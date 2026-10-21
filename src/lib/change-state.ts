// 오브젝트마다 연 때(기준)와 견준 변경 상태(OE-UI-22). 편집 막대의 "바뀐 것 N건"(changes.ts)과 같은 diffBaseline 결과에서 id 별로 뽑는다.
// 상태는 신규·변경 둘이고, 목록에 없는 것은 변경 없음이다. 지운 것은 목록에 남지 않으므로 개수로만 센다.
// 되돌리기로 기준과 같아지면 diffBaseline 에서 빠지므로 자동으로 변경 없음으로 돌아온다.

import type { BaselineDiff } from './edit'

export type ChangeState = 'added' | 'changed'
export type ObjectChanges = {
  /** 물리존 · 커스텀존 · 공조존(사람이 만든 것) · 설비의 id → 상태. */
  states: Map<string, ChangeState>
  /** 종류마다 신규·변경·삭제 개수. */
  counts: Record<'space' | 'custom' | 'hvac' | 'equipment', { added: number; changed: number; removed: number }>
}

const none = () => ({ added: 0, changed: 0, removed: 0 })

/**
 * `edited` 는 diffBaseline 이 id 로 내지 않는 편집이다 — 외곽선을 고쳐 넓이가 바뀐 물리존, 방 종류를 고른 물리존. 편집 막대는 이것을
 * id 없는 줄(`areaLines` · `spaceKindLines`)로 세므로, 같은 기준으로 고른 id 를 받아 변경으로 센다.
 */
export function objectChanges(since: BaselineDiff, edited: { spaces: Iterable<string> } = { spaces: [] }): ObjectChanges {
  const states = new Map<string, ChangeState>()
  const counts = { space: none(), custom: none(), hvac: none(), equipment: none() }
  const mark = (kind: keyof typeof counts, id: string, state: ChangeState) => {
    // 신규가 변경보다 앞선다 — 새로 만든 것을 고쳤어도 기준에는 없던 것이다.
    const was = states.get(id)
    if (was === 'added' || (was === 'changed' && state === 'changed')) return
    if (was === 'changed') counts[kind].changed--
    states.set(id, state)
    counts[kind][state]++
  }

  for (const s of since.spacesAdded) mark('space', s.id, 'added')
  for (const s of since.renamed) mark('space', s.spaceId, 'changed')
  for (const s of since.renumbered ?? []) mark('space', s.spaceId, 'changed')
  for (const id of edited.spaces) mark('space', id, 'changed')
  counts.space.removed = since.spacesRemoved.length

  for (const z of since.customZones) {
    if (z.change === 'removed') counts.custom.removed++
    else mark('custom', z.id, z.change)
  }
  for (const z of since.hvacZones) {
    if (z.change === 'removed') counts.hvac.removed++
    else mark('hvac', z.id, z.change)
  }

  for (const e of since.equipmentAdded) mark('equipment', e.id, 'added')
  for (const e of [...since.moved, ...since.restoreyed, ...since.equipmentRenamed, ...since.equipmentMounted, ...(since.equipmentShaft ?? []), ...since.systemMoved]) mark('equipment', e.id, 'changed')
  counts.equipment.removed = since.equipmentRemoved.length

  return { states, counts }
}
