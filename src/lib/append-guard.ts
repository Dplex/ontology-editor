// [덧붙이기](추가 파일 불러오기, OE-HIST-06)에서 같은 건물의 같은 분야 파일을 받지 않는다.
//
// **분야는 벽으로 가른다.** 벽이 있으면 건축, 없으면 설비다. Revit 설비 파일에도 MEP Space(방)가 들어 있어(병원 HVAC 263개, Duplex MEP 22개)
// 방으로는 가르지 못한다. 가진 IFC 에서 건축은 벽이 있고(Duplex 57 · 병원 1,080 · AC20 13) 설비는 0 이었다(Duplex MEP·HVAC, 병원 HVAC·MEP·전기).
//
// **같은 건물은 IfcBuilding GlobalId 가 같거나, 짝 파일 권하기(profile.ts partnerOf)처럼 평면 범위·층이 겹치는 것**이다.
// 같은 분야의 판본끼리는 GlobalId 가 같았다(Duplex 건축 · 건축-Optimized, 병원 MEP · 전기). 건축과 설비는 GlobalId 가 다르다.
//
// **지금은 건축만 막는다.** 설비는 한 건물이 공조·위생·전기 파일로 나뉘어 오는 일이 흔하다(병원 HVAC · MEP · 전기 — GlobalId 도 둘이 다르다).
// 설비끼리를 막으면 그 조합을 열 수 없게 되어, 막을지는 OE-HIST-06 이슈에서 PM 확인을 받는다.

import type { Model } from './model'
import { extentOf, extentOverlap, levelFit, PARTNER_OVERLAP, type Profile } from './profile'

export type Discipline = 'architecture' | 'mep'

export type LoadedPart = {
  name: string
  discipline: Discipline
  buildingId: string
  buildingName: string
  extent: Profile['extent']
  levels: NonNullable<Profile['levels']>
}

export const DISCIPLINE_LABEL: Record<Discipline, string> = { architecture: '건축', mep: '설비' }

export function partOf(name: string, model: Model): LoadedPart {
  const walls = model.storeys.reduce((n, s) => n + s.walls.length, 0)
  return {
    name,
    discipline: walls > 0 ? 'architecture' : 'mep',
    buildingId: model.buildingId,
    buildingName: model.buildingName,
    extent: extentOf(model),
    levels: model.storeys.map((s) => ({ name: s.name, elevation: s.elevation })),
  }
}

export function sameBuilding(a: LoadedPart, b: LoadedPart): boolean {
  if (a.buildingId && a.buildingId === b.buildingId) return true
  return !!a.extent && !!b.extent && extentOverlap(a.extent, b.extent) >= PARTNER_OVERLAP && levelFit(a.levels, b.levels) >= PARTNER_OVERLAP
}

/** 이미 연 파일 중 들어오는 파일과 같은 건물·같은 분야인 것(지금은 건축만). 없으면 null. */
export function duplicateOf(loaded: readonly LoadedPart[], incoming: LoadedPart): LoadedPart | null {
  if (incoming.discipline !== 'architecture') return null
  return loaded.find((p) => p.discipline === incoming.discipline && sameBuilding(p, incoming)) ?? null
}

/** 받지 않을 때의 문구. */
export function duplicateText(incoming: LoadedPart, existing: LoadedPart): string {
  const building = existing.buildingName || incoming.buildingName
  return (
    `${incoming.name} 는 이미 연 ${existing.name} 와 같은 건물${building ? `(${building})` : ''}의 ${DISCIPLINE_LABEL[incoming.discipline]} 파일이라 받지 않았습니다. ` +
    `한 건물에는 분야(건축·설비)마다 파일 하나를 덧붙입니다. 같은 건물을 새 판본으로 다시 시작하려면 [새 프로젝트]로 여세요.`
  )
}
