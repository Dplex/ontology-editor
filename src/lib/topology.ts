// 설비·배관이 어떻게 이어져 있는지를 다룬다. 온톨로지의 `brick:feeds` 가 여기서 나온다.
//
// 연결을 아는 길이 둘이다.
//
//   포트   BIM 이 IfcDistributionPort 로 직접 말한다. SOURCE→SINK 로 방향까지 온다.
//   형상   포트가 없는 파일에서, 요소의 메시 꼭짓점이 맞닿는 것으로 추정한다. 방향은 모른다.
//
// Duplex MEP 판본은 포트가 0 이다(원본도 최적화본도). 그런데 배관 끝과 피팅 끝의 꼭짓점이
// 1mm 안쪽으로 겹쳐서, 같은 계통끼리만 이으면 계통별 연결망이 깔끔하게 나온다.
// 추정은 추정으로 남긴다 — 방향을 지어내면 상류·하류가 거짓이 된다.

import type { Connection } from './model'

export type ElementPoints = {
  id: string
  /** 세계 좌표 꼭짓점을 x,y,z 순으로 이어 붙인 것(미터). 축 방향은 상관없다. */
  points: Float32Array
  /**
   * 이 요소가 속한 계통 이름들. **다른 계통끼리는 맞닿아도 잇지 않는다.**
   *
   * 냉수관과 온수관은 나란히 붙어 달리는 일이 흔해서, 형상만 보면 수십 곳에서 붙어 있다.
   * 계통을 모르면(null) 거르지 않는다.
   */
  systems: readonly string[] | null
}

/**
 * 꼭짓점이 tolerance 안으로 겹치는 요소끼리 잇는다.
 *
 * 격자에 꼭짓점을 담고 이웃 27칸만 본다. 칸 크기를 tolerance 로 두면 이웃 칸 밖의 점은
 * 반드시 tolerance 보다 멀어서, 놓치는 쌍 없이 비교 횟수만 준다. 격자 좌표를 반올림으로만
 * 맞추면 칸 경계를 사이에 둔 두 점을 놓친다 — 실측에서 연결망이 잘게 쪼개졌다.
 */
/**
 * 형상이 맞닿았다고 볼 거리(미터).
 *
 * 5mm 다. ifc4Mep 의 포트를 정답지로 재 보면 정밀도 79.6% · 재현율 75.8% 로, 1mm(88.8% ·
 * 47.0%)와 10mm(74.5% · 84.1%) 사이의 균형점이다. F1 은 10mm 가 조금 높지만 **온톨로지는
 * 틀린 관계가 들어가는 쪽이 빠지는 쪽보다 나쁘므로** 정밀도를 택했다.
 * 측정표는 `docs/ifc-coverage.md` §4.1 에 있고 `npm run check:sample` 이 다시 잰다.
 */
export const TOLERANCE = 0.005

/**
 * 고립된 요소를 살릴 때까지 넓혀 볼 거리(미터).
 *
 * 50mm 에서 재현율이 94.3% 로 포화하고, 그래도 안 붙는 것은 더 키워도 안 붙었다.
 * 그 너머는 오차가 아니라 접합 부재가 없는 것이다.
 */
export const REACH = 0.05

