import { computed, nextTick, ref, shallowRef, watch } from 'vue'
import { countOf, type Model } from '../lib/model'
import { viewer } from './scene'

// 테마는 라이트가 기본이고, 고른 값만 저장한다. 선행 스크립트(index.html)가 첫 페인트
// 전에 같은 값을 읽어 깜빡임을 막는다.
export const dark = ref(document.documentElement.getAttribute('data-theme') === 'dark')

export function toggleTheme() {
  dark.value = !dark.value
  viewer?.setDark(dark.value)
  const root = document.documentElement
  if (dark.value) root.setAttribute('data-theme', 'dark')
  else root.removeAttribute('data-theme')
  try {
    localStorage.setItem('oe-theme', dark.value ? 'dark' : 'light')
  } catch {
    // 저장을 못 해도 이번 세션 동안은 바뀐 채로 쓴다.
  }
}

export const fileName = ref('')
export const busy = ref(false)
export const error = ref('')
/**
 * 오류 문구는 목록 아래에 뜬다. data/ 목록 가운데서 [열기] 를 누른 사람에게는 화면 밖이라, 열 수 없는 파일을 눌러도
 * 아무 일이 없는 것처럼 보였다. 뜨면 보이는 자리까지 끌어온다.
 */
export const errorEl = ref<HTMLElement | null>(null)
export const dragging = ref(false)
export const model = shallowRef<Model | null>(null)

export const canvas = ref<HTMLCanvasElement | null>(null)

export const counts = computed(() => (model.value ? countOf(model.value) : null))
/** 임포트 때 읽지 않기로 한 피처(벽·문·창). 숫자 칸이 0 대신 "읽지 않음" 을 보인다. */
export const skipped = computed(() => new Set(model.value?.skipped ?? []))
/** 문이 잇는 방(방-문-방 그래프). GeoJSON 문 feature 의 connects 로 나간다. */
export const doorLinks = computed(() => {
  const doors = (model.value?.storeys ?? []).flatMap((s) => s.openings).filter((o) => o.kind === 'door' && o.connects)
  return {
    total: doors.length,
    two: doors.filter((d) => d.connects!.length >= 2).length,
    bim: doors.some((d) => d.connectsSource === 'bim'),
    calc: doors.some((d) => d.connectsSource === 'calc'),
  }
})

// --- 보기 / 편집 ---------------------------------------------------------------
//
// 온톨로지를 둘러보는 사람과 고치는 사람이 보는 화면을 나눈다. 보기는 3D 와 연결을 넓게 보이고 고치는 손잡이를
// 전부 숨긴다. 편집은 고칠 수 있는 것(물리존 이름·경계, 설비 위치, 흐름 방향 확정·지정)을 드러내고, 바뀐 것의
// 수와 내보내기를 화면 위에 붙여 둔다. 편집한 것은 모드를 바꿔도 남는다(보기로 돌아가도 리포트는 그대로다).
// 고른 모드는 이 브라우저에만 기억한다.
type Mode = 'view' | 'edit'
export const mode = ref<Mode>(
  (() => {
    try {
      return localStorage.getItem('oe-mode') === 'edit' ? 'edit' : 'view'
    } catch {
      return 'view'
    }
  })(),
)
export const editing = computed(() => mode.value === 'edit')

/** 화면이 붙을 때 한 번 — 이 모듈의 watch·이벤트·타이머. App.vue 가 부른다. */
export function setupCore() {
  watch(error, async (e) => {
    if (!e) return
    await nextTick()
    errorEl.value?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  })
  watch(mode, (m) => {
    try {
      localStorage.setItem('oe-mode', m)
    } catch {
      // 못 써도 이번 창에서는 그대로 돈다.
    }
  })
}
