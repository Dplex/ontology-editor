// B. 풍량 밀도(heat) — 물리존 바닥을 "그 방을 맡은 급기 말단의 정격 풍량 합 ÷ 면적(CMH/㎡)" 으로 칠한다(docs/plans/easter-eggs.md).
//
// - 담당은 담당 공간 표(served.ts 의 airServices)가 낸 것만 쓴다. 연결은 내보내기(TTL)와 같다 — 확정된 방향만, 유체가 흐르는 것만
//   (fluidConnections(withInferred(…, true))). 그래서 칠한 방은 TTL 에서 그 원천이 `brick:feeds` 하는 방이다.
// - 정격 풍량은 말단의 `ratedAirflow.cmh`(BIM 값을 CMH 로 바꾼 것 또는 사람이 넣은 것)만, 면적은 외곽선으로 잰 `areaM2` 만 쓴다.
// - **값이 없는 방은 0 으로 칠하지 않는다.** 맡은 말단이 없거나, 맡은 말단 가운데 하나라도 풍량이 없거나, 면적이 0 이면 빗금 회색에
//   "값 없음" 이다. 일부 말단만 더하면 실제보다 작은 값이 정상인 것처럼 보이기 때문이다.
// - 범례에 구간과 방 수, 값 없음의 까닭별 수, 출처(풍량 BIM·편집 · 면적 계산)를 적는다.
// - 층마다 메시 둘(칠한 판·빗금 판)이다. 한 층만 보고 있으면 그 층만 보인다.
// - 칠할 방이 하나도 없으면 범례 맨 위에 그렇다고 굵게 적는다. 성수는 정격 풍량이 있는 설비가 0대라 453개 방이 전부 빗금이었고,
//   빗금은 물리존 판에 묻혀서 켰는지조차 몰랐다(2026-10-24 피드백).
import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  RepeatWrapping,
  ShapeUtils,
  Vector2,
} from 'three'
import { watch } from 'vue'
import { withInferred } from '../lib/flow-rules'
import { fluidConnections } from '../lib/flow-review'
import type { Model, Vec2 } from '../lib/model'
import { airServices } from '../lib/served'
import type { EggContext, EggHandle } from './types'

/** 낮은 값에서 높은 값으로. 노랑 → 빨강(밝은 바탕·어두운 바탕 둘 다에서 구간이 갈린다). */
export const HEAT_COLORS = [0xfde68a, 0xfbbf24, 0xf97316, 0xdc2626, 0x7f1d1d]
const NONE_COLOR = 0x94a3b8
/** 판을 층 바닥에서 띄우는 높이. 물리존 판(0.1 안팎)보다 조금 위다. */
const LIFT = 0.16
const REBUILD_SETTLE_MS = 250

export type RoomHeat =
  | { spaceId: string; storeyId: string; ring: Vec2[]; value: number; cmh: number; area: number; terminals: number }
  | { spaceId: string; storeyId: string; ring: Vec2[]; value: null; why: 'no-terminal' | 'no-airflow' | 'no-area'; terminals: number }

export type HeatReading = {
  rooms: RoomHeat[]
  /** 구간 경계(오름차순, 구간 수 + 1개). 값 있는 방이 없으면 빈 배열. */
  breaks: number[]
  sources: { bim: number; edit: number }
}

/** 방마다 밀도를 잰다. 단위 테스트가 직접 부른다. */
export function readHeat(model: Readonly<Model>): HeatReading {
  const m = model as Model
  const services = airServices(m, fluidConnections(m, withInferred(m.connections, true)))
  const terminals = new Set(services.flatMap((s) => s.supply))
  const byId = new Map(m.storeys.flatMap((s) => s.equipment).map((e) => [e.id, e]))
  const perSpace = new Map<string, string[]>()
  for (const id of terminals) {
    const spaceId = byId.get(id)?.spaceId
    if (!spaceId) continue
    const list = perSpace.get(spaceId)
    if (list) list.push(id)
    else perSpace.set(spaceId, [id])
  }
  const sources = { bim: 0, edit: 0 }
  const rooms: RoomHeat[] = []
  for (const st of m.storeys) {
    for (const sp of st.spaces) {
      if (sp.footprint.length < 3) continue
      const ids = perSpace.get(sp.id) ?? []
      const base = { spaceId: sp.id, storeyId: st.id, ring: sp.footprint, terminals: ids.length }
      if (!ids.length) {
        rooms.push({ ...base, value: null, why: 'no-terminal' })
        continue
      }
      const flows = ids.map((id) => byId.get(id)?.ratedAirflow)
      if (flows.some((f) => !f)) {
        rooms.push({ ...base, value: null, why: 'no-airflow' })
        continue
      }
      if (!(sp.areaM2 > 0)) {
        rooms.push({ ...base, value: null, why: 'no-area' })
        continue
      }
      let cmh = 0
      for (const f of flows) {
        cmh += f!.cmh
        sources[f!.source]++
      }
      rooms.push({ ...base, value: cmh / sp.areaM2, cmh, area: sp.areaM2 })
    }
  }
  return { rooms, breaks: quantileBreaks(rooms.flatMap((r) => (r.value === null ? [] : [r.value])), HEAT_COLORS.length), sources }
}

