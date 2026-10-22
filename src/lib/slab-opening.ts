// 수직 관통 오브젝트가 뚫는 슬래브 개구부(OE-ML-03).
//
// **저장하지 않고 지금 형상에서 계산한다.** 오브젝트를 옮기거나(OE-ML-07) 층 조각 형상·구간을 바꾸거나(OE-ML-08) 지우면(OE-ML-09)
// 다음 계산에서 개구부가 따라 바뀐다 — 옛 자리의 편집 개구부는 계산에서 빠지고, BIM 개구부는 원본이라 그대로 남는다. 되돌리기도
// 오브젝트를 되돌리면 개구부가 같이 돌아온다.
//
// **관통하는 슬래브는 시작 층 위의 층 바닥이다.** 오브젝트가 1층~3층이면 2층·3층 바닥을 지난다. 시작 층(1층) 바닥과 끝 층(3층) 위의
// 지붕은 경계라 뚫지 않는다. 층 바닥 슬래브는 그 층 높이 ±0.6m 에 윗면이 있는 슬래브다(어느 층에 담겼는지는 보지 않는다 — 2층
// 바닥을 1층에 담는 BIM 이 있다). 그 층 조각에 형상이 없으면(계단이 끝나는 층) 바로 아래 조각의 형상이 올라온 자리다.
//
// 층마다 하나로 판정한다. 위에서부터 먼저 맞는 것이다.
// - `bim`      BIM 개구부(IfcOpeningElement)가 형상과 겹친다. 원본을 그대로 쓰고 새로 만들지 않는다. 계단은 평면 형상이 위층 슬래브
//              아래를 지나는 부분(첫 계단판)까지 포함해 슬래브가 일부 덮는 것이 정상이라, 덮은 넓이보다 BIM 개구부를 먼저 본다
//              (Institute 계단 4개: 덮은 넓이 6.0㎡ / 형상 21.6㎡ 인데 그 자리에 BIM 개구부가 있다).
// - `cut`      확정 편집 개구부: 슬래브 윗면이 형상의 25% 넘게 덮고 있다. 덮은 넓이(`coverM2`)를 뚫는다.
// - `open`     슬래브 외곽선이 이미 그 자리를 비워 두었다(구멍이 형상에 반영). 새로 만들지 않는다. **손대지 않은 BIM 오브젝트는
//              덮은 넓이와 상관없이 여기다** — 원본 BIM 의 계단과 슬래브는 같은 저작 도구가 맞춰 낸 것이라 슬래브 형상을 그대로 믿는다.
//              성수 B1F→1F 현장타설 계단 둘은 1F 바닥이 계단 평면의 30%·33% 를 덮는데, 긴 계단의 아랫부분이 슬래브 밑을 지나는 자리다.
//              뚫을지 재는 것은 사람이 만들거나 옮기거나 형상을 고친(`edited`) 오브젝트다.
// - `draft`    그 층 바닥에 슬래브가 없다(BIM 에 없거나 읽지 않음). 형상은 조각 형상으로 잡되 사람이 확인하기 전에는 확정하지 않는다.
// - `unmeasured` 그 층과 아래 조각 모두 평면 형상이 없어 개구부 형상을 정할 근거가 없다. 임의 형상을 만들지 않는다.
import polygonClipping, { type MultiPolygon, type Polygon, type Ring } from 'polygon-clipping'
import type { Model, Slab, Space, Storey, Vec2 } from './model'
import { overlapArea } from './polygon'
import { pointInPolygon } from './mapping'
import { polygonArea } from './model'
import { type VerticalObject, verticalObjects } from './vertical-object'
import { josa } from './josa'

/** 층 바닥 슬래브로 보는 윗면 높이 차(m). */
export const SLAB_LEVEL_TOLERANCE = 0.6
/**
 * 슬래브가 형상의 이 비율보다 넓게 덮어야 뚫는다. 그 밑이면 외곽선이 이미 비워 둔 자리로 본다(가장자리가 걸친 것) — Duplex 계단 둘은
 * 바닥 외곽선이 계단 자리를 비워 두었고, 가장자리가 0.41㎡ / 3.45㎡(12%) 걸친다.
 */
