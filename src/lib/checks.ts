// 완전성 검사. 온톨로지가 DT 에서 쓰일 만큼 이어져 있는지를 규칙 몇 줄로 잰다.
//
// 선행 연구(Wang 2026 Table 2, 정본 부록 E)는 이것을 SHACL 기수 규칙으로 적었다. "디퓨저는 정확히
// 한 방에 공급한다", "공조기는 말단 하나 이상에 공급한다" 같은 것이다. NREL BuildingMOTIF 도 같은 방식으로
// Brick 모델을 검증한다. 여기서는 SHACL 엔진을 들이지 않고 같은 규칙을 코드로 센다. 규칙마다 "비면 DT 에서
// 무엇이 안 되는가" 를 같이 적는다. 숫자만 보이면 무엇부터 고칠지 정할 수 없다.
//
// 규칙이 보는 방향은 호출부가 정한다(화면과 같은 방향). 원천·말단은 이름 사전(kinds.ts)으로 가르고,
// 소속 방은 좌표로 판정한 것이라 전부 추정이 섞인 검사다.
//
// 덕트·배관의 양 끝 규칙과 물 계통 규칙은 UCL 그룹의 두 논문에서 왔다(Mavrokapnidis 2023 Table 2 "구간·이음쇠는 둘
// 이상에 이어진다", Wang 2026 Table 2 의 수배관 루프). 공기 규칙만 있을 때는 연결망이 **어디서** 끊겼는지를 말하지
// 못했고(고립된 기기만 셌다), 열원과 공조기·FCU 사이는 아예 보지 않았다.

import { connectCandidates, excludedText } from './connect-candidates'
import { releasesOf } from './connection-release'
import { josa } from './josa'
import { equipmentKind, systemKind } from './kinds'
import { distanceToRing, interiorPoint, pointInPolygon } from './mapping'
import { isConduit, type Connection, type Model, type Vec2, type Vec3 } from './model'
import { overlapAt, type Box3 } from './overlap'
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

/** 열원. 순환수를 데우거나 식혀 내보내는 기기다. 펌프는 급수·배수에도 있어 뺀다(원천이 모델에 없는 망이 흔하다). */
const HEAT_SOURCES: readonly string[] = ['boiler', 'chiller', 'heat_pump', 'ground_source_heat_pump']
/** 냉온수를 받는 기기. 위생기구·스프링클러도 물을 받지만 원천(상수도·소화 수조)이 모델에 없는 것이 보통이라 뺀다. */
const HYDRONIC_USERS: readonly string[] = ['ahu', 'fcu', 'radiator']

/**
 * 순환수 연결. 열원과 냉온수를 받는 기기가 방향을 아는 연결로 이어지는가. 공기 쪽(`airServices`)처럼 한 방향으로만 따라간다 —
 * 공급은 열원에서 하류로, 환수는 열원으로 거슬러 올라간다. **공기 계통의 덕트는 건너지 않는다.** FCU 에서 덕트를 타고
 * 공조기로 넘어가 그 공조기의 냉수관에서 냉동기를 만나면, FCU 가 이어진 것으로 잘못 센다.
 */
function hydronicLinks(model: Model, connections: readonly Connection[]): { sources: Map<string, boolean>; users: Map<string, boolean> } {
  const equipment = model.storeys.flatMap((s) => s.equipment)
  const byId = new Map(equipment.map((e) => [e.id, e]))
  const mediumOf = new Map(model.systems.map((s) => [s.id, systemKind(s.kind)?.medium ?? null]))
  const airOnly = (id: string) => {
    const e = byId.get(id)
    return !!e && isConduit(e.role) && !!e.systemId && mediumOf.get(e.systemId) === 'air'
  }
  const forward = new Map<string, string[]>()
  const backward = new Map<string, string[]>()
  const push = (map: Map<string, string[]>, a: string, b: string) => map.set(a, [...(map.get(a) ?? []), b])
  for (const c of connections) {
    if (!c.directed) continue
    push(forward, c.from, c.to)
    push(backward, c.to, c.from)
  }
  const kindOf = (id: string) => byId.get(id)?.kind ?? ''
  const reaches = (start: string, goal: readonly string[]) => {
    for (const adj of [forward, backward]) {
      const seen = new Set([start])
      const queue = [start]
      while (queue.length) {
        const at = queue.shift()!
        for (const next of adj.get(at) ?? []) {
          if (seen.has(next) || airOnly(next)) continue
          if (goal.includes(kindOf(next))) return true
          seen.add(next)
          queue.push(next)
        }
      }
    }
    return false
  }
  const sources = new Map<string, boolean>()
  const users = new Map<string, boolean>()
  for (const e of equipment) {
    if (HEAT_SOURCES.includes(e.kind ?? '')) sources.set(e.id, reaches(e.id, HYDRONIC_USERS))
    else if (HYDRONIC_USERS.includes(e.kind ?? '')) users.set(e.id, reaches(e.id, HEAT_SOURCES))
  }
  return { sources, users }
}