/** 같은 수씩 나눈 구간 경계(소수 한 자리로 반올림, 겹치는 경계는 합친다). */
export function quantileBreaks(values: number[], bins: number): number[] {
  if (!values.length) return []
  const s = [...values].sort((a, b) => a - b)
  const round = (v: number) => Math.round(v * 10) / 10
  const out = [round(s[0])]
  for (let i = 1; i < bins; i++) {
    const v = round(s[Math.min(s.length - 1, Math.floor((i * s.length) / bins))])
    if (v > out[out.length - 1]) out.push(v)
  }
  const top = round(s[s.length - 1])
  if (top > out[out.length - 1]) out.push(top)
  else if (out.length === 1) out.push(out[0])
  return out
}

/** 값이 든 구간의 번호. 경계에 걸리면 위 구간이다(맨 위 경계는 맨 위 구간). */
export function binOf(value: number, breaks: number[]): number {
  for (let i = breaks.length - 2; i >= 0; i--) if (value >= breaks[i]) return i
  return 0
}

/** 1m 마다 되풀이되는 빗금. 번들 안에서 그린다(원격 텍스처를 받지 않는다). */
function hatchTexture(): CanvasTexture {
  const c = document.createElement('canvas')
  c.width = c.height = 32
  const g = c.getContext('2d')!
  g.fillStyle = 'rgba(148,163,184,0.25)'
  g.fillRect(0, 0, 32, 32)
  g.strokeStyle = 'rgba(148,163,184,0.95)'
  g.lineWidth = 3
  for (const o of [-32, 0, 32]) {
    g.beginPath()
    g.moveTo(o, 32)
    g.lineTo(o + 32, 0)
    g.stroke()
  }
  const t = new CanvasTexture(c)
  t.wrapS = t.wrapT = RepeatWrapping
  return t
}

/** 고리들을 한 형상으로 삼각형을 나눠 합친다(장면 좌표, 층 바닥 + LIFT). UV 는 미터라 빗금이 1m 마다 되풀이된다. */
function plateGeometry(items: { ring: Vec2[]; color: Color | null }[], elevation: number): BufferGeometry {
  const pos: number[] = []
  const col: number[] = []
  const uv: number[] = []
  for (const { ring, color } of items) {
    const closed = ring.length > 3 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]
    const pts = (closed ? ring.slice(0, -1) : ring).map((p) => new Vector2(p[0], p[1]))
    if (pts.length < 3) continue
    for (const [a, b, c] of ShapeUtils.triangulateShape(pts, [])) {
      for (const i of [a, b, c]) {
        const p = pts[i]
        pos.push(p.x, elevation + LIFT, -p.y)
        uv.push(p.x, p.y)
        if (color) col.push(color.r, color.g, color.b)
      }
    }
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3))
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2))
  if (col.length) g.setAttribute('color', new BufferAttribute(new Float32Array(col), 3))
  return g
}

