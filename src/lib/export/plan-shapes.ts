// 층 GeoJSON 한 장을 SVG 평면으로 그릴 모양. 내보낸 파일 뷰어(viewer.html)와 에디터의 비교 판(ExportCompare.vue)이 같이 쓴다.
// 좌표는 건물 로컬 미터다(geojson.ts) — 에디터 3D 와 같은 원점·축이다. y 를 뒤집어 북쪽이 위로 오게 그린다.
import type { ExportFloor } from './read-export'

export type PlanShape = { id: string; kind: string; d?: string; cx?: number; cy?: number; name: string; box: [number, number, number, number] }
export type Plan = {
  viewBox: string
  /** 그린 것 전체의 범위(SVG 좌표, y 뒤집힘) x0·y0·x1·y1. */
  bounds: [number, number, number, number]
  shapes: PlanShape[]
  /** 점(설비·문) 반지름. 평면 크기에 맞춘다. */
  r: number
  empty: boolean
}

/** GeoJSON feature 의 kind 를 화면 말로. */
export const KIND_LABEL: Record<string, string> = {
  space: '물리존',
  equipment: '설비',
  wall: '벽',
  door: '문',
  window: '창',
  customZone: '커스텀존',
  hvacZone: '공조존',
  room: '룸',
  spaceObject: '추가 공간 오브젝트',
  vertical: '수직 관통 오브젝트',
}

/** 넓이가 큰 것부터 그려 작은 것이 위에 온다. 점(설비·문)은 맨 위이고, 기기는 같은 자리의 덕트·배관 위에 둔다(눌러지게). */
const ORDER: Record<string, number> = { hvacZone: 0, customZone: 1, space: 2, room: 2.5, spaceObject: 2.7, vertical: 2.8, wall: 3, window: 4, door: 5, equipment: 7 }

/** `unread` 는 받는 쪽이 읽지 않는 주어(덕트·배관). 같은 자리의 기기보다 아래에 그린다. */
export function planOf(floor: ExportFloor, unread: ReadonlySet<string> = new Set()): Plan {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity]
  const shapes: PlanShape[] = []
  for (const f of floor.features) {
    const g = f.geometry
    if (!g) continue
    const kind = String(f.properties.kind)
    const name = String(f.properties.name ?? '')
    let [a0, b0, a1, b1] = [Infinity, Infinity, -Infinity, -Infinity]
    const add = (p: number[]) => {
      a0 = Math.min(a0, p[0])
      a1 = Math.max(a1, p[0])
      b0 = Math.min(b0, -p[1])
      b1 = Math.max(b1, -p[1])
    }
    if (g.type === 'Point') {
      const p = g.coordinates as number[]
      add(p)
      shapes.push({ id: f.id, kind, cx: p[0], cy: -p[1], name, box: [a0, b0, a1, b1] })
    } else if (g.type === 'Polygon' || g.type === 'MultiPolygon') {
      const polys = (g.type === 'Polygon' ? [g.coordinates] : g.coordinates) as number[][][][]
      const d = polys
        .flat()
        .map((ring) => {
          ring.forEach(add)
          return `M${ring.map((p) => `${p[0]},${-p[1]}`).join('L')}Z`
        })
        .join('')
      shapes.push({ id: f.id, kind, d, name, box: [a0, b0, a1, b1] })
    } else continue
    x0 = Math.min(x0, a0)
    x1 = Math.max(x1, a1)
    y0 = Math.min(y0, b0)
    y1 = Math.max(y1, b1)
  }
  if (!Number.isFinite(x0)) return { viewBox: '0 0 1 1', bounds: [0, 0, 1, 1], shapes: [], r: 0.1, empty: true }
  const pad = Math.max(x1 - x0, y1 - y0, 1) * 0.04
  const rank = (s: PlanShape) => (s.kind === 'equipment' && unread.has(s.id) ? 6 : (ORDER[s.kind] ?? 9))
  shapes.sort((a, b) => rank(a) - rank(b))
  return {
    viewBox: `${x0 - pad} ${y0 - pad} ${x1 - x0 + pad * 2} ${y1 - y0 + pad * 2}`,
    bounds: [x0, y0, x1, y1],
    shapes,
    r: Math.max(x1 - x0, y1 - y0, 1) / 220,
    empty: false,
  }
}
