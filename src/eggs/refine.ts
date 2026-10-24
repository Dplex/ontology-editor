// A. 멈추면 차오르는 화질(refine) — 시점이 0.25초 멈추면 다음 8장 동안 카메라를 서브픽셀만큼 흔들어 그린 것을 평균한다(docs/plans/easter-eggs.md).
//
// - TAA 와 같은 원리다(three 의 TAARenderPass 참고). 얇은 배관·모서리 선의 계단이 평균으로 메워진다.
// - 흔들기는 그리기 전(step)에 카메라의 view offset 으로 걸고, 그린 뒤(afterRender) 화면을 텍스처로 떠서 누적 판에 섞은 다음
//   누적 판을 화면에 다시 깐다. 본 장면을 한 번 더 그리지 않으니 한 장의 값은 평소 한 장 + 사각형 두 번이다.
// - 움직이면(카메라가 바뀌거나 모델이 바뀌면) 바로 멈추고 보통 그리기로 돌아간다. 가만히 있을 때 0장은 이 egg 동안만
//   "멈춘 뒤 8장, 그다음 0장" 이다. 다른 까닭으로 한 장이 그려지면(설명 풍선·고른 것 바뀜) 0.25초 뒤 다시 8장을 모은다.
// - 외곽선(고른 것·미리 강조)은 afterRender 뒤에 그려져 누적에 섞이지 않는다 — 윤곽은 늘 위에 또렷하다.
// - 2단계(누적 뒤 GTAO 한 장)는 하지 않았다. 먼저 이것만 보고 정한다.
import {
  FramebufferTexture,
  HalfFloatType,
  Matrix4,
  NoBlending,
  type PerspectiveCamera,
  RGBAFormat,
  ShaderMaterial,
  Vector2,
  WebGLRenderTarget,
  type WebGLRenderer,
} from 'three'
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js'
import { watch } from 'vue'
import type { EggContext, EggHandle } from './types'

export const IDLE_MS = 250
export const SAMPLES = 8
const MOVE_EPS = 1e-4

/** Halton 수열(밑 b)의 i 번째 값(0..1). */
function halton(i: number, b: number): number {
  let f = 1
  let r = 0
  for (let n = i + 1; n > 0; n = Math.floor(n / b)) {
    f /= b
    r += f * (n % b)
  }
  return r
}

/** 서브픽셀 흔들기(픽셀 단위, -0.5..0.5). 첫 장은 흔들지 않는다 — 누적이 끊겨도 첫 장은 평소 그림과 같다. */
export const JITTER: readonly [number, number][] = Array.from({ length: SAMPLES }, (_, i) =>
  i === 0 ? [0, 0] : [halton(i, 2) - 0.5, halton(i, 3) - 0.5],
)