export function inferConnections(elements: readonly ElementPoints[], tolerance = TOLERANCE): Connection[] {
  const cell = (v: number) => Math.floor(v / tolerance)
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`

  // 한 요소의 같은 꼭짓점은 한 번만 담는다. 메시는 면마다 꼭짓점을 따로 들고 있어서 같은
  // 점이 여러 번 나온다. 거르는 단위는 칸보다 훨씬 잘게 둔다 — 칸 단위로 거르면 한 칸에 든
  // 서로 다른 두 끝점 중 하나를 버려서, 그 끝에 붙은 연결을 놓친다.
  type Entry = { index: number; x: number; y: number; z: number }
  const grid = new Map<string, Entry[]>()
  const fine = tolerance / 50
  elements.forEach((el, index) => {
    const seen = new Set<string>()
    for (let i = 0; i + 2 < el.points.length; i += 3) {
      const x = el.points[i]
      const y = el.points[i + 1]
      const z = el.points[i + 2]
      const dedupe = key(Math.round(x / fine), Math.round(y / fine), Math.round(z / fine))
      if (seen.has(dedupe)) continue
      seen.add(dedupe)
      const k = key(cell(x), cell(y), cell(z))
      const list = grid.get(k)
      if (list) list.push({ index, x, y, z })
      else grid.set(k, [{ index, x, y, z }])
    }
  })

  const compatible = (a: ElementPoints, b: ElementPoints) =>
    a.systems === null || b.systems === null || a.systems.some((s) => b.systems!.includes(s))

  const pairs = new Set<string>()
  const out: Connection[] = []
  const limit = tolerance * tolerance

  for (const [k, entries] of grid) {
    const [cx, cy, cz] = k.split(',').map(Number)
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++) {
          const near = grid.get(key(cx + dx, cy + dy, cz + dz))
          if (!near) continue
          for (const p of entries)
            for (const q of near) {
              if (q.index <= p.index) continue
              const pair = `${p.index}:${q.index}`
              if (pairs.has(pair)) continue
              if ((p.x - q.x) ** 2 + (p.y - q.y) ** 2 + (p.z - q.z) ** 2 > limit) continue
              const a = elements[p.index]
              const b = elements[q.index]
              if (!compatible(a, b)) continue
              pairs.add(pair)
              out.push({ from: a.id, to: b.id, source: 'geometry', directed: false, tolerance })
            }
        }
  }
  return out
}

/**
 * 연결이 하나도 없는 요소. **왜 없는지가 둘로 갈린다.**
 *
 *   `'derived'`  상대는 있는데 허용 오차 밖이라 못 이었다. **오차를 키우면 붙는다.**
 *   `'primary'`  주변에 상대가 아예 없다. 접합 부재가 모델에 없는 것이다.
 *
 * 이 구분이 고객사에 할 말을 정한다. 전자는 "우리가 판정 기준을 조정하겠다" 이고 후자는
 * **"모델을 다시 그려 달라"** 다. 둘을 "연결 없음" 하나로 뭉치면 그 말을 할 수 없다.
 * Lilis 2025 가 1차·2차 결손(primary / derived knowledge gap)이라 부른 것이다.
 */
export type Gap = {
  id: string
  kind: 'primary' | 'derived'
  /** 이을 수 있었을 가장 가까운 요소까지의 거리(미터). `reach` 안에서 못 찾으면 `null`. */
  nearest: number | null
  /** 그 가장 가까운 요소의 id. 1차 결손이면 `null` 이다. */
  nearestId: string | null
}

/**
 * 연결이 없는 요소를 찾아 그 이유를 가른다.
 *
 * `reach` 는 "이 정도면 원래 이어졌어야 할 거리" 다. 기본 50mm 는 실측에서 온 값이다 —
 * ifc4Mep 의 포트를 정답지로 놓고 허용 오차를 키워 보면 50mm 에서 재현율이 94.3% 로
 * 사실상 포화하고, 그래도 안 붙는 113개는 오차를 더 키워도 안 붙었다. 그 경계가 여기다.
 *
 * 계통이 다른 상대는 세지 않는다. 오차를 키워도 어차피 안 이을 것이라, 세면 "오차 문제" 라고
 * 잘못 말하게 된다.
 */
export function findGaps(
  elements: readonly ElementPoints[],
  connections: readonly Connection[],
  reach = 0.05,
): Gap[] {
  const connected = new Set<string>()
  for (const c of connections) {
    connected.add(c.from)
    connected.add(c.to)
  }
  const lonely = elements.filter((e) => !connected.has(e.id))
  if (lonely.length === 0) return []

  // 격자 칸을 reach 로 잡으면 이웃 27칸 밖의 점은 반드시 reach 보다 멀다. inferConnections
  // 와 같은 장치인데, 여기서는 "닿았나" 가 아니라 "얼마나 가까운가" 를 본다.
  const cell = (v: number) => Math.floor(v / reach)
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`
  const grid = new Map<string, { index: number; x: number; y: number; z: number }[]>()
  elements.forEach((el, index) => {
    for (let i = 0; i + 2 < el.points.length; i += 3) {
      const x = el.points[i]
      const y = el.points[i + 1]
      const z = el.points[i + 2]
      const k = key(cell(x), cell(y), cell(z))
      const list = grid.get(k)
      if (list) list.push({ index, x, y, z })
      else grid.set(k, [{ index, x, y, z }])
    }
  })

  const compatible = (a: ElementPoints, b: ElementPoints) =>
    a.systems === null || b.systems === null || a.systems.some((s) => b.systems!.includes(s))

  const indexOf = new Map(elements.map((e, i) => [e.id, i]))
  const limit = reach * reach
  return lonely.map((el) => {
    const self = indexOf.get(el.id)!
    let best = Infinity
    let bestIndex = -1
    for (let i = 0; i + 2 < el.points.length; i += 3) {
      const x = el.points[i]
      const y = el.points[i + 1]
      const z = el.points[i + 2]
      const cx = cell(x)
      const cy = cell(y)
      const cz = cell(z)
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++)
          for (let dz = -1; dz <= 1; dz++) {
            const near = grid.get(key(cx + dx, cy + dy, cz + dz))
            if (!near) continue
            for (const q of near) {
              if (q.index === self) continue
              const d = (x - q.x) ** 2 + (y - q.y) ** 2 + (z - q.z) ** 2
              if (d >= best || d > limit) continue
              if (!compatible(el, elements[q.index])) continue
              best = d
              bestIndex = q.index
            }
          }
    }
    const nearest = bestIndex === -1 ? null : Math.sqrt(best)
    return {
      id: el.id,
      kind: nearest === null ? 'primary' : 'derived',
      nearest,
      nearestId: bestIndex === -1 ? null : elements[bestIndex].id,
    } as Gap
  })
}

