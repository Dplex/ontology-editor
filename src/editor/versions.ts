import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { ratioLabel } from '../lib/unit-check'
import { compareVersions, MATCH_KEY_BY, MATCH_KEY_LABEL, type MatchKey, type VersionDiff } from '../lib/versions'
import { dirtyKeys, progressVersion } from './autosave'
import { changeCount } from './changes'
import { stage } from './chat-view'
import { busy, fileName, model } from './core'
import { spaceNameOf } from './edit-report'
import { selectedId } from './flow-rules'
import { history } from './history'
import { selectedSystemId } from './kinds'
import { viewStorey } from './multi-view'
import { beginProgress, editFileNote, endProgress, importInWorker } from './progress'
import { selectedSpaceId } from './rooms'
import { viewer } from './scene'
import { multiView } from './vertical'

// --- 판본 비교 (PRD #6, 요구사항 R13) ----------------------------------------------------
//
// 이전 판본 IFC 를 열어 지금 모델과 짝짓는다(lib/versions.ts). 새로 생긴 것·없어진 것·옮겨진 것·소속이 바뀐 것을
// 보이고, 두 판본에 다 있는 것 중 GUID 가 그대로인 비율이 요구사항 R13 의 실측이 된다. 이전 판본은 짝짓기에만
// 쓰고 버린다 — 화면·내보내기는 지금 모델 그대로다.
export const versionDiff = shallowRef<{ name: string; diff: VersionDiff } | null>(null)
export const versionBusy = ref(false)
export const versionError = ref('')
export const versionView = ref('equipment-moved')

export async function onVersionPick(event: Event) {
  const input = event.target as HTMLInputElement
  const picked = input.files?.[0]
  input.value = ''
  const m = model.value
  if (!picked || !m) return
  // 워커는 하나라 열기·덧붙이기와 겹치면 안 된다(onmessage 를 서로 덮는다). busy 로 막고 진행 표시도 같이 쓴다.
  versionBusy.value = true
  busy.value = true
  versionError.value = ''
  beginProgress('이전 버전 여는 중')
  try {
    const { model: prev } = await importInWorker(await picked.arrayBuffer())
    const diff = compareVersions(prev, m)
    versionDiff.value = { name: picked.name, diff }
    // 처음 보일 목록은 비어 있지 않은 것 중 앞의 것.
    versionView.value = versionLists.value.find((l) => l.rows.length)?.key ?? 'equipment-moved'
  } catch (e) {
    versionError.value = `열지 못했습니다(${picked.name}): ${e instanceof Error ? e.message : String(e)}`
  } finally {
    versionBusy.value = false
    busy.value = false
    endProgress()
  }
}

/** R13 실측: 두 판본에 다 있는 것 중 GUID 가 그대로인 것과, 바뀌어 다른 열쇠로 찾은 것. */
export const versionStat = computed(() => {
  const v = versionDiff.value
  if (!v) return null
  const sum = (by: Record<MatchKey, number>) => ({ kept: by.guid, rematched: by.revitId + by.name + by.position })
  const a = sum(v.diff.spaces.by)
  const b = sum(v.diff.equipment.by)
  return { name: v.name, kept: a.kept + b.kept, rematched: a.rematched + b.rematched, storeyScale: v.diff.storeyScale }
})

