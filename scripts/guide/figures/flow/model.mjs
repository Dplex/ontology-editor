// 그림 2(흐름 방향)의 연결망과 추적 규칙이다. src/lib/topology.ts 의 trace·deviceFlows 를 그대로 옮겼다.
// 그림이 칠하는 범위, 읽음판 숫자, brick:feeds 줄은 모두 여기서 나온다.

/** 연결망의 요소. 기기는 brick:feeds 의 주어·목적어가 되고, 덕트(conduit)는 건너뛴다. */
export const ELEMENTS = [
  { id: "AHU-1", device: true, cls: "brick:AHU" },
  { id: "DUCT-1", device: false },
  { id: "TEE-1", device: false },
  { id: "DUCT-2", device: false },
  { id: "TEE-2", device: false },
  { id: "DUCT-3", device: false },
  { id: "VAV-1", device: true, cls: "brick:VAV" },
  { id: "VAV-2", device: true, cls: "brick:VAV" },
  { id: "VAV-3", device: true, cls: "brick:VAV" },
  { id: "DUCT-4", device: false },
  { id: "DUCT-5", device: false },
  { id: "DUCT-6", device: false },
  { id: "D-1", device: true, cls: "brick:Diffuser" },
  { id: "D-2", device: true, cls: "brick:Diffuser" },
  { id: "D-3", device: true, cls: "brick:Diffuser" },
];

/**
 * 연결. source 가 port 면 BIM 포트가 들어오고 나가는 쪽을 적었으니 from → to 가 흐름 방향이다.
 * geometry 는 편집기가 형상으로 맞닿았다고 추정한 연결이라 방향이 없다(from·to 는 이름일 뿐이다).
 */
export const CONNECTIONS = [
  { id: "J1", from: "AHU-1", to: "DUCT-1", source: "port" },
  { id: "J2", from: "DUCT-1", to: "TEE-1", source: "port" },
  { id: "J3", from: "TEE-1", to: "VAV-1", source: "port" },
  { id: "J4", from: "TEE-1", to: "DUCT-2", source: "port" },
  { id: "J5", from: "DUCT-2", to: "TEE-2", source: "port" },
  { id: "J6", from: "TEE-2", to: "VAV-2", source: "port" },
  { id: "J7", from: "TEE-2", to: "DUCT-3", source: "geometry" },
  { id: "J8", from: "DUCT-3", to: "VAV-3", source: "port" },
  { id: "J9", from: "VAV-1", to: "DUCT-4", source: "port" },
  { id: "J10", from: "DUCT-4", to: "D-1", source: "port" },
  { id: "J11", from: "VAV-2", to: "DUCT-5", source: "port" },
  { id: "J12", from: "DUCT-5", to: "D-2", source: "geometry" },
  { id: "J13", from: "VAV-3", to: "DUCT-6", source: "port" },
  { id: "J14", from: "DUCT-6", to: "D-3", source: "port" },
].map((c) => ({ ...c, directed: c.source === "port" }));

const DEVICE = new Map(ELEMENTS.map((e) => [e.id, e.device]));
export const isConduit = (id) => DEVICE.get(id) === false;
export const DEVICES = ELEMENTS.filter((e) => e.device).map((e) => e.id);

/**
 * 한 요소에서 상류·하류를 따라간다(topology.ts 의 trace).
 * 방향 있는 연결은 그 방향으로만, 방향 없는 연결은 양쪽으로 탄다. 방향 있는 연결만으로 닿은 곳이 상류·하류이고,
 * 나머지는 "이어져 있지만 방향 모름" 이다. 방향을 모르는 채로 닿은 기기에서는 더 가지 않는다.
 */
