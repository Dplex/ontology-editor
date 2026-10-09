// 외벽 판정(OE-EXT-01). BIM 이 외벽 여부(Pset_WallCommon.IsExternal)를 말하면 그것을 쓰고, 말하지 않은 벽만
// **건물 바깥에 닿는지**로 계산한다. Revit 은 벽마다 IsExternal 을 적지만 ArchiCAD(AC20)는 13장 전부 비워 둔다.
//
// 바깥은 층 평면을 격자로 칠하고 테두리에서 채워 들어가 찾는다. 벽·방 바닥이 막고, 채움이 닿은 칸이 바깥이다.
// 광선 하나로 보면 ㄱ자 건물의 안쪽 모서리 외벽이 다른 날개에 막혀 내벽이 된다 — 채움은 돌아 나가므로 안 틀린다.
// 벽 바닥 외곽선에는 문 자리가 뚫려 있지만 그 뒤를 방 바닥이 막아서 채움이 건물 안으로 새지 않는다.
// 방과 벽 면 사이의 틈(Revit 방은 벽 면에서 몇 cm 떨어져 있다)은 칸 하나만큼 부풀려 메운다.
//
// 모델에 저장하지 않고 쓸 때 계산한다(vertical.ts 와 같다). 벽을 옮기거나 더하고 지우면 다음 계산에 그대로 반영되어
// 재판정을 호출부에 맡길 일이 없다. 접은 방법과 실측은 docs/adr/0002-external-wall-flood-fill.md.

import { isConduit, type Model, type Storey, type Vec2, type Wall } from './model'
import { exteriorKind } from './mapping'

/** 격자 한 칸(미터). 문 폭(0.8m~)보다 충분히 작고, 방-벽 틈(몇 cm)보다 크다. */
const CELL = 0.1
/** 격자가 이보다 커지면 칸을 키운다(층 범위가 대지까지 넓은 파일). */
const MAX_CELLS = 6_000_000
/** 벽에서 이 칸 수 안에 바깥 칸이 있으면 바깥에 닿은 것으로 센다. 부풀린 한 칸 + 여유 한 칸. */
const REACH = 2
/**
 * 벽 길이 중 바깥에 닿은 비율이 이보다 크면 외벽이다. 외벽은 한쪽 면 전체가 바깥이라 1 가까이 나오고, 바깥 모서리에
 * 끝만 닿은 내벽은 끝을 빼고 세므로(END_MARGIN) 0 가까이 나온다. Duplex·병원 건축의 IsExternal 에 대 본다(check:sample).
 */
const MIN_SHARE = 0.3
/**
 * 벽 양 끝에서 이만큼(미터)은 닿아도 세지 않는다. 내벽 끝이 외벽에 붙으면 외벽 두께 너머의 바깥이 끝에 닿는다 —
 * 외벽 두께(병원 0.3m 안팎)만큼이다. 0.2~0.7m 사이는 Duplex·병원 정답 대조가 1,070±1 장으로 같아 가운데를 골랐다.
 * 짧은 벽은 길이의 1/4 까지만 뺀다.
 */
const END_MARGIN = 0.3

export type ExternalSource = 'bim' | 'calc' | 'edit'
export type ExternalJudgement = { external: boolean; source: ExternalSource }

/**
 * 한 층의 벽 id → 외벽 여부. 사람이 정한 벽(OE-OBJ-04)은 그 값, BIM 이 말한 벽은 그대로, 안 말한 벽은 계산한다.
 * 사람이 "모름" 으로 정한 벽과 바닥 외곽선이 없는 벽은 빠진다.
 */
export function judgeExternal(storey: Storey): Map<string, ExternalJudgement> {
  const out = new Map<string, ExternalJudgement>()
  const unknown: Wall[] = []
  for (const wall of storey.walls) {
    if (wall.externalEdited) {
      if (wall.external != null) out.set(wall.id, { external: wall.external, source: 'edit' })
    } else if (wall.external != null) out.set(wall.id, { external: wall.external, source: 'bim' })
    else if (wall.footprint?.some((r) => r.length >= 3)) unknown.push(wall)
  }
  if (unknown.length) for (const [id, external] of touchesOutside(storey, unknown)) out.set(id, { external, source: 'calc' })
  return out
}

/** 모델 전체. 층마다 따로 센다 — 층이 다르면 바깥도 다르다. */
export function judgeExternalAll(model: Model): Map<string, ExternalJudgement> {
  const out = new Map<string, ExternalJudgement>()
  for (const storey of model.storeys) for (const [id, j] of judgeExternal(storey)) out.set(id, j)
  return out
}

