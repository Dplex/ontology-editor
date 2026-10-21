// 인트로 앞머리. 검은 화면에 "Ontology-Editor" 가 뜨고, 한강 위에서 성수 쪽을 보다가 강을 건너 주인공 건물까지 날아간다.
// 건물에 닿으면 스캔선이 아래에서 위로 훑으며 층선이 드러나고, 그 자리에서 kit 의 층 조립 장면(index.html)으로 넘긴다.
//
// 동네는 scripts/intro-city.mjs 가 OSM 에서 구운 public/intro/city/<장면>.json 이다(없으면 앞머리 없이 바로 kit).
// 연출 틀은 airsup.ai/lab 의 첫 장면(로고 → 강 건너 도시 → 탑으로 비행)을 따랐다. 코드는 가져오지 않았다(공개되지 않았다).
//
// 부하: kit 과 같은 이유로 렌더 배율 1 이고 bloom 은 절반 해상도다. 앞머리는 13초 남짓만 그리고, 넘긴 뒤 렌더러를 버려 그래픽 메모리를 돌려준다.

import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { Reflector } from 'three/addons/objects/Reflector.js'

// index.html 은 kit 의 프레임을 줄이려고 requestAnimationFrame 을 바꿔 끼운다. 앞머리는 그 전에 잡아 둔 원본으로 매 프레임 그린다.
const raf = window.requestAnimationFrame.bind(window)

const CSS = `
.pro { position: fixed; inset: 0; z-index: 1000; background: #000; overflow: hidden; transition: opacity 1.2s ease; font-family: Pretendard, 'Apple SD Gothic Neo', 'Noto Sans KR', 'Segoe UI', system-ui, sans-serif }
.pro.leave { opacity: 0; pointer-events: none }
.pro canvas { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; transition: opacity 2.2s ease }
.pro.city canvas { opacity: 1 }
.pro-mark { position: absolute; left: 50%; top: 44%; transform: translate(-50%, -50%); text-align: center; color: #f4f2ee; pointer-events: none; transition: opacity 1.4s ease, transform 2.4s cubic-bezier(.3,.0,.2,1) }
.pro-mark.off { opacity: 0; transform: translate(-50%, -50%) scale(1.08) }
.pro-word { font-size: clamp(40px, 7.2vw, 128px); font-weight: 800; letter-spacing: 0.035em; opacity: 0; transform: scale(1.06); white-space: nowrap;
  background: linear-gradient(180deg, #ffffff 0%, #dcd9d2 60%, #a9a59c 100%); -webkit-background-clip: text; background-clip: text; color: transparent;
  filter: drop-shadow(0 0 18px rgba(255, 236, 210, 0.25)); transition: opacity 1.6s ease .35s, transform 2.4s cubic-bezier(.2,.7,.1,1) .2s }
.pro-line { height: 1px; width: min(46vw, 560px); margin: 0.9em auto 0; transform: scaleX(0); background: linear-gradient(90deg, transparent, rgba(244,242,238,.85), transparent); transition: transform 1.2s cubic-bezier(.4,0,.2,1) }
.pro-sub { margin-top: 0.9em; font-size: clamp(12px, 1.05vw, 17px); letter-spacing: 0.32em; color: rgba(244,242,238,.72); opacity: 0; transition: opacity 1.2s ease 1.1s }
.pro.on .pro-word { opacity: 1; transform: none }
.pro.on .pro-line { transform: none }
.pro.on .pro-sub { opacity: 1 }
.pro-pin { position: absolute; left: 0; top: 0; transform: translate(-50%, -100%); color: #eafcff; font-size: 16px; font-weight: 600; letter-spacing: 0.04em; text-align: center; white-space: nowrap; opacity: 0; transition: opacity .8s ease; pointer-events: none; text-shadow: 0 1px 8px rgba(0,0,0,.6) }
.pro-pin small { display: block; font-size: 11px; color: rgba(234,252,255,.65); letter-spacing: 0.08em }
.pro-pin::after { content: ''; display: block; width: 1px; height: 38px; margin: 6px auto 0; background: linear-gradient(rgba(140,235,255,.9), rgba(140,235,255,0)) }
.pro-pin.show { opacity: 1 }
.pro-cap { position: absolute; left: 50%; bottom: 11%; transform: translateX(-50%); color: rgba(244,242,238,.9); font-size: clamp(14px, 1.3vw, 20px); letter-spacing: 0.02em; opacity: 0; transition: opacity .9s ease; white-space: nowrap; text-shadow: 0 1px 10px rgba(0,0,0,.7) }
.pro-cap.show { opacity: 1 }
.pro-skip { position: absolute; right: 28px; bottom: 26px; padding: 0.5rem 1rem; border: 1px solid rgba(244,242,238,.3); border-radius: 999px; background: rgba(0,0,0,.35); color: #f4f2ee; font: 500 13px/1 inherit; letter-spacing: .04em; cursor: pointer }
.pro-skip:hover { background: #f4f2ee; color: #000 }
.pro-credit { position: absolute; left: 24px; bottom: 22px; color: rgba(244,242,238,.45); font-size: 11px; letter-spacing: .02em; opacity: 0; transition: opacity 2s ease }
.pro.city .pro-credit { opacity: 1 }
`