/**
 * `connections` 는 화면과 같은 방향의 연결이다(규칙 방향을 켰으면 `withInferred` 로 펼친 것). 도관의 양 끝은 방향과
 * 상관없이 이어졌는지만 본다.
 */
export function completenessChecks(model: Model, services: readonly AirService[], connections: readonly Connection[] = model.connections): CheckResult[] {
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
  // 도관마다 이어진 상대의 수. 같은 상대와 두 번 이어진 것(포트 둘)은 하나로 센다.
  const neighbors = new Map<string, Set<string>>()
  for (const c of model.connections) {
    if (c.from === c.to) continue
    neighbors.set(c.from, (neighbors.get(c.from) ?? new Set()).add(c.to))
    neighbors.set(c.to, (neighbors.get(c.to) ?? new Set()).add(c.from))
  }
  const conduits = equipment.filter((e) => isConduit(e.role))
  const hydronic = hydronicLinks(model, connections)

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
    {
      key: 'conduit-ends',
      rule: '덕트·배관 구간과 이음쇠가 양쪽 모두 이어져 있다',
      why: '연결망이 이 자리에서 끊깁니다. 흐름이 여기서 멈춰 담당 설비·공간을 따라갈 수 없습니다. 끝막이(캡)라면 정상입니다.',
      total: conduits.length,
      failed: conduits.filter((e) => (neighbors.get(e.id)?.size ?? 0) < 2).map((e) => e.id),
    },
    {
      key: 'heat-source-user',
      rule: '열원(보일러·냉동기·히트펌프)이 냉온수를 받는 기기(공조기·FCU·방열기)와 이어져 있다',
      why: '열원이 어느 기기에 냉온수를 보내는지 알 수 없어, 열원 고장이 어디까지 번지는지 계통도에 나오지 않습니다.',
      total: hydronic.sources.size,
      failed: [...hydronic.sources].filter(([, ok]) => !ok).map(([id]) => id),
    },
    {
      key: 'hydronic-user-source',
      rule: '냉온수를 받는 기기(공조기·FCU·방열기)가 열원과 이어져 있다',
      why: '이 기기의 냉온수를 어느 열원이 대는지 알 수 없습니다. 열원이 모델에 없으면(다른 파일·다른 건물) 그 파일을 덧붙여야 합니다.',
      total: hydronic.users.size,
      failed: [...hydronic.users].filter(([, ok]) => !ok).map(([id]) => id),
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
  /**
   * 겹침 판정의 설비 상자(IFC 좌표, overlap.ts). 있으면 [방 안으로 옮기기] 가 배관 없는 설비끼리 겹치는 자리를 권하지 않는다 —
   * 권한 자리가 겹치면 누를 때 편집이 겹침 금지(OE-OBJ-16)에 막혀 아무 일도 일어나지 않았다(성수 HV PNL).
   */
  boxOf?: (id: string) => Box3 | null
  /** 목록에 보일 이름(이름 · 종류). */
  label: (id: string) => string
}

/**
 * 어긴 것 하나가 **왜** 어겼는지. 목록에 이름만 있으면 하나씩 3D 로 열어 봐야 알 수 있었다. 고칠 방법이 이유마다
 * 다르다 — 좌표가 없는 설비는 좌표를 넣고, 방 경계에서 0.3m 벗어난 설비는 옮기고, 30m 떨어진 설비는 건축 파일이
 * 모자란 것이다. 보이는 줄에만 부른다(검사 전체를 다시 도는 값이 아니다).
 */
/** 한 번에 고칠 수 있는 것. 화면이 버튼으로 보이고, 누르면 여느 편집과 같이 되돌리기에 쌓인다. */
export type FailureFix =
  /** 방 경계 바로 안쪽으로 옮긴다. 경계에서 조금 벗어난 설비(벽에 붙은 것 등)가 흔하다. */
  | { kind: 'move-into'; spaceName: string; to: Vec3 }
  /** 가장 가까운 이웃과 잇는다. 형상이 허용 거리 밖에서 떨어진 것. */
  | { kind: 'connect'; other: string }

export function explainFailure(key: string, id: string, ctx: ExplainContext): string {
  return diagnoseFailure(key, id, ctx).text
}

/**
 * 경계에서 가장 가까운 점에서 벽에 수직으로 방 안쪽으로 `margin` 만큼 들어간 점. 오목한 모서리라 안이 아니면 방 안의 한 점
 * (`fallback` 이 거짓이면 null — 더 깊이 들어가 보는 자리가 방 반대편으로 튀지 않게).
 */
function justInside(p: Vec2, ring: readonly Vec2[], margin = 0.1, fallback = true): Vec2 | null {
  let best: { q: Vec2; d: number; n: Vec2 } | null = null
  for (let i = 0; i + 1 < ring.length; i++) {
    const [ax, ay] = ring[i]
    const [bx, by] = ring[i + 1]
    const len2 = (bx - ax) ** 2 + (by - ay) ** 2
    if (len2 === 0) continue
    const t = Math.max(0, Math.min(1, ((p[0] - ax) * (bx - ax) + (p[1] - ay) * (by - ay)) / len2))
    const q: Vec2 = [ax + t * (bx - ax), ay + t * (by - ay)]
    const d = Math.hypot(q[0] - p[0], q[1] - p[1])
    const len = Math.sqrt(len2)
    if (!best || d < best.d) best = { q, d, n: [-(by - ay) / len, (bx - ax) / len] }
  }
  if (best) {
    for (const sign of [1, -1]) {
      const step: Vec2 = [best.q[0] + sign * best.n[0] * margin, best.q[1] + sign * best.n[1] * margin]
      if (pointInPolygon(step, ring)) return step
    }
  }
  return fallback ? interiorPoint(ring) : null
}

/** [방 안으로 옮기기] 가 경계에서 들어가 보는 깊이(미터). 바로 안쪽이 다른 설비와 겹치면 차례로 더 들어간다. */
const INSIDE_STEPS = [0.1, 0.3, 0.6, 1, 1.5]

const cm = (v: number) => Math.round(v * 100) / 100

export function diagnoseFailure(key: string, id: string, ctx: ExplainContext): { text: string; fix?: FailureFix } {
  const say = (text: string, fix?: FailureFix) => (fix ? { text, fix } : { text })
  const { model, connections } = ctx
  const equipment = model.storeys.flatMap((s) => s.equipment)
  const byId = new Map(equipment.map((e) => [e.id, e]))
  const e = byId.get(id)
  const conduit = (x: string) => isConduit(byId.get(x)?.role ?? null)
  const touches = connections.some((c) => c.from === id || c.to === id)

  if (key === 'terminal-source' || key === 'source-terminal') {
    if (!touches) {
      return key === 'source-terminal'
        ? say('연결이 하나도 없습니다. 덕트 없이 방에 놓인 기기라면 정상입니다.')
        : say('연결이 하나도 없습니다.')
    }
    const t = trace(connections, id, conduit)
    const along = new Set([...t.upstream, ...t.downstream])
    const target = key === 'terminal-source' ? '공조기·FCU 같은 원천' : '디퓨저·그릴 같은 말단'
    if (along.size === 0) return say(`방향을 모르는 연결에서 끊깁니다(이어진 것 ${t.linked.size}개). 방향을 정하면 따라갈 수 있습니다.`)
    return say(`흐름을 따라 ${along.size}개까지 가지만 ${target}${josa(target, '이/가')} 없습니다` + (t.linked.size ? ` (방향 모름 ${t.linked.size}개).` : '.'))
  }

  if (key === 'terminal-single-source') {
    const from = ctx.services.filter((s) => s.supply.includes(id)).map((s) => ctx.label(s.sourceId))
    return say(`원천 ${from.length}대에서 받습니다: ${from.join(', ')}`)
  }

  if (key === 'device-space') {
    if (!e?.position) return say('좌표가 없습니다. 위치를 넣으면 소속 방을 찾습니다.')
    const storey = model.storeys.find((s) => s.equipment.some((x) => x.id === id))
    const spaces = (storey?.spaces ?? []).filter((s) => s.footprint.length >= 3)
    if (spaces.length === 0) return say('이 층에 물리존이 없습니다. 건축 파일을 덧붙이거나 층을 확인하세요.')
    let best: { name: string; d: number; ring: Vec2[] } | null = null
    for (const sp of spaces) {
      const d = distanceToRing([e.position[0], e.position[1]], sp.footprint)
      if (!best || d < best.d) best = { name: sp.longName || sp.name, d, ring: sp.footprint }
    }
    const text = `어느 방에도 들어가지 않습니다. 가장 가까운 방은 ${best!.name}(${best!.d.toFixed(2)}m)입니다.`
    // 멀리 떨어진 것(건축 파일이 모자라거나 층이 틀린 것)은 옮겨서 고칠 일이 아니다. 경계 가까이에 있을 때만 권한다.
    if (best!.d > 1) return say(text)
    // 권하는 자리가 다른 배관 없는 설비와 겹치면 편집이 막힌다(OE-OBJ-16). 겹치지 않는 자리까지 더 들어가 보고, 없으면 권하지 않는다.
    let blocked: string | null = null
    for (const [i, margin] of INSIDE_STEPS.entries()) {
      const inside = justInside([e.position[0], e.position[1]], best!.ring, margin, i === 0)
      if (!inside) continue
      const to: Vec3 = [cm(inside[0]), cm(inside[1]), e.position[2]]
      const hit = ctx.boxOf ? overlapAt(model, id, to, ctx.boxOf) : null
      if (!hit) return say(text, { kind: 'move-into', spaceName: best!.name, to })
      blocked ??= hit.id
    }
    if (!blocked) return say(text)
    const other = ctx.label(blocked)
    return say(`${text} 경계 안쪽 ${INSIDE_STEPS.at(-1)}m 까지는 ${other}${josa(other, '과/와')} 겹쳐 바로 옮길 수 없습니다.`)
  }

  if (key === 'heat-source-user' || key === 'hydronic-user-source') {
    if (!touches) return say('연결이 하나도 없습니다.')
    const t = trace(connections, id, conduit)
    const along = new Set([...t.upstream, ...t.downstream])
    const target = key === 'heat-source-user' ? '공조기·FCU·방열기' : '보일러·냉동기·히트펌프 같은 열원'
    if (along.size === 0) return say(`방향을 모르는 연결에서 끊깁니다(이어진 것 ${t.linked.size}개). 방향을 정하면 따라갈 수 있습니다.`)
    return say(`흐름을 따라 ${along.size}개까지 가지만 ${target}${josa(target, '이/가')} 없습니다. 공기 덕트는 건너지 않습니다.`)
  }

  if (key === 'device-connected' || key === 'conduit-ends') {
    // 도관의 한쪽 끝만 이어졌으면 이미 이어진 상대는 후보에서 뺀다 — 열린 끝에 붙을 것을 찾는다.
    const linked = new Set(ctx.model.connections.flatMap((c) => (c.from === id ? [c.to] : c.to === id ? [c.from] : [])))
    // 사람이 해제 보정한 BIM 연결이 있으면 누락이 아니라 의도한 해제다(OE-PIP-06). 먼저 말하고, 그 상대는 후보에서 뺀다.
    const released = releasesOf(ctx.model, id).filter((r) => r.review !== 'missing').length
    const why = released ? `해제 보정한 BIM 연결 ${released}개가 있습니다(의도한 해제라 되살리지 않습니다). ` : ''
    if (key === 'conduit-ends' && linked.size === 1) {
      if (!ctx.boxes?.get(id)) return say(why + '한쪽 끝만 이어져 있습니다. 형상이 없어 반대쪽 이웃을 잴 수 없습니다.')
    }
    const box = ctx.boxes?.get(id)
    // 해제한 연결이 있으면 포트가 없었던 것이 아니다. 형상이 없어 이웃을 못 잰다고만 한다.
    if (!box) return say(why + (released ? '형상이 없어 가까운 이웃을 잴 수 없습니다.' : '포트도, 맞닿은 형상도 없습니다.'))
    // 가까운 순 후보에서 다른 매체·흐름 없는 기기·말단끼리·다른 계통·해제한 연결을 뺀다(OE-PIP-08, connect-candidates.ts).
    const found = connectCandidates(ctx.model, id, ctx.boxes!)
    const best = found.candidates[0]
    const head = why + (key === 'conduit-ends' ? (linked.size === 0 ? '어디에도 이어져 있지 않습니다. ' : '한쪽 끝만 이어져 있습니다. ') : '')
    const skipped = excludedText(found.excluded)
    if (!best) {
      return say(head + '1m 안에 이어질 덕트·배관·설비가 없습니다. 접합 부재가 빠졌을 수 있습니다.' + (skipped ? ` ${skipped} 직접 확인한 뒤 설비 패널의 [연결하기]로 잇습니다.` : ''))
    }
    return say(
      `${head}가장 가까운 것: ${ctx.label(best.id)}, ${Math.round(best.distance * 1000)}mm 떨어져 있습니다. ${Math.round(TOLERANCE * 1000)}mm 안이어야 연결로 봅니다.` +
        (skipped ? ` ${skipped}` : ''),
      { kind: 'connect', other: best.id },
    )
  }
  return say('')
}
