// --- 지금 보는 것을 주소 하나로 넘기기 (OE-UI-01 의 `?open=`·`?project=` 에 `select` 를 더한 것) ---
// 이슈 코멘트·메신저에 "성수 4F 의 이 FCU" 를 GlobalId 와 층 이름으로 적으면 받는 사람이 같은 파일을 열고 층을 바꾸고 찾아야 했다.
// 링크 하나로 같은 파일·같은 층·같은 고른 것이 열린다. Azure Digital Twins Explorer 의 "환경과 쿼리를 링크로 공유" 에서 가져왔다(reference.md).
// data/ 목록이나 프로젝트로 연 파일만 주소로 열 수 있다 — 손으로 고른 파일은 서버에 없다. 화면 상태만 담고 편집은 담지 않는다
// (편집은 서버에 저장한 편집이 파일을 열 때 같이 얹힌다).
import { computed, nextTick } from 'vue'
import { model } from './core'
import { compareSelected, selectFromCompare } from './export-compare'
import { equipmentById } from './flow-rules'
import { selectedSystemId } from './kinds'
import { note } from './keyboard'
import { viewStorey } from './multi-view'
import { openedProject, openedSources } from './projects'
import { select } from './systems'
import { multiView } from './vertical'

/** 지금 화면을 다시 여는 주소의 검색 부분. 주소로 열 수 없는 파일이면 null. */
export const shareQuery = computed((): URLSearchParams | null => {
  if (!model.value) return null
  const q = new URLSearchParams()
  const sources = openedSources.value
  const p = openedProject.value
  if (p && p.paths.join('|') === sources.join('|')) q.set('project', p.id)
  else if (sources.length && sources.every((x) => x)) q.set('open', sources.join('|'))
  else return null
  if (viewStorey.value && !multiView.value) q.set('storey', viewStorey.value)
  const id = compareSelected.value ?? selectedSystemId.value
  if (id) q.set('select', id)
  return q
})

export const shareUrl = computed(() => (shareQuery.value ? `${location.origin}${location.pathname}?${shareQuery.value}` : null))

/**
 * 글을 클립보드에 넣는다. 55 처럼 https 도 localhost 도 아닌 주소는 Clipboard API 를 주지 않아서(`isSecureContext` 가 거짓)
 * 숨긴 textarea 를 골라 `execCommand('copy')` 로 넣는다. 오래된 길이지만 크롬·엣지는 아직 그 자리에서 복사한다.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // 아래 길로 간다.
  }
  const area = document.createElement('textarea')
  area.value = text
  area.setAttribute('readonly', '')
  area.style.position = 'fixed'
  area.style.opacity = '0'
  document.body.appendChild(area)
  area.select()
  try {
    return document.execCommand('copy')
  } catch {
    return false
  } finally {
    area.remove()
  }
}

export async function copyShareLink() {
  const url = shareUrl.value
  if (!url) return
  const what = shareQuery.value?.get('select') ? '고른 것까지' : shareQuery.value?.get('storey') ? '이 층까지' : '이 파일을'
  note((await copyText(url)) ? `${what} 여는 링크를 복사했습니다` : `복사하지 못했습니다(브라우저가 막음): ${url}`)
}

/** 주소의 `select` 를 고른다. 설비·물리존·벽·문·창·존·오브젝트·계통·층. 없는 id 면 알린다. */
export function selectFromLink(id: string) {
  const m = model.value
  if (!m) return
  if (m.systems.some((s) => s.id === id)) {
    select(null)
    selectedSystemId.value = id
    return
  }
  if (m.storeys.some((s) => s.id === id)) {
    if (!multiView.value) viewStorey.value = id
    return
  }
  const known =
    equipmentById.value.has(id) ||
    m.storeys.some(
      (s) =>
        s.spaces.some((x) => x.id === id) ||
        s.walls.some((x) => x.id === id) ||
        s.openings.some((x) => x.id === id) ||
        (s.customZones ?? []).some((x) => x.id === id) ||
        (s.rooms ?? []).some((x) => x.id === id) ||
        (s.spaceObjects ?? []).some((x) => x.id === id),
    )
  if (!known) {
    note(`링크의 ${id} 가 이 파일에 없습니다(다른 버전의 BIM 일 수 있습니다)`)
    return
  }
  // 층을 주지 않은 링크로 층 하나만 보는 중이면, 고른 것이 다른 층에서 안 보이지 않게 그 층으로 간다.
  const home = m.storeys.find(
    (s) => s.equipment.some((x) => x.id === id) || s.spaces.some((x) => x.id === id) || s.walls.some((x) => x.id === id) || s.openings.some((x) => x.id === id),
  )
  if (home && viewStorey.value && viewStorey.value !== home.id && !multiView.value) viewStorey.value = home.id
  const kind = m.storeys.some((s) => (s.spaceObjects ?? []).some((x) => x.id === id)) ? 'spaceObject' : m.storeys.some((s) => (s.customZones ?? []).some((x) => x.id === id)) ? 'customZone' : ''
  nextTick(() => selectFromCompare(id, kind))
}
