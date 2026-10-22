// 인트로 앞머리. 검은 화면에 "Ontology-Editor" 가 뜨고, 한강 위에서 성수 쪽을 보다가 강을 건너 주인공 건물까지 날아간다.
// 건물에 닿으면 스캔선이 아래에서 위로 훑으며 층선이 드러나고, 그 자리에서 kit 의 층 조립 장면(index.html)으로 넘긴다.
//
// 동네는 scripts/intro-city.mjs 가 OSM 에서 구운 public/intro/city/<장면>.json 이다(없으면 앞머리 없이 바로 kit).
// 연출 틀은 airsup.ai/lab 의 첫 장면(로고 → 강 건너 도시 → 탑으로 비행)을 따랐다. 코드는 가져오지 않았다(공개되지 않았다).
//
// 건물이 레고처럼 읽히던 까닭은 셋이었다. 창 격자를 벽 길이와 상관없이 붙여 모서리에서 창이 잘렸고, 지붕·땅이 새까매서 상자만 떠 보였고,
// 모든 건물이 같은 창 하나로 칠해졌다. 그래서 창은 벽 한 면마다 칸 수를 맞추고(모서리를 비운다), 건물마다 외벽 종류(돌·유리·아파트)를 나누고,
// 1층 상가·간판, 옥상 기계실, 탑의 왕관을 더하고, 땅은 길을 따라 번지는 가로등 빛으로 채운다.
//
// 부하: kit 과 같은 이유로 렌더 배율 1 이고 bloom 은 절반 해상도다. 앞머리는 13초 남짓만 그리고, 넘긴 뒤 렌더러를 버려 그래픽 메모리를 돌려준다.
// RTX 2080 Ti·1920×1080 에서 GPU 0.8ms/프레임이다. 노트북 내장 그래픽은 그 6~10배로 본다. 그래도 60fps 를 못 지키면(govern) 한 단계씩 내린다.
// 멈칫함은 GPU 보다 셰이더 링크에서 났다. 글자가 떠 있는 동안 compileAsync 로 링크하고 한 프레임 그려 둔다(play).

import * as THREE from 'three'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { Reflector } from 'three/addons/objects/Reflector.js'

// index.html 은 kit 의 프레임을 줄이려고 requestAnimationFrame 을 바꿔 끼운다. 앞머리는 그 전에 잡아 둔 원본으로 매 프레임 그린다.
const raf = window.requestAnimationFrame.bind(window)

