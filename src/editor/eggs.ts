// --- 숨은 연출(egg)의 껍데기 (docs/plans/easter-eggs.md) ---
// 켜는 길은 셋(주소 `?egg=` · 콘솔 `__oe.egg()` · `~` 판)뿐이고 기본은 꺼짐이다. 켜지 않으면 DOM·3D·단축키·내보내는 파일이 egg 가
// 없을 때와 같다 — 여기서 늘 하는 일은 키 하나(Shift+`)를 듣는 것과 `window.__oe` 에 이름 몇 개를 더하는 것뿐이다.
//
// egg 는 src/eggs/ 에 있고 편집기 상태는 이 파일만 읽는다. egg 에는 EggContext 로 읽을 것만 건넨다(고치는 함수는 없다).
// egg 가 얹은 3D 층·빛·HUD·넓게 보기는 여기서 같이 거둔다 — egg 가 거두기를 빠뜨려도 끄면 켜기 전으로 돌아온다.
// 리플레이를 열면 켠 egg 를 모두 쉬게 했다가 닫으면 되살린다(리플레이는 제 연출이 따로 있고 Space 를 재생에 쓴다).
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { modelToGeoJSON } from '../lib/export/geojson'
import { modelToTTL } from '../lib/export/ttl'
import { still } from '../lib/motion'
import { replayOpen } from '../lib/replay-player'
import { EGGS } from '../eggs/registry'
import type { EggContext, EggHandle, EggSignals } from '../eggs/types'
import { fullscreen } from './chat-view'
import { checks } from './checks'
import { oeHook } from './connections'
import { canvas, dark, fileName, model } from './core'
import { isTextEntry } from './history'
import { flying } from './keyboard'
import { viewStorey } from './multi-view'
import { storeyChips } from './panels'
import { importClasses, progress, wantClassCounts } from './progress'
import { grades } from './publish'
import { sceneVersion } from './redraw'
import { viewer } from './scene'

type Running = { handle: EggHandle; cleanup: (() => void)[] }

const running = new Map<string, Running>()
/** 내려받는 중(동적 import)인 egg. 그 사이 끄면 여기서 빠지고, 다 받은 뒤 켜지 않는다. */
const loading = new Set<string>()
/** 켜 둔 egg 의 id(켠 순서). `~` 판이 읽는다. */
export const eggsOn = ref<string[]>([])
/** 리플레이 동안 쉬게 한 egg. 닫으면 되살린다. */
let resting: string[] = []
/** egg 의 watch 가 받아야 하니 ref 다. 평범한 변수면 `watch(() => ctx.modelVersion())` 가 한 번도 울리지 않는다. */
const version = ref(0)

// 계산은 egg 가 읽을 때만 돈다(computed). egg 가 꺼져 있으면 아무도 안 읽는다.
const signals: EggSignals = {
  violations: computed(() => checks.value.reduce((n, c) => n + (c.skipped ? 0 : c.failed.length), 0)),
  storeyViolations: computed(() => {
    const m = model.value
    if (!m) return new Map<string, number>()
    if (storeyChips.value.length) {
      return new Map(storeyChips.value.map((c) => [c.id, c.noSpace + c.failed]))
    }
    const v = checks.value.reduce((n, c) => n + (c.skipped ? 0 : c.failed.length), 0)
    return new Map(m.storeys.map((s) => [s.id, v]))
  }),
  accepted: computed(() => (grades.value ? grades.value.gate : null)),
  flying: computed(() => flying.value),
  replaying: computed(() => replayOpen.value),
  storeyId: computed(() => viewStorey.value),
  importing: computed(() => !!progress.value),
  importClasses: computed(() => importClasses.value),
}

/**
 * egg 들의 HUD 를 쌓는 기둥(3D 칸 왼쪽 아래). egg 는 제 HUD 의 자리를 정하지 않는다 — 여럿 켜면 한 자리에 겹쳤고, 아래 도구 막대
 * (BottomViewDock)에 깔려 sun 의 시각 막대를 끌 수 없었다. 기둥의 아래 끝을 도구 막대 위로 맞추고, 창 크기가 바뀌면 다시 잰다.
 */