const blendMaterial = () =>
  new ShaderMaterial({
    uniforms: { tPrev: { value: null }, tCur: { value: null }, uWeight: { value: 1 } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader:
      'uniform sampler2D tPrev; uniform sampler2D tCur; uniform float uWeight; varying vec2 vUv;' +
      'void main() { gl_FragColor = mix(texture2D(tPrev, vUv), texture2D(tCur, vUv), uWeight); }',
    blending: NoBlending,
    depthTest: false,
    depthWrite: false,
  })

const copyMaterial = () =>
  new ShaderMaterial({
    uniforms: { tSrc: { value: null } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: 'uniform sampler2D tSrc; varying vec2 vUv; void main() { gl_FragColor = texture2D(tSrc, vUv); }',
    blending: NoBlending,
    depthTest: false,
    depthWrite: false,
  })

export function enable(ctx: EggContext): EggHandle {
  const blend = blendMaterial()
  const copy = copyMaterial()
  const quad = new FullScreenQuad()
  const size = new Vector2()
  let grab: FramebufferTexture | null = null
  let accA: WebGLRenderTarget | null = null
  let accB: WebGLRenderTarget | null = null

  let camera: PerspectiveCamera | null = null
  const seen = new Matrix4()
  let seenFov = 0
  let seenAspect = 0
  let lastPlainAt = performance.now()
  let waiting = true
  /** 지금 모으는 장의 번호. null 이면 모으지 않는다. */
  let sample: number | null = null
  let sequences = 0
  let completed = 0
  let samplesDrawn = 0

  function ensureTargets(renderer: WebGLRenderer) {
    renderer.getDrawingBufferSize(size)
    if (grab && grab.image.width === size.x && grab.image.height === size.y) return
    grab?.dispose()
    accA?.dispose()
    accB?.dispose()
    grab = new FramebufferTexture(size.x, size.y)
    // 누적은 HalfFloat 로 한다. 8비트로 섞으면 장마다 반올림이 쌓여 어두운 면에 띠가 생긴다(TAARenderPass 도 그렇게 한다).
    accA = new WebGLRenderTarget(size.x, size.y, { format: RGBAFormat, type: HalfFloatType, depthBuffer: false })
    accB = new WebGLRenderTarget(size.x, size.y, { format: RGBAFormat, type: HalfFloatType, depthBuffer: false })
  }

  /**
   * 시점이 움직였나. 정확히 같음으로 보면 안 된다 — 회전을 놓은 뒤에도 OrbitControls 의 감쇠가 문턱(뷰어가 다시 그리는 기준)보다
   * 작은 양(1e-5)으로 카메라를 계속 밀어서, Duplex·병원에서 흔든 둘째 장마다 끊겼다. 1e-4 는 100m 앞에서도 1mm 가 안 된다.
   */
  function cameraMoved(c: PerspectiveCamera): boolean {
    const a = seen.elements
    const b = c.matrixWorld.elements
    for (let i = 0; i < 16; i++) if (Math.abs(a[i] - b[i]) > MOVE_EPS) return true
    return seenFov !== c.fov || seenAspect !== c.aspect
  }
  function remember(c: PerspectiveCamera) {
    seen.copy(c.matrixWorld)
    seenFov = c.fov
    seenAspect = c.aspect
  }

  function stopSampling() {
    if (camera?.view?.enabled) camera.clearViewOffset()
    sample = null
  }

  const stopModel = watch(
    () => ctx.modelVersion(),
    () => {
      stopSampling()
      waiting = true
      lastPlainAt = performance.now()
    },
  )

  ctx.addLayer({
    step(now) {
      if (sample === null) {
        if (!waiting || !camera || now - lastPlainAt < IDLE_MS) return false
        waiting = false
        sample = 0
        sequences++
      }
      // 이번 장의 흔들기. 화면 크기 단위의 view offset 이라 drawing buffer 크기로 나눠 1픽셀보다 작게 민다.
      const c = camera!
      const [jx, jy] = JITTER[sample]
      const w = size.x || 1
      const h = size.y || 1
      if (jx === 0 && jy === 0) {
        if (c.view?.enabled) c.clearViewOffset()
      } else c.setViewOffset(w, h, jx, jy, w, h)
      return true
    },
    afterRender({ renderer, camera: cam }) {
      camera = cam
      if (sample === null) {
        // 다른 까닭으로 그린 평소 한 장. 0.25초 가만히 있으면 모으기 시작한다.
        remember(cam)
        lastPlainAt = performance.now()
        waiting = true
        return
      }
      if (sample > 0 && cameraMoved(cam)) {
        // 흔드는 사이에 시점이 움직였다. 이번 장은 평소 그림이 아니라 흔든 그림이니 한 장 더 평소대로 그린다.
        stopSampling()
        remember(cam)
        lastPlainAt = performance.now()
        waiting = true
        return
      }
      if (sample === 0) remember(cam)
      ensureTargets(renderer)
      const prevTarget = renderer.getRenderTarget()
      const prevAutoClear = renderer.autoClear
      renderer.autoClear = false
      renderer.copyFramebufferToTexture(grab!)
      // 누적: A(지금까지) 와 이번 장을 1/(n+1) 로 섞어 B 에, 그다음 A·B 를 바꾼다.
      blend.uniforms.tPrev.value = accA!.texture
      blend.uniforms.tCur.value = grab
      blend.uniforms.uWeight.value = 1 / (sample + 1)
      quad.material = blend
      renderer.setRenderTarget(accB)
      quad.render(renderer)
      ;[accA, accB] = [accB, accA]
      // 누적 판을 화면에 깐다.
      copy.uniforms.tSrc.value = accA!.texture
      quad.material = copy
      renderer.setRenderTarget(prevTarget)
      quad.render(renderer)
      renderer.autoClear = prevAutoClear
      samplesDrawn++
      sample++
      if (sample >= SAMPLES) {
        stopSampling()
        completed++
      }
    },
    dispose() {
      stopSampling()
      grab?.dispose()
      accA?.dispose()
      accB?.dispose()
      blend.dispose()
      copy.dispose()
      quad.dispose()
    },
  })

  return {
    off: stopModel,
    inspect: () => ({ sequences, completed, samplesDrawn, sampling: sample !== null }),
  }
}
