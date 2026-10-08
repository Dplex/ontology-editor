// 층 단위 진행(OE-MAN-06). 층마다 "완료" 를 표시하고, 몇 층이 끝났는지 보인다(2026-10-03 사용자 결정, ADR-0011).
//
// 완료를 누를 때 그 층의 **지문**(storeySignature)을 같이 적어 둔다. 지금 지문이 그때와 다르면 "완료 뒤 고침" 이다 — 완료가 저절로
// 풀린 것이고, 다시 구축해 완료를 눌러야 한다. 상태를 저장된 깃발이 아니라 지금 모델로 재기 때문에, 고친 것을 Ctrl+Z 로 되돌려 그
// 층이 완료한 때와 같아지면 다시 완료로 보인다(되돌리기 스냅숏이 층 깃발을 몰라도 된다).
//
// 지문은 그 층 파일(OE-GEN-11)에 나갈 것을 정하는 값이다: 방·벽·문·창·설비·커스텀존, 그 층 설비에 걸린 연결(방향을 아는 것)과
// 그 층 설비가 든 계통. 순서와 객체 열쇠 순서는 보지 않는다 — 되돌리기가 같은 값을 다른 순서로 돌려놓아도 같은 지문이다.

import type { Model, Storey } from './model'

export type StoreyState = 'todo' | 'done' | 'changed'

export type StoreyProgress = {
  id: string
  name: string
  state: StoreyState
  /** 완료를 누른 때(ISO). 완료한 적이 없으면 없다. */
  at?: string
}

/** 열쇠 순서와 상관없는 JSON. 배열 순서는 호출부가 정렬한다. */
function stable(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined)
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(',')}}`
}

/** FNV-1a 32비트. 지문은 같은지만 보면 되어 짧게 둔다. */
function hash(text: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return `${(h >>> 0).toString(16).padStart(8, '0')}:${text.length}`
}

const byId = <T extends { id: string }>(items: readonly T[]) => [...items].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))

/** 층의 지문. 이 층 파일에 나갈 것이 같으면 같다. `done` 은 빼고 잰다. */
export function storeySignature(model: Model, storey: Storey): string {
  const mine = new Set(storey.equipment.map((e) => e.id))
  const connections = model.connections
    .filter((c) => mine.has(c.from) || mine.has(c.to))
    .map((c) => ({
      a: c.from < c.to ? c.from : c.to,
      b: c.from < c.to ? c.to : c.from,
      directed: c.directed ? c.from : null,
      edited: c.edited?.from ?? null,
      // 재검토 중인 확정(OE-PIP-07)은 내보내지 않으니 확정이 아닌 것으로 잰다.
      confirmed: c.inferred?.confirmed && c.inferred.recheck === undefined ? c.inferred.from : null,
      source: c.source,
    }))
    .sort((x, y) => (x.a + x.b < y.a + y.b ? -1 : x.a + x.b > y.a + y.b ? 1 : 0))
  const systems = byId(model.systems.filter((s) => s.memberIds.some((id) => mine.has(id)))).map((s) => ({ id: s.id, name: s.name, kind: s.kind, fluid: s.fluid }))
  return hash(
    stable({
      spaces: byId(storey.spaces),
      walls: byId(storey.walls),
      openings: byId(storey.openings),
      equipment: byId(storey.equipment),
      customZones: byId(storey.customZones ?? []),
      connections,
      systems,
    }),
  )
}

/** 층마다 진행 상태. 건물 층 순서(아래부터)다. */
export function storeyProgress(model: Model): StoreyProgress[] {
  return model.storeys.map((s) => {
    if (!s.done) return { id: s.id, name: s.name, state: 'todo' }
    return { id: s.id, name: s.name, state: s.done.sig === storeySignature(model, s) ? 'done' : 'changed', at: s.done.at }
  })
}

/** 이 층을 완료로 표시한다. 지금 지문을 적는다(완료 뒤 고친 층을 다시 완료하면 지문이 새로 적힌다). */
export function markStoreyDone(model: Model, storeyId: string, now = new Date()): boolean {
  const storey = model.storeys.find((s) => s.id === storeyId)
  if (!storey) return false
  storey.done = { at: now.toISOString(), sig: storeySignature(model, storey) }
  return true
}

/** 완료 표시를 지운다. */
export function clearStoreyDone(model: Model, storeyId: string): boolean {
  const storey = model.storeys.find((s) => s.id === storeyId)
  if (!storey?.done) return false
  delete storey.done
  return true
}
