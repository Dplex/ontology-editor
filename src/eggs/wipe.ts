// A. 테마 원형 번짐(wipe) — 테마 단추를 누르면 그 단추에서 원이 퍼지며 라이트와 다크가 바뀐다(docs/plans/easter-eggs.md).
//
// - egg 는 테마를 바꾸는 함수를 받지 않는다(G4). 그래서 단추의 click 을 capture 단계에서 먼저 받아 View Transition 으로 감싸고,
//   그 안에서 같은 단추를 한 번 더 눌러 앱 자기 코드(toggleTheme)가 바꾸게 한다. 저장·3D(setDark)는 평소와 똑같다.
// - 전환 콜백은 Vue 가 DOM 을 고칠 틈(작업 한 칸)만 기다린다. 처음에는 새 3D 가 한 장 그려지기를 기다렸는데, 콜백이 도는 동안
//   브라우저가 화면 갱신(rAF)을 멈춰서 그 한 장은 오지 않고 매번 0.3초 시간 초과로 끝났다(성수에서 잼). 새 화면은 살아 있는 사본이라
//   3D 칸은 전환이 시작된 뒤 다음 장에서 새 테마로 바뀐다.
// - 움직임 끄기(still())이거나 브라우저에 View Transition 이 없으면 아무것도 가로채지 않는다 — 그냥 바뀐다.
// - 바탕 CSS 에 규칙을 더하지 않는다(G6). 전환 기본 애니메이션을 끄는 규칙은 켜 있는 동안만 <style> 하나로 붙인다.
import type { EggContext, EggHandle } from './types'

export const WIPE_MS = 450
/** 편집기 위쪽 막대의 테마 단추(AppBar.vue). 시작 화면에는 egg 가 켜지지 않는다(파일이 열려 있어야 켜진다). */
const THEME_BUTTON = '.appbar button.theme'

type ViewTransitionLike = { ready: Promise<void>; finished: Promise<void> }
type DocWithVT = Document & { startViewTransition?: (cb: () => Promise<void> | void) => ViewTransitionLike }

/** 단추 가운데에서 화면 네 귀퉁이 중 가장 먼 곳까지의 거리 — 원이 화면을 다 덮는 반지름. */
export function coverRadius(x: number, y: number, w: number, h: number): number {
  return Math.hypot(Math.max(x, w - x), Math.max(y, h - y))
}

export function enable(ctx: EggContext): EggHandle {
  const doc = document as DocWithVT
  const style = document.createElement('style')
  style.dataset.testid = 'egg-wipe-style'
  // 기본 교차 페이드를 끄고 새 화면이 원으로만 드러나게 한다.
  style.textContent = '::view-transition-old(root),::view-transition-new(root){animation:none;mix-blend-mode:normal}'
  document.head.append(style)

  let passing = false
  let running = false
  let transitions = 0
  let lastWaitMs = 0

  const onClick = (e: MouseEvent) => {
    if (passing || running) return
    const btn = e.target instanceof Element ? e.target.closest<HTMLButtonElement>(THEME_BUTTON) : null
    if (!btn || ctx.still() || typeof doc.startViewTransition !== 'function') return
    e.preventDefault()
    e.stopImmediatePropagation()
    const r = btn.getBoundingClientRect()
    const x = r.left + r.width / 2
    const y = r.top + r.height / 2
    const radius = coverRadius(x, y, window.innerWidth, window.innerHeight)
    running = true
    const t0 = performance.now()
    const vt = doc.startViewTransition(async () => {
      passing = true
      try {
        btn.click()
      } finally {
        passing = false
      }
      // Vue 의 DOM 고치기(마이크로태스크)가 끝난 뒤에 새 화면을 뜨게 한다.
      await new Promise((resolve) => setTimeout(resolve, 0))
      lastWaitMs = Math.round(performance.now() - t0)
    })
    transitions++
    vt.ready
      .then(() => {
        document.documentElement.animate(
          { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
          { duration: WIPE_MS, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', pseudoElement: '::view-transition-new(root)' },
        )
      })
      .catch(() => {})
    vt.finished.finally(() => (running = false)).catch(() => {})
  }
  document.addEventListener('click', onClick, { capture: true })

  return {
    off() {
      document.removeEventListener('click', onClick, { capture: true })
      style.remove()
    },
    inspect: () => ({ transitions, lastWaitMs, running, supported: typeof doc.startViewTransition === 'function' }),
  }
}
