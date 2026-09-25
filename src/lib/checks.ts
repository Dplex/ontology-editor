// 완전성 검사. 온톨로지가 DT 에서 쓰일 만큼 이어져 있는지를 규칙 몇 줄로 잰다.
//
// 선행 연구(Wang 2026 Table 2, docs/research.md ④)는 이것을 SHACL 기수 규칙으로 적었다. "디퓨저는 정확히
// 한 방에 공급한다", "공조기는 말단 하나 이상에 공급한다" 같은 것이다. NREL BuildingMOTIF 도 같은 방식으로
// Brick 모델을 검증한다. 여기서는 SHACL 엔진을 들이지 않고 같은 규칙을 코드로 센다. 규칙마다 "비면 DT 에서
// 무엇이 안 되는가" 를 같이 적는다. 숫자만 보이면 무엇부터 고칠지 정할 수 없다.
//
// 규칙이 보는 방향은 호출부가 정한다(화면과 같은 방향). 원천·말단은 이름 사전(kinds.ts)으로 가르고,
// 소속 방은 좌표로 판정한 것이라 전부 추정이 섞인 검사다.

import { equipmentKind } from './kinds'
import { isConduit, type Model } from './model'
import { isAirSource, isAirTerminal, type AirService } from './served'

export type CheckResult = {
  key: string
  /** 규칙. "~는 ~한다" 로 적는다. */
  rule: string
  /** 비면 DT 에서 무엇이 안 되는가. */
  why: string
  /** 검사 대상 수. 0 이면 이 파일에서는 잴 것이 없다. */
  total: number
  /** 규칙을 어긴 요소 id. */
  failed: string[]
  /** 잴 수 없을 때의 이유. 있으면 total·failed 를 보지 않는다. */
  skipped?: string
}

export function completenessChecks(model: Model, services: readonly AirService[]): CheckResult[] {
  const equipment = model.storeys.flatMap((s) => s.equipment)
  const devices = equipment.filter((e) => !isConduit(e.role))
  const terminals = equipment.filter(isAirTerminal)
  const sources = equipment.filter(isAirSource)
  const hasSpaces = model.storeys.some((s) => s.spaces.length > 0)

  const supplySources = new Map<string, number>()
  const reached = new Set<string>()
  for (const s of services) {
    for (const id of s.supply) {
      supplySources.set(id, (supplySources.get(id) ?? 0) + 1)
      reached.add(id)
    }
    for (const id of s.extract) reached.add(id)
  }
  const connected = new Set(model.connections.flatMap((c) => [c.from, c.to]))
  const flowing = devices.filter((e) => {
    const flow = equipmentKind(e.kind)?.flow
    return !!flow && Object.keys(flow).length > 0
  })

  return [
    {
      key: 'terminal-source',
      rule: '공기 말단(디퓨저·그릴)이 원천(공조기·FCU 등)과 이어져 있다',
      why: '그 방을 어느 기기가 맡는지 알 수 없고, 계통도의 담당 공간이 비어 있게 됩니다.',
      total: terminals.length,
      failed: terminals.filter((e) => !reached.has(e.id)).map((e) => e.id),
    },
    {
      key: 'source-terminal',
      rule: '공기 원천이 말단 하나 이상과 이어져 있다',
      why: '담당 공간이 비어 계통도에 나오지 않습니다. 덕트 없는 카세트형이면 정상입니다.',
      total: sources.length,
      failed: services.filter((s) => s.supply.length + s.extract.length === 0).map((s) => s.sourceId),
    },
    {
      key: 'terminal-single-source',
      rule: '급기 말단이 원천 하나에서만 공기를 받는다',
      why: '둘 이상이면 방향 규칙이나 연결이 잘못됐을 수 있고, 담당 공간이 두 기기에 겹칩니다.',
      total: supplySources.size,
      failed: [...supplySources].filter(([, n]) => n > 1).map(([id]) => id),
    },
    {
      key: 'device-space',
      rule: '기기마다 소속 방이 있다 (brick:hasLocation)',
      why: '이상 알림의 발생 위치가 층까지만 나가고, 탐색기 트리에서 방 아래에 보이지 않습니다.',
      total: devices.length,
      failed: devices.filter((e) => !e.spaceId).map((e) => e.id),
      skipped: hasSpaces ? undefined : '방이 없는 파일입니다. 건축 파일을 덧붙이면 검사할 수 있습니다.',
    },
    {
      key: 'device-connected',
      rule: '공기·물이 흐르는 기기가 연결망에 붙어 있다',
      why: '상류·하류를 따라갈 수 없습니다. 포트가 없거나 형상이 맞닿지 않은 경우입니다.',
      total: flowing.length,
      failed: flowing.filter((e) => !connected.has(e.id)).map((e) => e.id),
    },
  ]
}