function hudStack(): HTMLElement {
  const root = hudRoot()
  let stack = root.querySelector<HTMLElement>(':scope > .egg-hud-stack')
  if (!stack) {
    stack = document.createElement('div')
    stack.className = 'egg-hud-stack'
    stack.style.cssText = 'position:absolute;left:0.75rem;display:flex;flex-direction:column;align-items:flex-start;gap:0.4rem;max-width:calc(100% - 1.5rem)'
    root.append(stack)
    placeStack(stack)
  }
  return stack
}
function placeStack(stack: HTMLElement) {
  const wrap = stack.parentElement?.getBoundingClientRect()
  const dock = document.querySelector<HTMLElement>('.bottom-view-dock')?.getBoundingClientRect()
  const gap = 12
  const over = wrap && dock && dock.height > 0 && dock.bottom > wrap.top ? wrap.bottom - dock.top + 8 : 0
  stack.style.bottom = `${Math.max(gap, over)}px`
}
const onResize = () => {
  const stack = canvas.value?.parentElement?.querySelector<HTMLElement>(':scope > .egg-hud > .egg-hud-stack')
  if (stack) placeStack(stack)
}

/** 3D 칸을 덮는 HUD 상자. 처음 쓰는 egg 가 만들고 그 뒤로 남는다(비어 있으면 아무것도 안 보인다). */
function hudRoot(): HTMLElement {
  const wrap = canvas.value?.parentElement
  let root = wrap?.querySelector<HTMLElement>(':scope > .egg-hud') ?? null
  if (!root) {
    root = document.createElement('div')
    root.className = 'egg-hud'
    // 바탕 CSS 에 규칙을 더하지 않는다(기본 번들이 그대로여야 한다). 그래서 자리를 여기서 바로 준다.
    root.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:2;overflow:hidden'
    wrap?.append(root)
  }
  return root
}

function contextFor(id: string, run: Running): EggContext {
  // 파일을 열기 전에 켜지는 egg(early)는 3D 가 없을 수 있다. 3D 를 쓰는 것은 부를 때 뷰어를 찾고, 없으면 던진다.
  const view = () => {
    if (!viewer) throw new Error(`[egg] '${id}' 가 3D 가 없을 때 3D 를 썼습니다`)
    return viewer
  }
  let hud: HTMLElement | null = null
  let overlay: HTMLElement | null = null
  let wideByEgg = false
  return {
    model: () => model.value,
    modelVersion: () => version.value,
    addLayer(layer) {
      const off = view().addLayer(layer)
      run.cleanup.push(off)
      return off
    },
    get camera() {
      return view().eggCamera
    },
    lights(o) {
      const off = view().setLights(o)
      run.cleanup.push(off)
      return off
    },
    wide(on) {
      if (on && !fullscreen.value) {
        fullscreen.value = true
        if (!wideByEgg) run.cleanup.push(() => wideByEgg && (fullscreen.value = false))
        wideByEgg = true
      } else if (!on && wideByEgg) {
        fullscreen.value = false
        wideByEgg = false
      }
    },
    still,
    dark: () => dark.value,
    get hud() {
      if (!hud) {
        const el = document.createElement('div')
        el.dataset.testid = `egg-hud-${id}`
        const stack = hudStack()
        stack.append(el)
        placeStack(stack)
        run.cleanup.push(() => el.remove())
        hud = el
      }
      return hud
    },
    get overlay() {
      if (!overlay) {
        const el = document.createElement('div')
        el.dataset.testid = `egg-overlay-${id}`
        el.style.cssText = 'position:absolute;inset:0;pointer-events:none'
        hudRoot().append(el)
        run.cleanup.push(() => el.remove())
        overlay = el
      }
      return overlay
    },
    signals,
  }
}

/** 켠다. 켜졌으면(이미 켜져 있었어도) true. 3D 가 아직 없거나 리플레이 중이거나 egg 가 켜다 실패하면 false. */
export async function enableEgg(id: string): Promise<boolean> {
  const egg = EGGS.find((e) => e.id === id)
  if (!egg) {
    console.warn(`[egg] '${id}' 는 없습니다. __oe.eggs() 로 목록을 봅니다.`)
    return false
  }
  if (running.has(id)) return true
  if (loading.has(id) || replayOpen.value) return false
  if (!egg.early && (!viewer || !model.value)) return false
  loading.add(id)
  const run: Running = { handle: { off() {} }, cleanup: [] }
  try {
    const mod = await egg.load()
    if (!loading.has(id) || (!egg.early && !viewer) || replayOpen.value) return false
    run.handle = await mod.enable(contextFor(id, run))
    // enable 이 기다리는 사이 껐으면(loading 에서 빠졌으면) 켠 것을 바로 거둔다.
    if (!loading.has(id)) {
      run.handle.off()
      for (const off of run.cleanup.reverse()) off()
      return false
    }
  } catch (e) {
    console.error(`[egg] '${id}' 를 켜지 못했습니다`, e)
    for (const off of run.cleanup.reverse()) off()
    return false
  } finally {
    loading.delete(id)
  }
  running.set(id, run)
  eggsOn.value = [...running.keys()]
  // 켜는 사이(egg 의 enable 이 기다리는 동안) 리플레이가 열렸으면 바로 쉬게 한다.
  if (replayOpen.value) {
    disableEgg(id)
    resting.push(id)
    return false
  }
  return true
}

