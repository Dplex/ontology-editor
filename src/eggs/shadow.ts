// A. 바닥에 앉는 그림자(shadow) — 건물을 바닥에서 위로 정사영으로 한 번 찍어 흐린 판을 발밑에 깐다(docs/plans/easter-eggs.md).
//
// - drei ContactShadows 의 수법이다. 바닥에 놓은 정사영 카메라가 위를 보고, 바닥에 가까운 면일수록 짙게(깊이로) 512px 에 찍은 뒤
//   가로·세로 흐림을 두 번 건다. 그리는 비용은 사각형 하나라, 건물이 허공에 떠 있지 않고 땅에 앉아 보인다.
// - 찍는 것은 켤 때 한 번, 편집·다시 그리기 뒤에는 0.5초를 모았다가 한 번이다. 시점을 돌릴 때는 찍지 않는다(카메라와 상관없다).
// - 찍을 대상은 장면의 메시다. 물리존 바닥판처럼 반쯤 비치는 판도 찍는다 — 벽·배관만 찍으면 얇아서 흐림에 묽어지고 발밑이 빈다.
//   아주 옅은 것(흐리게 한 설비 8%, 놓기 전 미리보기)과 선·점, 직접 쓴 셰이더(바닥 격자·하늘·흐르는 빛)는 뺀다.
// - 판은 덮인 정도를 smoothstep 으로 올려 칠한다. 발밑은 꽉 차고 건물 밖으로 흐림 폭만큼만 부드럽게 번진다.
// - 건물은 데이터로 바꾸지 않는다. 모델에서 읽는 것은 없고 장면을 한 번 찍을 뿐이다.
import {
  Box3,
  Color,
  DoubleSide,
  Mesh,
  type Object3D,
  OrthographicCamera,
  PlaneGeometry,
  type Scene,
  ShaderMaterial,
  Sprite,
  type Texture,
  Vector3,
  WebGLRenderTarget,
  type WebGLRenderer,
} from 'three'
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js'
import { HorizontalBlurShader } from 'three/addons/shaders/HorizontalBlurShader.js'
import { VerticalBlurShader } from 'three/addons/shaders/VerticalBlurShader.js'
import { watch } from 'vue'
import type { EggContext, EggHandle } from './types'

/** 찍는 해상도(한 변). */
export const SHADOW_PX = 512
/** 편집 뒤 다시 찍기까지 모으는 시간. */
export const SETTLE_MS = 500
/** 바닥에서 이 높이(m)까지의 면이 그림자를 만든다. 위로 갈수록 옅다. 1층 높이쯤이다. */
const REACH_M = 4
/**
 * 흐림이 한 번에 번지는 폭(m). 픽셀로 정하면 판 크기를 따라가서, Duplex(13m)에서는 벽 밖으로 0.25m 만 번져 벽에 가려 안 보였다.
 * 흐림 셰이더는 한 방향으로 4칸을 보니 한 칸은 이 폭의 4분의 1이다.
 */
const SPREAD_M = 1.2
/** 찍을 메시에만 잠시 켜는 three.js 레이어. 외곽선(28~30)과 겹치지 않는다. 메시의 보이기를 건드리지 않으려고 레이어로 가른다. */
const CAPTURE_LAYER = 27

/** 깊이로 짙기를 정하는 재질. 정사영이라 gl_FragCoord.z 가 바닥에서의 거리에 곧게 비례한다. */
function darknessMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    side: DoubleSide,
    vertexShader: /* glsl */ `
      void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      void main() { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0 - gl_FragCoord.z); }
    `,
  })
}

