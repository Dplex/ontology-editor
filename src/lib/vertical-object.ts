// 수직 관통 오브젝트(OE-ML-02·OE-OBJ-14, ADR-0033). EL·ES·계단·샤프트처럼 여러 층을 지나는 것을 물리존과 따로 둔다.
//
// **층별 조각이 데이터다.** 오브젝트 하나는 층마다 조각 하나(`Storey.verticalParts`)를 두고, 같은 `parentId` 로 묶인다. 조각에는 그 층의
// 평면 형상과 진입(아래 끝)·종료(위 끝) 지점이 있다. 계단은 층마다 모양과 자리가 달라서(1층에서 오르기 시작하는 자리와 2층에 다다르는
// 자리가 다르다) 공통 축 하나로는 모자란다.
//
// **계단은 BIM 의 IfcStair 에서 만든다.** Revit 은 계단을 층 구간 하나씩 내보내고(시작 층에 속한다), 형상은 계단판(IfcStairFlight)과
// 참(IfcSlab)이다. 난간(IfcRailing·IfcMember)은 위 끝을 1m 쯤 올려 위층을 잘못 고르게 하므로 뺀다. 가진 파일 7개의 계단 50개를 쟀을 때
// 난간을 뺀 위 끝은 위층 바닥보다 0~0.17m 낮았다(병원 4.52 / 2층 4.57). 하위 부재가 없는 계단(FZK·Institute)은 자기 형상을 쓴다.
//
// **연관 물리존은 저장하지 않는다.** 진입·종료 지점이 드는 물리존을 그때 짚는다. 사람이 물리존을 나누거나 지워도 낡은 id 가 남지 않는다.

import { locate } from './mapping'
import { convexHull } from './polygon'
import type { Model, Storey, Vec2, Vec3, VerticalKind, VerticalPart } from './model'

/** 위 끝이 위층 바닥보다 이만큼 높아도 그 층에 다다른 것으로 본다(미터). 하위 부재가 없어 난간이 섞인 계단도 위층을 넘겨짚지 않게 좁게 둔다. */
export const STOREY_REACH = 0.3
/** 시작 층보다 이만큼 넘게 높은 층만 위층으로 본다(미터). 한 층 안의 몇 계단(성수 B1F 의 0.9m)은 층을 잇지 않는다. */
export const MIN_RISE = 1.0
/** 아래·위 끝 지점을 모으는 높이 폭(미터). 첫 단·마지막 단 언저리의 점이다. */
const END_BAND = 0.2

const mm = (v: number) => Math.round(v * 1000) / 1000

/** 점들의 평균. 진입·종료 지점이다. */
function mean(points: readonly Vec3[]): Vec3 | null {
  if (!points.length) return null
  const sum = points.reduce((s, p) => [s[0] + p[0], s[1] + p[1], s[2] + p[2]], [0, 0, 0])
  return [mm(sum[0] / points.length), mm(sum[1] / points.length), mm(sum[2] / points.length)]
}

/**
 * 계단 형상의 점(세계 좌표 x·y, 높이 z)으로 층별 조각을 만든다. 다른 층에 닿지 않는 계단은 null 이다(수직 관통이 아니다).
 *
 * - 끝 층: 시작 층보다 MIN_RISE 넘게 높고, 위 끝 + STOREY_REACH 이하인 층 중 가장 높은 층
 * - 지나는 층: 시작 층부터 끝 층까지. 성수 B5F 계단은 중간층 B5'F 를 지나 B4F 에 닿는다
 * - 형상: 층마다 그 층 높이 구간에 든 점의 볼록 껍질. 끝 층은 다다르는 자리뿐이라 형상이 없다
 */