export function trace(connections, start) {
  const forward = new Map();
  const backward = new Map();
  const push = (map, at, edge) => (map.get(at) ?? map.set(at, []).get(at)).push(edge);
  for (const c of connections) {
    push(forward, c.from, { to: c.to, directed: c.directed, id: c.id });
    push(backward, c.to, { to: c.from, directed: c.directed, id: c.id });
    if (!c.directed) {
      push(forward, c.to, { to: c.from, directed: false, id: c.id });
      push(backward, c.from, { to: c.to, directed: false, id: c.id });
    }
  }
  const walk = (adj) => {
    const strict = new Set();
    const any = new Set();
    const visited = new Map([[start, true]]);
    const queue = [[start, true]];
    while (queue.length) {
      const [at, pure] = queue.shift();
      for (const e of adj.get(at) ?? []) {
        const nextPure = pure && e.directed;
        const had = visited.get(e.to);
        if (had === true || (had === false && !nextPure)) continue;
        visited.set(e.to, nextPure);
        if (e.to !== start) (nextPure ? strict : any).add(e.to);
        if (!nextPure && e.to !== start && !isConduit(e.to)) continue;
        queue.push([e.to, nextPure]);
      }
    }
    for (const id of strict) any.delete(id);
    return { strict, any };
  };
  const down = walk(forward);
  const up = walk(backward);
  const upstream = new Set([...up.strict].filter((id) => !down.strict.has(id)));
  const downstream = new Set([...down.strict].filter((id) => !up.strict.has(id)));
  const linked = new Set();
  for (const id of [...down.any, ...up.any, ...up.strict, ...down.strict]) if (!upstream.has(id) && !downstream.has(id)) linked.add(id);
  return { upstream, downstream, linked };
}

/**
 * 기기에서 기기로 가는 흐름(topology.ts 의 deviceFlows). 방향을 아는 연결만 타고 덕트만 지나서 닿은 기기를 모은다.
 * TTL 은 이 쌍을 brick:feeds 로 적는다. 덕트는 fso: 어휘라 받는 쪽 파서가 엔티티로 읽지 않기 때문이다.
 */
export function deviceFlows(connections) {
  const out = new Map();
  for (const c of connections) if (c.directed) (out.get(c.from) ?? out.set(c.from, []).get(c.from)).push(c.to);
  const flows = new Map();
  for (const start of DEVICES) {
    const found = [];
    const seen = new Set([start]);
    const queue = [...(out.get(start) ?? [])];
    for (const id of queue) seen.add(id);
    for (let head = 0; head < queue.length; head++) {
      const at = queue[head];
      if (!isConduit(at)) {
        found.push(at);
        continue;
      }
      for (const n of out.get(at) ?? []) if (!seen.has(n)) (seen.add(n), queue.push(n));
    }
    if (found.length) flows.set(start, found);
  }
  return flows;
}

/**
 * 고른 기기 하나에 대해 그림이 보일 것 전부. 펄스의 도착 거리는 방향을 아는 연결만 따라 잰다.
 * stops 는 펄스가 방향 모름 연결에 닿아 멈추는 곳(연결 id), lines 는 칠한 범위 안의 brick:feeds 쌍이다.
 */
export function pickOf(start, lengthOf) {
  const t = trace(CONNECTIONS, start);
  const flows = deviceFlows(CONNECTIONS);
  const sweep = (forward) => {
    const dist = new Map([[start, 0]]);
    const stops = new Map();
    const queue = [start];
    while (queue.length) {
      queue.sort((a, b) => dist.get(a) - dist.get(b));
      const at = queue.shift();
      const leave = dist.get(at) + (at === start ? 0 : lengthOf(at));
      for (const c of CONNECTIONS) {
        const near = forward ? c.from : c.to;
        const far = forward ? c.to : c.from;
        const touches = c.directed ? near === at : c.from === at || c.to === at;
        if (!touches) continue;
        if (!c.directed) {
          if (!stops.has(c.id) || stops.get(c.id) > leave) stops.set(c.id, leave);
          continue;
        }
        if (dist.has(far) && dist.get(far) <= leave) continue;
        dist.set(far, leave);
        queue.push(far);
      }
    }
    dist.delete(start);
    return { dist, stops };
  };
  const down = sweep(true);
  const up = sweep(false);
  const painted = new Set([start, ...t.upstream, ...t.downstream]);
  const lines = [];
  for (const [from, list] of flows) for (const to of list) if (painted.has(from) && painted.has(to)) lines.push([from, to]);
  const devices = (set) => [...set].filter((id) => !isConduit(id));
  const beyond = (stopIds) => [...stopIds].map((id) => CONNECTIONS.find((c) => c.id === id));
  return {
    start,
    upstream: [...t.upstream],
    downstream: [...t.downstream],
    linked: [...t.linked],
    upDevices: devices(t.upstream),
    downDevices: devices(t.downstream),
    linkedDevices: devices(t.linked),
    down: Object.fromEntries([...down.dist].filter(([id]) => t.downstream.has(id))),
    up: Object.fromEntries([...up.dist].filter(([id]) => t.upstream.has(id))),
    stops: [...new Map([...down.stops, ...up.stops])].map(([id, at]) => ({ id, at, joint: beyond([id])[0] })),
    lines,
  };
}
