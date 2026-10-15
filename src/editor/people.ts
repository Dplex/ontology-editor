import { computed, ref, watch } from 'vue'
import { mode } from './core'
import { keyNote } from './keyboard'

// --- 사람·역할 (OE-COM-01·02, server/users.ts) ---------------------------------------------------
// 로그인 대신 서버의 사람 목록(data/.users.json)에서 고른다. 고른 사람은 쓰기 요청(저장·반영·되돌리기·로그)에 머리로 붙는다. 보기 전용(Viewer)은
// 편집에 들어가지 못한다. 목록을 못 받으면(손으로 연 파일만 쓰는 곳, e2e 의 흉내 서버) 사람을 묻지 않고 예전처럼 돈다.
type Person = { name: string; role: 'viewer' | 'admin' | 'super_admin' }
export const PERSON_ROLE: Record<Person['role'], string> = { viewer: '보기 전용', admin: 'Admin', super_admin: 'Super Admin' }
export const people = ref<Person[] | null>(null)
export const currentUser = ref(
  (() => {
    try {
      return localStorage.getItem('oe.user') ?? ''
    } catch {
      return ''
    }
  })(),
)
export const me = computed(() => people.value?.find((p) => p.name === currentUser.value) ?? null)
/** 편집할 수 없는 이유. 사람 목록이 없으면 막지 않는다. */
export const editBlock = computed(() => {
  if (!people.value) return null
  if (!me.value) return '화면 위의 사용자 칸에서 사람을 먼저 고르세요'
  return me.value.role === 'viewer' ? `${me.value.name}은(는) 보기 전용(Viewer)이라 편집에 들어가지 않습니다` : null
})
/** 쓰기 요청에 붙이는 사람. */
export const asMe = (): Record<string, string> => (currentUser.value ? { 'X-OE-User': encodeURIComponent(currentUser.value) } : {})

/** 화면이 붙을 때 한 번 — 이 모듈의 watch·이벤트·타이머. App.vue 가 부른다. */
export function setupPeople() {
  watch(currentUser, (u) => {
    try {
      localStorage.setItem('oe.user', u)
    } catch {
      // 못 남겨도 이번 창에서는 그대로다
    }
  })
  fetch('./__data/__users')
    .then((r) => (r.ok ? r.json() : null))
    .then((list) => (people.value = Array.isArray(list) && list.length ? list : null))
    .catch(() => {})
  // 편집에 들어가는 길이 여럿이라(버튼·E 키·목록의 [놓기] 등) 모드가 바뀐 뒤에 막는다.
  watch([mode, editBlock], () => {
    if (mode.value === 'edit' && editBlock.value) {
      mode.value = 'view'
      window.setTimeout(() => (keyNote.value = editBlock.value ?? ''))
    }
  })
}