export const SLAB_COVER_RATIO = 0.25

export type SlabOpeningState = 'cut' | 'bim' | 'open' | 'draft' | 'unmeasured'

export type SlabOpening = {
  objectId: string
  /** 바닥이 뚫리는 층. */
  storeyId: string
  state: SlabOpeningState
  /** 개구부 평면 형상(오브젝트의 층 조각 형상). 근거가 없으면 null. */
  footprint: Vec2[] | null
  /** 형상 넓이(㎡). */
  areaM2: number | null
  /** 슬래브 윗면이 형상을 덮은 넓이(㎡). `cut` 이면 이만큼 뚫는다. */
  coverM2: number | null
  /** 덮은 슬래브(`cut`)나 BIM 개구부가 있는 슬래브(`bim`)의 id. */
  slabId?: string
  /** 다시 쓰는 BIM 개구부(IfcOpeningElement) id. */
  bimOpeningId?: string
  reason: string
}

const tris = (slab: Slab): [Vec2, Vec2, Vec2][] => {
  const out: [Vec2, Vec2, Vec2][] = []
  for (let i = 0; i + 5 < slab.tris.length; i += 6) out.push([[slab.tris[i], slab.tris[i + 1]], [slab.tris[i + 2], slab.tris[i + 3]], [slab.tris[i + 4], slab.tris[i + 5]]])
  return out
}
const m2 = (v: number) => `${v.toFixed(2)}㎡`
/** "슬래브 이름이" · "슬래브 이름 외 2개가". */
const slabName = (slab: Slab, count: number) => {
  const name = slab.name || '슬래브'
  return count > 1 ? `${name} 외 ${count - 1}개가` : `${name}${josa(name, '이/가')}`
}

/** 격자 한 변의 점 수. 형상 안의 점 중 어느 슬래브든 덮는 점의 비율로 덮은 넓이를 잰다. */
const GRID = 32

/**
 * 슬래브들이 형상을 덮은 넓이(합집합)와 가장 많이 덮은 슬래브. 슬래브마다 겹친 넓이를 더하면 겹겹이 쌓인 바닥(Duplex 2층: 구조층·마감층
 * 10개)을 여러 번 세어 형상보다 커진다(4.56㎡ / 3.45㎡). 그래서 형상 범위를 격자로 찍어 형상 안이면서 어느 슬래브 윗면 삼각형에든 드는
 * 점의 비율로 잰다. 한 변 32점이면 2m×2m 샤프트에서 칸이 6cm 다.
 */
function coverOf(footprint: readonly Vec2[], area: number, slabs: readonly Slab[]): { cover: number; coveredBy: Slab | null; covering: number } {
  const xs = footprint.map((p) => p[0])
  const ys = footprint.map((p) => p[1])
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
  const all = slabs.map((slab) => ({ slab, tris: tris(slab).filter((t) => !(Math.max(t[0][0], t[1][0], t[2][0]) < x0 || Math.min(t[0][0], t[1][0], t[2][0]) > x1 || Math.max(t[0][1], t[1][1], t[2][1]) < y0 || Math.min(t[0][1], t[1][1], t[2][1]) > y1)) }))
  let inside = 0
  let covered = 0
  const hits = new Map<Slab, number>()
  for (let i = 0; i < GRID; i++) {
    for (let j = 0; j < GRID; j++) {
      const p: Vec2 = [x0 + ((i + 0.5) / GRID) * (x1 - x0), y0 + ((j + 0.5) / GRID) * (y1 - y0)]
      if (!pointInPolygon(p, footprint)) continue
      inside++
      let any = false
      for (const { slab, tris: ts } of all) {
        if (!ts.some((t) => inTriangle(p, t))) continue
        hits.set(slab, (hits.get(slab) ?? 0) + 1)
        any = true
      }
      if (any) covered++
    }
  }
  const coveredBy = [...hits].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
  return { cover: inside ? (area * covered) / inside : 0, coveredBy, covering: hits.size }
}