export function disableEgg(id: string) {
  loading.delete(id)
  const run = running.get(id)
  if (!run) return
  running.delete(id)
  try {
    run.handle.off()
  } catch (e) {
    console.error(`[egg] '${id}' 를 끄다 실패했습니다. 남은 층·빛·HUD 는 거둡니다`, e)
  }
  for (const off of run.cleanup.reverse()) off()
  eggsOn.value = [...running.keys()]
}

/** 켜져 있거나 켜는 중이면 끄고, 아니면 켠다. 켜졌으면 true. */
export function toggleEgg(id: string): Promise<boolean> {
  if (!running.has(id) && !loading.has(id)) return enableEgg(id)
  disableEgg(id)
  return Promise.resolve(false)
}

// --- `~` 판 ---
let hub: { update(): void; dispose(): void } | null = null
let hubOpening = false
async function openHub() {
  if (hub || hubOpening) return
  hubOpening = true
  try {
    const { createHub } = await import('../eggs/hub')
    hub = createHub(hudRoot(), { eggs: EGGS, isOn: (id) => running.has(id), toggle: (id) => void toggleEgg(id) })
  } finally {
    hubOpening = false
  }
}
function closeHub() {
  hub?.dispose()
  hub = null
}

const swallow = (e: KeyboardEvent) => {
  e.preventDefault()
  e.stopImmediatePropagation()
}
// 비행 중 Q·E 를 0.12초 안에 같이 누르면 방 이름 자막(title)을 켜고 끈다. 지금 둘을 같이 누르면 오르내림이 상쇄돼 아무 일도 없다.
// 키를 삼키지 않는다 — 비행은 그대로 둘을 받는다.
const CHORD_MS = 120
const chordDown = { KeyQ: -Infinity, KeyE: -Infinity }
function onChord(e: KeyboardEvent) {
  if (!flying.value || (e.code !== 'KeyQ' && e.code !== 'KeyE')) return
  const now = performance.now()
  chordDown[e.code] = now
  const other = chordDown[e.code === 'KeyQ' ? 'KeyE' : 'KeyQ']
  if (now - other <= CHORD_MS) {
    chordDown.KeyQ = chordDown.KeyE = -Infinity
    void toggleEgg('title')
  }
}

/** window 의 capture 단계에서 받는다. 판이 떠 있을 때의 Esc·숫자는 편집기 단축키(keyboard.ts)까지 가지 않는다. */
function onKey(e: KeyboardEvent) {
  if (e.isComposing || e.repeat || !model.value || replayOpen.value) return
  if (e.target instanceof Element && e.target.closest('dialog[open]')) return
  const plain = !(e.ctrlKey || e.metaKey || e.altKey)
  if (plain && !e.shiftKey && !isTextEntry(e.target)) onChord(e)
  // Shift+` 는 성능 표(`)의 조합에 맞지 않는다(shortcuts.ts — shift 를 적지 않은 조합은 Shift 가 붙으면 안 맞는다).
  if (e.code === 'Backquote' && e.shiftKey && plain && !isTextEntry(e.target)) {
    if (hub) closeHub()
    else void openHub()
    return swallow(e)
  }
  if (!hub) return
  if (e.code === 'Escape') {
    closeHub()
    return swallow(e)
  }
  const digit = /^Digit([1-9])$/.exec(e.code)
  if (digit && plain && !e.shiftKey && !isTextEntry(e.target)) {
    const egg = EGGS[Number(digit[1]) - 1]
    if (egg) void toggleEgg(egg.id)
    return swallow(e)
  }
}