const CSS = `
.pro { position: fixed; inset: 0; z-index: 1000; background: #000; overflow: hidden; transition: opacity 1.2s ease; font-family: Pretendard, 'Apple SD Gothic Neo', 'Noto Sans KR', 'Segoe UI', system-ui, sans-serif }
.pro.leave { opacity: 0; pointer-events: none }
.pro canvas { position: absolute; inset: 0; width: 100%; height: 100%; opacity: 0; transition: opacity 2.2s ease }
.pro.city canvas { opacity: 1 }
.pro-mark { position: absolute; left: 50%; top: 31%; transform: translate(-50%, -50%); text-align: center; color: #f4f2ee; pointer-events: none; transition: opacity 1.4s ease, transform 2.4s cubic-bezier(.3,.0,.2,1) }
.pro-mark.off { opacity: 0; transform: translate(-50%, -50%) scale(1.08) }
.pro-word { font-size: clamp(34px, 5.4vw, 92px); font-weight: 300; letter-spacing: 0.16em; color: #f7f5f0; opacity: 0; transform: scale(1.04); white-space: nowrap;
  transition: opacity 1.8s ease .35s, transform 2.8s cubic-bezier(.2,.7,.1,1) .2s }
.pro-line { height: 1px; width: min(30vw, 360px); margin: 1.1em auto 0; transform: scaleX(0); background: linear-gradient(90deg, transparent, rgba(244,242,238,.55), transparent); transition: transform 1.2s cubic-bezier(.4,0,.2,1) }
.pro-sub { margin-top: 1.1em; font-size: clamp(11px, 0.9vw, 14px); font-weight: 400; letter-spacing: 0.42em; color: rgba(244,242,238,.6); opacity: 0; transition: opacity 1.2s ease 1.1s }
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

// ---------------------------------------------------------------- 하늘·물·건물·길 셰이더
const SUN = new THREE.Vector3(-0.86, 0.035, -0.5).normalize() // 북쪽을 볼 때 왼쪽(서북서) 지평선 바로 위의 해
// 지평선 안개. 도시 불빛이 비쳐 조금 따뜻하다. 먼 건물이 이 색으로 묻혀 깊이가 생긴다.
// 밝게 두면 먼 건물이 불빛 대신 회색 판으로 읽혀서, 하늘보다 어둡게 두어 강 건너 동네가 실루엣과 불빛으로 남게 한다.
const HORIZON = new THREE.Color(0.11, 0.09, 0.09)
const NOISE = `
  float h3(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
  float vn(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    return mix(mix(h3(vec3(i, 0.0)), h3(vec3(i + vec2(1.0, 0.0), 0.0)), f.x), mix(h3(vec3(i + vec2(0.0, 1.0), 0.0)), h3(vec3(i + 1.0, 0.0)), f.x), f.y); }`

const skyMaterial = () =>
  new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: { sun: { value: SUN }, time: { value: 0 }, fogC: { value: HORIZON } },
    vertexShader: `varying vec3 vDir; void main() { vDir = position; vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`,
    fragmentShader: `
      uniform vec3 sun; uniform float time; uniform vec3 fogC; varying vec3 vDir;
      ${NOISE}
      float fbm(vec2 p) { float a = 0.0, w = 0.5; for (int i = 0; i < 4; i++) { a += w * vn(p); p *= 2.03; w *= 0.5; } return a; }
      void main() {
        vec3 d = normalize(vDir); float h = d.y;
        // 채도를 낮춘 해 진 직후. 따뜻한 빛은 해 쪽 지평선에만 몰고, 반대편은 회청색 안개다(보라·파랑 띠와 별이 레트로하게 읽혔다).
        vec3 zen = vec3(0.010, 0.016, 0.032), mid = vec3(0.055, 0.07, 0.10), haze = vec3(0.30, 0.27, 0.27), warm = vec3(1.0, 0.56, 0.30);
        float s = max(dot(d, sun), 0.0);
        vec3 hor = mix(haze, warm, pow(s, 2.5));
        vec3 c = mix(hor, mid, smoothstep(-0.02, 0.16, h));
        c = mix(c, zen, smoothstep(0.16, 0.65, h));
        // 도시 불빛이 지평선 둘레를 데운다(빛 공해). 낮게 깔린 주황 띠.
        c += vec3(0.42, 0.22, 0.12) * exp(-max(h, 0.0) * 16.0) * 0.35;
        // 아래에서 도시 불빛을 받는 옅은 구름. 천천히 흐른다.
        if (h > 0.0) {
          vec2 uv = d.xz / (h + 0.12) * 1.1 + vec2(time * 0.012, time * 0.004);
          float cl = smoothstep(0.52, 0.86, fbm(uv)) * smoothstep(0.0, 0.07, h) * (1.0 - smoothstep(0.3, 0.75, h));
          vec3 cc = mix(vec3(0.20, 0.14, 0.12), vec3(0.05, 0.055, 0.07), smoothstep(0.02, 0.3, h)) + warm * pow(s, 3.0) * 0.4;
          c = mix(c, cc, cl * 0.7);
        }
        c += vec3(1.0, 0.6, 0.32) * pow(s, 12.0) * 0.45 + vec3(1.0, 0.9, 0.75) * pow(s, 1200.0) * 5.0;
        // 지평선 바로 위는 안개 색으로 잇는다. 높이 날면 땅 끝(안개에 묻힌 판)이 보이는데, 하늘과 색이 다르면 그 자리에 금이 그어졌다.
        c = mix(fogC, c, smoothstep(-0.005, 0.035, h));
        if (h < 0.0) c = fogC;
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
      // 가로로 길게 겹친 물결이 세로 줄무늬 반사를 만든다(강 건너 야경과 다리 불빛이 물에 길게 늘어지는 모양).
      float w = sin(vWorld.z * 0.42 + time * 1.6 + sin(vWorld.x * 0.013) * 3.0) + 0.6 * sin(vWorld.z * 0.95 - time * 2.1 + vWorld.x * 0.02);
      vec2 uv = vUv.xy / vUv.w + vec2(w * 0.0022, sin(vWorld.z * 0.13 + time) * 0.0035);
      vec3 refl = texture2D(tDiffuse, uv).rgb;
      vec3 v = normalize(cameraPosition - vWorld);
      float fres = 0.3 + 0.7 * pow(1.0 - max(v.y, 0.0), 4.0);
      vec3 c = mix(color, refl * 1.15, fres * 0.85);
      gl_FragColor = vec4(c, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      #include <fog_fragment>
    }`,
}

/**
 * 밤 건물. Lambert 위에 외벽·창·상가·간판을 칠한다.
 * 건물마다 씨앗(aSeed)과 높이(aTop)로 외벽 종류를 고른다: 0 돌(창이 뚫린 벽) · 1 유리(사무동, 층이 통째로 켜진다) · 2 아파트(발코니 띠).
 * 창은 벽 한 면(aEdge = 그 면의 길이) 안에서 칸 수를 정수로 맞춘다. 칸을 벽 둘레에 이어 붙이면 모서리에서 창이 잘려 상자에 무늬를 바른 것처럼 읽혔다.
 * aTop 이 음수면 옥상 기계실이다(창 없음).
 */
function cityMaterial(opts = {}) {
  const m = new THREE.MeshLambertMaterial({ color: 0x23272d, ...opts })
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aWall; attribute float aEdge; attribute float aSeed; attribute float aTop; varying vec2 vWall; varying float vEdge; varying float vSeed; varying float vTop; varying float vSide; varying vec2 vXZ;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWall = aWall; vEdge = aEdge; vSeed = aSeed; vTop = aTop; vSide = 1.0 - abs(normal.y); vXZ = (modelMatrix * vec4(transformed, 1.0)).xz;')
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec2 vWall; varying float vEdge; varying float vSeed; varying float vTop; varying float vSide; varying vec2 vXZ;
        ${NOISE}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        // 씨앗은 정수다. 소수면 삼각형 안에서 보간되며 끝자리가 흔들리고, 해시가 그 차이를 키워 창 안이 점점이 얼룩진다.
        float seed = floor(vSeed + 0.5);
        bool equip = vTop < 0.0;
        float top = abs(vTop);
        float r1 = h3(vec3(seed, 1.7, 3.1)), r2 = h3(vec3(seed, 4.2, 0.3)), r3 = h3(vec3(seed, 8.1, 2.9));
        float style = top >= 45.0 ? (r2 < 0.6 ? 2.0 : 1.0) : (r2 < 0.72 ? 0.0 : 1.0);
        bool glassy = style > 0.5 && style < 1.5;
        bool wallF = vSide > 0.5 && !equip;
        vec3 base = glassy ? mix(vec3(0.035, 0.045, 0.06), vec3(0.06, 0.07, 0.08), r3) : mix(vec3(0.09, 0.088, 0.085), vec3(0.19, 0.18, 0.165), r3);
        if (!wallF) {
          // 지붕·기계실: 방수 칠이 군데군데 다른 콘크리트.
          float n = vn(vXZ * 0.35) * 0.6 + vn(vXZ * 1.7) * 0.4;
          base = mix(vec3(0.12, 0.12, 0.125), vec3(0.24, 0.235, 0.225), n) * (0.75 + 0.5 * r3);
        }
        // 땅에 닿는 곳이 어둡다(주변 가림). 상자가 땅 위에 떠 보이지 않게 한다.
        base *= mix(1.0, 0.45 + 0.55 * smoothstep(0.0, 7.0, vWall.y), vSide);
        diffuseColor.rgb = base;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        {
          vec3 warm = vec3(1.0, 0.72, 0.45), cool = vec3(0.80, 0.88, 1.0), fluo = vec3(0.92, 1.0, 0.95);
          vec3 nv = normalize(normal), vd = normalize(-vViewPosition);
          float fr = pow(1.0 - abs(dot(nv, vd)), 3.0);
          // 유리에 비친 하늘: 반사 방향의 높이로 지평선(도시 불빛)~천정 색을 고른다. viewMatrix 의 전치가 시점 → 세계 회전이다.
          vec3 rw = (vec4(reflect(-vd, nv), 0.0) * viewMatrix).xyz;
          vec3 skyR = mix(vec3(0.22, 0.15, 0.13), vec3(0.02, 0.03, 0.05), smoothstep(-0.05, 0.4, rw.y));
          // 창 칸 좌표. 화소 하나가 칸의 몇 분의 일인지(wx, wy)를 분기 밖에서 잰다(fwidth 는 이웃 화소와 같이 돌아야 맞다).
          float fh = style < 0.5 ? 3.2 + 0.5 * r1 : glassy ? 3.9 + 0.4 * r1 : 2.85;
          float cw = style < 0.5 ? 2.4 + 1.2 * r3 : glassy ? 1.5 : 3.0 + 1.0 * r3;
          float L = max(vEdge, 0.01);
          float cols = max(1.0, floor(L / cw));
          float ground = style > 1.5 ? 3.0 : 4.5;
          float gx = vWall.x / (L / cols), gy = (vWall.y - ground) / fh;
          float wx = max(fwidth(gx), 1e-4), wy = max(fwidth(gy), 1e-4);
          if (wallF) {
            vec2 cell = floor(vec2(gx, gy)), f = fract(vec2(gx, gy));
            float edgeU = min(vWall.x, L - vWall.x);
            float parapet = step(top - 1.2, vWall.y);
            float floors = floor((top - 1.2 - ground) / fh);
            float inFloor = step(0.0, gy) * step(cell.y, floors - 1.0);
            vec4 wr = style < 0.5 ? vec4(0.2, 0.8, 0.32, 0.84) : glassy ? vec4(0.03, 0.97, 0.1, 0.94) : vec4(0.07, 0.93, 0.22, 0.9);
            // 창 테두리를 화소 폭만큼 흐려 그린다. 계단처럼 깨지거나 비스듬한 벽에서 점무늬로 번쩍이지 않는다.
            float win = clamp((f.x - wr.x) / wx + 0.5, 0.0, 1.0) * clamp((wr.y - f.x) / wx + 0.5, 0.0, 1.0)
                      * clamp((f.y - wr.z) / wy + 0.5, 0.0, 1.0) * clamp((wr.w - f.y) / wy + 0.5, 0.0, 1.0) * inFloor;
            if (!glassy) win *= step(0.7, edgeU);
            float busy = 0.18 + 0.4 * r1;
            float on = step(1.0 - busy, h3(vec3(cell, seed)));
            // 사무동은 층이 통째로, 또는 몇 칸씩 묶여 켜진다.
            if (glassy) on = max(on * 0.4, step(0.45, h3(vec3(cell.y, seed, 7.0))) * step(0.2, h3(vec3(floor(cell.x / 6.0), cell.y, seed + 2.0))));
            vec3 tint = glassy ? mix(mix(cool, fluo, h3(vec3(cell.y, seed, 3.0))), warm, step(0.65, h3(vec3(cell.y, seed, 4.0)))) : mix(warm, cool, step(0.72, h3(vec3(cell.yx, seed + 9.0))));
            float curtain = style > 1.5 ? step(0.55, h3(vec3(cell, seed + 5.0))) : 0.0;
            // 천장 조명이라 창 위쪽이 밝다. 넓은 창은 가운데 창살이 있다.
            // 사무동 한 층이 한 판의 흰 면으로 보이지 않게, 칸마다 밝기를 흔들고 아래쪽(책상·칸막이)을 어둡게 한다.
            // 사무동은 칸이 좁아(1.5m) 칸마다 따로 흔들면 바코드처럼 읽혀, 네 칸씩 묶어 흔든다.
            float inten = glassy
              ? (0.3 + 0.45 * h3(vec3(floor(cell.x / 4.0), cell.y, seed + 3.0)) + 0.12 * h3(vec3(cell, seed))) * (0.35 + 0.75 * smoothstep(0.2, 0.95, f.y))
              : (0.35 + 0.75 * h3(vec3(cell, seed + 3.0))) * (0.65 + 0.5 * f.y) * (1.0 - 0.6 * curtain);
            float mull = glassy ? 1.0 - 0.7 * step(abs(f.x - 0.5), 0.02) * step(0.5, h3(vec3(seed, 6.0, 1.0))) : 1.0 - 0.8 * step(abs(f.x - 0.5), 0.015);
            vec3 lit = tint * inten * win * on * mull * (1.0 - parapet);
            vec3 refl = skyR * (0.25 + 0.75 * fr) * (glassy ? 1.0 : win) * (1.0 - on * win);
            float slab = style > 1.5 ? (1.0 - step(0.12, f.y)) * inFloor : 0.0;
            // 1층 상가: 쇼윈도 불빛과 그 위 가로 간판. 간판 색은 가게(6m)마다 다르다.
            float sgx = floor(vWall.x / 6.0);
            float shop = (style > 1.5 ? 0.4 : 1.0) * step(vWall.y, ground - 0.4) * step(0.6, vWall.y) * step(0.5, edgeU) * step(0.3, h3(vec3(sgx, seed, 11.0)));
            vec3 signC = mix(0.5 + 0.5 * cos(6.2831 * (h3(vec3(sgx, seed, 12.0)) + vec3(0.0, 0.33, 0.67))), warm, 0.3);
            // 간판은 낮은 상가 건물의 몇 가게에만. 모든 건물 밑동에 띠를 두르면 무지개 받침처럼 보였다.
            float signBand = step(ground - 1.3, vWall.y) * (style < 0.5 && top < 30.0 ? step(0.55, h3(vec3(sgx, seed, 15.0))) : 0.0);
            vec3 shopC = mix(warm * 0.8 * (0.6 + 0.4 * f.x), signC * 1.3, signBand) * shop;
            // 돌 건물 모서리의 세로 간판(낮은 상가 건물).
            float vsign = style < 0.5 && top < 30.0 ? step(0.75, edgeU) * step(edgeU, 1.45) * step(ground, vWall.y) * step(vWall.y, min(top - 2.0, ground + 10.0)) * step(0.72, h3(vec3(seed, 13.0, floor(L * 10.0)))) : 0.0;
            vec3 vsC = (0.5 + 0.5 * cos(6.2831 * (h3(vec3(seed, 14.0, L)) + vec3(0.0, 0.33, 0.67)))) * 1.3;
            // 탑의 왕관: 꼭대기 아래 LED 띠.
            float crown = step(100.0, top) * step(top - 3.0, vWall.y) * step(vWall.y, top - 2.7);
            // 가로등이 아래층 외벽을 비춘다.
            vec3 wash = warm * exp(-vWall.y / 5.0) * 0.05;
            // 창 한 칸이 화소 두셋보다 작아지면 켜고 끄는 무늬가 번쩍인다. 그때부터 층(줄)마다 켜진 정도만 남기고,
            // 줄도 화소보다 얇아지면 평균으로 바꾼다. 거리로 자르면 강 건너 건물이 창 없는 판이 되어 종이 상자처럼 읽혔다.
            float far = smoothstep(0.3, 0.75, max(wx, wy));
            float row = step(1.0 - busy * 1.4, h3(vec3(cell.y, seed, 21.0))) * (0.4 + 0.6 * h3(vec3(cell.y, seed, 22.0))) * step(0.0, gy) * step(cell.y, floors - 1.0);
            vec3 nearC = lit + refl + shopC + vsC * vsign + wash + vec3(0.05) * slab;
            // 줄의 대비는 낮게, 1.6km 너머는 평균으로. 층 줄이 화소 두어 개 높이가 되면 얼룩말 무늬로 읽혔다.
            row = mix(0.35 + 0.65 * row, busy, smoothstep(0.25, 0.6, wy));
            vec3 farC = (glassy ? mix(cool, warm, 0.4) : warm) * row * 0.22 * (1.0 - parapet) + skyR * 0.3 * fr + wash + shopC * 0.3;
            totalEmissiveRadiance += (mix(nearC, farC, far) + vec3(0.85, 0.92, 1.0) * crown * 0.6) * 0.6;
          } else totalEmissiveRadiance += vec3(0.012, 0.013, 0.017) + skyR * fr * 0.15;
        }`)
  }
  return m
}