/**
 * BIM 이 말한 것을 가리고 계산만으로 판정한다. 계산을 BIM 정답에 대 보는 데 쓴다(check:sample).
 * 다른 벽이 BIM 값을 가졌는지와 상관없이 모든 벽을 계산한다.
 */
export function computeExternal(storey: Storey): Map<string, boolean> {
  return touchesOutside(storey, storey.walls.filter((w) => w.footprint?.some((r) => r.length >= 3)))
}

function touchesOutside(storey: Storey, targets: readonly Wall[]): Map<string, boolean> {
  const out = new Map<string, boolean>()
  const walls: Vec2[][] = []
  for (const w of storey.walls) {
    const rings = (w.footprint ?? []).filter((r) => r.length >= 3)
    if (rings.length) walls.push(convexHull(rings.flat()))
  }
  const spaces = storey.spaces.filter((s) => s.footprint.length >= 3).map((s) => s.footprint as Vec2[])
  if (!walls.length) return out

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const r of [...walls, ...spaces]) for (const [x, y] of r) {
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  const pad = REACH + 2
  let cell = CELL
  while (((maxX - minX) / cell + 2 * pad) * ((maxY - minY) / cell + 2 * pad) > MAX_CELLS) cell *= 2
  const w = Math.ceil((maxX - minX) / cell) + 2 * pad
  const h = Math.ceil((maxY - minY) / cell) + 2 * pad
  const grid: Grid = { w, h, ox: minX - pad * cell, oy: minY - pad * cell, cell }

  const outside = floodOutside([...walls, ...spaces], grid)

  for (const wall of targets) {
    const rings = (wall.footprint ?? []).filter((r) => r.length >= 3)
    const cells = new Set<number>()
    for (const r of rings) for (const i of rasterize(r, grid)) cells.add(i)
    // 옆면에서 닿은 것만 센다. 끝에서 닿은 것은 빼야 외벽 둘 사이를 가로지르는 내벽(양 끝이 다 외벽에 붙는다)이
    // 내벽으로 남는다. 부풀린 한 칸 바로 바깥의 한 겹이 닿는 칸이라, 닿은 칸 수가 곧 바깥에 닿은 옆면 길이(칸)다.
    const axis = wallAxis(rings)
    const margin = Math.min(END_MARGIN, (axis.hi - axis.lo) / 4)
    const touched = new Set<number>()
    for (const i of cells) {
      const x = i % w, y = (i - x) / w
      for (let dy = -REACH; dy <= REACH; dy++) for (let dx = -REACH; dx <= REACH; dx++) {
        const nx = x + dx, ny = y + dy
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
        const j = ny * w + nx
        if (!outside[j] || touched.has(j)) continue
        const t = axis.at(grid.ox + (nx + 0.5) * cell, grid.oy + (ny + 0.5) * cell)
        if (t > axis.lo + margin && t < axis.hi - margin) touched.add(j)
      }
    }
    const share = touched.size / Math.max(1, (axis.hi - axis.lo - 2 * margin) / cell)
    out.set(wall.id, share > MIN_SHARE)
  }
  return out
}

type Grid = { w: number; h: number; ox: number; oy: number; cell: number }

/** 막는 다각형을 칠하고 칸 하나만큼 부풀린 뒤(방-벽 틈을 메운다) 테두리에서 4방향으로 채운 칸. */
function floodOutside(obstacles: readonly (readonly Vec2[])[], g: Grid): Uint8Array {
  const { w, h } = g
  const raw = new Uint8Array(w * h)
  for (const r of obstacles) for (const i of rasterize(r, g)) raw[i] = 1
  const blocked = new Uint8Array(w * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!raw[y * w + x]) continue
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy
      if (nx >= 0 && ny >= 0 && nx < w && ny < h) blocked[ny * w + nx] = 1
    }
  }
  const outside = new Uint8Array(w * h)
  const stack: number[] = []
  const seed = (i: number) => {
    if (!blocked[i] && !outside[i]) {
      outside[i] = 1
      stack.push(i)
    }
  }
  for (let x = 0; x < w; x++) seed(x), seed((h - 1) * w + x)
  for (let y = 0; y < h; y++) seed(y * w), seed(y * w + w - 1)
  while (stack.length) {
    const i = stack.pop()!
    const x = i % w, y = (i - x) / w
    if (x > 0) seed(i - 1)
    if (x < w - 1) seed(i + 1)
    if (y > 0) seed(i - w)
    if (y < h - 1) seed(i + w)
  }
  return outside
}

