import { computed, ref, shallowRef, triggerRef, watch } from 'vue'
import type { Mesh3dReply, Mesh3dRequest } from '../lib/export/mesh3d.worker'
import { storeyFiles } from '../lib/export/storey-export'
import { escapeLocalName, modelToTTL } from '../lib/export/ttl'
import { clearStoreyDone, markStoreyDone, storeyProgress, type StoreyProgress } from '../lib/storey-progress'
import { filterActive, NO_SYSTEM } from '../lib/view-filter'
import { autosaveArmed, progressVersion, setAutosaveArmed } from './autosave'
import { ceilingMode, editPart } from './ceiling'
import { mb } from './chat-view'
import { oeHook } from './connections'
import { activeTab } from './context-menu'
import { editing, fileName, model } from './core'
import { selectedId } from './flow-rules'
import { zoneVertexEdit } from './grid-snap'
import { note } from './keyboard'
import { selectedSystemId } from './kinds'
import { viewStorey } from './multi-view'
import { meshes, pristine } from './open-file'
import { download, markDone } from './open-many'
import { currentUser } from './people'
import { beginProgress, endProgress, paint, progress } from './progress'
import { selectedRoomId, selectedSpaceId } from './rooms'
import { selectedCustomZoneId } from './space-edit'
import { multiView } from './vertical'
import { viewFilter } from './view-filter'

