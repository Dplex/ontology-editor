// 외벽 에디터(OE-EXT-03, ADR-0041). 전체 층의 외벽을 한 번에 고친다 — 층 편집 화면에서는 외벽이 잠겨 있다(OE-EXT-02).
// 한 층의 외벽을 고르면 다른 층에서 같은 면에 쌓인 외벽을 묶어 함께 옮기고, 벽 가까운 방 변도 층마다 따라가 설비 소속을 다시 잰다(OE-MAP-01).
//
// "같은 면" 은 평행하고(2° 안), 중심선 간격이 두께 차의 절반 + 1cm 안이며(두께가 다른 층도 바깥 면이나 안 면이 맞으면 같은 면),
// 벽 길이 방향으로 0.3m 넘게 겹치는 것이다. 가진 BIM 에서 잰 값: 다른 층에 짝이 있는 외벽 중 이 규칙으로 묶이는 것
// FZK 8/8 · Duplex 23/23 · 병원 14/22 · 합성 성수 368/378. 안 묶이는 것은 층마다 물러난 입면(간격 0.09~1m)이라 따로 두는 게 맞다.

import { EXTERIOR_LOCKED, moveWall, moveWallWithSpaces, newCrossing, wallAxis, wallShapeLock, type BoundaryChange } from './edit'
import type { ExternalJudgement } from './exterior'
import { josa } from './josa'
import type { Model, Vec2, Wall } from './model'

export const FACADE = {
  /** 평행으로 보는 방향 차(사인값, 약 2°). */
  angle: 0.035,
  /** 두께 차의 절반에 더하는 여유(m). */
  slack: 0.01,
  /** 같은 면으로 보려면 겹쳐야 하는 길이(m). */
  overlap: 0.3,
} as const

type Line = { id: string; storeyId: string; a: Vec2; d: Vec2; len: number; half: number }

function lineOf(wall: Wall, storeyId: string): Line | null {
  const ax = wallAxis(wall.footprint ?? [])
  if (!ax) return null
  const len = Math.hypot(ax.b[0] - ax.a[0], ax.b[1] - ax.a[1])
  if (len < 0.05) return null
  return { id: wall.id, storeyId, a: ax.a, d: [(ax.b[0] - ax.a[0]) / len, (ax.b[1] - ax.a[1]) / len], len, half: ax.half }
}

/** 두 벽이 같은 면인가(층이 달라야 한다). */
export function sameFace(w: Line, v: Line): boolean {
  if (w.storeyId === v.storeyId) return false
  if (Math.abs(w.d[0] * v.d[1] - w.d[1] * v.d[0]) > FACADE.angle) return false
  const n: Vec2 = [-w.d[1], w.d[0]]
  const mid: Vec2 = [v.a[0] + (v.d[0] * v.len) / 2, v.a[1] + (v.d[1] * v.len) / 2]
  const off = Math.abs((mid[0] - w.a[0]) * n[0] + (mid[1] - w.a[1]) * n[1])
  if (off > Math.abs(w.half - v.half) + FACADE.slack) return false
  const t0 = (v.a[0] - w.a[0]) * w.d[0] + (v.a[1] - w.a[1]) * w.d[1]
  const t1 = t0 + v.len * (v.d[0] * w.d[0] + v.d[1] * w.d[1])
  return Math.min(w.len, Math.max(t0, t1)) - Math.max(0, Math.min(t0, t1)) > FACADE.overlap
}

/**
 * 고른 외벽과 같은 면에 쌓인 다른 층 외벽들(자기 포함, 층 높이 순). 이어진 것은 건너서도 묶는다 — 1층 긴 벽 하나에 2층 벽 둘이 붙으면 셋이다.
 * 고른 벽이 외벽이 아니면 null.
 */
export function facadeOf(model: Model, external: ReadonlyMap<string, ExternalJudgement>, wallId: string): { id: string; storeyId: string }[] | null {
  if (!external.get(wallId)?.external) return null
  const lines: Line[] = []
  const elevation = new Map(model.storeys.map((st) => [st.id, st.elevation]))
  for (const st of model.storeys)
    for (const w of st.walls) {
      if (!external.get(w.id)?.external) continue
      const l = lineOf(w, st.id)
      if (l) lines.push(l)
    }
  const start = lines.find((l) => l.id === wallId)
  if (!start) return null
  const group = new Map([[start.id, start]])
  const queue = [start]
  while (queue.length) {
    const w = queue.pop()!
    for (const v of lines) {
      if (group.has(v.id) || !sameFace(w, v)) continue
      group.set(v.id, v)
      queue.push(v)
    }
  }
  return [...group.values()].map((l) => ({ id: l.id, storeyId: l.storeyId })).sort((a, b) => elevation.get(a.storeyId)! - elevation.get(b.storeyId)!)
}

export type FacadeMove = { moved: number; kept: string[]; changes: BoundaryChange[]; crossed: string[] } | { refused: string }

/**
 * 묶은 외벽을 함께 옮긴다. 내력벽은 값이 있으면 고치지 않으므로(PRD 1.4) 제자리에 두고 `kept`(층 이름)로 알린다 — Duplex 는 면마다 기초벽(T/FDN)이
 * 내력이라 면 전체를 거절하면 외벽 에디터를 쓸 수 없다. 옮길 벽 중 하나라도 다른 벽을 가로지르게 되면 아무것도 옮기지 않는다 — 층마다 따로 남으면
 * 같은 면이 어긋난다. `carry` 면 층마다 벽 가까운 방 변이 같이 간다(소속이 바뀐 설비는 `changes` 에).
 */
export function moveFacade(model: Model, wallIds: readonly string[], delta: Vec2, carry: boolean): FacadeMove {
  const walls = model.storeys.flatMap((st) => st.walls.map((w) => ({ w, st })))
  const byId = new Map(walls.map((x) => [x.w.id, x]))
  const movable: string[] = []
  const kept: string[] = []
  for (const id of wallIds) {
    const found = byId.get(id)
    if (!found?.w.footprint?.length) return { refused: '외곽선이 없는 벽이 있어 옮기지 않습니다' }
    const lock = wallShapeLock(found.w)
    if (lock && lock !== EXTERIOR_LOCKED) {
      kept.push(found.st.name)
      continue
    }
    const next = found.w.footprint.map((r) => r.map((p) => [p[0] + delta[0], p[1] + delta[1]] as Vec2))
    const crossed = newCrossing(model, id, next)
    const other = crossed?.name || '다른 벽'
    if (crossed) return { refused: `${found.st.name} 에서 ${other}${josa(other, '을/를')} 가로지르게 되어 옮기지 않습니다` }
    movable.push(id)
  }
  if (!movable.length) return { refused: '이 면의 외벽이 모두 내력벽이라 옮기지 않습니다(내력벽은 값이 있으면 고치지 않습니다)' }
  const changes: BoundaryChange[] = []
  const crossed: string[] = []
  let moved = 0
  for (const id of movable) {
    if (carry) {
      const done = moveWallWithSpaces(model, id, delta, null, { exterior: true })
      if (!done) continue
      // 벽 길이 방향으로 밀면 방 변은 그대로라 넓이가 같은 변경이 따라온다(성수 30개 묶음에서 92건). 바뀐 것만 남긴다.
      changes.push(...done.changes.filter((c) => Math.abs(c.toAreaM2 - c.fromAreaM2) > 1e-6 || c.equipment.length))
      crossed.push(...done.crossed)
      moved++
    } else if (moveWall(model, id, delta, { exterior: true })) moved++
  }
  return { moved, kept, changes, crossed }
}