/** 다각형이 덮는 칸(칸 중심이 안에 드는 칸 + 변이 지나는 칸). 얇은 벽이 칸 중심을 비켜 가도 빠지지 않게 변도 칠한다. */
function rasterize(ring: readonly Vec2[], g: Grid): number[] {
  const out: number[] = []
  const n = ring.length
  let minY = Infinity, maxY = -Infinity
  for (const [, y] of ring) {
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }
  const y0 = Math.max(0, Math.floor((minY - g.oy) / g.cell))
  const y1 = Math.min(g.h - 1, Math.ceil((maxY - g.oy) / g.cell))
  for (let cy = y0; cy <= y1; cy++) {
    const py = g.oy + (cy + 0.5) * g.cell
    const xs: number[] = []
    for (let i = 0, j = n - 1; i < n; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j]
      if ((yi > py) !== (yj > py)) xs.push(xi + ((py - yi) / (yj - yi)) * (xj - xi))
    }
    xs.sort((a, b) => a - b)
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const a = Math.max(0, Math.ceil((xs[k] - g.ox) / g.cell - 0.5))
      const b = Math.min(g.w - 1, Math.floor((xs[k + 1] - g.ox) / g.cell - 0.5))
      for (let cx = a; cx <= b; cx++) out.push(cy * g.w + cx)
    }
  }
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const [ax, ay] = ring[j], [bx, by] = ring[i]
    const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / (g.cell / 2)))
    for (let s = 0; s <= steps; s++) {
      const t = s / steps
      const cx = Math.floor((ax + (bx - ax) * t - g.ox) / g.cell)
      const cy = Math.floor((ay + (by - ay) * t - g.oy) / g.cell)
      if (cx >= 0 && cy >= 0 && cx < g.w && cy < g.h) out.push(cy * g.w + cx)
    }
  }
  return out
}

/** 벽의 주축 — 바닥 외곽선 점들의 주성분 방향과 그 위의 범위. 문 자리로 쪼개진 고리 여럿이어도 벽 하나의 축이 나온다. */
function wallAxis(rings: readonly (readonly Vec2[])[]): { at: (x: number, y: number) => number; lo: number; hi: number } {
  const pts = rings.flat()
  let cx = 0, cy = 0
  for (const [x, y] of pts) cx += x, cy += y
  cx /= pts.length || 1
  cy /= pts.length || 1
  let sxx = 0, syy = 0, sxy = 0
  for (const [x, y] of pts) {
    sxx += (x - cx) ** 2
    syy += (y - cy) ** 2
    sxy += (x - cx) * (y - cy)
  }
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy)
  const ux = Math.cos(angle), uy = Math.sin(angle)
  const at = (x: number, y: number) => (x - cx) * ux + (y - cy) * uy
  let lo = Infinity, hi = -Infinity
  for (const [x, y] of pts) {
    const t = at(x, y)
    if (t < lo) lo = t
    if (t > hi) hi = t
  }
  return { at, lo, hi }
}

/** 볼록 껍질(모노톤 체인). 벽 바닥 외곽선의 문 자리 홈을 메운다. */
function convexHull(points: readonly Vec2[]): Vec2[] {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  if (pts.length < 3) return pts
  const cross = (o: Vec2, a: Vec2, b: Vec2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lower: Vec2[] = []
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop()
    lower.push(p)
  }
  const upper: Vec2[] = []
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i]
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop()
    upper.push(p)
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)]
}

/**
 * 외벽 설비(OE-EQP-15·OE-EXT-04). 외벽 바깥 면에 붙는 종류(외기 센서 — kinds.ts 의 `mount: 'exterior'` — 와 외부 루버)와, 사람이
 * 외벽에 붙인 설비다. 방 안에 들지 않는 것이 맞는 설비라 소속 방 없음을 허용하고, 완전성 검사 "기기마다 소속 방" 과 등급 2(소속)의
 * 분모에서 뺀다. 외벽에 붙인 설비의 외벽 여부는 judgeExternal(BIM·편집·계산)로 본다 — 붙인 설비가 있는 층만 잰다.
 */
export function exteriorDevices(model: Model): Set<string> {
  const out = new Set<string>()
  for (const storey of model.storeys) {
    let judged: Map<string, ExternalJudgement> | null = null
    for (const e of storey.equipment) {
      if (isConduit(e.role)) continue
      if (exteriorKind(e)) out.add(e.id)
      else if (e.wallId) {
        judged ??= judgeExternal(storey)
        if (judged.get(e.wallId)?.external) out.add(e.id)
      }
    }
  }
  return out
}