export function enable(ctx: EggContext): EggHandle {
  const root = new Group()
  const hatch = hatchTexture()
  const fillMat = new MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.78, depthWrite: false, side: DoubleSide })
  const noneMat = new MeshBasicMaterial({ map: hatch, color: NONE_COLOR, transparent: true, opacity: 0.85, depthWrite: false, side: DoubleSide })
  const byStorey = new Map<string, Group>()
  let reading: HeatReading | null = null
  let needsFrame = false

  const hud = ctx.hud
  hud.style.cssText =
    'padding:0.5rem 0.65rem;border:1px solid var(--line);border-radius:6px;background:color-mix(in srgb,var(--surface) 92%,transparent);font:12px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--fg)'

  function clear() {
    for (const g of byStorey.values()) for (const o of g.children) (o as Mesh).geometry.dispose()
    byStorey.clear()
    root.clear()
  }

  function build() {
    const m = ctx.model()
    clear()
    if (!m) return
    reading = readHeat(m)
    const colors = HEAT_COLORS.map((c) => new Color(c))
    const elevation = new Map(m.storeys.map((s) => [s.id, s.elevation]))
    const groups = new Map<string, { fill: { ring: Vec2[]; color: Color }[]; none: { ring: Vec2[]; color: null }[] }>()
    for (const r of reading.rooms) {
      const g = groups.get(r.storeyId) ?? { fill: [], none: [] }
      groups.set(r.storeyId, g)
      if (r.value === null) g.none.push({ ring: r.ring, color: null })
      else g.fill.push({ ring: r.ring, color: colors[binOf(r.value, reading.breaks)] })
    }
    for (const [storeyId, g] of groups) {
      const group = new Group()
      const y = elevation.get(storeyId) ?? 0
      if (g.fill.length) group.add(new Mesh(plateGeometry(g.fill, y), fillMat))
      if (g.none.length) group.add(new Mesh(plateGeometry(g.none, y), noneMat))
      group.userData.storeyId = storeyId
      byStorey.set(storeyId, group)
      root.add(group)
    }
    showStorey()
    paintLegend()
    needsFrame = true
  }

  function showStorey() {
    const only = ctx.signals.storeyId.value
    for (const [id, g] of byStorey) g.visible = !only || id === only
  }

  function paintLegend() {
    const r = reading
    hud.replaceChildren()
    if (!r) return
    const doc = hud.ownerDocument
    const line = (text: string, color?: number, hatched = false) => {
      const row = doc.createElement('div')
      row.style.cssText = 'display:flex;align-items:center;gap:0.45rem'
      if (color !== undefined) {
        const sw = doc.createElement('span')
        sw.style.cssText = `display:inline-block;width:0.9rem;height:0.65rem;border-radius:2px;background:${hatched ? `repeating-linear-gradient(135deg,#94a3b8 0 2px,transparent 2px 5px)` : `#${color.toString(16).padStart(6, '0')}`}`
        row.append(sw)
      }
      const t = doc.createElement('span')
      t.textContent = text
      row.append(t)
      hud.append(row)
      return row
    }
    const valued = r.rooms.filter((x) => x.value !== null) as Extract<RoomHeat, { value: number }>[]
    if (!valued.length) {
      const empty = line('이 파일에는 칠할 방이 없습니다 · 까닭은 아래 "값 없음" 줄에')
      empty.dataset.testid = 'egg-heat-empty'
      empty.style.fontWeight = '600'
      empty.style.color = 'var(--warn-fg, var(--fg))'
    }
    line('풍량 밀도 · 맡은 급기 말단의 정격 풍량 합 ÷ 면적 (CMH/㎡) · 화면에서만')
    for (let i = 0; i < r.breaks.length - 1; i++) {
      const lo = r.breaks[i]
      const hi = r.breaks[i + 1]
      const n = valued.filter((x) => binOf(x.value, r.breaks) === i).length
      line(`${lo.toLocaleString()} – ${hi.toLocaleString()} · 방 ${n.toLocaleString()}`, HEAT_COLORS[i])
    }
    const why = (w: string) => r.rooms.filter((x) => x.value === null && x.why === w).length
    const none = r.rooms.length - valued.length
    line(`값 없음 · 방 ${none.toLocaleString()} (맡은 말단 없음 ${why('no-terminal')} · 말단 풍량 없음 ${why('no-airflow')} · 면적 없음 ${why('no-area')})`, NONE_COLOR, true)
    const src = line(`출처 · 풍량 BIM ${r.sources.bim.toLocaleString()} · 편집 ${r.sources.edit.toLocaleString()} · 면적 계산 · 담당은 확정된 흐름 방향`)
    src.style.color = 'var(--muted)'
  }

  build()

  let timer: ReturnType<typeof setTimeout> | null = null
  const stopModel = watch(
    () => ctx.modelVersion(),
    () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        build()
      }, REBUILD_SETTLE_MS)
    },
  )
  const stopStorey = watch(ctx.signals.storeyId, () => {
    showStorey()
    needsFrame = true
  })

  ctx.addLayer({
    object: root,
    step() {
      const draw = needsFrame
      needsFrame = false
      return draw
    },
    dispose() {
      clear()
      fillMat.dispose()
      noneMat.dispose()
      hatch.dispose()
    },
  })

  return {
    off() {
      stopModel()
      stopStorey()
      if (timer) clearTimeout(timer)
    },
    inspect: () => {
      const r = reading
      if (!r) return null
      const valued = r.rooms.filter((x) => x.value !== null).length
      return { rooms: r.rooms.length, valued, none: r.rooms.length - valued, breaks: r.breaks, sources: r.sources, meshes: [...byStorey.values()].reduce((n, g) => n + g.children.length, 0), hud: hud.textContent }
    },
  }
}
