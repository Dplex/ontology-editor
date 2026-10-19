// --- 놓을 때 바닥에 떨어져 앉는 움직임 ---
//
// 설비·추가 공간 오브젝트를 새로 놓으면 작게 나타나 살짝 떠올랐다가 바닥에 떨어지고, 닿는 순간 한 번 눌렸다 돌아온다.
// 클릭→클릭으로 놓으면(D16) 상자가 그 자리에 갑자기 생겨서, 큰 층에서는 무엇이 생겼는지 눈으로 다시 찾아야 했다.
// ArtCraft(storytold/artcraft, MIT)의 entrance/meshDrop.ts 에서 가져왔다(reference.md). 시간은 그쪽 0.75초를 0.52초로 줄였다 —
// 놓기는 자주 하는 편집이라 기다리게 하지 않는다(디자인 시스템 A6). 모양만 움직이고 자리·고르기 상자·소속 판정은 처음부터 끝 자리다.

/** 한 번 떨어지는 시간(ms). */
export const DROP_MS = 520
/** 한 번에 이만큼보다 많이 생기면(여러 층 붙여넣기 등) 움직이지 않는다 — 한꺼번에 튀면 무엇이 생겼는지 오히려 안 읽힌다. */
export const DROP_MAX = 60

// 선형 시간(0..1)의 구간. 나타나며 떠오르기 → 떨어지기 → 눌렸다 돌아오기.
const POP_END = 0.22
const IMPACT = 0.55
const POP_START_SCALE = 0.45
const SQUASH_AMOUNT = 0.12
const SQUASH_DECAY = 3.6
const SQUASH_FREQ = 6.5

const clamp01 = (t: number) => (t < 0 ? 0 : t > 1 ? 1 : t)
const easeOutCubic = (t: number) => 1 - (1 - t) ** 3
const easeInQuart = (t: number) => t ** 4
function easeOutBack(t: number, overshoot: number) {
  const c3 = overshoot + 1
  return 1 + c3 * (t - 1) ** 3 + overshoot * (t - 1) ** 2
}

/**
 * `t`(0..1)일 때의 모양. 바닥 가운데를 기준으로 `scale`·`sy`·`sxz` 를 곱하고 `lift` 만큼 띄운다(미터).
 * 떠오르는 높이는 큰 변의 절반이고 0.2~0.6m 다 — 건물 하나를 내려다보는 거리에서도 뜬 것이 보이고, 의자와 공조기가 같은 느낌으로
 * 떨어진다. ArtCraft 는 큰 변의 22%(0.08~0.45m)인데, 방 하나를 보는 화면 기준이라 층 전체를 보면 움직임이 안 보였다. t = 1 이면 그대로(1, 0, 1, 1)다.
 */
export function dropPose(t: number, maxDim: number): { scale: number; lift: number; sy: number; sxz: number } {
  const k = clamp01(t)
  if (k >= 1) return { scale: 1, lift: 0, sy: 1, sxz: 1 }
  const peak = Math.min(0.6, Math.max(0.2, 0.5 * (maxDim || 1)))
  const scale = POP_START_SCALE + (1 - POP_START_SCALE) * easeOutBack(clamp01(k / POP_END), 2.2)
  const lift = k <= POP_END ? peak * easeOutCubic(k / POP_END) : k < IMPACT ? peak * (1 - easeInQuart((k - POP_END) / (IMPACT - POP_END))) : 0
  if (k < IMPACT) return { scale, lift, sy: 1, sxz: 1 }
  const u = (k - IMPACT) / (1 - IMPACT)
  const wobble = Math.exp(-SQUASH_DECAY * u) * Math.sin(SQUASH_FREQ * u)
  return { scale, lift, sy: 1 - SQUASH_AMOUNT * wobble, sxz: 1 + SQUASH_AMOUNT * 0.6 * wobble }
}

/**
 * 꼭짓점 배열(three.js 장면 좌표, y 가 위)에 모양을 입힌다. 기준점은 바닥 가운데 `pivot`(x, 바닥 y, z)이다. `out` 에 쓴다.
 * 설비 형상은 덩어리 하나에 합쳐 있어 물체의 크기·자리를 바꿀 수 없다 — 그 설비의 꼭짓점만 다시 쓴다(되돌리기 미끄러짐과 같은 장치).
 */
export function poseVertices(base: ArrayLike<number>, out: Float32Array, pivot: readonly [number, number, number], pose: ReturnType<typeof dropPose>) {
  const sx = pose.scale * pose.sxz
  const sy = pose.scale * pose.sy
  const [px, py, pz] = pivot
  for (let i = 0; i < out.length; i += 3) {
    out[i] = px + (base[i] - px) * sx
    out[i + 1] = py + (base[i + 1] - py) * sy + pose.lift
    out[i + 2] = pz + (base[i + 2] - pz) * sx
  }
}

// --- 지울 때 가라앉기 ---
// 떨어져 앉기의 반대다. 지운 설비·오브젝트가 0.32초 동안 줄며 바닥 아래로 가라앉고 흐려진다. 지운 것이 갑자기 사라지면 큰 층에서 무엇이
// 없어졌는지 다시 찾아야 했다. 모델에서는 이미 지워졌고, 남은 모양은 그리기만 하는 사본이다(고를 수 없다).

/** 한 번 가라앉는 시간(ms). 떨어지기보다 짧다 — 없어지는 것을 오래 보여 줄 까닭이 없다. */
export const SINK_MS = 320

/**
 * `t`(0..1)일 때의 모양. 바닥 가운데 기준으로 `scale` 을 곱하고 `lift`(음수, 미터)만큼 내리며 `opacity` 로 흐린다. 줄기는 처음부터
 * 고르게(눈이 바로 따라간다), 가라앉기는 점점 빠르게(바닥으로 빠지는 느낌), 흐리기는 끝으로 갈수록 빠르게 한다.
 */
export function sinkPose(t: number, height: number): { scale: number; lift: number; opacity: number } {
  const k = clamp01(t)
  return { scale: 1 - 0.6 * k, lift: -Math.min(0.6, Math.max(0.15, 0.5 * (height || 1))) * k * k, opacity: 1 - k ** 1.5 }
}

// --- 겹쳐서 막혔을 때 흔들기 ---
// 막은 상대(OE-SPC-15 "겹치는 상대 오브젝트가 붉게 표시")가 붉은 외곽선과 함께 좌우로 짧게 흔들린다. 붉은 선만으로는 큰 층에서
// 어느 것이 막았는지 눈이 가지 않았다. 고개를 젓는 몸짓이라 "안 된다" 로 읽힌다.

/** 한 번 흔드는 시간(ms). */
export const SHAKE_MS = 360

/** `t`(0..1)일 때의 좌우 밀림(미터). 세 번 오가며 줄어든다. 진폭은 큰 변의 12%, 4~12cm 다 — 층 하나를 내려다보는 거리에서 보이는 폭이다. */
export function shakeOffset(t: number, maxDim: number): number {
  const k = clamp01(t)
  if (k >= 1) return 0
  const amp = Math.min(0.12, Math.max(0.04, 0.12 * (maxDim || 1)))
  return amp * Math.sin(k * Math.PI * 6) * (1 - k)
}
