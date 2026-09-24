// 단축키 표. 키를 받는 쪽(App.vue)과 `?` 로 뜨는 안내(ShortcutHelp.vue)가 이 표 하나를 읽는다 —
// 둘이 따로 적으면 안내에는 있는데 안 먹는 키, 먹는데 안내에 없는 키가 생긴다.
//
// 글자 키는 `code`(자판 위치)로 맞춘다. 한글 입력 상태에서는 `key` 가 'ㄹ' 처럼 와서, `key` 로 맞추면 한글 자판을
// 켜 둔 사람에게만 단축키가 조용히 안 먹는다.

export type ShortcutId =
  | 'help'
  | 'mode'
  | 'search'
  | 'escape'
  | 'frame'
  | 'frameAll'
  | 'rules'
  | 'walls'
  | 'undo'
  | 'redo'
  | 'save'
  | 'nudge'
  | 'storeyUp'
  | 'storeyDown'
  | 'arrowPrev'
  | 'arrowNext'
  | 'flow'
  | 'confirm'
  | 'kind'
  | 'nextUnknown'
  | 'prevUnknown'

/** 키 하나의 조합. `ctrl` 은 Ctrl 또는 ⌘ 다. `shift: 'any'` 는 Shift 를 눌렀든 말든 받는다(처리하는 쪽이 본다). */
type Combo = ({ code: string; key?: never } | { key: string; code?: never }) & { shift?: boolean | 'any'; ctrl?: boolean }

export type ShortcutGroup = '어디서나' | '3D 시점' | '편집 · 설비' | '편집 · 연결 방향' | '편집 · 종류'

export type Shortcut = {
  id: ShortcutId
  combos: Combo[]
  /** 안내에 보이는 키. 조합 하나가 한 칸이다. */
  keys: string[]
  label: string
  group: ShortcutGroup
  /** 편집 모드에서만 먹는다. 보기 모드에는 고치는 손잡이가 없다. */
  edit?: boolean
}