/**
 * 길. 같은 형상으로 두 번 그린다.
 *   uSpill 0: 아스팔트. 가로등 아래가 밝고, 큰 길에는 차 불빛이 차선을 따라 흐른다(앞 흰빛·뒤 붉은빛). 다리는 난간 LED 가 빛난다.
 *   uSpill 1: 길 폭의 몇 배로 넓혀 가로등 빛이 땅에 번지는 자리를 덧칠한다. 건물 사이가 새까맣던 것을 이것이 채운다.
 * 정점은 길 가운데 선에 있고, aPerp(옆 방향 × 좌우) · aInfo.z(반폭)로 밀어 폭을 낸다.
 */
function roadMaterial(spill) {
  return new THREE.ShaderMaterial({
    fog: true,
    transparent: spill,
    depthWrite: !spill,
    blending: spill ? THREE.AdditiveBlending : THREE.NormalBlending,
    side: THREE.DoubleSide,
    uniforms: { time: { value: 0 }, uSpill: { value: spill ? 1 : 0 }, uSpread: { value: spill ? 3.2 : 1 }, ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog) },
    vertexShader: `
      attribute vec2 aPerp; attribute vec2 aRoad; attribute vec3 aInfo;
      uniform float uSpread; uniform float uSpill;
      varying vec2 vRoad; varying vec3 vInfo;
      #include <fog_pars_vertex>
      void main() {
        vec3 p = position;
        p.xz += aPerp * aInfo.z * uSpread;
        p.y += uSpill * 0.08;
        vRoad = vec2(aRoad.x, aRoad.y * uSpread); vInfo = aInfo;
        vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      uniform float time; uniform float uSpill; uniform float uSpread;
      varying vec2 vRoad; varying vec3 vInfo;
      #include <fog_pars_fragment>
      ${NOISE}
      void main() {
        float k = vInfo.x, s = vRoad.x, a = vRoad.y;
        bool bridge = vInfo.y > 0.5, major = k < 3.5;
        vec3 sodium = vec3(1.0, 0.58, 0.26);
        float pool = pow(0.5 + 0.5 * cos(6.2831 * s / 32.0), 2.0);
        if (uSpill > 0.5) {
          if (bridge) discard;
          float fall = pow(1.0 - smoothstep(0.0, uSpread, abs(a)), 2.2);
          vec3 c = sodium * fall * (0.55 + 0.45 * pool) * (major ? 0.16 : 0.09);
          // 덧셈으로 그리므로 안개에 묻힐수록 빛을 빼야 한다(안개 색을 더하면 먼 땅이 떠오른다).
          float ff = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
          gl_FragColor = vec4(c * (1.0 - ff), 1.0);
          return;
        }
        vec3 c = vec3(0.028, 0.028, 0.032) + sodium * (0.04 + 0.14 * pool) * (major ? 1.0 : 0.6);
        if (major) {
          // 차선: 한쪽(a > 0)은 앞 불빛, 반대쪽은 뒤 불빛. 칸(간격 34m)마다 차가 있을지 난수로 정한다.
          float lanes = k < 0.5 ? 3.0 : k < 2.5 ? 2.0 : 1.0;
          float side = sign(a), la = abs(a) * lanes, lane = floor(la);
          float inLane = 1.0 - smoothstep(0.12, 0.3, abs(fract(la) - 0.5));
          float v = 13.0 + 5.0 * h3(vec3(lane, side, k));
          float ph = (s * side - time * v) / 34.0 + h3(vec3(lane, side, 2.0));
          float id = floor(ph), x = fract(ph);
          float car = step(0.35, h3(vec3(id, lane, side))) * smoothstep(0.0, 0.03, x) * (1.0 - smoothstep(0.1, 0.17, x));
          vec3 lamp = side > 0.0 ? vec3(1.0, 0.92, 0.8) : vec3(1.0, 0.12, 0.06);
          c += lamp * car * inLane * 2.2 * step(abs(a), 0.92);
        }
        if (bridge) {
          // 한강 다리 난간 LED. 색이 다리를 따라 천천히 돈다.
          float edge = smoothstep(0.84, 0.95, abs(a));
          vec3 hue = mix(0.5 + 0.5 * cos(6.2831 * (s * 0.0012 - time * 0.03 + vec3(0.0, 0.33, 0.67))), vec3(1.0), 0.35);
          c += hue * edge * 1.6;
        }
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }`,
  })
}

