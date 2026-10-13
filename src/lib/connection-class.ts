// 연결을 근거로 넷으로 가른다(OE-BIM-09). 같은 "연결" 이어도 BIM 이 무엇을 말했는지가 다르다.
//
// - `port-directed` BIM 포트가 이었고 흐름 방향(SOURCE→SINK)까지 말했다.
// - `port-undirected` BIM 포트가 이었지만 방향은 말하지 않았다(SOURCEANDSINK·NOTDEFINED, 양방향/미지정). 규칙·사람이 방향을 정한다.
// - `geometry` 포트가 없는 구간에서 배관 끝이 맞닿은 형상으로 추정한 것이다. **미확정 연결 후보**다 — 방향이 없어 `brick:feeds` 로 나가지
//   않고, 사람이 끊으면 다시 연 BIM 에서 형상이 또 맞닿아도 편집 파일이 끊은 채로 둔다(되살리는 것은 사람이 다시 잇는 것뿐이다).
// - `manual` 사람이 에디터에서 이었다.

import type { Connection } from './model'

export type ConnectionClass = 'port-directed' | 'port-undirected' | 'geometry' | 'manual'

export function connectionClass(c: Pick<Connection, 'source' | 'directed'>): ConnectionClass {
  if (c.source === 'port') return c.directed ? 'port-directed' : 'port-undirected'
  return c.source
}

/** 화면·리포트에 쓰는 이름. */
export const CONNECTION_CLASS_LABEL: Record<ConnectionClass, string> = {
  'port-directed': 'BIM 포트 · 방향 명시',
  'port-undirected': 'BIM 포트 · 양방향/미지정',
  geometry: '형상 추정 · 미확정 후보',
  manual: '사람이 이음',
}

export function countConnectionClasses(connections: readonly Pick<Connection, 'source' | 'directed'>[]): Record<ConnectionClass, number> {
  const out: Record<ConnectionClass, number> = { 'port-directed': 0, 'port-undirected': 0, geometry: 0, manual: 0 }
  for (const c of connections) out[connectionClass(c)]++
  return out
}