export const SHORTCUTS: readonly Shortcut[] = [
  // '?' 는 자판마다 자리가 달라 글자로도 받는다.
  { id: 'help', combos: [{ key: '?', shift: 'any' }, { code: 'Slash', shift: true }], keys: ['?'], label: '단축키 안내 열기·닫기', group: '어디서나' },
  { id: 'mode', combos: [{ code: 'KeyE' }], keys: ['E'], label: '보기 ↔ 편집', group: '어디서나' },
  { id: 'save', combos: [{ code: 'KeyS', ctrl: true }], keys: ['Ctrl+S'], label: '편집 저장(파일로 내려받기)', group: '어디서나' },
  { id: 'search', combos: [{ code: 'Slash' }], keys: ['/'], label: '이름으로 찾기 칸으로', group: '어디서나' },
  {
    id: 'escape',
    combos: [{ code: 'Escape' }],
    keys: ['Esc'],
    label: '끄는 중이면 취소, 아니면 고른 것 풀기',
    group: '어디서나',
  },
  { id: 'frame', combos: [{ code: 'KeyF' }], keys: ['F'], label: '고른 것(연결망·물리존·계통)에 시점 맞추기', group: '3D 시점' },
  { id: 'frameAll', combos: [{ code: 'KeyF', shift: true }, { code: 'Home' }], keys: ['Shift+F', 'Home'], label: '건물 전체 보기', group: '3D 시점' },
  { id: 'rules', combos: [{ code: 'KeyR' }], keys: ['R'], label: '규칙 방향 칠하기 켜기·끄기', group: '3D 시점' },
  { id: 'walls', combos: [{ code: 'KeyW' }], keys: ['W'], label: '내력벽 켜기·끄기', group: '3D 시점' },

  { id: 'undo', combos: [{ code: 'KeyZ', ctrl: true }], keys: ['Ctrl+Z'], label: '되돌리기', group: '편집 · 설비', edit: true },
  {
    id: 'redo',
    combos: [
      { code: 'KeyZ', ctrl: true, shift: true },
      { code: 'KeyY', ctrl: true },
    ],
    keys: ['Ctrl+Shift+Z', 'Ctrl+Y'],
    label: '다시 하기',
    group: '편집 · 설비',
    edit: true,
  },
  {
    id: 'nudge',
    combos: ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].map((code) => ({ code, shift: 'any' as const })),
    keys: ['← ↑ → ↓'],
    label: '고른 설비(물리존이면 짚은 꼭짓점)를 화면 방향으로 10cm 옮기기 (Shift 는 1m)',
    group: '편집 · 설비',
    edit: true,
  },
  { id: 'storeyUp', combos: [{ code: 'PageUp' }], keys: ['PageUp'], label: '고른 설비를 위층으로', group: '편집 · 설비', edit: true },
  { id: 'storeyDown', combos: [{ code: 'PageDown' }], keys: ['PageDown'], label: '고른 설비를 아래층으로', group: '편집 · 설비', edit: true },

  { id: 'arrowPrev', combos: [{ code: 'BracketLeft' }], keys: ['['], label: '이전 연결 (물리존이면 이전 꼭짓점)', group: '편집 · 연결 방향', edit: true },
  { id: 'arrowNext', combos: [{ code: 'BracketRight' }], keys: [']'], label: '다음 연결 (물리존이면 다음 꼭짓점)', group: '편집 · 연결 방향', edit: true },
  {
    id: 'flow',
    combos: [{ code: 'KeyD' }],
    keys: ['D'],
    label: '그 연결의 방향 바꾸기 (하류 → 상류 → 지움)',
    group: '편집 · 연결 방향',
    edit: true,
  },
  { id: 'confirm', combos: [{ code: 'KeyC' }], keys: ['C'], label: '고른 설비 계통의 규칙 방향 확정', group: '편집 · 연결 방향', edit: true },

  { id: 'kind', combos: [{ code: 'KeyK' }], keys: ['K'], label: '고른 설비의 종류 고르기 (같은 패밀리 전부)', group: '편집 · 종류', edit: true },
  { id: 'nextUnknown', combos: [{ code: 'KeyU' }], keys: ['U'], label: '종류를 모르는 다음 패밀리의 설비로', group: '편집 · 종류', edit: true },
  { id: 'prevUnknown', combos: [{ code: 'KeyU', shift: true }], keys: ['Shift+U'], label: '종류를 모르는 이전 패밀리의 설비로', group: '편집 · 종류', edit: true },
]

export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = ['어디서나', '3D 시점', '편집 · 설비', '편집 · 연결 방향', '편집 · 종류']

type KeyLike = Pick<KeyboardEvent, 'code' | 'key' | 'shiftKey' | 'ctrlKey' | 'metaKey' | 'altKey'>

function matches(combo: Combo, e: KeyLike): boolean {
  if (combo.code ? e.code !== combo.code : e.key !== combo.key) return false
  if ((combo.ctrl ?? false) !== (e.ctrlKey || e.metaKey)) return false
  return combo.shift === 'any' || (combo.shift ?? false) === e.shiftKey
}

/** 눌린 키에 맞는 단축키. Alt 가 섞이면 브라우저·OS 몫이라 받지 않는다. */
export function matchShortcut(e: KeyLike): Shortcut | null {
  if (e.altKey) return null
  return SHORTCUTS.find((s) => s.combos.some((c) => matches(c, e))) ?? null
}

/** 한 글자 키(수식 키 없이)인가. 선택 상자에 포커스가 있으면 그 글자는 목록 찾기라 단축키로 받지 않는다. */
export const isPlainKey = (e: KeyLike) => !(e.ctrlKey || e.metaKey)

/**
 * 화면 방향을 평면의 축 하나로. 3D 를 비스듬히 봐도 ←↑ 은 x·y 축을 따라 옮긴다 — 화면 방향 그대로 옮기면
 * 좌표가 45° 로 비껴 12.07 같은 값이 된다. 가장 가까운 축으로 맞춘다.
 */
export function snapAxis(x: number, y: number): [number, number] {
  if (Math.abs(x) < 1e-9 && Math.abs(y) < 1e-9) return [0, 0]
  return Math.abs(x) >= Math.abs(y) ? [Math.sign(x), 0] : [0, Math.sign(y)]
}