type VersionRow = { id: string; name: string; detail: string; target: 'equipment' | 'space' | null }
export const versionLists = computed((): { key: string; label: string; rows: VersionRow[] }[] => {
  const d = versionDiff.value?.diff
  if (!d) return []
  const eq = (r: { id: string; name: string }, detail = ''): VersionRow => ({ ...r, detail, target: 'equipment' })
  const sp = (r: { id: string; name: string }, detail = ''): VersionRow => ({ ...r, detail, target: 'space' })
  const gone = (r: { id: string; name: string }): VersionRow => ({ ...r, detail: '', target: null })
  const spaceName = (id: string) => spaceNameOf(id)
  // GUID 가 바뀐 것(R13 판정 근거). 지금 판본에서 고르고, 이전 GUID 와 무엇으로 찾았는지를 같이 보인다.
  const rekeyed = (r: VersionDiff['spaces']['rekeyed'][number], target: 'equipment' | 'space'): VersionRow => ({
    id: r.id,
    name: r.name,
    detail: `${MATCH_KEY_BY[r.by]} 찾음 · 이전 GUID ${r.prevId}`,
    target,
  })
  return [
    { key: 'rekeyed', label: 'GUID가 바뀐 것', rows: [...d.spaces.rekeyed.map((r) => rekeyed(r, 'space')), ...d.equipment.rekeyed.map((r) => rekeyed(r, 'equipment'))] },
    { key: 'equipment-moved', label: '옮겨진 설비', rows: d.equipment.moved.map((r) => eq(r, `${r.distance.toFixed(2)} m`)) },
    {
      key: 'equipment-relocated',
      label: '소속이 바뀐 설비',
      rows: d.equipment.relocated.map((r) => eq(r, `${r.from ?? '(소속 없음)'} → ${r.to ?? '(소속 없음)'}`)),
    },
    { key: 'equipment-added', label: '새 설비', rows: d.equipment.added.map((r) => eq(r)) },
    { key: 'equipment-removed', label: '없어진 설비', rows: d.equipment.removed.map(gone) },
    { key: 'spaces-renamed', label: '이름이 바뀐 물리존', rows: d.spaces.renamed.map((r) => sp({ id: r.id, name: spaceName(r.id) }, `${r.from || '(없음)'} → ${r.to || '(없음)'}`)) },
    {
      key: 'spaces-reshaped',
      label: '넓이가 바뀐 물리존',
      rows: d.spaces.reshaped.map((r) => sp(r, `${r.from.toFixed(1)} → ${r.to.toFixed(1)} ㎡`)),
    },
    { key: 'spaces-added', label: '새 물리존', rows: d.spaces.added.map((r) => sp(r)) },
    { key: 'spaces-removed', label: '없어진 물리존', rows: d.spaces.removed.map(gone) },
    // 후보가 여럿이라 짝짓지 않은 것(OE-BIM-19). 없어진 것·새것과 따로 둔다 — 어느 것과 같은지 모르는 것이다.
    {
      key: 'ambiguous',
      label: '짝 후보가 여럿',
      rows: [
        ...d.spaces.ambiguous.map((r) => (r.side === 'next' ? sp(r, ambiguousDetail(r)) : { ...gone(r), detail: ambiguousDetail(r) })),
        ...d.equipment.ambiguous.map((r) => (r.side === 'next' ? eq(r, ambiguousDetail(r)) : { ...gone(r), detail: ambiguousDetail(r) })),
      ],
    },
  ]
})
export const versionRows = computed(() => versionLists.value.find((l) => l.key === versionView.value)?.rows ?? [])
const ambiguousDetail = (r: VersionDiff['spaces']['ambiguous'][number]) =>
  `${r.side === 'prev' ? '이전 판본' : '지금 판본'} · ${r.keys.map((k) => MATCH_KEY_LABEL[k]).join('·')}에 후보가 여럿이라 짝짓지 않음`
/** 비교 전에 맞춘 것(OE-BIM-19 정규화). 단위 배수와 원점 이동은 맞춘 경우에만, 이름 정규화는 늘 한다. */
export const versionNormalized = computed(() => {
  const n = versionDiff.value?.diff.normalized
  if (!n) return ''
  return [
    n.scale ? `이전 판본 길이를 ${ratioLabel(n.scale)}로(단위 선언이 실제와 달라 맞춤)` : '',
    n.offset ? `이전 판본 원점 (${n.offset.map((x) => x.toFixed(2)).join(', ')}) m 옮겨 맞춤` : '',
    '이름은 공백·유니코드 조합을 맞춰 견줌',
  ].filter(Boolean).join(' · ')
})

/** 비교·규칙 경고 목록에서 물리존을 고른다. 3D 에서 바닥을 누른 것과 같다(편집 모드가 아니어도 그 방에 맞춘다). */
export function showSpace(id: string) {
  const home = model.value?.storeys.find((s) => s.spaces.some((x) => x.id === id))
  if (home && viewStorey.value && !multiView.value) viewStorey.value = home.id
  selectedId.value = null
  selectedSystemId.value = null
  selectedSpaceId.value = id
  viewer?.frameSpace(id)
  const el = stage.value
  if (el && el.getBoundingClientRect().top > window.innerHeight * 0.5) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

// --- 편집을 잃지 않게 ----------------------------------------------------------------
//
// 편집은 탭 안에만 있다(내보낸 파일에만 남는다). 새로 고침·탭 닫기·다른 파일 열기가 편집을 조용히 버리면, 한 시간
// 고친 것이 경고 없이 사라진다. 편집이 남아 있으면 먼저 묻는다.
export const hasEdits = computed(() => changeCount.value > 0 || history.value.length > 0 || progressVersion.value > 0)
function onBeforeUnload(e: BeforeUnloadEvent) {
  // 임시 저장·편집 저장·구축하기 뒤로 바뀐 것이 없으면 묻지 않는다(OE-COM-08). 남길 것이 이미 남아 있다.
  if (!hasEdits.value || !dirtyKeys().length) return
  e.preventDefault()
  // 옛 브라우저는 returnValue 가 있어야 묻는다. 문구는 브라우저가 정한 것으로 바뀐다.
  e.returnValue = ''
}

/** 화면이 붙을 때 한 번 — 이 모듈의 watch·이벤트·타이머. App.vue 가 부른다. */
export function setupVersions() {
  watch(fileName, () => {
    versionDiff.value = null
    versionError.value = ''
  })
  watch(fileName, () => (editFileNote.value = ''))
  window.addEventListener('beforeunload', onBeforeUnload)
  onBeforeUnmount(() => window.removeEventListener('beforeunload', onBeforeUnload))
}
