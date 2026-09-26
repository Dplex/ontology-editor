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
import { distanceToRing } from './mapping'
import { isConduit, type Connection, type Model } from './model'
import { isAirSource, isAirTerminal, type AirService } from './served'
import { trace, TOLERANCE } from './topology'

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

/** 설비 형상의 상자(최소 x·y·z, 최대 x·y·z). 연결망에서 떨어진 설비가 이웃과 얼마나 떨어졌는지 잴 때 쓴다. */
export type Box = readonly [number, number, number, number, number, number]

export type ExplainContext = {
  model: Model
  /** 검사에 쓴 연결(화면과 같은 방향. 규칙 방향을 켰으면 그것까지). */
  connections: readonly Connection[]
  services: readonly AirService[]
  /** 설비 형상의 상자. 없으면 연결망 검사의 이웃 거리를 말하지 않는다. */
  boxes?: ReadonlyMap<string, Box>
  /** 목록에 보일 이름(이름 · 종류). */
  label: (id: string) => string
}

const gapBetween = (a: Box, b: Box) =>
  Math.hypot(
    Math.max(0, a[0] - b[3], b[0] - a[3]),
    Math.max(0, a[1] - b[4], b[1] - a[4]),
    Math.max(0, a[2] - b[5], b[2] - a[5]),
  )

/**
 * 어긴 것 하나가 **왜** 어겼는지. 목록에 이름만 있으면 하나씩 3D 로 열어 봐야 알 수 있었다. 고칠 방법이 이유마다
 * 다르다 — 좌표가 없는 설비는 좌표를 넣고, 방 경계에서 0.3m 벗어난 설비는 옮기고, 30m 떨어진 설비는 건축 파일이
 * 모자란 것이다. 보이는 줄에만 부른다(검사 전체를 다시 도는 값이 아니다).
 */
export function explainFailure(key: string, id: string, ctx: ExplainContext): string {
  const { model, connections } = ctx
  const equipment = model.storeys.flatMap((s) => s.equipment)
  const byId = new Map(equipment.map((e) => [e.id, e]))
  const e = byId.get(id)
  const conduit = (x: string) => isConduit(byId.get(x)?.role ?? null)
  const touches = connections.some((c) => c.from === id || c.to === id)

  if (key === 'terminal-source' || key === 'source-terminal') {
    if (!touches) {
      return key === 'source-terminal'
        ? '연결이 하나도 없습니다. 덕트 없이 방에 놓인 기기라면 정상입니다.'
        : '연결이 하나도 없습니다.'
    }
    const t = trace(connections, id, conduit)
    const along = new Set([...t.upstream, ...t.downstream])
    const target = key === 'terminal-source' ? '공조기·FCU 같은 원천' : '디퓨저·그릴 같은 말단'
    if (along.size === 0) return `방향을 모르는 연결에서 끊깁니다(이어진 것 ${t.linked.size}개). 방향을 정하면 따라갈 수 있습니다.`
    return `흐름을 따라 ${along.size}개까지 가지만 ${target}이 없습니다` + (t.linked.size ? ` (방향 모름 ${t.linked.size}개).` : '.')
  }

  if (key === 'terminal-single-source') {
    const from = ctx.services.filter((s) => s.supply.includes(id)).map((s) => ctx.label(s.sourceId))
    return `원천 ${from.length}대에서 받습니다: ${from.join(', ')}`
  }

  if (key === 'device-space') {
    if (!e?.position) return '좌표가 없습니다. 위치를 넣으면 소속 방을 찾습니다.'
    const storey = model.storeys.find((s) => s.equipment.some((x) => x.id === id))
    const spaces = (storey?.spaces ?? []).filter((s) => s.footprint.length >= 3)
    if (spaces.length === 0) return '이 층에 물리존이 없습니다. 건축 파일을 덧붙이거나 층을 확인하세요.'
    let best: { name: string; d: number } | null = null
    for (const sp of spaces) {
      const d = distanceToRing([e.position[0], e.position[1]], sp.footprint)
      if (!best || d < best.d) best = { name: sp.longName || sp.name, d }
    }
    return `어느 방에도 들어가지 않습니다. 가장 가까운 방은 ${best!.name}(${best!.d.toFixed(2)}m)입니다.`
  }

  if (key === 'device-connected') {
    const box = ctx.boxes?.get(id)
    if (!box) return '포트도, 맞닿은 형상도 없습니다.'
    let best: { id: string; d: number } | null = null
    for (const other of equipment) {
      if (other.id === id) continue
      if (e?.systemId && other.systemId && other.systemId !== e.systemId) continue
      const b = ctx.boxes!.get(other.id)
      if (!b) continue
      const d = gapBetween(box, b)
      if (!best || d < best.d) best = { id: other.id, d }
    }
    if (!best || best.d > 1) return '1m 안에 이어질 덕트·배관·설비가 없습니다. 접합 부재가 빠졌을 수 있습니다.'
    return `가장 가까운 것: ${ctx.label(best.id)}, ${Math.round(best.d * 1000)}mm 떨어져 있습니다. ${Math.round(TOLERANCE * 1000)}mm 안이어야 연결로 봅니다.`
  }
  return ''
}
