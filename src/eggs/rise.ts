// A. 층이 올라앉는 오프닝(rise) — 파일을 연 뒤 층이 아래부터 0.08초 간격으로 한 층 높이 위에서 내려앉는다(docs/plans/easter-eggs.md).
//
// - 인트로(#intro)는 파일을 열기 전의 구운 장면이고 이것은 실제 파일을 연 편집기 3D 다. 조립과 겹치지 않게 짧게 둔다.
// - 드는 높이는 층 사이 간격의 가운데 값이다(1.5~6m). 처음엔 0.4m 였는데 성수(19개 층, 80m)에서는 건물 높이의 0.5% 라 움직이는 줄 몰랐다.
// - 모양만 움직인다. 재질의 꼭짓점 셰이더에 "세계 y 가 속한 층만큼 위로" 를 꽂을 뿐, 형상·자리·고르기 상자(JS 배열)는
//   처음부터 끝 자리다(drop-in.ts 와 같은 원칙, replay-viewer.ts 의 층 들기와 같은 관용구).
// - 다 내려앉아도 꽂은 것은 egg 를 끌 때까지 둔다(들기 0). 빼면 그 자리에서 셰이더를 다시 지어 내려앉는 끝에 화면이 멈칫한다.
//   층 수만큼 도는 짧은 반복이 꼭짓점마다 남는 값이고, 가만히 있을 때 0장은 그대로다. 새 파일의 재질은 처음 그리기 전에 꽂으니
//   셰이더를 한 번만 짓는다.
// - 시계는 장 간격이 평소로 돌아온 장부터 간다(최대 10초 기다림). 꽂으면 재질 셰이더를 다시 짓는데 성수(재질 220개)는 그 멈춤이
//   두 장에 걸쳐 3.4초 · 2.1초라 내려앉는 시간(2초)보다 길었다. 꽂은 다음 장부터 재면 두 장 만에 끝나 아무것도 안 보였다.
//   CPU 로 그리는 e2e 의 평소 장 간격(0.15~0.2초)은 멈춤으로 보지 않게 문턱을 0.4초로 둔다.
// - 켤 때 한 번, 그리고 켜 둔 동안 새 파일을 열 때마다 한 번 튼다(편집은 모델 객체가 그대로라 틀지 않는다).
//   주소(?egg=rise)로 켜면 3D 첫 장 뒤에 켜지므로 곧 여는 장면이 된다. 열기 완료 신호는 건드리지 않는다.
// - 움직임 끄기(still())면 틀지 않는다.
import type { Material, WebGLProgramParametersWithUniforms, WebGLRenderer } from 'three'
import { Line, Mesh, Object3D, Points } from 'three'
import { watch } from 'vue'
import type { Model } from '../lib/model'
import type { EggContext, EggHandle } from './types'

export const STAGGER_MS = 80
export const DROP_MS = 600
/** 층이 하나뿐이라 간격을 잴 수 없을 때 드는 높이. */
export const LIFT_M = 3
const LIFT_MIN = 1.5
const LIFT_MAX = 6
/** 이보다 긴 장 간격은 셰이더를 짓느라 멈춘 것으로 본다. */
const STALL_MS = 400
const STALL_WAIT_MAX = 10_000
/** 셰이더 배열 크기. 층이 이보다 많으면 위층들은 맨 위 단과 같이 내려앉는다. */
const MAX_LEVELS = 64

/** 층 높이(장면 y, 같은 높이는 한 단)를 아래부터. */
export function riseLevels(model: Readonly<Model>): number[] {
  return [...new Set(model.storeys.map((s) => s.elevation))].sort((a, b) => a - b).slice(0, MAX_LEVELS)
}

/** 드는 높이. 층 사이 간격의 가운데 값(1.5~6m). 층이 하나면 LIFT_M. */
export function riseLift(levels: readonly number[]): number {
  const gaps = levels.slice(1).map((y, i) => y - levels[i]).sort((a, b) => a - b)
  if (!gaps.length) return LIFT_M
  return Math.min(LIFT_MAX, Math.max(LIFT_MIN, gaps[Math.floor(gaps.length / 2)]))
}

/** 전체가 다 내려앉는 데 걸리는 시간. */
export function riseDuration(levels: number): number {
  return levels > 0 ? (levels - 1) * STAGGER_MS + DROP_MS : 0
}

/** k 번째 단이 t(ms)에 떠 있는 높이. 셰이더와 같은 식이다(단위 테스트가 이것으로 잰다). */
export function liftAt(k: number, t: number, lift = LIFT_M): number {
  const u = Math.min(1, Math.max(0, (t - k * STAGGER_MS) / DROP_MS))
  return lift * (1 - (1 - (1 - u) ** 3))
}

const VERT_HEAD = `uniform float uRiseT;\nuniform float uRiseLift;\nuniform float uRiseLevels[${MAX_LEVELS}];\nuniform int uRiseCount;\n`
// 세계 y 로 단을 찾는다. 층 높이보다 조금 아래(바닥판 두께)까지는 그 층으로 본다.
const VERT_BODY = `
  {
    vec4 rw = modelMatrix * vec4(transformed, 1.0);
    int k = 0;
    for (int i = 0; i < ${MAX_LEVELS}; i++) {
      if (i >= uRiseCount) break;
      if (rw.y >= uRiseLevels[i] - 0.05) k = i;
    }
    float u = clamp((uRiseT - float(k) * ${STAGGER_MS.toFixed(1)}) / ${DROP_MS.toFixed(1)}, 0.0, 1.0);
    float e = 1.0 - pow(1.0 - u, 3.0);
    rw.y += uRiseLift * (1.0 - e);
    mvPosition = viewMatrix * rw;
    gl_Position = projectionMatrix * mvPosition;
  }`