// ---------------------------------------------------------------- 형상
const ringOf = (flat) => { const p = []; for (let i = 0; i < flat.length; i += 2) p.push([flat[i], flat[i + 1]]); return p }
const signedArea = (r) => r.reduce((s, [x, y], i) => { const [x2, y2] = r[(i + 1) % r.length]; return s + x * y2 - x2 * y }, 0) / 2
const rnd = (i) => { const x = Math.sin(i * 12.9898) * 43758.5453; return x - Math.floor(x) }
const inside = (r, x, y) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c } return c }

/**
 * 정점 속성 11개(위치 3 · 법선 3 · aWall 2 · aEdge · aSeed · aTop)를 한 Float32Array 에 차례로 쌓는다.
 * 성수는 정점이 85만 개다. JS 배열 여섯에 펼쳐 넣던 것보다 빠르고, 그대로 GPU 에 올린다(InterleavedBuffer).
 */
function vertexSink() {
  let a = new Float32Array(11 * 65536), n = 0
  return {
    put(x, y, z, nx, ny, nz, u, v, e, s, t) {
      if (n + 11 > a.length) { const b = new Float32Array(a.length * 2); b.set(a); a = b }
      a[n] = x; a[n + 1] = y; a[n + 2] = z; a[n + 3] = nx; a[n + 4] = ny; a[n + 5] = nz; a[n + 6] = u; a[n + 7] = v; a[n + 8] = e; a[n + 9] = s; a[n + 10] = t
      n += 11
    },
    geometry() {
      const ib = new THREE.InterleavedBuffer(a.slice(0, n), 11)
      const g = new THREE.BufferGeometry()
      g.setAttribute('position', new THREE.InterleavedBufferAttribute(ib, 3, 0))
      g.setAttribute('normal', new THREE.InterleavedBufferAttribute(ib, 3, 3))
      g.setAttribute('aWall', new THREE.InterleavedBufferAttribute(ib, 2, 6))
      g.setAttribute('aEdge', new THREE.InterleavedBufferAttribute(ib, 1, 8))
      g.setAttribute('aSeed', new THREE.InterleavedBufferAttribute(ib, 1, 9))
      g.setAttribute('aTop', new THREE.InterleavedBufferAttribute(ib, 1, 10))
      g.computeBoundingSphere()
      return g
    },
  }
}