// ---------------------------------------------------------------- 하늘·물·건물 셰이더
const SUN = new THREE.Vector3(-0.86, 0.035, -0.5).normalize() // 북쪽을 볼 때 왼쪽(서북서) 지평선 바로 위의 해
const HORIZON = new THREE.Color(0.24, 0.16, 0.19)

const skyMaterial = () =>
  new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: { sun: { value: SUN } },
    vertexShader: `varying vec3 vDir; void main() { vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`,
    fragmentShader: `
      uniform vec3 sun; varying vec3 vDir;
      float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
      void main() {
        vec3 d = normalize(vDir); float h = d.y;
        vec3 zen = vec3(0.008, 0.016, 0.06), mid = vec3(0.04, 0.06, 0.19), hor = vec3(0.95, 0.46, 0.22);
        float s = max(dot(d, sun), 0.0);
        hor = mix(hor * 0.55, hor, pow(s, 3.0));
        vec3 c = mix(hor, mid, smoothstep(-0.02, 0.16, h));
        c = mix(c, zen, smoothstep(0.16, 0.65, h));
        c += vec3(1.0, 0.55, 0.25) * pow(s, 10.0) * 0.55 + vec3(1.0, 0.9, 0.7) * pow(s, 900.0) * 6.0;
        float st = step(0.9985, hash(floor(d * 520.0))) * smoothstep(0.12, 0.45, h);
        c += vec3(st) * 0.8;
        if (h < 0.0) c = mix(hor * 0.35, vec3(0.02), smoothstep(0.0, -0.2, h));
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  })

const WATER = {
  name: 'Water',
  uniforms: { color: { value: null }, tDiffuse: { value: null }, textureMatrix: { value: null }, time: { value: 0 }, ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog) },
  vertexShader: `
    uniform mat4 textureMatrix; varying vec4 vUv; varying vec3 vWorld;
    #include <fog_pars_vertex>
    void main() {
      vUv = textureMatrix * vec4(position, 1.0);
      vWorld = (modelMatrix * vec4(position, 1.0)).xyz;
      vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
      gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
    }`,
  fragmentShader: `
    uniform vec3 color; uniform sampler2D tDiffuse; uniform float time; varying vec4 vUv; varying vec3 vWorld;
    #include <fog_pars_fragment>
    void main() {
      // 가로로 길게 겹친 물결이 세로 줄무늬 반사를 만든다(강 건너 야경이 물에 길게 늘어지는 모양).
      float w = sin(vWorld.z * 0.42 + time * 1.6 + sin(vWorld.x * 0.013) * 3.0) + 0.6 * sin(vWorld.z * 0.95 - time * 2.1 + vWorld.x * 0.02);
      vec2 uv = vUv.xy / vUv.w + vec2(w * 0.0045, sin(vWorld.z * 0.13 + time) * 0.0025);
      vec3 refl = texture2D(tDiffuse, uv).rgb;
      vec3 v = normalize(cameraPosition - vWorld);
      float fres = 0.25 + 0.75 * pow(1.0 - max(v.y, 0.0), 4.0);
      vec3 c = mix(color, refl, fres * 0.9);
      gl_FragColor = vec4(c, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      #include <fog_fragment>
    }`,
}

/** 밤 건물: Lambert 에 창 불빛을 얹는다. 창은 벽 둘레 길이(u)·높이(v)로 칸을 나눠, 칸마다 건물 번호를 섞은 난수로 켠다. */
function cityMaterial(opts = {}) {
  const m = new THREE.MeshLambertMaterial({ color: 0x2b3038, ...opts })
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aWall; attribute float aSeed; attribute float aTop; varying vec2 vWall; varying float vSeed; varying float vTop; varying float vSide;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWall = aWall; vSeed = aSeed; vTop = aTop; vSide = 1.0 - abs(normal.y);')
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec2 vWall; varying float vSeed; varying float vTop; varying float vSide;
        float h3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          float seed = floor(vSeed + 0.5);
          vec2 g = vWall / vec2(3.1, 3.4);
          vec2 cell = floor(g), f = fract(g);
          float win = step(0.16, f.x) * step(f.x, 0.84) * step(0.28, f.y) * step(f.y, 0.86);
          float busy = 0.16 + 0.34 * h3(vec3(seed, 1.7, 3.1));
          float on = step(1.0 - busy, h3(vec3(cell, seed)));
          vec3 warm = vec3(1.0, 0.68, 0.36), cool = vec3(0.70, 0.84, 1.0);
          vec3 wc = mix(warm, cool, step(0.78, h3(vec3(cell.yx, seed + 9.0)))) * (0.35 + 0.9 * h3(vec3(cell, seed + 3.0)));
          float roofBand = step(vTop - 2.2, vWall.y);
          float street = step(vWall.y, 3.4) * 0.6;
          float lit = win * on * (1.0 - roofBand) * vSide;
          // 멀어서 창 한 칸이 화소보다 작아지면 줄무늬가 번쩍인다. 500m 너머는 켜진 비율만큼의 평균 밝기로 바꾼다.
          float far = smoothstep(500.0, 1100.0, length(vViewPosition));
          vec3 glow = mix(wc * lit, warm * busy * 0.09 * vSide * (1.0 - roofBand), far);
          totalEmissiveRadiance += glow * 0.55 + warm * street * win * vSide * (1.0 - far) * 0.35;
        }`)
  }
  return m
}