type Saved = { onBeforeCompile: Material['onBeforeCompile']; customProgramCacheKey: Material['customProgramCacheKey'] }

export function enable(ctx: EggContext): EggHandle {
  const uniforms = {
    uRiseT: { value: 0 },
    uRiseLift: { value: LIFT_M },
    uRiseLevels: { value: new Float32Array(MAX_LEVELS) },
    uRiseCount: { value: 0 },
  }
  const patched = new Map<Material, Saved>()
  let pending = !ctx.still()
  /** 꽂고 첫 장(t = 0)을 그렸다. 장 간격이 평소로 돌아오면 시계를 건다. */
  let armed = false
  let armedAt = 0
  let lastStep = 0
  let startAt: number | null = null
  let duration = 0
  let runs = 0
  let frames = 0
  let lastModel = ctx.model()
  let needsFrame = false
  let repatch = false

  function patch(material: Material) {
    if (patched.has(material)) return
    patched.set(material, { onBeforeCompile: material.onBeforeCompile, customProgramCacheKey: material.customProgramCacheKey })
    const before = material.onBeforeCompile
    const beforeKey = material.customProgramCacheKey
    material.onBeforeCompile = (shader: WebGLProgramParametersWithUniforms, r: WebGLRenderer) => {
      before.call(material, shader, r)
      // 직접 쓴 셰이더(ShaderMaterial: 바닥 격자·흐르는 빛)는 project_vertex 가 없으니 그대로 둔다.
      if (!shader.vertexShader.includes('#include <project_vertex>')) return
      Object.assign(shader.uniforms, uniforms)
      shader.vertexShader = VERT_HEAD + shader.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>${VERT_BODY}`)
    }
    material.customProgramCacheKey = () => `${beforeKey.call(material)}|egg-rise`
    material.needsUpdate = true
  }

  function unpatchAll() {
    for (const [material, saved] of patched) {
      material.onBeforeCompile = saved.onBeforeCompile
      material.customProgramCacheKey = saved.customProgramCacheKey
      material.needsUpdate = true
    }
    patched.clear()
  }

  // 장면은 이 빈 물체의 부모다. 그리기 전(step)에 재질을 꽂아야 첫 장부터 떠 있다 — 쉬는 자리를 한 장 그린 뒤 꽂으면 튀어 오른다.
  const anchor = new Object3D()

  function patchScene() {
    anchor.parent?.traverse((o) => {
      if (!(o instanceof Mesh || o instanceof Line || o instanceof Points)) return
      for (const mat of ([] as Material[]).concat(o.material)) if (mat) patch(mat)
    })
  }

  function begin() {
    const m = ctx.model()
    const scene = anchor.parent
    if (!m || !scene) return
    const levels = riseLevels(m)
    if (!levels.length) return
    uniforms.uRiseLevels.value.fill(0)
    uniforms.uRiseLevels.value.set(levels)
    uniforms.uRiseCount.value = levels.length
    uniforms.uRiseLift.value = riseLift(levels)
    uniforms.uRiseT.value = 0
    patchScene()
    duration = riseDuration(levels.length)
    armed = true
    armedAt = performance.now()
    runs++
  }

  function finish() {
    startAt = null
    armed = false
    // 셰이더는 그대로 두고 들기만 0 으로 — 셰이더 식에서 시간이 충분히 지나면 모든 단이 0 이다.
    uniforms.uRiseT.value = 1e9
    needsFrame = true
  }

  // 새 파일(모델 객체가 바뀜)이면 다시 튼다. 편집은 같은 객체를 고치고 알리기만 한다.
  const stop = watch(
    () => ctx.modelVersion(),
    () => {
      const m = ctx.model()
      // 내려앉는 동안 3D 를 다시 지었으면(새 파일의 덩어리가 뒤늦게 생기는 등) 새 재질에도 꽂는다.
      if (startAt !== null || armed) repatch = true
      if (m === lastModel) return
      lastModel = m
      if (startAt !== null || armed) finish()
      if (m && !ctx.still()) {
        pending = true
        needsFrame = true
      }
    },
  )

  ctx.addLayer({
    object: anchor,
    step(now) {
      const gap = now - lastStep
      lastStep = now
      if (pending) {
        pending = false
        begin()
        return true
      }
      if (armed) {
        // 셰이더를 짓느라 멈춘 장이면 t = 0 으로 한 장 더 그리고 기다린다.
        if (gap > STALL_MS && now - armedAt < STALL_WAIT_MAX) return true
        armed = false
        startAt = now
      }
      if (startAt !== null) {
        if (repatch) patchScene()
        repatch = false
        uniforms.uRiseT.value = now - startAt
        frames++
        if (now - startAt >= duration) finish()
        return true
      }
      const draw = needsFrame
      needsFrame = false
      return draw
    },
    dispose() {
      unpatchAll()
    },
  })

  return {
    off: stop,
    inspect: () => ({ runs, frames, running: pending || armed || startAt !== null, patched: patched.size, levels: uniforms.uRiseCount.value, lift: uniforms.uRiseLift.value, duration}),
  }
}
