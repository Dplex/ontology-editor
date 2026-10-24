// B. 읽는 중인 IFC 클래스(ticker) — 파일을 읽는 동안 진행 막대 아래에 `IfcDuctSegment 3,421` 같은 줄이 고정폭 글자로 하나씩 오른다
// (docs/plans/easter-eggs.md).
//
// - 수는 임포터가 파일을 연 직후 센 IfcProduct 하위 클래스별 수 그대로다(ImportOptions.classCounts — 이 egg 가 켜져 있을 때만 센다).
//   0 부터 굴려 올리지 않는다. 줄이 아래에서 올라오는 것만 움직임이고, 많은 클래스부터 0.12초마다 한 줄씩이다.
// - 파일을 열기 전에 켜져 있어야 해서 주소(`?egg=ticker`)로 켠다(early). 3D·HUD 를 쓰지 않는다.
// - 진행 알림(App.vue 의 .progress-toast)은 Vue 가 그리는 것이라 그 안에 끼우지 않고, 바로 아래(자리가 없으면 위)에 따로 띄워 자리만 따라간다.
// - 움직임 끄기면 줄을 한꺼번에 보인다.
import { watch } from 'vue'
import type { EggContext, EggHandle } from './types'

export const MAX_LINES = 12
const LINE_MS = 120
const TOAST = '.progress-toast'

/** 보일 줄들. 많은 것부터 MAX_LINES 개, `IfcDuctSegment 3,421` 꼴. */
export function tickerLines(classes: readonly (readonly [string, number])[]): string[] {
  return classes.slice(0, MAX_LINES).map(([name, n]) => `${name} ${n.toLocaleString()}`)
}

export function enable(ctx: EggContext): EggHandle {
  let box: HTMLElement | null = null
  let reveal: ReturnType<typeof setInterval> | null = null
  let follow = 0
  let shown = 0
  let files = 0
  let last: string[] = []

  function place() {
    const toast = document.querySelector<HTMLElement>(TOAST)
    if (!box) return
    if (!toast) {
      box.style.visibility = 'hidden'
    } else {
      const r = toast.getBoundingClientRect()
      box.style.visibility = 'visible'
      box.style.left = `${r.left}px`
      box.style.width = `${r.width}px`
      // 진행 알림은 화면 아래에 붙어 있어 그 밑은 대개 화면 밖이다. 아래에 자리가 없으면 위에 띄운다.
      const h = box.offsetHeight
      box.style.top = `${r.bottom + 6 + h <= window.innerHeight ? r.bottom + 6 : Math.max(0, r.top - 6 - h)}px`
    }
    follow = requestAnimationFrame(place)
  }

  function clear() {
    if (reveal) clearInterval(reveal)
    reveal = null
    cancelAnimationFrame(follow)
    box?.remove()
    box = null
  }

  function show(classes: readonly (readonly [string, number])[]) {
    clear()
    files++
    last = tickerLines(classes)
    shown = 0
    box = document.createElement('div')
    box.dataset.testid = 'egg-ticker'
    box.setAttribute('aria-hidden', 'true')
    box.style.cssText =
      'position:fixed;z-index:60;pointer-events:none;padding:0.35rem 0.6rem;border:1px solid var(--line);border-radius:6px;background:color-mix(in srgb,var(--surface) 94%,transparent);font:11px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--muted);overflow:hidden'
    document.body.append(box)
    place()
    const still = ctx.still()
    const add = () => {
      if (!box || shown >= last.length) {
        if (reveal) clearInterval(reveal)
        reveal = null
        return
      }
      const line = document.createElement('div')
      line.textContent = last[shown++]
      if (!still) {
        line.animate([{ transform: 'translateY(8px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 220, easing: 'ease-out' })
      }
      box.append(line)
    }
    if (still) while (shown < last.length) add()
    else {
      add()
      reveal = setInterval(add, LINE_MS)
    }
  }

  const stopClasses = watch(ctx.signals.importClasses, (c) => {
    if (c?.length) show(c)
  })
  // 다 읽으면(진행 알림이 닫히면) 걷는다.
  const stopImporting = watch(ctx.signals.importing, (on) => {
    if (!on) clear()
  })

  return {
    off() {
      stopClasses()
      stopImporting()
      clear()
    },
    inspect: () => ({ files, shown, lines: last }),
  }
}
