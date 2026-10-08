// 층마다 임시 저장본 하나(OE-COM-08 · OE-WF-01~03).
//
// 편집 파일(edit-file.ts)은 연 때와 달라진 것을 건물 하나로 적는다. 임시 저장본은 층의 것이라(OE-COM-03) 편집 파일을 층별로
// 가른다. 가른 조각을 다시 이으면 원래 편집 파일과 같은 편집이다 — 얹을 때는 늘 조각을 이어 한 번에 얹는다(applyEdits 가
// 재판정까지 하는 길을 그대로 탄다).
//
// **층이 없는 편집은 건물 조각(BUILDING)에 둔다.** 계통(종류·이름·만들기·지우기), 타입 종류, 흐름 방향·확정, 잇기·끊기는 한
// 층의 것이 아니다(계통·배관은 층을 넘는다). 어느 층에서 임시 저장해도 건물 조각이 같이 저장되고, 어느 층에 들어가도 같이 얹힌다.
// 층에 속한 것의 층은 **연 때의 층**이다(`homeOf`). 다른 층으로 옮긴 설비는 원래 층의 편집이다 — 옮긴 층에서 보면 들어온
// 설비지만, 되돌리면 원래 층으로 돌아가는 편집이라서다.

import type { EditFile } from './edit-file'

/** 건물 조각의 열쇠. 층 id 와 겹치지 않는다. */
export const BUILDING = '*'

/** 층에 속한 편집의 층. 연 때 있던 것은 연 때의 층, 모르면 null(건물 조각으로 간다). */
export type HomeOf = (id: string) => string | null

const empty = (f: EditFile): EditFile => ({
  format: f.format,
  version: f.version,
  source: f.source,
  savedAt: f.savedAt,
  equipment: [],
  spaces: [],
  kinds: [],
  flows: [],
  confirmedSystems: [],
})

/** 편집 파일을 층별 조각으로 가른다. 빈 조각은 넣지 않는다. 지문(keys)은 조각이 가리키는 id 것만 남긴다. */
export function splitByStorey(file: EditFile, homeOf: HomeOf): Map<string, EditFile> {
  const parts = new Map<string, EditFile>()
  const part = (storeyId: string | null | undefined) => {
    const key = storeyId ?? BUILDING
    let p = parts.get(key)
    if (!p) parts.set(key, (p = empty(file)))
    return p
  }
  const push = <K extends keyof EditFile>(p: EditFile, key: K, row: NonNullable<EditFile[K]> extends (infer T)[] ? T : never) => {
    const list = (p[key] ?? []) as unknown[]
    list.push(row)
    ;(p as Record<string, unknown>)[key] = list
  }

  for (const row of file.equipment) push(part(homeOf(row.id) ?? row.storeyId), 'equipment', row)
  for (const row of file.spaces) push(part(homeOf(row.id)), 'spaces', row)
  for (const row of file.equipmentAdded ?? []) push(part(row.storeyId), 'equipmentAdded', row)
  for (const id of file.equipmentRemoved ?? []) push(part(homeOf(id)), 'equipmentRemoved', id)
  for (const row of file.spacesAdded ?? []) push(part(row.storeyId), 'spacesAdded', row)
  for (const row of file.spacesRemoved ?? []) push(part(homeOf(row.id)), 'spacesRemoved', row)
  for (const row of file.walls ?? []) push(part(homeOf(row.id)), 'walls', row)
  for (const row of file.wallsAdded ?? []) push(part(row.storeyId), 'wallsAdded', row)
  for (const id of file.wallsRemoved ?? []) push(part(homeOf(id)), 'wallsRemoved', id)
  for (const row of file.openings ?? []) push(part(homeOf(row.id)), 'openings', row)
  for (const row of file.openingsAdded ?? []) push(part(row.storeyId), 'openingsAdded', row)
  for (const id of file.openingsRemoved ?? []) push(part(homeOf(id)), 'openingsRemoved', id)
  for (const row of file.customZones ?? []) push(part(row.storeyId), 'customZones', row)
  for (const row of file.storeysDone ?? []) push(part(row.id), 'storeysDone', row)
  for (const row of file.ceilings ?? []) push(part(row.storeyId), 'ceilings', row)

  // 층이 없는 편집 — 건물 조각
  const building = () => part(null)
  if (file.kinds.length) building().kinds = file.kinds
  if (file.flows.length) building().flows = file.flows
  if (file.confirmedSystems.length) building().confirmedSystems = file.confirmedSystems
  if (file.confirmedFlows?.length) building().confirmedFlows = file.confirmedFlows
  if (file.connections && (file.connections.add.length || file.connections.remove.length)) building().connections = file.connections
  if (file.systems?.length) building().systems = file.systems
  if (file.systemsAdded?.length) building().systemsAdded = file.systemsAdded
  if (file.systemsRemoved?.length) building().systemsRemoved = file.systemsRemoved
  if (file.systemNames?.length) building().systemNames = file.systemNames

  if (file.keys) {
    for (const p of parts.values()) {
      const text = JSON.stringify(p)
      const keys = Object.fromEntries(Object.entries(file.keys).filter(([id]) => text.includes(JSON.stringify(id))))
      if (Object.keys(keys).length) p.keys = keys
    }
  }
  return parts
}

/** 조각들을 다시 하나의 편집 파일로 잇는다. 조각이 없으면 편집이 없는 파일이다. */
export function joinParts(parts: Iterable<EditFile>, base: Pick<EditFile, 'format' | 'version' | 'source' | 'savedAt'>): EditFile {
  const out = empty(base as EditFile)
  const lists = [
    'equipment', 'spaces', 'kinds', 'flows', 'confirmedSystems', 'confirmedFlows', 'systems', 'systemsAdded', 'systemsRemoved',
    'systemNames', 'equipmentAdded', 'equipmentRemoved', 'spacesAdded', 'spacesRemoved', 'walls', 'wallsAdded', 'wallsRemoved',
    'openings', 'openingsAdded', 'openingsRemoved', 'customZones', 'storeysDone', 'ceilings',
  ] as const
  for (const p of parts) {
    for (const key of lists) {
      const rows = p[key] as unknown[] | undefined
      if (!rows?.length) continue
      ;(out as Record<string, unknown>)[key] = [...(((out as Record<string, unknown>)[key] as unknown[] | undefined) ?? []), ...rows]
    }
    if (p.connections) {
      const c = out.connections ?? { add: [], remove: [] }
      out.connections = { add: [...c.add, ...p.connections.add], remove: [...c.remove, ...p.connections.remove] }
    }
    if (p.keys) out.keys = { ...(out.keys ?? {}), ...p.keys }
  }
  return out
}

/** 편집이 하나도 없는가. countEdits 는 계통·커스텀존을 세지 않아서 따로 본다. */
export function isEmptyPart(part: EditFile): boolean {
  const { format: _f, version: _v, source: _s, savedAt: _t, keys: _k, connections, ...rest } = part
  return Object.values(rest).every((v) => !Array.isArray(v) || v.length === 0) && !(connections && (connections.add.length || connections.remove.length))
}

/** 조각의 서명. 저장 시각·지문을 빼고 편집 내용만 견준다. 편집이 없으면 null. */
export function partSig(part: EditFile | undefined): string | null {
  if (!part || isEmptyPart(part)) return null
  const { savedAt: _savedAt, keys: _keys, source: _source, ...rest } = part
  return JSON.stringify(rest)
}