/**
 * 바닥 고리 r 을 y0~y1 로 세운 기둥(벽 + 지붕)을 out 에 더한다. 평면 (x 동, y 북) → 화면 (x, -z).
 * lip 을 주면 벽을 지붕보다 그만큼 올려 난간을 세운다. 난간 안쪽 면은 창 없는 면(top 음수)이다. 지붕 둘레에 턱이 없으면 상자 뚜껑처럼 읽혔다.
 */
function prismInto(out, r, y0, y1, seed, top, lip = 0) {
  if (lip) {
    for (let i = 0; i < r.length; i++) {
      const [x1, z1] = r[i], [x2, z2] = r[(i + 1) % r.length]
      const L = Math.hypot(x2 - x1, z2 - z1)
      if (L < 0.01) continue
      const nx = -(z2 - z1) / L, nz = -(x2 - x1) / L
      const yl = y1 + lip, eq = -Math.abs(top)
      // A C B · A D C (A·B 는 지붕 높이, C·D 는 난간 끝)
      out.put(x1, y1, -z1, nx, 0, nz, 0, y1 + 8, L, seed, eq); out.put(x2, yl, -z2, nx, 0, nz, 0, y1 + 8, L, seed, eq); out.put(x2, y1, -z2, nx, 0, nz, 0, y1 + 8, L, seed, eq)
      out.put(x1, y1, -z1, nx, 0, nz, 0, y1 + 8, L, seed, eq); out.put(x1, yl, -z1, nx, 0, nz, 0, y1 + 8, L, seed, eq); out.put(x2, yl, -z2, nx, 0, nz, 0, y1 + 8, L, seed, eq)
    }
  }
  const yTop = y1 + lip
  for (let i = 0; i < r.length; i++) {
    const [x1, z1] = r[i], [x2, z2] = r[(i + 1) % r.length]
    const dx = x2 - x1, dy = z2 - z1, L = Math.hypot(dx, dy)
    if (L < 0.01) continue
    const nx = dy / L, nz = dx / L
    // A B C · A C D (A·B 바닥, C·D 꼭대기). aWall 은 그 면 안의 (가로 m, 높이 m) 다.
    out.put(x1, y0, -z1, nx, 0, nz, 0, y0, L, seed, top); out.put(x2, y0, -z2, nx, 0, nz, L, y0, L, seed, top); out.put(x2, yTop, -z2, nx, 0, nz, L, yTop, L, seed, top)
    out.put(x1, y0, -z1, nx, 0, nz, 0, y0, L, seed, top); out.put(x2, yTop, -z2, nx, 0, nz, L, yTop, L, seed, top); out.put(x1, yTop, -z1, nx, 0, nz, 0, yTop, L, seed, top)
  }
  for (const t of THREE.ShapeUtils.triangulateShape(r.map(([x, y]) => new THREE.Vector2(x, y)), [])) {
    const [a, b, c] = t.map((k) => r[k])
    const up = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) > 0
    for (const p of up ? [a, b, c] : [a, c, b]) out.put(p[0], y1, -p[1], 0, 1, 0, 0, y1, 0, seed, top)
  }
}

/** 고리를 가운데로 k 배 줄인다. */
const shrink = (r, k) => {
  const cx = r.reduce((a, p) => a + p[0], 0) / r.length, cy = r.reduce((a, p) => a + p[1], 0) / r.length
  return r.map(([x, y]) => [cx + (x - cx) * k, cy + (y - cy) * k])
}

/** 가장 긴 변 방향으로 돌린 w×d 사각형(가운데 x, y). 옥상 기계실을 건물 결에 맞춰 놓는다. */
function boxRing(r, x, y, w, d) {
  let best = 0, ang = 0
  for (let i = 0; i < r.length; i++) { const [x1, y1] = r[i], [x2, y2] = r[(i + 1) % r.length], L = Math.hypot(x2 - x1, y2 - y1); if (L > best) (best = L), (ang = Math.atan2(y2 - y1, x2 - x1)) }
  const c = Math.cos(ang), s = Math.sin(ang)
  return [[-w, -d], [w, -d], [w, d], [-w, d]].map(([u, v]) => [x + (u * c - v * s) / 2, y + (u * s + v * c) / 2])
}