/**
 * 2차 결손을 메운다 — 고립된 요소를 가장 가까운 상대에 잇는다.
 *
 * 판정 오차를 전역으로 키우면 안 된다. 실측에서 5mm → 50mm 로 넓히면 재현율은 75.8% →
 * 94.3% 로 오르지만 정밀도가 79.6% → 55.1% 로 무너진다. 이미 이어진 요소들 사이에 엉뚱한
 * 연결이 쏟아지기 때문이다.
 *
 * **고립된 요소는 사정이 다르다. 잃을 연결이 없다.** 그 주변에서만 넓히면 망에 붙이면서
 * 정밀도는 건드리지 않는다.
 *
 * 요소마다 **가장 가까운 상대 하나에만** 잇는다. 반경 안의 모든 것에 이으면 없던 분기를
 * 지어내게 된다. 고아를 망에 붙이는 것까지가 우리가 아는 것이고, 그 너머는 추측이다.
 */
export function connectGaps(gaps: readonly Gap[]): Connection[] {
  // 고립된 요소는 정의상 기존 연결에 안 걸려 있다. 그래서 볼 중복은 **고립된 것끼리 서로를
  // 지목한 경우** 하나뿐이다.
  const seen = new Set<string>()
  const out: Connection[] = []
  for (const gap of gaps) {
    if (gap.nearestId === null || gap.nearest === null) continue
    const pair = gap.id < gap.nearestId ? `${gap.id}|${gap.nearestId}` : `${gap.nearestId}|${gap.id}`
    if (seen.has(pair)) continue
    seen.add(pair)
    // 실제로 떨어져 있던 거리를 그대로 적는다. 검토 화면이 이 값을 보여 준다.
    out.push({ from: gap.id, to: gap.nearestId, source: 'geometry', directed: false, tolerance: gap.nearest })
  }
  return out
}

export type Trace = {
  /** 흐름을 거슬러 올라가서만 닿는 요소. */
  upstream: Set<string>
  /** 흐름을 따라 내려가서만 닿는 요소. */
  downstream: Set<string>
  /**
   * 이어져 있지만 상류인지 하류인지 모르는 요소.
   *
   * 방향을 모르는 연결을 하나라도 거쳐야 닿는 곳이 여기 온다. 포트가 없는 파일은 전부
   * 여기 들어간다. 양쪽으로 다 닿는 것(방향 없는 고리를 돌아 나오는 곳)도 여기 넣는다 —
   * 어느 한쪽으로 단정하면 틀린 쪽이 반이다.
   */
  linked: Set<string>
}

/**
 * 한 요소에서 상류·하류를 따라간다.
 *
 * 방향이 있는 연결은 그 방향으로만, 방향이 없는 연결은 양쪽으로 탄다. 그렇게 내려가서 닿은
 * 곳과 올라가서 닿은 곳을 따로 모은 뒤, 방향 있는 연결만으로 닿은 곳만 상류·하류로 둔다.
 * 나머지는 전부 "이어져 있지만 방향 모름" 이다.
 *
 * `isConduit` 를 주면 **방향 모름은 다음 기기에서 멈춘다**(그 기기까지는 넣는다). 주지 않으면
 * 연결망 끝까지 번진다. 성수 기계 파일은 요소의 68%(13,066개)가 순환수 배관으로 한 덩어리라,
 * FCU 하나를 고르면 순환수관 → 다른 FCU → 그 FCU 의 덕트·디퓨저로 번져 1만 개가 넘게 "이어짐" 이
 * 됐다. 멈추면 3,051개(기기 143)다. 방향을 아는 길은 기기를 지나 계속 간다 — 디퓨저의 상류가
 * 공조기에서 끝나지 않고 그 공조기에 물을 보내는 열원까지 닿아야 한다.
 */
