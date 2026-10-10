// 3D 아래 칸의 움직임. ieum-apm 의 portal/web/motion.js 를 Vue 로 옮긴 것이고 원칙도 같다 — **바뀐 것만 움직인다.**
//
// 편집할 때마다 검사 통과 수·요구사항·일치율이 제자리에서 갈아끼워져, 무엇이 바뀌었는지 눈으로 따라갈 수 없었다.
// 숫자는 굴러서 어느 쪽으로 얼마나 갔는지 보이고, 바뀐 줄은 한 번 번쩍인다. 가만히 있는 것은 가만히 둔다.
// 움직임을 끈 사람(prefers-reduced-motion)과 안 보이는 탭에서는 전부 멈춘다. 3D 와 큰 표에는 쓰지 않는다 —
// 성수에서 App 한 번 그리기가 0.2초라 화면 전체를 움직이면 마우스를 못 따라간다.

import type { Directive } from 'vue'

const reduced = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null
export const still = () => !!reduced?.matches || (typeof document !== 'undefined' && document.hidden)

/** 빨리 가서 부드럽게 선다. 읽기 시작할 때는 거의 다 와 있다. */
export const easeOut = (k: number) => 1 - (1 - k) ** 3

/**
 * 숫자를 `from` 에서 `to` 로 굴린다. 프레임마다 `paint` 를 부르고 멈출 함수를 돌려준다. 마지막 프레임은 `to` 그대로다 —
 * from + 차이 × 1 로 두면 부동소수 찌꺼기(99.99999)가 화면에 남는다.
 */
export function roll(from: number, to: number, paint: (v: number) => void, duration = 900): () => void {
  if (still() || from === to || !Number.isFinite(from) || !Number.isFinite(to)) {
    paint(to)
    return () => {}
  }
  let raf = 0
  let t0: number | null = null
  const frame = (now: number) => {
    if (t0 === null) t0 = now
    const k = Math.min(1, (now - t0) / duration)
    paint(k < 1 ? from + (to - from) * easeOut(k) : to)
    if (k < 1) raf = requestAnimationFrame(frame)
  }
  raf = requestAnimationFrame(frame)
  return () => cancelAnimationFrame(raf)
}

/** 같은 노드에서 CSS 애니메이션을 처음부터 다시 튼다. */
export function replay(el: Element, cls: string) {
  el.classList.remove(cls)
  void (el as HTMLElement).offsetWidth
  el.classList.add(cls)
}

/**
 * 값이 바뀐 줄을 한 번 번쩍인다(`v-flash="통과 수"`). 처음 그릴 때는 가만히 둔다 — 연 직후 전부 번쩍이면 아무것도
 * 가리키지 않는다. 값은 문자열로 견준다(배열·객체를 넘길 때는 호출부가 열쇠 문자열을 만든다).
 */
let flashPaused = false
/** 번쩍임을 잠시 끈다. 리플레이가 극장을 덮는 동안 — 가려진 패널의 줄마다 번쩍임을 다시 틀며 레이아웃을 강제로 다시 쟀다. */
export function pauseFlash(on: boolean) {
  flashPaused = on
}
export const vFlash: Directive<HTMLElement, unknown> = {
  updated(el, { value, oldValue }) {
    if (String(value) === String(oldValue) || still() || flashPaused) return
    replay(el, 'flash')
  },
}