/**
 * 건물들을 한 덩어리로. 높은 건물(50m 이상)은 꼭대기를 한 단 들여 세우고, 넓은 지붕에는 계단실·실외기 상자를 얹는다.
 * 높이 60m 이상의 꼭대기 자리를 tops 로 돌려준다(항공 장애등).
 */
function buildingsGeometry(list, tops = []) {
  const out = vertexSink()
  for (const [bi, b] of list) {
    const h = b[0]
    let r = ringOf(b.slice(1))
    if (signedArea(r) < 0) r = r.reverse()
    // OSM 에는 외곽선이 겹치거나 벽을 맞댄 건물이 많다. 같은 면이 두 장이면 창에 사선 줄무늬(z-fighting)가 인다.
    // 건물마다 0.15~0.5m 씩 다르게 안으로 줄여 면을 떼어 놓는다.
    const cx = r.reduce((a, p) => a + p[0], 0) / r.length, cy = r.reduce((a, p) => a + p[1], 0) / r.length
    const rad = r.reduce((a, p) => a + Math.hypot(p[0] - cx, p[1] - cy), 0) / r.length
    r = shrink(r, 1 - (0.15 + 0.35 * rnd(bi + 5)) / Math.max(rad, 2))
    const s = Math.floor(rnd(bi + 1) * 997)
    const area = Math.abs(signedArea(r))
    let roof = h, roofRing = r
    if (h >= 50 && area > 250) {
      const t = Math.min(9, Math.max(3, h * 0.06))
      prismInto(out, r, 0, h - t, s, h, 1)
      roofRing = shrink(r, 0.84)
      prismInto(out, roofRing, h - t, h, s, h, 1.2)
    } else prismInto(out, r, 0, h, s, h, h >= 6 ? 0.9 : 0)
    if (h >= 60) tops.push([roofRing[0][0], h + 1.2, -roofRing[0][1]], [roofRing[Math.floor(roofRing.length / 2)][0], h + 1.2, -roofRing[Math.floor(roofRing.length / 2)][1]])
    // 옥상: 계단실 하나, 넓으면 실외기 몇 개. 네 귀가 다 지붕 안일 때만 놓는다.
    if (h >= 6 && area > 150) {
      const ra = Math.abs(signedArea(roofRing))
      const fits = (q) => q.every(([x, y]) => inside(roofRing, x, y))
      const core = Math.min(9, Math.max(3, Math.sqrt(ra) * 0.2))
      const c = boxRing(roofRing, cx, cy, core, core * (0.7 + 0.5 * rnd(bi + 9)))
      if (fits(c)) prismInto(out, c, roof, roof + 3.2, s, -h)
      if (ra > 600) {
        const xs = roofRing.map((p) => p[0]), ys = roofRing.map((p) => p[1])
        for (let n = 0, put = 0; n < 8 && put < 3; n++) {
          const x = Math.min(...xs) + (Math.max(...xs) - Math.min(...xs)) * rnd(bi * 7 + n), y = Math.min(...ys) + (Math.max(...ys) - Math.min(...ys)) * rnd(bi * 13 + n)
          const q = boxRing(roofRing, x, y, 2.2, 1.6)
          if (Math.hypot(x - cx, y - cy) > core && fits(q)) prismInto(out, q, roof, roof + 1.5, s, -h), put++
        }
      }
    }
  }
  return out.geometry()
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

// 길 등급(scripts/intro-city.mjs): 0 고속 · 1 간선 · 2 주 · 3 보조 · 4~7 골목.
const ROAD_W = [22, 16, 12, 9, 7, 5.5, 5, 4]
function roadsGeometry(roads) {
  const pos = [], perp = [], road = [], info = []
  for (const r of roads) {
    const [k, bridge] = r
    const pts = ringOf(r.slice(2))
    // 큰 길이 골목 위에 오게 등급마다 조금씩 띄운다(겹친 면의 z-fighting).
    const w = ROAD_W[k] / 2, y = bridge ? 11 : 0.2 + (7 - k) * 0.02
    let s = 0
    for (let i = 0; i < pts.length - 1; i++) {
      const [x1, y1] = pts[i], [x2, y2] = pts[i + 1]
      const L = Math.hypot(x2 - x1, y2 - y1) || 1
      const px = (y2 - y1) / L, pz = (x2 - x1) / L
      const c1 = [x1, y, -y1], c2 = [x2, y, -y2]
      for (const [c, side, ss] of [[c1, -1, s], [c1, 1, s], [c2, 1, s + L], [c1, -1, s], [c2, 1, s + L], [c2, -1, s + L]]) {
        pos.push(...c); perp.push(px * side, pz * side); road.push(ss, side); info.push(k, bridge, w)
      }
      s += L
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('aPerp', new THREE.Float32BufferAttribute(perp, 2))
  g.setAttribute('aRoad', new THREE.Float32BufferAttribute(road, 2))
  g.setAttribute('aInfo', new THREE.Float32BufferAttribute(info, 3))
  // 정점이 가운데 선에 있어 형상이 실제보다 좁다. 화면 밖으로 잘못 걸러지지 않게 경계를 넉넉히 잡는다.
  g.computeBoundingSphere()
  g.boundingSphere.radius += 80
  return g
}

/** 길을 따라 every 마다 놓은 점. side 를 주면 길 양쪽 가장자리에 놓는다(다리 난간 등). */
function lightsAlong(roads, every, pick, { side = 0, lift = 7 } = {}) {
  const out = []
  for (const r of roads) {
    if (!pick(r)) continue
    const pts = ringOf(r.slice(2)), y = (r[1] ? 11 : 0.6) + lift, w = (ROAD_W[r[0]] / 2) * side
    let carry = 0
    for (let i = 0; i < pts.length - 1; i++) {
      const [x1, y1] = pts[i], [x2, y2] = pts[i + 1]
      const L = Math.hypot(x2 - x1, y2 - y1) || 1
      const px = ((y2 - y1) / L) * w, pz = ((x2 - x1) / L) * w
      let s = carry
      for (; s < L; s += every) {
        const x = x1 + ((x2 - x1) * s) / L, z = -(y1 + ((y2 - y1) * s) / L)
        if (side) out.push(x + px, y, z + pz, x - px, y, z - pz)
        else out.push(x, y, z)
      }
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
const points = (xyz, mat) => new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(xyz, 3)), mat)

/**
 * 지도 밖의 먼 동네: 불빛 점만 흩뿌린다. 받은 지도는 주인공에서 2~3km 에서 끝나서, 높이 날면 그 너머가 빈 판으로 보였다.
 * 동네 덩어리(가운데 하나에 점 수십 개)로 뭉쳐 놓고, 한강 줄기(주인공 남쪽 0.9~2km)는 비운다. 거리에 따라 흐려지고 조금씩 깜빡인다.
 */
function lightCarpet(extent, n = 36000) {
  const [x0, y0, x1, y1] = extent
  const pos = [], seed = []
  let k = 1
  const r = () => rnd(k++)
  while (pos.length < n * 3) {
    const cx = (r() - 0.5) * 22000, cy = (r() - 0.5) * 22000, spread = 120 + r() * 380, m = 20 + Math.floor(r() * 70)
    for (let i = 0; i < m; i++) {
      const a = r() * Math.PI * 2, d = spread * Math.sqrt(-2 * Math.log(1 - r() * 0.999))
      const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d
      if (x > x0 - 150 && x < x1 + 150 && y > y0 - 150 && y < y1 + 150) continue
      if (y > -2000 && y < -900) continue
      pos.push(x, 2 + r() * 40, -y); seed.push(r())
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  g.setAttribute('aSeed', new THREE.Float32BufferAttribute(seed, 1))
  const m = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { time: { value: 0 } },
    vertexShader: `
      attribute float aSeed; uniform float time; varying vec3 vC; varying float vA;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0); float d = -mv.z;
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(2600.0 / d, 1.0, 3.0);
        vA = exp(-d * 0.00016) * (0.75 + 0.25 * sin(time * (1.0 + aSeed * 3.0) + aSeed * 40.0));
        vC = mix(vec3(1.0, 0.68, 0.4), vec3(0.85, 0.9, 1.0), step(0.72, aSeed));
      }`,
    fragmentShader: `varying vec3 vC; varying float vA;
      void main() { float a = smoothstep(0.5, 0.0, length(gl_PointCoord - 0.5)); gl_FragColor = vec4(vC * vA * a * 1.3, 1.0); }`,
  })
  return new THREE.Points(g, m)
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
export function mountPrologue(city, { word = 'Ontology-Editor', sub = 'BIM → DT 공간 온톨로지', pin = city.heroName, pinSub = '', caption = '', low = false } = {}) {
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
    // 장면은 composer 의 렌더 타깃(MSAA 없음)에 그린다. 캔버스의 MSAA 는 마지막 한 장만 받아 계단을 못 지우고 대역폭만 쓴다.
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' })
    renderer.setPixelRatio(1)
    renderer.toneMapping = THREE.ACESFilmicToneMapping
    renderer.toneMappingExposure = 1.0
    renderer.localClippingEnabled = true
    const scene = new THREE.Scene()
    scene.fog = new THREE.FogExp2(HORIZON, 0.00034)
    const camera = new THREE.PerspectiveCamera(34, 1, 2, 20000)

    const sky = new THREE.Mesh(new THREE.SphereGeometry(15000, 32, 16), skyMaterial())
    scene.add(sky)
    scene.add(new THREE.HemisphereLight(0x5a6c9a, 0x2a1a10, 0.5))
    // 해는 졌다. 서쪽 벽만 옅게 물든다(세게 두면 먼 동네의 서쪽 벽이 회색 판처럼 떠올랐다).
    const sunLight = new THREE.DirectionalLight(0xff9c62, 0.35)
    sunLight.position.copy(SUN).multiplyScalar(1000)
    scene.add(sunLight)

    // 땅·공원·길
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(40000, 40000), new THREE.MeshLambertMaterial({ color: 0x0d0e11 }))
    ground.rotation.x = -Math.PI / 2
    scene.add(ground)
    scene.add(new THREE.Mesh(flatGeometry(city.parks, false, 0.15), new THREE.MeshLambertMaterial({ color: 0x0c1810 })))
    const roadGeo = roadsGeometry(city.roads)
    const roadMat = roadMaterial(false), spillMat = roadMaterial(true)
    scene.add(new THREE.Mesh(roadGeo, roadMat))
    const spill = new THREE.Mesh(roadGeo, spillMat)
    spill.renderOrder = 1
    scene.add(spill)

    // 물: 강을 비추는 Reflector. 반사 텍스처는 절반 해상도다.
    const water = new Reflector(flatGeometry(city.waters, true), { shader: WATER, color: 0x04070b, textureWidth: 512, textureHeight: 512, clipBias: 0.003 })
    water.rotation.x = -Math.PI / 2
    water.position.y = 0.35
    water.material.fog = true
    water.material.side = THREE.DoubleSide
    scene.add(water)

    // 건물: 주인공만 따로 둔다.
    const heroB = city.buildings[city.hero]
    const others = []
    city.buildings.forEach((b, i) => i !== city.hero && others.push([i, b]))
    const tops = []
    scene.add(new THREE.Mesh(buildingsGeometry(others, tops), cityMaterial()))

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

    // 가로등(큰 길은 희게, 골목은 주황), 다리 난간 등, 높은 건물 꼭대기의 붉은 항공 장애등
    scene.add(points(lightsAlong(city.roads, 30, (r) => r[0] <= 3 && !r[1]), pointsMaterial(0xffd6a0, 8)))
    scene.add(points(lightsAlong(city.roads, 38, (r) => r[0] >= 4, { lift: 5 }), pointsMaterial(0xff9a48, 5)))
    scene.add(points(lightsAlong(city.roads, 14, (r) => r[1], { side: 0.95, lift: 1.5 }), pointsMaterial(0xfff0d8, 7)))
    const beaconMat = pointsMaterial(0xff2a1a, 6)
    scene.add(points(tops.flat(), beaconMat))
    const carpet = lightCarpet(city.extent)
    scene.add(carpet)

    // 후처리: bloom 이 창 불빛·차·간판·스캔선을 번지게 한다.
    const composer = new EffectComposer(renderer)
    composer.setPixelRatio(1)
    composer.addPass(new RenderPass(scene, camera))
    const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.85, 0.55, 0.72)
    composer.addPass(bloom)
    // 필름 질감: 가장자리 색 번짐·비네팅·옅은 입자, 그리고 어두운 곳은 청록·밝은 곳은 주황으로 나누는 색보정.
    const grade = new ShaderPass({
      uniforms: { tDiffuse: { value: null }, time: { value: 0 }, grain: { value: 0.018 } },
      vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `uniform sampler2D tDiffuse; uniform float time; uniform float grain; varying vec2 vUv;
        float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233)) + time) * 43758.5453); }
        void main() {
          vec2 q = vUv - 0.5;
          vec2 off = q * dot(q, q) * 0.004;
          vec3 c = vec3(texture2D(tDiffuse, vUv - off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv + off).b);
          float lum = dot(c, vec3(0.299, 0.587, 0.114));
          c *= mix(vec3(0.92, 1.0, 1.08), vec3(1.08, 1.0, 0.9), smoothstep(0.04, 0.5, lum));
          c *= mix(1.0, 0.55, smoothstep(0.25, 0.85, length(q * vec2(1.25, 1.0))));
          c += (h(vUv * 1024.0) - 0.5) * grain;
          gl_FragColor = vec4(c, 1.0);
        }`,
    })
    composer.addPass(grade)
    composer.addPass(new OutputPass())

    // 느린 GPU: 1단계 렌더 배율 0.75 · 2단계 배율 0.6 에 물 반사를 두 프레임에 한 번 · 3단계 bloom 끔.
    let tier = 0, scale = 1, tick = 0
    const reflect = water.onBeforeRender
    water.onBeforeRender = (...a) => { if (tier < 2 || tick % 2 === 0) reflect.apply(water, a) }
    function lower() {
      tier++
      if (tier === 1) scale = 0.75
      if (tier === 2) scale = 0.6
      // 입자는 낮은 해상도에서 늘어나 얼룩으로 보인다. 배율만큼 옅게 한다.
      grade.uniforms.grain.value = 0.018 * scale * scale
      if (tier === 3) bloom.enabled = false
      renderer.setPixelRatio(scale)
      composer.setPixelRatio(scale)
      resize()
    }
    // 프레임 간격의 중앙값이 24ms(약 40fps)를 넘으면 내린다. 처음 몇 프레임은 버린다(첫 그림·탭 전환).
    const gaps = []
    function govern(gap) {
      if (tier >= 3 || gap > 250 || tick < 10) return
      gaps.push(gap)
      if (gaps.length < 30) return
      const mid = gaps.sort((a, b) => a - b)[15]
      gaps.length = 0
      if (mid > 24) lower()
    }

    function resize() {
      const w = innerWidth, h = innerHeight
      renderer.setSize(w, h, false)
      composer.setSize(w, h)
      bloom.resolution.set((w * scale) / 2, (h * scale) / 2)
      camera.aspect = w / h
      camera.updateProjectionMatrix()
    }
    resize()
    addEventListener('resize', resize)
    if (low) while (tier < 3) lower()

    // ---------------------------------------------------------------- 길: 한강 한가운데 → 북쪽 강변 → 성수 위 → kit 의 첫 시점
    // 좌표는 주인공 건물 가운데가 원점, z 가 클수록 남쪽이다. 성수 쪽 한강은 건물에서 남쪽 1.05~1.84km 다(city.json).
    const V = (x, y, z) => new THREE.Vector3(x, y, z)
    // 강 남쪽에서 조금 높이 떠서 본다. 왼쪽(서울숲 쪽) 고층이 하늘선에 들어오게 서쪽으로 비튼다.
    const P0 = V(-300, 44, 1600), P0b = V(-280, 46, 1500)
    const L0 = V(-420, 95, -300)
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
    let t0 = 0, done, stopped = false, last = 0, started = false, roll = 0
    const finished = new Promise((ok) => (done = ok))
    let handedOff = false
    const handoff = () => { if (!handedOff) { handedOff = true; done() } }
    $('.pro-skip').addEventListener('click', handoff)
    const onKey = (e) => { if (e.key === ' ' || e.key === 'Enter') handoff() }
    addEventListener('keydown', onKey)
    const yawOf = (u) => { const p = path.getPoint(u), l = look.getPoint(u); return Math.atan2(l.x - p.x, l.z - p.z) }

    function frame(now) {
      if (stopped) return
      if (last) govern(now - last)
      tick++
      const dt = Math.min(0.05, (now - (last || now)) / 1000); last = now
      const t = started ? (now - t0) / 1000 : 0
      const sec = now / 1000
      water.material.uniforms.time.value = sec
      sky.material.uniforms.time.value = sec % 1000
      roadMat.uniforms.time.value = spillMat.uniforms.time.value = carpet.material.uniforms.time.value = sec % 1000
      grade.uniforms.time.value = sec % 100
      // 항공 장애등은 1.5초에 한 번 깜빡인다.
      beaconMat.opacity = Math.pow(Math.max(0, Math.sin(sec * 4.2)), 6)

      // 카메라: 머무는 동안 천천히 다가가고, 그다음 길을 따라 난다. 도는 쪽으로 살짝 기울인다(끝에서는 kit 시점과 맞게 0).
      const fly = clamp01((t - T_HOLD) / T_FLY)
      const u = ease(fly)
      if (fly <= 0) {
        const k = clamp01(t / T_HOLD)
        camera.position.lerpVectors(P0, P0b, k * (2 - k))
        camera.lookAt(L0)
      } else {
        camera.position.copy(path.getPoint(u))
        camera.lookAt(look.getPoint(u))
        let dy = yawOf(Math.min(1, u + 0.02)) - yawOf(u)
        dy = Math.atan2(Math.sin(dy), Math.cos(dy))
        roll += (THREE.MathUtils.clamp(dy * 1.4, -0.07, 0.07) * clamp01((1 - u) * 4) - roll) * Math.min(1, dt * 3)
        camera.rotateZ(roll)
      }
      const endFov = camera.userData.endFov ?? 30
      camera.fov = 34 + (endFov - 34) * u
      camera.updateProjectionMatrix()
      if (t > T_HOLD + 0.4) markEl.classList.add('off')

      // 주인공: 날아가는 동안 테두리가 밝아지고 바닥에 원이 퍼진다.
      edgeMat.opacity = 0.25 + 0.75 * u
      const pr = (sec % 2.4) / 2.4
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
        // 첫 시점에서 한 번 그려 둔다(캔버스는 아직 투명하다). 물 반사·bloom 의 셰이더와 렌더 타깃이 여기서 만들어진다.
        camera.position.copy(P0)
        camera.lookAt(L0)
        camera.updateMatrixWorld()
        await renderer.compileAsync(scene, camera)
        composer.render(0)
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