export function trace(
  connections: readonly Connection[],
  start: string,
  isConduit?: (id: string) => boolean,
): Trace {
  type Edge = { to: string; directed: boolean }
  const forward = new Map<string, Edge[]>()
  const backward = new Map<string, Edge[]>()
  const push = (map: Map<string, Edge[]>, at: string, edge: Edge) => {
    const list = map.get(at)
    if (list) list.push(edge)
    else map.set(at, [edge])
  }
  for (const c of connections) {
    push(forward, c.from, { to: c.to, directed: c.directed })
    push(backward, c.to, { to: c.from, directed: c.directed })
    if (!c.directed) {
      push(forward, c.to, { to: c.from, directed: false })
      push(backward, c.from, { to: c.to, directed: false })
    }
  }

  // 방향 있는 연결만 탄 도달과, 방향 없는 연결까지 섞어 탄 도달을 나눠 센다.
  const walk = (adj: Map<string, Edge[]>) => {
    const strict = new Set<string>()
    const any = new Set<string>()
    const queue: [string, boolean][] = [[start, true]]
    const visited = new Map<string, boolean>([[start, true]])
    while (queue.length > 0) {
      const [at, pure] = queue.shift()!
      for (const e of adj.get(at) ?? []) {
        const nextPure = pure && e.directed
        const had = visited.get(e.to)
        // 이미 "순수하게" 닿은 곳은 다시 볼 필요가 없다. 순수하지 않게 닿았던 곳에 순수한
        // 길이 새로 나면 한 번 더 본다.
        if (had === true || (had === false && !nextPure)) continue
        visited.set(e.to, nextPure)
        if (e.to !== start) (nextPure ? strict : any).add(e.to)
        // 방향을 모르는 채로 닿은 기기는 넣기만 하고 그 너머로는 가지 않는다.
        if (!nextPure && isConduit && e.to !== start && !isConduit(e.to)) continue
        queue.push([e.to, nextPure])
      }
    }
    for (const id of strict) any.delete(id)
    return { strict, any }
  }

  const down = walk(forward)
  const up = walk(backward)

  const upstream = new Set([...up.strict].filter((id) => !down.strict.has(id)))
  const downstream = new Set([...down.strict].filter((id) => !up.strict.has(id)))
  const linked = new Set<string>()
  for (const id of [...down.any, ...up.any, ...up.strict, ...down.strict]) {
    if (!upstream.has(id) && !downstream.has(id)) linked.add(id)
  }
  return { upstream, downstream, linked }
}

/** 계통 하나로 좁힌 추적. `systemId` 가 null 이면 덕트·배관 없이 기기끼리 바로 붙은 연결이다. */
export type SystemTrace = Trace & { systemId: string | null }

/**
 * 고른 요소의 연결을 **계통별로** 따라간다.
 *
 * FCU 하나에는 순환수 공급관·환수관·응축수 배수관·급기 덕트가 같이 붙는다. 한데 섞어 세면 성수에서
 * "이어짐 3,051" 이 되는데, 엔지니어가 묻는 것은 "이 FCU 의 물은 어느 관에서 와서 어느 관으로 가고, 바람은
 * 어느 디퓨저로 가는가" 다. 그래서 고른 요소에 바로 붙은 덕트·배관의 계통마다, **그 계통의 덕트·배관을 지나는
 * 연결만** 남겨 따로 추적한다. 끝에 걸린 기기는 계통 밖이어도 센다(FCU 는 보통 어느 계통의 구성원도 아니다).
 */
export function traceBySystem(
  connections: readonly Connection[],
  start: string,
  systemOf: (id: string) => string | null,
  isConduit: (id: string) => boolean,
): SystemTrace[] {
  const keys = new Set<string | null>()
  for (const c of connections) {
    const other = c.from === start ? c.to : c.to === start ? c.from : null
    if (other === null) continue
    keys.add(isConduit(other) ? systemOf(other) : null)
  }
  return [...keys].map((systemId) => {
    const edges = connections.filter((c) => {
      const conduits = [c.from, c.to].filter(isConduit)
      if (systemId === null) return conduits.length === 0
      return conduits.length > 0 && conduits.every((id) => systemOf(id) === systemId)
    })
    return { systemId, ...trace(edges, start, isConduit) }
  })
}