export function stairParts(
  stair: { id: string; name: string; points: readonly Vec3[] },
  base: Storey,
  storeys: readonly Storey[],
): { storey: Storey; part: VerticalPart }[] | null {
  const pts = stair.points
  if (pts.length < 3) return null
  let zmin = Infinity
  let zmax = -Infinity
  for (const p of pts) {
    if (p[2] < zmin) zmin = p[2]
    if (p[2] > zmax) zmax = p[2]
  }
  const sorted = storeys.filter((s) => Number.isFinite(s.elevation)).sort((a, b) => a.elevation - b.elevation)
  const above = sorted.filter((s) => s.elevation > base.elevation + MIN_RISE && s.elevation <= zmax + STOREY_REACH)
  const top = above.at(-1)
  if (!top) return null
  const through = sorted.filter((s) => s.elevation >= base.elevation && s.elevation <= top.elevation)
  if (through[0] !== base) return null

  const entry = mean(pts.filter((p) => p[2] <= zmin + END_BAND))
  const reach = pts.filter((p) => p[2] <= top.elevation + STOREY_REACH)
  const ztop = Math.max(...reach.map((p) => p[2]))
  const exit = mean(reach.filter((p) => p[2] >= ztop - END_BAND))

  return through.map((storey, i) => {
    const last = i === through.length - 1
    const lo = i === 0 ? -Infinity : storey.elevation
    const band = last ? [] : pts.filter((p) => p[2] >= lo && p[2] < through[i + 1].elevation).map((p) => [p[0], p[1]] as Vec2)
    const hull = convexHull(band).map((p) => [mm(p[0]), mm(p[1])] as Vec2)
    return {
      storey,
      part: {
        parentId: stair.id,
        kind: 'stair',
        name: stair.name,
        source: 'bim',
        footprint: hull.length >= 3 ? hull : [],
        entry: i === 0 ? entry : null,
        exit: last ? exit : null,
      },
    }
  })
}

/** GeoJSON 에서 조각을 가리키는 id. 오브젝트 id 와 층 id 로 짓는다(OE-ML-02 "부모 오브젝트 ID 와 층 ID 로 식별"). */
export const partId = (parentId: string, storeyId: string) => `${parentId}@${storeyId}`

/** 조각의 진입·종료 지점이 드는 물리존. 지점이 없는 사이 층 조각은 비어 있다. */
export function partSpaces(storey: Storey, part: VerticalPart): string[] {
  const ids = [part.entry, part.exit].flatMap((p) => (p ? [locate([p[0], p[1]], storey.spaces)] : []))
  return [...new Set(ids.filter((id): id is string => id !== null))]
}

export type VerticalObject = {
  id: string
  kind: VerticalKind
  name: string
  source: VerticalPart['source']
  /** 층 높이 순. 첫 조각이 시작 층, 끝 조각이 끝 층이다. */
  parts: { storey: Storey; part: VerticalPart }[]
}

/** 층별 조각을 오브젝트로 묶는다. 오브젝트 순서는 처음 나온 순서다. */
export function verticalObjects(model: Pick<Model, 'storeys'>): VerticalObject[] {
  const out = new Map<string, VerticalObject>()
  for (const storey of model.storeys) {
    for (const part of storey.verticalParts ?? []) {
      const had = out.get(part.parentId)
      if (had) had.parts.push({ storey, part })
      else out.set(part.parentId, { id: part.parentId, kind: part.kind, name: part.name, source: part.source, parts: [{ storey, part }] })
    }
  }
  for (const o of out.values()) o.parts.sort((a, b) => a.storey.elevation - b.storey.elevation)
  return [...out.values()]
}

/** 조각 id → 같은 오브젝트에서 바로 아래·위 조각 id. 오브젝트가 말하는 층별 경로다. */
export function partLinks(objects: readonly VerticalObject[]): Map<string, string[]> {
  const out = new Map<string, string[]>()
  for (const o of objects) {
    const ids = o.parts.map((p) => partId(o.id, p.storey.id))
    ids.forEach((id, i) => out.set(id, [ids[i - 1], ids[i + 1]].filter((x): x is string => !!x)))
  }
  return out
}

/**
 * 오브젝트가 명시한 물리존 사이 연결(OE-ML-19 "명시된 수직 관통 오브젝트의 … 연관 공간을 우선"). 시작 층 진입 지점의 물리존과 끝 층
 * 종료 지점의 물리존을 잇는다. 한쪽 물리존을 못 짚으면 잇지 않는다 — 그 물리존은 겹침 후보에 남는다.
 */
export function explicitSpaceLinks(objects: readonly VerticalObject[]): { a: string; b: string; parentId: string; source: VerticalPart['source'] }[] {
  const out: { a: string; b: string; parentId: string; source: VerticalPart['source'] }[] = []
  for (const o of objects) {
    const first = o.parts[0]
    const last = o.parts.at(-1)!
    if (first === last) continue
    const [a] = partSpaces(first.storey, first.part)
    const [b] = partSpaces(last.storey, last.part)
    if (a && b && a !== b) out.push({ a, b, parentId: o.id, source: o.source })
  }
  return out
}
