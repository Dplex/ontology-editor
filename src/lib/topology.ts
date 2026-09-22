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
export function inferConnections(elements: readonly ElementPoints[], tolerance = 0.005): Connection[] {
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
              out.push({ from: a.id, to: b.id, source: 'geometry', directed: false })
            }
        }
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
 */
export function trace(connections: readonly Connection[], start: string): Trace {
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

/** 한 요소에 바로 붙은 이웃. 선택한 요소의 연결 목록을 보여 줄 때 쓴다. */
export function neighbors(
  connections: readonly Connection[],
  id: string,
): { id: string; relation: 'upstream' | 'downstream' | 'linked'; source: Connection['source'] }[] {
  const out: { id: string; relation: 'upstream' | 'downstream' | 'linked'; source: Connection['source'] }[] = []
  for (const c of connections) {
    if (c.from === id) out.push({ id: c.to, relation: c.directed ? 'downstream' : 'linked', source: c.source })
    else if (c.to === id) out.push({ id: c.from, relation: c.directed ? 'upstream' : 'linked', source: c.source })
  }
  return out
}