// ---------------------------------------------------------------- 형상
const ringOf = (flat) => { const p = []; for (let i = 0; i < flat.length; i += 2) p.push([flat[i], flat[i + 1]]); return p }
const signedArea = (r) => r.reduce((s, [x, y], i) => { const [x2, y2] = r[(i + 1) % r.length]; return s + x * y2 - x2 * y }, 0) / 2
const rnd = (i) => { const x = Math.sin(i * 12.9898) * 43758.5453; return x - Math.floor(x) }

/** 건물들을 한 덩어리로: 벽(둘레 u·높이 v 를 aWall 에)과 지붕. 평면 (x 동, y 북) → 화면 (x, -z). */
function buildingsGeometry(list) {
  const pos = [], nor = [], wall = [], seed = [], top = []
  for (const [bi, b] of list) {
    const h = b[0]
    let r = ringOf(b.slice(1))
    if (signedArea(r) < 0) r = r.reverse()
    // OSM 에는 외곽선이 겹치거나 벽을 맞댄 건물이 많다. 같은 면이 두 장이면 창에 사선 줄무늬(z-fighting)가 인다.
    // 건물마다 0.15~0.5m 씩 다르게 안으로 줄여 면을 떼어 놓는다.
    const cx = r.reduce((a, p) => a + p[0], 0) / r.length, cy = r.reduce((a, p) => a + p[1], 0) / r.length
    const rad = r.reduce((a, p) => a + Math.hypot(p[0] - cx, p[1] - cy), 0) / r.length
    const k = 1 - (0.15 + 0.35 * rnd(bi + 5)) / Math.max(rad, 2)
    r = r.map(([x, y]) => [cx + (x - cx) * k, cy + (y - cy) * k])
    // 씨앗은 정수다. 소수면 삼각형 안에서 보간되며 끝자리가 흔들리고, 해시가 그 차이를 키워 창 안이 점점이 얼룩진다.
    const s = Math.floor(rnd(bi + 1) * 997)
    let u = 0
    for (let i = 0; i < r.length; i++) {
      const [x1, y1] = r[i], [x2, y2] = r[(i + 1) % r.length]
      const dx = x2 - x1, dy = y2 - y1, L = Math.hypot(dx, dy)
      if (L < 0.01) continue
      const nx = dy / L, nz = dx / L
      const A = [x1, 0, -y1], B = [x2, 0, -y2], C = [x2, h, -y2], D = [x1, h, -y1]
      for (const [p, uu, vv] of [[A, u, 0], [B, u + L, 0], [C, u + L, h], [A, u, 0], [C, u + L, h], [D, u, h]]) {
        pos.push(...p); nor.push(nx, 0, nz); wall.push(uu, vv); seed.push(s); top.push(h)
      }
      u += L
    }
    const tri = THREE.ShapeUtils.triangulateShape(r.map(([x, y]) => new THREE.Vector2(x, y)), [])
    for (const t of tri) {
      const [a, b2, c] = t.map((k) => r[k])
      const up = (b2[0] - a[0]) * (c[1] - a[1]) - (b2[1] - a[1]) * (c[0] - a[0]) > 0
      for (const p of up ? [a, b2, c] : [a, c, b2]) { pos.push(p[0], h, -p[1]); nor.push(0, 1, 0); wall.push(0, h); seed.push(s); top.push(h) }
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3))
  g.setAttribute('aWall', new THREE.Float32BufferAttribute(wall, 2))
  g.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 1))
  g.setAttribute('aTop', new THREE.Float32BufferAttribute(top, 1))
  g.computeBoundingSphere()
  return g
}