const inTriangle = (p: Vec2, [a, b, c]: readonly [Vec2, Vec2, Vec2]) => {
  const d1 = (p[0] - b[0]) * (a[1] - b[1]) - (a[0] - b[0]) * (p[1] - b[1])
  const d2 = (p[0] - c[0]) * (b[1] - c[1]) - (b[0] - c[0]) * (p[1] - c[1])
  const d3 = (p[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (p[1] - a[1])
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))
}

/** 그 층 바닥 높이에 윗면이 있는 슬래브(모든 층에서 찾는다). */
export function floorSlabs(model: Pick<Model, 'storeys'>, storey: Storey): Slab[] {
  return model.storeys.flatMap((s) => s.slabs ?? []).filter((slab) => Math.abs(slab.top - storey.elevation) <= SLAB_LEVEL_TOLERANCE)
}

/** 사람이 만들거나 옮기거나 형상을 고치지 않은 BIM 오브젝트. 슬래브 형상을 그대로 믿어 새로 뚫지 않는다(위 `open`). */
const isPristine = (object: VerticalObject) => object.source === 'bim' && object.parts.every((p) => !p.part.edited)

/** 오브젝트 하나가 지나는 층 바닥마다의 개구부 판정(층 높이 순). 시작 층은 넣지 않는다. */
export function slabOpenings(model: Pick<Model, 'storeys'>, object: VerticalObject): SlabOpening[] {
  const out: SlabOpening[] = []
  const pristine = isPristine(object)
  for (let i = 1; i < object.parts.length; i++) {
    const { storey, part } = object.parts[i]
    const below = object.parts[i - 1].part
    const footprint = part.footprint.length >= 3 ? part.footprint : below.footprint.length >= 3 ? below.footprint : null
    const base = { objectId: object.id, storeyId: storey.id }
    if (!footprint) {
      out.push({ ...base, state: 'unmeasured', footprint: null, areaM2: null, coverM2: null, reason: `${storey.name}${josa(storey.name, '과/와')} 아래 층 조각 모두 평면 형상이 없어 개구부 형상을 정할 근거가 없습니다. 형상을 채운 뒤 다시 잽니다.` })
      continue
    }
    const area = Math.abs(polygonArea(footprint))
    const slabs = floorSlabs(model, storey)
    if (!slabs.length) {
      out.push({
        ...base,
        state: 'draft',
        footprint,
        areaM2: area,
        coverM2: null,
        reason: `${storey.name} 바닥 높이(±${SLAB_LEVEL_TOLERANCE}m)에 슬래브가 없습니다(BIM 에 바닥 슬래브가 없거나 읽지 않음). 조각 형상으로 초안을 두고, 확인 전에는 면적에 반영하지 않습니다.`,
      })
      continue
    }
    const { cover, coveredBy, covering } = coverOf(footprint, area, slabs)
    const hole = slabs.flatMap((slab) => slab.openings.map((o) => ({ slab, o, shared: overlapArea(footprint, o.footprint) ?? 0 }))).sort((a, b) => b.shared - a.shared)[0]
    if (hole && hole.shared > 0) {
      out.push({
        ...base,
        state: 'bim',
        footprint,
        areaM2: area,
        coverM2: cover,
        slabId: hole.slab.id,
        bimOpeningId: hole.o.id,
        reason: `BIM 개구부가 이미 뚫려 있어(겹친 넓이 ${m2(hole.shared)}) 원본을 그대로 씁니다. 새로 만들지 않습니다.`,
      })
    } else if (!pristine && cover > area * SLAB_COVER_RATIO && coveredBy) {
      out.push({
        ...base,
        state: 'cut',
        footprint,
        areaM2: area,
        coverM2: cover,
        slabId: coveredBy.id,
        reason: `${slabName(coveredBy, covering)} 이 자리를 덮고 있어(덮은 넓이 ${m2(cover)} / 형상 ${m2(area)}) 개구부를 냅니다.`,
      })
    } else {
      out.push({
        ...base,
        state: 'open',
        footprint,
        areaM2: area,
        coverM2: cover,
        reason: pristine && cover > area * SLAB_COVER_RATIO
          ? `원본 BIM 오브젝트라 슬래브 형상을 그대로 씁니다(덮은 넓이 ${m2(cover)} / 형상 ${m2(area)} — 계단이 슬래브 밑을 지나는 자리). 새로 만들지 않습니다.`
          : `슬래브 외곽선이 이 자리를 이미 비워 두었습니다(덮은 넓이 ${m2(cover)} / 형상 ${m2(area)}). 새로 만들지 않습니다.`,
      })
    }
  }
  return out
}