// --- 층 단위 진행 (OE-MAN-06) -------------------------------------------------------------
//
// 층마다 완료를 표시하고 몇 층이 끝났는지 보인다(ADR-0011). 완료는 그때 층의 지문과 지금 지문을 견줘 정한다(storey-progress.ts) —
// 완료한 층을 고치면 "완료 뒤 고침" 으로 저절로 풀리고, Ctrl+Z 로 그 층이 완료한 때와 같아지면 다시 완료다. 표시는 편집 파일에
// 남는다(되돌리기 이력에는 들지 않는다 — 고친 것이 아니라 진행 표시다).
// 완료한 층의 지문을 재는 값이 병원 건축+HVAC 네 층에 45ms 다. 편집(방향키 한 번)마다 바로 재면 편집이 그만큼 느려진다.
// 편집이 멈춘 뒤 한 번 잰다. 완료를 누르거나 지울 때는 바로 잰다.
export const storeyProgressRows = shallowRef<StoreyProgress[]>([])
let progressTimer: number | undefined
function refreshProgress() {
  window.clearTimeout(progressTimer)
  storeyProgressRows.value = model.value ? storeyProgress(model.value) : []
}
export const progressById = computed(() => new Map(storeyProgressRows.value.map((p) => [p.id, p])))
export const storeysDoneCount = computed(() => storeyProgressRows.value.filter((p) => p.state === 'done').length)
export function setStoreyDone(storeyId: string, on: boolean) {
  const m = model.value
  if (!m) return
  const name = m.storeys.find((s) => s.id === storeyId)?.name ?? ''
  if (!(on ? markStoreyDone(m, storeyId) : clearStoreyDone(m, storeyId))) return
  progressVersion.value++
  setAutosaveArmed(true)
  refreshProgress()
  triggerRef(model)
  note(on ? `${name} 층을 완료로 표시했습니다(${storeysDoneCount.value}/${m.storeys.length}층).` : `${name} 층의 완료 표시를 지웠습니다.`)
}
export const doneTime = (at?: string) => (at ? new Date(at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '')

/**
 * 층 하나만 구축한다(OE-GEN-11). 그 층의 TTL·GeoJSON 한 쌍을 받는다(storey-export.ts). 층 파일을 다 모으면 건물 전체와 같은
 * 트리플이다(ADR-0011). 건물 전체 [구축하기] 와 달리 저장으로 치지 않는다 — 다른 층의 편집은 아직 안 나갔다.
 */
export async function buildStorey(storeyId: string) {
  const m = model.value
  const files = m ? storeyFiles(m, storeyId) : null
  if (!m || !files) return
  download(files.ttlName, files.ttl, 'text/turtle')
  // 잇달아 받으면 크롬이 둘째를 막을 수 있다(exportGeoJSON 주석). 틈을 둔다.
  await new Promise((r) => window.setTimeout(r, 250))
  download(files.geojsonName, files.geojson, 'application/geo+json')
  const name = m.storeys.find((s) => s.id === storeyId)?.name ?? ''
  note(`${name} 층을 구축했습니다: ${files.ttlName} · ${files.geojsonName}. 다른 층을 가리키는 줄은 id 로 남습니다.`)
  markDone(`build:${storeyId}`)
}

/**
 * [온톨로지] 칸이 질문과 같이 보내는 지금 화면(ADR-0050 "보는 화면"). "이 층·이거·여기" 를 알아듣게 한다. **id 와 정해진 값만** 담는다 — 이름·
 * 메모처럼 사람이 친 글은 안 넣는다(서버가 질문 앞에 붙이니 그 칸이 지시문 통로가 된다). id 는 TTL 의 지역 이름(`ex:` 뒤)과 같게 이스케이프한다.
 * 서버(scripts/onto-view.mjs)가 고른 출처 TTL 에 있는 id 만 남기고 나머지는 버린다.
 */
function viewForChat() {
  if (!model.value) return null
  const id = (x: string | null | undefined) => (x ? escapeLocalName(x) : null)
  const f = viewFilter.value
  return {
    mode: activeTab.value,
    editing: editing.value,
    part: editing.value ? (ceilingMode.value ? 'ceiling' : editPart.value) : null,
    storey: id(viewStorey.value),
    range: multiView.value ? { from: escapeLocalName(multiView.value.from), to: escapeLocalName(multiView.value.to) } : null,
    selected: [selectedId.value, selectedSpaceId.value, selectedRoomId.value, selectedSystemId.value].filter((x): x is string => !!x).map(escapeLocalName),
    zone: id(selectedCustomZoneId.value),
    hvacZone: id(zoneVertexEdit.value),
    filter: filterActive(f)
      ? {
          // 서버가 받는 개수만큼 자른다(onto-view.mjs). 격리·층이 수백 개면 본문 상한(64KB)에 걸린다.
          storeys: f.storeys?.slice(0, 60).map(escapeLocalName) ?? null,
          classes: f.classes?.slice(0, 30) ?? null,
          systems: f.systems?.filter((s) => s !== NO_SYSTEM).slice(0, 30).map(escapeLocalName) ?? null,
          isolate: f.isolate?.slice(0, 30).map(escapeLocalName) ?? null,
          hidden: f.hidden.length,
        }
      : null,
  }
}

export function exportTTL() {
  if (!model.value) return
  download('ontology.ttl', modelToTTL(model.value), 'text/turtle')
}
export function exportTTLDone() {
  exportTTL()
  markDone('ttl')
}

/**
 * 3D 형상(GLB·OBJ·FBX). 보여 주기용 파일이라 GeoJSON·TTL 과 따로 낸다. 큰 파일은 몇 초(성수 OBJ 16초) 걸려 누르는 동안
 * 버튼을 막고, 여는 때와 같은 진행 막대에 단계를 보인다. OBJ 는 꼭짓점 수로 막대가 차고, GLB 는 흐르기만 한다.
 * FBX 는 GLB 를 만들어 서버에 보내면 서버의 Blender 가 바꿔 돌려준다(src/server/fbx.ts). 성수는 서버에서 46초다.
 */
export const exporting3d = ref<'glb' | 'obj' | 'fbx' | null>(null)
/** 서버가 FBX 로 바꿀 수 있는지. 서버에 Blender 가 없거나 서버 없이 띄운 화면이면 단추를 막고 까닭을 title 로 보인다. */
export const fbxServer = ref<{ enabled: boolean; reason?: string }>({ enabled: false, reason: 'FBX 변환 서버를 확인하는 중입니다' })
/**
 * 3D 형상을 워커에서 만든다(lib/export/mesh3d.worker.ts). 화면 스레드로 만들면 성수에서 3~4초씩 멈췄다. 한 번 쓰고 닫는다 — 워커가 든
 * 장면(수백 MB)이 남지 않게. 진행 막대는 부르는 쪽이 연다.
 */
export async function makeMesh3D(format: 'glb' | 'obj', moreSteps = 0): Promise<ArrayBuffer[]> {
  const worker = new Worker(new URL('../lib/export/mesh3d.worker.ts', import.meta.url), { type: 'module' })
  try {
    return await new Promise<ArrayBuffer[]>((resolve, reject) => {
      worker.onmessage = (e: MessageEvent<Mesh3dReply>) => {
        const d = e.data
        if (d.type === 'progress') progress.value = { label: d.stage, step: d.step, steps: d.steps + moreSteps, done: d.done, total: d.total, unit: 'items' }
        else if (d.type === 'done') resolve(d.parts)
        else reject(new Error(d.message))
      }
      worker.onerror = (e) => reject(new Error(e.message || '워커가 멈췄습니다'))
      const request: Mesh3dRequest = { format, model: model.value!, pristine, meshes: [...meshes] }
      worker.postMessage(request)
    })
  } finally {
    worker.terminate()
  }
}
/** GLB 를 서버에 보내 FBX 로 받는다. 실패하면 서버가 준 까닭을 그대로 올린다. */
async function glbToFBX(glb: ArrayBuffer[]): Promise<ArrayBuffer> {
  progress.value = { label: 'FBX 로 바꾸는 중(서버의 Blender)', step: 3, steps: 3 }
  const r = await fetch('./__data/__fbx', { method: 'POST', body: new Blob(glb, { type: 'model/gltf-binary' }) })
  if (!r.ok) throw new Error(((await r.json().catch(() => null)) as { error?: string } | null)?.error ?? `서버가 ${r.status} 을 줬습니다`)
  return r.arrayBuffer()
}
export async function export3D(format: 'glb' | 'obj' | 'fbx') {
  if (!model.value || exporting3d.value || progress.value) return
  if (format === 'fbx' && !fbxServer.value.enabled) return
  exporting3d.value = format
  beginProgress('형상 넘기는 중')
  // 형상을 워커로 복사하는 동안 화면이 잠깐 멈춘다. 막대가 먼저 보이게 한 번 그린다.
  await paint()
  // 합쳐 연 파일은 이름이 "건축.ifc + 기계.ifc" 다. 확장자를 떼고 + 로 잇는다.
  const stem = fileName.value.split(' + ').map((n) => n.replace(/\.[^.]+$/, '')).join('+') || 'model'
  try {
    const parts = format === 'fbx' ? [await glbToFBX(await makeMesh3D('glb', 1))] : await makeMesh3D(format)
    const name = `${stem}.${format}`
    download(name, parts, format === 'glb' ? 'model/gltf-binary' : format === 'obj' ? 'model/obj' : 'application/octet-stream')
    // 막대가 닫히면 끝났는지 알 길이 브라우저 받기 표시뿐이다. 이름과 크기를 남긴다(성수 OBJ 는 683MB 다).
    note(`${name} (${mb(parts.reduce((s, p) => s + p.byteLength, 0))}) 내려받기를 시작했습니다`)
    markDone(format)
  } catch (e) {
    note(`3D 내보내기에 실패했습니다: ${(e as Error).message}`)
  } finally {
    exporting3d.value = null
    endProgress()
  }
}

/** 화면이 붙을 때 한 번 — 이 모듈의 watch·이벤트·타이머. App.vue 가 부른다. */
export function setupStoreyProgress() {
  watch(
    model,
    () => {
      window.clearTimeout(progressTimer)
      progressTimer = window.setTimeout(refreshProgress, 200)
    },
    { immediate: true },
  )
  // 완료한 층을 고치면 알린다. 표에서도 보이지만 표는 접혀 있을 수 있다.
  watch(storeyProgressRows, (now, before) => {
    const was = new Map((before ?? []).map((p) => [p.id, p.state]))
    const reopened = now.filter((p) => p.state === 'changed' && was.get(p.id) === 'done')
    if (reopened.length) note(`${reopened.map((p) => p.name).join(', ')} 층을 완료한 뒤 고쳤습니다 — 완료가 풀렸습니다. 다시 구축하고 완료를 표시하세요.`)
  })
  /**
   * [온톨로지] 칸(scripts/docs-chat.js)이 "지금 화면(반영 전)" 으로 물을 때 부른다(ADR-0050). [TTL] 내려받기와 같은 글이다 — 반영하면
   * 나갈 온톨로지를 반영 전에 묻는다. 창은 Vue 밖(빌드에 끼워 넣는 스크립트)이라 window 로 건넨다. 모델이 없으면 null.
   */
  Object.assign(oeHook(), {
    screen: () => (model.value ? { title: fileName.value, by: currentUser.value ?? '', ttl: modelToTTL(model.value) } : null),
    view: viewForChat,
  })
  fetch('./__data/__fbx')
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then((p: { enabled?: boolean; reason?: string }) => (fbxServer.value = { enabled: p.enabled === true, reason: p.reason }))
    .catch(() => (fbxServer.value = { enabled: false, reason: 'FBX 는 서버의 Blender 가 변환합니다. 이 화면에서는 서버에 연결되지 않습니다' }))
}
