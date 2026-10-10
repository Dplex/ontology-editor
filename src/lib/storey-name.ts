// 층 이름 고치기. 이름 없는 층이 하나라도 있으면 등급 0(층 이름 100%, PRD 1.8)이 미달이라 [구축하기] 가 막힌다(OE-GEN-02, ADR-0040).
// 기초 층처럼 BIM 이 이름을 비워 둔 층은 사람이 이름만 넣으면 끝나는 경우가 많아, 재제출 대신 에디터에서 넣게 한다. 판정은 편집을 얹은
// 모델로 하므로(ADR-0040) 넣으면 게이트가 풀린다.
//
// BIM 이름은 `bimName` 에 남긴다(처음 고칠 때 한 번). 있으면 사람이 고친 층이다 — 편집 파일(`storeyNames`)·출처 표시가 이것을 본다.
// BIM 이름으로 되돌리면 지운다.

import type { Model, Storey } from './model'

export type StoreyNameResult = true | false | { refused: string }

/** 고친 이름. 같은 이름이면 false, 받을 수 없으면 이유. */
export function setStoreyName(model: Model, storeyId: string, raw: string): StoreyNameResult {
  const storey = model.storeys.find((s) => s.id === storeyId)
  if (!storey) return false
  const name = raw.trim()
  const bim = storey.bimName ?? storey.name
  if (!name && bim.trim()) return { refused: '층 이름을 비울 수 없습니다. BIM 이름으로 돌리려면 [BIM 이름으로] 를 누르세요' }
  if (!name) return { refused: '층 이름을 넣으세요' }
  if (name === storey.name) return false
  // 같은 건물에 같은 이름의 층이 둘이면 탐색기 트리·층 파일에서 가를 수 없다.
  const twin = model.storeys.find((s) => s.id !== storeyId && s.name.trim() === name)
  if (twin) return { refused: `같은 이름의 층(${twin.name})이 이미 있습니다` }
  if (storey.bimName === undefined) storey.bimName = storey.name
  storey.name = name
  if (storey.name === storey.bimName) delete storey.bimName
  return true
}

/** BIM 이름으로 돌린다. 고친 적이 없으면 false. */
export function resetStoreyName(model: Model, storeyId: string): boolean {
  const storey = model.storeys.find((s) => s.id === storeyId)
  if (!storey || storey.bimName === undefined) return false
  storey.name = storey.bimName
  delete storey.bimName
  return true
}

/** 사람이 이름을 고친 층인가. */
export const storeyNamed = (storey: Pick<Storey, 'bimName'>) => storey.bimName !== undefined
