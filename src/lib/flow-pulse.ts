// 고른 계통의 흐름을 3D 에서 달리는 빛으로 보인다. ieum-pipeline 의 공간 화면(web/src/lib/spaceScene.js 의 PIPE_FRAG)과 같은 수법이다 —
// 연결마다 가는 관을 깔고, 꼭짓점에 "흐름을 따라 잰 거리" 를 적어 셰이더가 그 거리를 따라 혜성 꼴 빛 덩이를 민다.
//
// 거리는 연결마다 0 에서 시작하지 않고 계통의 원천(들어오는 흐름이 없는 것)부터 누적한다. 마디마다 새로 세면 이음쇠 하나 지날 때마다
// 빛이 끊겨 "흐른다" 가 아니라 "깜빡인다" 로 보였다. 관은 실제 배관 형상이 아니라 설비 중심끼리 잇는 선이다(연결 화살표와 같은 자리).
// 굵기는 화면에서 몇 픽셀 이상으로 버틴다 — 성수처럼 건물 전체를 볼 때 실제 배관 굵기(수 cm)로 그리면 한 픽셀도 안 된다.

import { BufferAttribute, BufferGeometry, Color, Mesh, ShaderMaterial, Vector3 } from 'three'

/** 방향이 있는 연결 하나. `strong` 은 누군가(BIM 포트·사람)가 말한 방향, 아니면 규칙이 짐작한 방향이다. */
export type FlowEdge = { from: string; to: string; strong: boolean }
/** 3D 자리까지 붙은 연결. a 가 흐름이 나가는 쪽이다. */
export type FlowSegment = FlowEdge & { a: Vector3; b: Vector3 }

/** 빛 덩이가 초속 몇 m 로 달리고, 몇 m 마다 하나씩 있나. 층 하나(수십 m)를 몇 초에 건너는 빠르기다. */
export const FLOW_SPEED = 4
export const FLOW_PERIOD = 9

/**
 * 연결 끝마다 흐름을 따라 잰 거리(m). 원천(들어오는 연결이 없는 것)은 0 이고, 나머지는 원천에서 가장 가까운 길의 길이다.
 * 원천이 없는 고리(순환 배관)는 남은 것 중 하나를 0 으로 두고 다시 잰다. 그래야 모든 연결이 거리를 갖는다.
 */
export function flowDistances(edges: readonly { from: string; to: string; len: number }[]): Map<string, number> {
  const out = new Map<string, { to: string; len: number }[]>()
  const incoming = new Set<string>()
  const nodes: string[] = []
  const seen = new Set<string>()
  for (const e of edges) {
    for (const id of [e.from, e.to]) if (!seen.has(id)) (seen.add(id), nodes.push(id))
    ;(out.get(e.from) ?? out.set(e.from, []).get(e.from)!).push({ to: e.to, len: e.len })
    incoming.add(e.to)
  }
  const dist = new Map<string, number>()
  // 거리 순으로 꺼내는 이진 힙(다익스트라). 성수 계통 하나가 연결 수천 개라 매번 전부 훑으면 고를 때마다 끊긴다.
  const heap: [number, string][] = []
  const push = (d: number, id: string) => {
    heap.push([d, id])
    for (let i = heap.length - 1; i > 0; ) {
      const p = (i - 1) >> 1
      if (heap[p][0] <= heap[i][0]) break
      ;[heap[p], heap[i]] = [heap[i], heap[p]]
      i = p
    }
  }
  const pop = () => {
    const top = heap[0]
    const last = heap.pop()!
    if (heap.length) {
      heap[0] = last
      for (let i = 0; ; ) {
        const l = 2 * i + 1
        const r = l + 1
        let m = i
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r
        if (m === i) break
        ;[heap[m], heap[i]] = [heap[i], heap[m]]
        i = m
      }
    }
    return top
  }
  const run = () => {
    while (heap.length) {
      const [d, id] = pop()
      if (d > (dist.get(id) ?? Infinity)) continue
      for (const e of out.get(id) ?? []) {
        const next = d + e.len
        if (next < (dist.get(e.to) ?? Infinity)) {
          dist.set(e.to, next)
          push(next, e.to)
        }
      }
    }
  }
  for (const id of nodes) if (!incoming.has(id)) (dist.set(id, 0), push(0, id))
  run()
  for (const id of nodes) {
    if (dist.has(id)) continue
    dist.set(id, 0)
    push(0, id)
    run()
  }
  return dist
}

const VERT = /* glsl */ `
attribute float aDist;
attribute float aStrong;
uniform float uMinR;
uniform float uPx;
varying float vDist;
varying float vStrong;
varying float vShade;
void main() {
  vDist = aDist;
  vStrong = aStrong;
  // position 은 관의 축, normal 은 축에서 바깥으로 향한 방향이다. 굵기는 카메라에서 먼 만큼 키워 화면에서 몇 픽셀을 지킨다.
  vec4 axis = modelViewMatrix * vec4(position, 1.0);
  float r = max(uMinR, -axis.z * uPx);
  vec3 n = normalize(normalMatrix * normal);
  vShade = 0.55 + 0.45 * abs(n.z);
  gl_Position = projectionMatrix * (axis + vec4(n * r, 0.0));
}`