/** 판정의 짧은 이름(패널·리포트). */
export const SLAB_OPENING_LABEL: Record<SlabOpeningState, string> = {
  cut: '개구부 확정',
  bim: 'BIM 개구부',
  open: '이미 비어 있음',
  draft: '초안',
  unmeasured: '산정 못 함',
}

const q = (v: number) => Math.round(v * 1000) / 1000
const toRing = (ring: readonly Vec2[]): Ring => {
  const pts: Ring = ring.map((p) => [q(p[0]), q(p[1])])
  const [a, z] = [pts[0], pts.at(-1)]
  return a && z && (a[0] !== z[0] || a[1] !== z[1]) ? [...pts, [a[0], a[1]]] : pts
}
const ringArea = (r: Ring) => {
  let s = 0
  for (let i = 0; i + 1 < r.length; i++) s += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1]
  return Math.abs(s) / 2
}
const multiArea = (m: MultiPolygon) => m.reduce((n, p) => n + ringArea(p[0]) - p.slice(1).reduce((h, r) => h + ringArea(r), 0), 0)

/**
 * 물리존 id → 확정 편집 개구부(`cut`)가 그 물리존에서 빼는 넓이(㎡). 뺄 것이 있는 물리존만 든다(OE-ML-03 AC2~4 · OE-ML-09 AC3).
 * 원본 BIM 개구부(`bim` · `open`)는 원본 외곽선이 이미 비워 두어 다시 빼지 않고, 초안(`draft`)·산정 못 함(`unmeasured`)도 빼지 않는다.
 * 그 층 바닥의 확정 개구부를 합집합으로 합친 뒤 물리존 외곽선과 겹친 넓이를 잰다 — 두 샤프트가 겹치면 겹친 자리는 한 번만 빠진다.
 * 손대지 않은 BIM 오브젝트는 `cut` 이 나오지 않아(slabOpenings) 재지 않는다.
 * `only` 를 주면 그 개구부만 센다 — 오브젝트 하나가 지금 얼마를 빼는지, 구간을 줄이면 얼마가 돌아오는지 미리 볼 때 쓴다(OE-ML-07·08·09 영향 표시).
 */
export function spaceSlabCuts(model: Pick<Model, 'storeys'>, only?: (objectId: string, storeyId: string) => boolean): Map<string, number> {
  const cuts = new Map<string, Polygon[]>()
  for (const obj of verticalObjects(model)) {
    if (isPristine(obj)) continue
    for (const o of slabOpenings(model, obj)) {
      if (o.state !== 'cut' || !o.footprint || o.footprint.length < 3) continue
      if (only && !only(o.objectId, o.storeyId)) continue
      cuts.set(o.storeyId, [...(cuts.get(o.storeyId) ?? []), [toRing(o.footprint)]])
    }
  }
  const out = new Map<string, number>()
  for (const storey of model.storeys) {
    const polys = cuts.get(storey.id)
    if (!polys) continue
    const union = polygonClipping.union(polys[0], ...polys.slice(1))
    for (const space of storey.spaces) {
      if (space.footprint.length < 3) continue
      const cut = multiArea(polygonClipping.intersection([toRing(space.footprint)], union))
      if (cut > 1e-6) out.set(space.id, cut)
    }
  }
  return out
}

/** 확정 편집 개구부를 뺀 물리존 넓이(㎡). TTL·GeoJSON 의 `areaM2` 와 물리존 패널이 이 값이다. 외곽선 넓이(`Space.areaM2`)는 그대로 둔다. */
export const netAreaM2 = (space: Pick<Space, 'id' | 'areaM2'>, cuts: ReadonlyMap<string, number>) => Math.max(0, space.areaM2 - (cuts.get(space.id) ?? 0))