/** 한 요소에 바로 붙은 이웃. 선택한 요소의 연결 목록을 보여 줄 때 쓴다. */
export type Neighbor = {
  id: string
  relation: 'upstream' | 'downstream' | 'linked'
  source: Connection['source']
  /** 형상으로 이었다면 그때의 거리(미터). 넓혀서 이은 것을 검토 화면이 이 값으로 구별한다. */
  tolerance: number | null
  /** 이 이웃과 잇는 연결. 검토 화면이 사람이 정한 방향을 여기에 적는다. */
  connection: Connection
}

export function neighbors(connections: readonly Connection[], id: string): Neighbor[] {
  const out: Neighbor[] = []
  for (const c of connections) {
    if (c.from === id) {
      out.push({ id: c.to, relation: c.directed ? 'downstream' : 'linked', source: c.source, tolerance: c.tolerance, connection: c })
    } else if (c.to === id) {
      out.push({ id: c.from, relation: c.directed ? 'upstream' : 'linked', source: c.source, tolerance: c.tolerance, connection: c })
    }
  }
  return out
}

/**
 * 기기에서 기기로 가는 흐름. **DT 가 받는 연결은 이것이다.**
 *
 * 받는 쪽(ieum-pipeline 의 ttl.go)은 덕트·배관을 엔티티로 읽지 않는다(fso: 클래스). 그래서
 * 연결 개수가 아니라 "기기끼리 닿는가" 를 세야 DT 가 무엇을 받는지 말할 수 있다. 연결 단위로 세면
 * Duplex HVAC 가 "방향 39%" 로 보이는데, 기기에서 출발한 방향 사슬은 전부 중간의 SOURCEANDSINK
 * 에서 끊겨서 기기끼리 닿는 흐름은 0 이다.
 *
 * - `directed` — 기기에서 출발해 **방향을 아는 변만** 타고 덕트·배관을 지나 닿은 기기. TTL 이
 *   이 쌍을 `brick:feeds` 로 적는다(Brick 은 원래 "공조기 feeds VAV" 처럼 덕트를 건너뛴다).
 * - `linked` — 방향과 무관하게 덕트·배관을 지나 **다른 기기와 이어진 기기**. 분모로 쓴다.
 *
 * 분모를 쌍으로 잡지 않는다. 한 배관에 나란히 매달린 토출구끼리도 "이어진 쌍" 인데, 형제끼리는
 * 원래 흐름이 없어서 영원히 채워지지 않는다. 쌍으로 셌을 때 방향이 100% 인 ifc4Mep 이 30/492 로
 * 나왔다. 기기 단위로 "공급하거나 공급받는 기기가 있는가" 를 센다.
 *
 * 둘 다 덕트·배관만 **지나간다.** 중간에 다른 기기(밸브·댐퍼)가 있으면 거기서 멈춘다 —
 * 공조기 → 댐퍼, 댐퍼 → 토출구 로 따로 적힌다.
 */
export function deviceFlows(
  connections: readonly Connection[],
  isConduitId: (id: string) => boolean,
  devices: Iterable<string>,
): { directed: Map<string, string[]>; linked: Set<string>; fed: Set<string> } {
  const out = new Map<string, string[]>()
  const both = new Map<string, string[]>()
  const push = (map: Map<string, string[]>, a: string, b: string) => {
    const list = map.get(a)
    if (list) list.push(b)
    else map.set(a, [b])
  }
  for (const c of connections) {
    if (c.directed) push(out, c.from, c.to)
    push(both, c.from, c.to)
    push(both, c.to, c.from)
  }

  /** 덕트·배관만 지나서 닿는 기기들. */
  const reach = (start: string, adj: Map<string, string[]>) => {
    const found = new Set<string>()
    const seen = new Set<string>([start])
    const queue = [...(adj.get(start) ?? [])]
    for (const id of queue) seen.add(id)
    while (queue.length > 0) {
      const at = queue.shift()!
      if (!isConduitId(at)) {
        found.add(at)
        continue
      }
      for (const n of adj.get(at) ?? []) {
        if (seen.has(n)) continue
        seen.add(n)
        queue.push(n)
      }
    }
    found.delete(start)
    return found
  }

  const directed = new Map<string, string[]>()
  const linked = new Set<string>()
  /** 흐름 방향으로 다른 기기와 이어진 기기 — 공급하거나 공급받는다. */
  const fed = new Set<string>()
  for (const id of devices) {
    const down = reach(id, out)
    if (down.size > 0) {
      directed.set(id, [...down])
      fed.add(id)
      for (const d of down) fed.add(d)
    }
    if (reach(id, both).size > 0) linked.add(id)
  }
  return { directed, linked, fed }
}