// 혜성 꼴: 긴 꼬리로 올라가 머리에서 가장 밝고 끝에서 뚝 끊는다(pipeline 의 PIPE_FRAG 와 같은 꼴). 바탕선은 두지 않는다 — pipeline 은 이 관이
// 곧 배관이라 계통색 바탕이 필요했지만, 여기서는 그 아래에 계통색으로 칠한 실제 덕트·배관이 있다. 같은 색을 얹었더니 빨강 덕트 위의 빨강
// 덩이가 보이지 않았다. 그래서 빛 덩이는 계통색을 조금 남긴 흰빛이다. 규칙이 짐작한 방향(vStrong < 1)은 화살표처럼 옅게 둔다.
const FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uTime;
uniform float uSpeed;
uniform float uPeriod;
uniform float uDark;
varying float vDist;
varying float vStrong;
varying float vShade;
void main() {
  float p = fract((vDist - uTime * uSpeed) / uPeriod);
  float cut = 1.0 - smoothstep(0.985, 1.0, p);
  float tail = smoothstep(0.4, 0.92, p) * cut;
  float head = smoothstep(0.88, 0.975, p) * cut;
  float a = max(tail * 0.6, head) * vStrong;
  if (a < 0.01) discard;
  vec3 col = mix(uColor, vec3(1.0), mix(0.5, 0.92, head)) * mix(0.9, 1.0, vShade);
  // 다크는 바탕이 어두워 흰빛이 그대로 빛난다. 라이트는 흰 바탕에 걸친 곳에서 덩이가 사라지지 않게 가장자리를 계통색으로 눌러 둔다.
  if (uDark < 0.5) col = mix(uColor * 0.55, col, smoothstep(0.35, 0.8, vShade));
  gl_FragColor = vec4(col, a);
}`

const RADIAL = 6

/** 연결들을 관 한 덩어리로. 연결이 없으면 null. 시간은 `setFlowTime` 으로 민다. */
export function flowPulseMesh(segments: readonly FlowSegment[], color: number, dark: boolean): Mesh | null {
  const usable = segments.filter((s) => s.a.distanceToSquared(s.b) > 1e-8)
  if (!usable.length) return null
  const dist = flowDistances(usable.map((s) => ({ from: s.from, to: s.to, len: s.a.distanceTo(s.b) })))
  const n = usable.length
  const position = new Float32Array(n * RADIAL * 2 * 3)
  const normal = new Float32Array(n * RADIAL * 2 * 3)
  const along = new Float32Array(n * RADIAL * 2)
  const strong = new Float32Array(n * RADIAL * 2)
  const index = new Uint32Array(n * RADIAL * 6)
  const dir = new Vector3()
  const u = new Vector3()
  const v = new Vector3()
  const ring = new Vector3()
  const up = new Vector3(0, 1, 0)
  const side = new Vector3(1, 0, 0)
  usable.forEach((s, k) => {
    const len = s.a.distanceTo(s.b)
    const d0 = dist.get(s.from) ?? 0
    dir.subVectors(s.b, s.a).normalize()
    u.crossVectors(dir, Math.abs(dir.y) < 0.9 ? up : side).normalize()
    v.crossVectors(dir, u)
    for (let i = 0; i < RADIAL; i++) {
      const t = (i / RADIAL) * Math.PI * 2
      ring.copy(u).multiplyScalar(Math.cos(t)).addScaledVector(v, Math.sin(t))
      for (let end = 0; end < 2; end++) {
        const at = (k * RADIAL * 2 + end * RADIAL + i)
        const p = end ? s.b : s.a
        position.set([p.x, p.y, p.z], at * 3)
        normal.set([ring.x, ring.y, ring.z], at * 3)
        along[at] = d0 + (end ? len : 0)
        strong[at] = s.strong ? 1 : 0.5
      }
      const a0 = k * RADIAL * 2 + i
      const a1 = k * RADIAL * 2 + ((i + 1) % RADIAL)
      const b0 = a0 + RADIAL
      const b1 = a1 + RADIAL
      index.set([a0, b0, a1, a1, b0, b1], (k * RADIAL + i) * 6)
    }
  })
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(position, 3))
  geometry.setAttribute('normal', new BufferAttribute(normal, 3))
  geometry.setAttribute('aDist', new BufferAttribute(along, 1))
  geometry.setAttribute('aStrong', new BufferAttribute(strong, 1))
  geometry.setIndex(new BufferAttribute(index, 1))
  const material = new ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uColor: { value: new Color(color) },
      uTime: { value: 0 },
      uSpeed: { value: FLOW_SPEED },
      uPeriod: { value: FLOW_PERIOD },
      uDark: { value: dark ? 1 : 0 },
      // 가까이서는 4cm, 멀어지면 화면 높이의 약 0.2%(1000px 화면에서 2px 남짓)를 지킨다.
      uMinR: { value: 0.04 },
      uPx: { value: 0.0022 },
    },
    transparent: true,
    depthTest: false,
    depthWrite: false,
  })
  const mesh = new Mesh(geometry, material)
  // 설비 강조·연결 화살표(10~12) 위, 리플레이 알갱이(23) 아래.
  mesh.renderOrder = 13
  // 굵기를 셰이더에서 키우므로 축으로 잰 경계 구가 실제보다 작다. 화면 끝에서 잘리지 않게 거르지 않는다.
  mesh.frustumCulled = false
  mesh.userData.flowSegments = n
  return mesh
}

export function setFlowTime(mesh: Mesh, seconds: number): void {
  ;(mesh.material as ShaderMaterial).uniforms.uTime.value = seconds
}