/** 주소의 `?egg=a,b`(여러 번 적어도 된다). */
function eggsInUrl(): string[] {
  return new URLSearchParams(location.search)
    .getAll('egg')
    .flatMap((s) => s.split(','))
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * 콘솔·e2e 가 쓰는 손잡이. `window.__oe` 는 말로 편집(connections.ts 의 screen·plan·apply)과 같이 쓰는 자리라
 * 덮지 않고 이름을 더한다.
 */
function consoleApi() {
  return {
    /** 켜고 끈다. 켜졌으면 true. */
    egg: (id: string) => toggleEgg(id),
    eggOn: (id: string) => enableEgg(id),
    eggOff: (id: string) => disableEgg(id),
    /** 목록과 켠 것, 켠 egg 가 들여다보라고 내놓은 값. 콘솔에서는 표로도 찍는다. */
    eggs() {
      const list = EGGS.map((e, i) => ({ key: i < 9 ? String(i + 1) : '', id: e.id, title: e.title, on: running.has(e.id) }))
      if (import.meta.env.MODE !== 'e2e') console.table(list)
      return { list, on: [...running.keys()], inspect: Object.fromEntries([...running].map(([id, r]) => [id, r.handle.inspect?.()])) }
    },
    /** 내보내는 것의 문자열(e2e 만). egg 를 켜고 끈 뒤 같아야 한다(G3). */
    ...(import.meta.env.MODE === 'e2e'
      ? {
          exportSnapshot: () => {
            const m = model.value
            return m ? { ttl: modelToTTL(m), geojson: JSON.stringify(modelToGeoJSON(m)), model: JSON.stringify(m) } : null
          },
        }
      : {}),
  }
}

/** 화면이 붙을 때 한 번 — 이 모듈의 watch·이벤트. App.vue 가 부른다. */
export function setupEggs() {
  const api = consoleApi()
  Object.assign(oeHook(), api)
  window.addEventListener('keydown', onKey, { capture: true })
  window.addEventListener('resize', onResize)
  onBeforeUnmount(() => {
    window.removeEventListener('keydown', onKey, { capture: true })
    window.removeEventListener('resize', onResize)
    for (const id of [...running.keys()]) disableEgg(id)
    closeHub()
    const hook = oeHook()
    for (const k of Object.keys(api)) delete hook[k]
  })

  // egg 가 지어 둔 것을 버릴 때. 편집은 모델을 그 자리에서 고치고 triggerRef 로 알린다(shallowRef 라 watch 가 받는다).
  watch([model, sceneVersion], () => version.value++, { flush: 'sync' })
  // 콘솔 배너(B, G2 의 유일한 예외 — 기본으로 켜져 있다). 새 파일(모델 객체가 바뀜)을 열 때 한 번 찍는다. 편집은 같은 객체라 찍지 않는다.
  // e2e 의 콘솔을 어지럽히지 않게 그 모드에서는 내려받지도 않는다.
  if (import.meta.env.MODE !== 'e2e') {
    let printed: object | null = null
    watch(model, (m) => {
      if (!m || m === printed) return
      printed = m
      void import('../eggs/banner').then(({ printBanner }) => printBanner(m, fileName.value))
    })
  }
  // 파일을 닫으면 끈다. 3D 칸이 없는데 HUD·층이 남는다. 파일을 열기 전부터 켜지는 것(early)은 그대로 둔다.
  watch(model, (m) => {
    if (m) return
    for (const id of [...running.keys()]) if (!EGGS.find((e) => e.id === id)?.early) disableEgg(id)
    closeHub()
  })
  // 리플레이를 여는 그 자리에서(sync) 거둔다. 늦으면 리플레이가 연출을 시작하는 첫 장에 egg 의 빛·층이 섞인다.
  watch(
    replayOpen,
    (open) => {
      if (open) {
        resting = [...running.keys()]
        for (const id of resting) disableEgg(id)
        closeHub()
      } else {
        for (const id of resting) void enableEgg(id)
        resting = []
      }
    },
    { flush: 'sync' },
  )
  watch(eggsOn, () => hub?.update())
  // ticker 가 켜져 있을 때만 임포터가 클래스별 수를 센다(progress.ts). 기본 경로에 값을 더하지 않는다.
  watch(eggsOn, (on) => (wantClassCounts.value = on.includes('ticker')), { immediate: true })

  // 주소로 켠 것은 3D 가 처음 그려진 뒤에 켠다. 파일을 읽는 동안이 무대인 것(early)은 바로 켠다.
  const fromUrl = eggsInUrl()
  for (const id of fromUrl) if (EGGS.find((e) => e.id === id)?.early) void enableEgg(id)
  if (fromUrl.some((id) => !EGGS.find((e) => e.id === id)?.early)) {
    const stop = watch(sceneVersion, (n) => {
      if (n < 1 || !viewer) return
      stop()
      for (const id of fromUrl) if (!EGGS.find((e) => e.id === id)?.early) void enableEgg(id)
    })
  }
}