/** 발밑 판. 흐린 덮임을 smoothstep 으로 올려 칠한다. 직접 쓴 셰이더라 다음 찍기에 제가 찍히지 않는다. */
function planeMaterial(map: Texture): ShaderMaterial {
  return new ShaderMaterial({
    uniforms: { tMap: { value: map }, uOpacity: { value: 0.5 } },
    transparent: true,
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
    `,
    fragmentShader: /* glsl */ `
      uniform sampler2D tMap;
      uniform float uOpacity;
      varying vec2 vUv;
      void main() { gl_FragColor = vec4(0.0, 0.0, 0.0, uOpacity * smoothstep(0.0, 0.3, texture2D(tMap, vUv).a)); }
    `,
  })
}

/** 이보다 옅은 반투명은 찍지 않는다. 흐리게 한 설비(0.08)·놓기 전 미리보기가 그림자를 만들면 안 된다. */
const MIN_OPACITY = 0.15

/**
 * 그림자를 만들 것인가. 메시만 — 선·점·스프라이트와 아주 옅은 반투명은 뺀다. 직접 쓴 셰이더(ShaderMaterial: 바닥 격자,
 * sun 의 하늘, 흐르는 빛)도 뺀다. 설비 덩어리는 frustumCulled 를 끄고 있어 그것으로는 하늘을 가를 수 없다.
 */
export function castsContact(o: Object3D, own: Object3D): boolean {
  if (o === own) return false
  if (!(o instanceof Mesh) || o instanceof Sprite) return false
  const mats = Array.isArray(o.material) ? o.material : [o.material]
  return mats.every((m) => m && m.visible !== false && !(m instanceof ShaderMaterial) && (!m.transparent || m.opacity >= MIN_OPACITY))
}

/** 장면에서 찍을 메시와 그 상자. 보이지 않는 부모 아래 것은 뺀다(층을 숨긴 경우). */
function collect(scene: Scene, own: Object3D): { meshes: Mesh[]; box: Box3 } {
  const meshes: Mesh[] = []
  const box = new Box3()
  scene.traverseVisible((o) => {
    if (!castsContact(o, own)) return
    const mesh = o as Mesh
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox()
    box.expandByObject(mesh, false)
    meshes.push(mesh)
  })
  return { meshes, box }
}

export function enable(ctx: EggContext): EggHandle {
  const rtA = new WebGLRenderTarget(SHADOW_PX, SHADOW_PX)
  const rtB = new WebGLRenderTarget(SHADOW_PX, SHADOW_PX)
  const depthMat = darknessMaterial()
  const hBlur = new ShaderMaterial({ ...HorizontalBlurShader, uniforms: { tDiffuse: { value: null }, h: { value: 0 } } })
  const vBlur = new ShaderMaterial({ ...VerticalBlurShader, uniforms: { tDiffuse: { value: null }, v: { value: 0 } } })
  const quad = new FullScreenQuad()
  const cam = new OrthographicCamera(-1, 1, 1, -1, 0, REACH_M)

  const planeGeo = new PlaneGeometry(1, 1)
  planeGeo.rotateX(-Math.PI / 2)
  // 카메라가 아래에서 위를 보니 찍힌 그림은 위에서 본 것과 앞뒤가 뒤집혀 있다. 판의 v 를 뒤집어 맞춘다.
  const uv = planeGeo.getAttribute('uv')
  for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i))
  const planeMat = planeMaterial(rtA.texture)
  const plane = new Mesh(planeGeo, planeMat)
  plane.renderOrder = -2
  plane.visible = false

  let needCapture = true
  let needsFrame = false
  let captures = 0
  let captureMs = 0
  let timer: ReturnType<typeof setTimeout> | null = null
  let footprint: { w: number; d: number; y: number } | null = null

  function opacity() {
    return ctx.dark() ? 0.7 : 0.5
  }

  function capture(renderer: WebGLRenderer, scene: Scene) {
    const t0 = performance.now()
    const { meshes, box } = collect(scene, plane)
    if (!meshes.length || box.isEmpty()) {
      plane.visible = false
      return
    }
    const size = box.getSize(new Vector3())
    const center = box.getCenter(new Vector3())
    // 판은 건물보다 흐림 폭의 세 배 넓게 — 흐림이 가장자리에서 잘리지 않게.
    const margin = SPREAD_M * 3
    const w = size.x + margin * 2
    const d = size.z + margin * 2
    cam.left = -w / 2
    cam.right = w / 2
    cam.top = d / 2
    cam.bottom = -d / 2
    cam.near = 0
    cam.far = Math.min(REACH_M, Math.max(0.5, size.y))
    cam.position.set(center.x, box.min.y - 0.02, center.z)
    cam.up.set(0, 0, 1)
    cam.lookAt(center.x, box.min.y + 1, center.z)
    cam.updateProjectionMatrix()
    cam.updateMatrixWorld()
    cam.layers.set(CAPTURE_LAYER)
    hBlur.uniforms.h.value = SPREAD_M / 4 / w
    vBlur.uniforms.v.value = SPREAD_M / 4 / d

    // 찍을 것에만 레이어를 켠다. 덮어쓰기 재질(overrideMaterial)은 선·점에도 걸리니 그것들은 이 카메라에 안 보여야 한다.
    for (const m of meshes) m.layers.enable(CAPTURE_LAYER)
    const prev = {
      target: renderer.getRenderTarget(),
      autoClear: renderer.autoClear,
      clearColor: renderer.getClearColor(new Color()),
      clearAlpha: renderer.getClearAlpha(),
      background: scene.background,
      override: scene.overrideMaterial,
      shadowAuto: renderer.shadowMap.autoUpdate,
    }
    try {
      scene.background = null
      scene.overrideMaterial = depthMat
      // 다른 egg(sun)가 그림자 맵을 기다리게 걸어 두었으면 이 찍기가 그것을 먹지 않게 한다.
      const pendingShadow = renderer.shadowMap.needsUpdate
      renderer.autoClear = true
      renderer.setClearColor(0x000000, 0)
      renderer.setRenderTarget(rtA)
      renderer.render(scene, cam)
      renderer.shadowMap.needsUpdate = pendingShadow
      scene.overrideMaterial = prev.override
      for (let i = 0; i < 2; i++) {
        quad.material = hBlur
        hBlur.uniforms.tDiffuse.value = rtA.texture
        renderer.setRenderTarget(rtB)
        quad.render(renderer)
        quad.material = vBlur
        vBlur.uniforms.tDiffuse.value = rtB.texture
        renderer.setRenderTarget(rtA)
        quad.render(renderer)
      }
    } finally {
      for (const m of meshes) m.layers.disable(CAPTURE_LAYER)
      scene.overrideMaterial = prev.override
      scene.background = prev.background
      renderer.setRenderTarget(prev.target)
      renderer.setClearColor(prev.clearColor, prev.clearAlpha)
      renderer.autoClear = prev.autoClear
      renderer.shadowMap.autoUpdate = prev.shadowAuto
    }

    plane.scale.set(w, 1, d)
    plane.position.set(center.x, box.min.y - 0.01, center.z)
    planeMat.uniforms.uOpacity.value = opacity()
    plane.visible = true
    footprint = { w, d, y: box.min.y }
    captures++
    captureMs = Math.round((performance.now() - t0) * 10) / 10
  }

  function schedule() {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      needCapture = true
      needsFrame = true
    }, SETTLE_MS)
  }

  const stopModel = watch(() => ctx.modelVersion(), schedule)
  const stopDark = watch(
    () => ctx.dark(),
    () => {
      planeMat.uniforms.uOpacity.value = opacity()
      needsFrame = true
    },
  )

  ctx.addLayer({
    object: plane,
    step() {
      const draw = needsFrame
      needsFrame = false
      return draw
    },
    afterRender({ renderer, scene }) {
      if (!needCapture) return
      needCapture = false
      capture(renderer, scene)
      // 찍은 판은 다음 장에 보인다.
      needsFrame = true
    },
    dispose() {
      rtA.dispose()
      rtB.dispose()
      depthMat.dispose()
      hBlur.dispose()
      vBlur.dispose()
      quad.dispose()
      planeGeo.dispose()
      planeMat.dispose()
    },
  })

  return {
    off() {
      stopModel()
      stopDark()
      if (timer) clearTimeout(timer)
      timer = null
    },
    inspect: () => ({ captures, captureMs, visible: plane.visible, footprint }),
  }
}