/** 평면 다각형들을 높이 y 의 한 판으로. Reflector 는 자기 평면이 xy 라서 local 좌표를 (x, y) 로 두고 밖에서 눕힌다. */
function flatGeometry(rings, local = false, y = 0) {
  const pos = []
  for (const flat of rings) {
    let r = ringOf(flat)
    if (r.length < 3) continue
    if (signedArea(r) < 0) r = r.reverse()
    for (const t of THREE.ShapeUtils.triangulateShape(r.map(([x, yy]) => new THREE.Vector2(x, yy)), [])) {
      for (const k of t) local ? pos.push(r[k][0], r[k][1], 0) : pos.push(r[k][0], y, -r[k][1])
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  if (!local) {
    // 위에서 보는 판이라 감김을 위로 맞춘다.
    const p = g.attributes.position.array
    for (let i = 0; i < p.length; i += 9) {
      const ax = p[i], az = p[i + 2], bx = p[i + 3], bz = p[i + 5], cx = p[i + 6], cz = p[i + 8]
      if ((bx - ax) * (cz - az) - (bz - az) * (cx - ax) > 0) for (let k = 0; k < 3; k++) [p[i + 3 + k], p[i + 6 + k]] = [p[i + 6 + k], p[i + 3 + k]]
    }
  }
  g.computeVertexNormals()
  return g
}

const ROAD_W = [22, 16, 12, 9]
function roadsGeometry(roads) {
  const pos = []
  for (const r of roads) {
    const [k, bridge] = r
    const pts = ringOf(r.slice(2))
    const w = ROAD_W[k] / 2, y = bridge ? 11 : 0.25
    for (let i = 0; i < pts.length - 1; i++) {
      const [x1, y1] = pts[i], [x2, y2] = pts[i + 1]
      const L = Math.hypot(x2 - x1, y2 - y1) || 1
      const ox = (-(y2 - y1) / L) * w, oy = ((x2 - x1) / L) * w
      const a = [x1 + ox, y, -(y1 + oy)], b = [x1 - ox, y, -(y1 - oy)], c = [x2 - ox, y, -(y2 - oy)], d = [x2 + ox, y, -(y2 + oy)]
      pos.push(...a, ...b, ...c, ...a, ...c, ...d)
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  return g
}

/** 길을 따라 고르게 놓은 점(가로등)과, 큰 길 위를 오가는 차 불빛. */
function lightsAlong(roads, every, pick) {
  const out = []
  for (const r of roads) {
    if (!pick(r)) continue
    const pts = ringOf(r.slice(2)), y = r[1] ? 12 : 0.6
    let carry = 0
    for (let i = 0; i < pts.length - 1; i++) {
      const [x1, y1] = pts[i], [x2, y2] = pts[i + 1]
      const L = Math.hypot(x2 - x1, y2 - y1)
      let s = carry
      for (; s < L; s += every) out.push([x1 + ((x2 - x1) * s) / L, y, -(y1 + ((y2 - y1) * s) / L), (x2 - x1) / L, -(y2 - y1) / L, r[0]])
      carry = s - L
    }
  }
  return out
}

function pointsMaterial(color, size) {
  return new THREE.PointsMaterial({ color, size, sizeAttenuation: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, map: dot() })
}
let _dot
function dot() {
  if (_dot) return _dot
  const c = document.createElement('canvas'); c.width = c.height = 32
  const x = c.getContext('2d'), g = x.createRadialGradient(16, 16, 0, 16, 16, 16)
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,.55)'); g.addColorStop(1, 'rgba(255,255,255,0)')
  x.fillStyle = g; x.fillRect(0, 0, 32, 32)
  return (_dot = new THREE.CanvasTexture(c))
}

// ---------------------------------------------------------------- 시간
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2)
const clamp01 = (t) => Math.min(1, Math.max(0, t))
const T_HOLD = 3.2 // 강 위에서 글자와 야경을 보는 시간
const T_FLY = 7.6 // 강을 건너 건물까지
const T_SCAN = 2.2 // 스캔선이 건물을 훑는 시간

/**
 * 앞머리를 띄운다. 형상을 만드는 동안 글자가 먼저 뜬다.
 * @returns {{ play(end): Promise<void>, leave(): Promise<void> }}
 *   play 는 건물을 다 훑었거나 [건너뛰기] 를 누르면 풀린다. 그때 kit 을 시작하고 leave 로 앞머리를 걷는다.
 */
export function mountPrologue(city, { word = 'Ontology-Editor', sub = 'BIM → DT 공간 온톨로지', pin = city.heroName, pinSub = '', caption = '' } = {}) {
  const style = document.createElement('style'); style.textContent = CSS; document.head.appendChild(style)
  const root = document.createElement('div'); root.className = 'pro'
  root.innerHTML = `<canvas></canvas>
    <div class="pro-mark"><div class="pro-word"></div><div class="pro-line"></div><div class="pro-sub"></div></div>
    <div class="pro-pin"></div><div class="pro-cap"></div>
    <button type="button" class="pro-skip">건너뛰기</button>
    <div class="pro-credit"></div>`
  document.body.appendChild(root)
  const $ = (s) => root.querySelector(s)
  $('.pro-word').textContent = word
  $('.pro-sub').textContent = sub
  $('.pro-pin').innerHTML = `${pin}${pinSub ? `<small>${pinSub}</small>` : ''}`
  $('.pro-cap').textContent = caption
  $('.pro-credit').textContent = `지도 ${city.attribution} · 높이가 없는 건물은 쓰임새·넓이로 추정`
  const mountedAt = performance.now()
  raf(() => raf(() => root.classList.add('on')))

  // 형상은 글자 연출이 시작된 뒤에 만든다. 만드는 동안 메인 스레드가 1초 가까이 막혀도 글자 전환(opacity·transform)은 합성 단계라 끊기지 않는다.
  const api = new Promise((ok) => setTimeout(() => ok(build()), 150))
  return {
    play: async (o) => (await api).play(o),
    leave: async () => (await api).leave(),
    skip: () => api.then((x) => x.skip()),
  }

  function build() {
    const canvas = $('canvas')
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
    renderer.setPixelRatio(1)
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 0.9
    renderer.localClippingEnabled = true
    const scene = new THREE.Scene()
    scene.fog = new THREE.FogExp2(HORIZON, 0.00026)
    const camera = new THREE.PerspectiveCamera(34, 1, 2, 20000)

    scene.add(new THREE.Mesh(new THREE.SphereGeometry(15000, 32, 16), skyMaterial()))
    scene.add(new THREE.HemisphereLight(0x5a6c9a, 0x0b0b0e, 0.6))
    const sunLight = new THREE.DirectionalLight(0xff9c62, 1.1)
    sunLight.position.copy(SUN).multiplyScalar(1000)
    scene.add(sunLight)

    // 땅·공원·길
      const ground = new THREE.Mesh(new THREE.PlaneGeometry(40000, 40000), new THREE.MeshLambertMaterial({ color: 0x0c0d10 }))
    ground.rotation.x = -Math.PI / 2
    scene.add(ground)
    scene.add(new THREE.Mesh(flatGeometry(city.parks, false, 0.15), new THREE.MeshLambertMaterial({ color: 0x0e1a13 })))
    scene.add(new THREE.Mesh(roadsGeometry(city.roads), new THREE.MeshLambertMaterial({ color: 0x17181c, side: THREE.DoubleSide })))

    // 물: 강을 비추는 Reflector. 반사 텍스처는 절반 해상도다.
    const water = new Reflector(flatGeometry(city.waters, true), { shader: WATER, color: 0x0a1426, textureWidth: 512, textureHeight: 512, clipBias: 0.003 })
    water.rotation.x = -Math.PI / 2
    water.position.y = 0.35
    water.material.fog = true
    water.material.side = THREE.DoubleSide
    scene.add(water)

    // 건물: 주인공만 따로 둔다.
    const heroB = city.buildings[city.hero]
    const others = []
    city.buildings.forEach((b, i) => i !== city.hero && others.push([i, b]))
    scene.add(new THREE.Mesh(buildingsGeometry(others), cityMaterial()))

    const heroH = heroB[0]
    const heroRing = ringOf(heroB.slice(1))
    const scanPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0) // y ≥ scan 만 남긴다
    const underPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 0) // y ≤ scan 만 남긴다
    const heroSolid = new THREE.Mesh(buildingsGeometry([[city.hero, heroB]]), cityMaterial({ clippingPlanes: [scanPlane] }))
    scene.add(heroSolid)
    const cyan = new THREE.Color(0.45, 0.92, 1.0)
    const glass = new THREE.Mesh(heroSolid.geometry, new THREE.MeshBasicMaterial({ color: cyan, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, clippingPlanes: [underPlane] }))
    scene.add(glass)
    const edgeMat = new THREE.LineBasicMaterial({ color: cyan, transparent: true, opacity: 0.0 })
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(heroSolid.geometry, 30), edgeMat)
    scene.add(edges)
    const floorMat = new THREE.LineBasicMaterial({ color: cyan, transparent: true, opacity: 0.95, clippingPlanes: [underPlane] })
    const floorGroup = new THREE.Group()
    scene.add(floorGroup)
    const scanMesh = new THREE.Mesh(
      (() => { const s = new THREE.Shape(heroRing.map(([x, y]) => new THREE.Vector2(x * 1.18, -y * 1.18))); const g = new THREE.ShapeGeometry(s); g.rotateX(-Math.PI / 2); return g })(),
      new THREE.MeshBasicMaterial({ color: cyan, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
    )
    scanMesh.geometry.scale(1, 1, -1)
    scene.add(scanMesh)
    const pulse = new THREE.Mesh(new THREE.RingGeometry(1, 1.012, 128), new THREE.MeshBasicMaterial({ color: cyan, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }))
    pulse.rotation.x = -Math.PI / 2
    pulse.position.y = 0.6
    scene.add(pulse)

    // 가로등과 차
    const lamps = lightsAlong(city.roads, 34, (r) => r[0] >= 1 || r[1])
    const lampGeo = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(lamps.flatMap(([x, y, z]) => [x, y + 7, z]), 3))
    scene.add(new THREE.Points(lampGeo, pointsMaterial(0xffb066, 9)))
    const cars = lightsAlong(city.roads, 26, (r) => r[0] <= 1).map((c, i) => ({ c, s: rnd(i) * 26, dir: i % 2 ? 1 : -1, v: 14 + rnd(i + 7) * 10 }))
    const carPos = new Float32Array(cars.length * 3)
    const carCol = new Float32Array(cars.length * 3)
    cars.forEach(({ dir }, i) => carCol.set(dir > 0 ? [1, 0.93, 0.8] : [1, 0.18, 0.1], i * 3))
    const carGeo = new THREE.BufferGeometry()
    carGeo.setAttribute('position', new THREE.BufferAttribute(carPos, 3))
    carGeo.setAttribute('color', new THREE.BufferAttribute(carCol, 3))
    const carMat = pointsMaterial(0xffffff, 6)
    carMat.vertexColors = true
    scene.add(new THREE.Points(carGeo, carMat))

    // 후처리: bloom 만. 창 불빛·차·스캔선이 번진다.
    const composer = new EffectComposer(renderer)
    composer.setPixelRatio(1)
    composer.addPass(new RenderPass(scene, camera))
    const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.7, 0.45, 0.8)
    composer.addPass(bloom)
    composer.addPass(new OutputPass())

    function resize() {
      const w = innerWidth, h = innerHeight
      renderer.setSize(w, h, false)
      composer.setSize(w, h)
      bloom.resolution.set(w / 2, h / 2)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }
    resize()
    addEventListener('resize', resize)

    // ---------------------------------------------------------------- 길: 한강 한가운데 → 북쪽 강변 → 성수 위 → kit 의 첫 시점
    // 좌표는 주인공 건물 가운데가 원점, z 가 클수록 남쪽이다. 성수 쪽 한강은 건물에서 남쪽 1.05~1.84km 다(city.json).
    const V = (x, y, z) => new THREE.Vector3(x, y, z)
    const P0 = V(-170, 20, 1480), P0b = V(-160, 22, 1380)
    const L0 = V(-120, 70, -400)
    let path, look
    function setEnd(end) {
      const ET = end?.target ? V(...end.target) : V(0, heroH * 0.5, 0)
      // kit 의 첫 시점(앙각 14°)은 주변이 빈 스튜디오 기준이다. 팩토리얼 둘레에는 60~72m 건물이 붙어 있어 그 높이로 다가가면 가린다.
      // 방위는 kit 을 따르고, 앙각을 34° 로 올려 이웃 지붕 너머로 내려다본다.
      const off = (end?.pos ? V(...end.pos) : V(98, 63, 126)).sub(ET)
      const az = Math.atan2(off.x, off.z), d = Math.max(off.length() * 0.85, heroH * 2.8), el = THREE.MathUtils.degToRad(34)
      const E = V(ET.x + d * Math.cos(el) * Math.sin(az), ET.y + d * Math.sin(el), ET.z + d * Math.cos(el) * Math.cos(az))
      path = new THREE.CatmullRomCurve3([P0b, V(-110, 95, 950), V(-40, 150, 470), V(E.x * 1.3 - 30, E.y * 1.25, E.z * 1.7), E], false, 'centripetal')
      look = new THREE.CatmullRomCurve3([L0, V(-60, 60, -260), V(-10, heroH * 0.7, -40), ET, ET], false, 'centripetal')
      if (end?.fov) camera.userData.endFov = end.fov
    }
    setEnd(null)

    // 층선: 장면이 주는 층 높이(IFC)로 그린다. 없으면 3.4m 마다.
    function setFloors(levels) {
      floorGroup.clear()
      const ys = levels?.length ? levels.filter((y) => y > -0.5 && y < heroH + 1) : Array.from({ length: Math.floor(heroH / 3.4) }, (_, i) => i * 3.4)
      for (const y of [...ys, heroH]) {
        const g = new THREE.BufferGeometry().setFromPoints(heroRing.map(([x, yy]) => V(x, y + 0.05, -yy)))
        floorGroup.add(new THREE.LineLoop(g, floorMat))
      }
    }
    setFloors(null)

    const pinEl = $('.pro-pin'), capEl = $('.pro-cap'), markEl = $('.pro-mark')
    const v = new THREE.Vector3()
    let t0 = 0, done, stopped = false, last = 0, started = false
    const finished = new Promise((ok) => (done = ok))
    let handedOff = false
    const handoff = () => { if (!handedOff) { handedOff = true; done() } }
    $('.pro-skip').addEventListener('click', handoff)
    const onKey = (e) => { if (e.key === ' ' || e.key === 'Enter') handoff() }
    addEventListener('keydown', onKey)

    function frame(now) {
      if (stopped) return
      const dt = Math.min(0.05, (now - (last || now)) / 1000); last = now
      const t = started ? (now - t0) / 1000 : 0
      water.material.uniforms.time.value = now / 1000

      // 카메라: 머무는 동안 천천히 다가가고, 그다음 길을 따라 난다.
      const fly = clamp01((t - T_HOLD) / T_FLY)
      const u = ease(fly)
      if (fly <= 0) {
        const k = clamp01(t / T_HOLD)
        camera.position.lerpVectors(P0, P0b, k * (2 - k))
        camera.lookAt(L0)
      } else {
        camera.position.copy(path.getPoint(u))
        camera.lookAt(look.getPoint(u))
      }
      const endFov = camera.userData.endFov ?? 30
      camera.fov = 34 + (endFov - 34) * u
      camera.updateProjectionMatrix()
      if (t > T_HOLD + 0.4) markEl.classList.add('off')

      // 주인공: 날아가는 동안 테두리가 밝아지고 바닥에 원이 퍼진다.
      edgeMat.opacity = 0.25 + 0.75 * u
      heroSolid.material.emissive.setRGB(0.012, 0.05, 0.065).multiplyScalar(u)
      const pr = ((now / 1000) % 2.4) / 2.4
      pulse.scale.setScalar(30 + pr * 90)
      pulse.material.opacity = (1 - pr) * 0.45 * clamp01(fly * 3) * (1 - clamp01((fly - 0.85) * 8))

      // 스캔: 건물에 닿으면 아래에서 위로 훑는다. 훑고 지난 아래쪽은 유리와 층선, 위쪽은 아직 밤 건물이다.
      const sc = clamp01((t - T_HOLD - T_FLY + 0.3) / T_SCAN)
      const scanY = sc <= 0 ? -1 : -1 + ease(sc) * (heroH + 2)
      scanPlane.constant = -scanY
      underPlane.constant = scanY
      scanMesh.position.y = scanY
      scanMesh.material.opacity = sc > 0 && sc < 1 ? 0.55 : 0
      glass.visible = floorGroup.visible = sc > 0
      if (sc >= 1) handoff()

      // 차
      for (let i = 0; i < cars.length; i++) {
        const car = cars[i], [x, y, z, dx, dz] = car.c
        car.s = (car.s + car.v * dt) % 26
        const s = car.s * car.dir
        carPos[i * 3] = x + dx * s + (car.dir > 0 ? dz : -dz) * 3
        carPos[i * 3 + 1] = y
        carPos[i * 3 + 2] = z + dz * s - (car.dir > 0 ? dx : -dx) * 3
      }
      carGeo.attributes.position.needsUpdate = true

      // 핀: 건물 위 12m. 화면 밖이거나 아직 멀면 숨긴다.
      v.set(0, heroH + 14, 0).project(camera)
      const showPin = fly > 0.35 && sc <= 0 && v.z < 1
      pinEl.classList.toggle('show', showPin)
      if (showPin) pinEl.style.transform = `translate(${((v.x + 1) / 2) * innerWidth}px, ${((1 - v.y) / 2) * innerHeight}px) translate(-50%, -100%)`
      capEl.classList.toggle('show', !!capEl.textContent && sc > 0)

      composer.render(dt)
      raf(frame)
    }

    return {
      /** 형상이 다 섰으면 카메라를 움직인다. 글자는 적어도 1.8초 보이게 한다. end 는 kit 의 첫 시점({ pos, target, fov }), levels 는 층 높이(m). */
      async play({ end, levels } = {}) {
        setEnd(end)
        setFloors(levels)
        renderer.compile(scene, camera)
        const wait = 1800 - (performance.now() - mountedAt)
        if (wait > 0) await new Promise((ok) => setTimeout(ok, wait))
        root.classList.add('city')
        t0 = performance.now()
        started = true
        raf(frame)
        return finished
      },
      /** 앞머리를 걷고 렌더러를 버린다. */
      async leave() {
        removeEventListener('keydown', onKey)
        root.classList.add('leave')
        await new Promise((ok) => setTimeout(ok, 1250))
        stopped = true
        removeEventListener('resize', resize)
        composer.dispose()
        water.getRenderTarget().dispose()
        scene.traverse((o) => { o.geometry?.dispose(); if (o.material) [].concat(o.material).forEach((m) => m.dispose()) })
        renderer.dispose()
        renderer.forceContextLoss()
        root.remove()
        style.remove()
      },
      skip: handoff,
    }
  }
}
