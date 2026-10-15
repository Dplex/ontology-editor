import { computed, nextTick, shallowRef, watch } from 'vue'
import { duplicateOf, duplicateText, type LoadedPart, partOf } from '../lib/append-guard'
import { baselineOf, type SegmentAxis } from '../lib/edit'
import { exportEdits } from '../lib/edit-file'
import { inferFlowByRules } from '../lib/flow-rules'
import { gradeCounts, type GradeCounts } from '../lib/grade'
import { attachIdf, type IdfAttachReport, modelFromIdf } from '../lib/idf/attach'
import type { IdfPlacement } from '../lib/idf/place'
import { type IdfModel, readIdf } from '../lib/idf/read'
import type { MeshMap } from '../lib/ifc/import'
import { josa } from '../lib/josa'
import { assignEquipmentToSpaces, assignSnapNow, SNAP } from '../lib/mapping'
import { mergeModels, type MergeReport } from '../lib/merge'
import { isConduit, type Model, type Vec3 } from '../lib/model'
import { type Profile, profileOf } from '../lib/profile'
import { replayOpen } from '../lib/replay-player'
import { type RequirementRow, requirementsReport } from '../lib/requirements'
import { baseline, changeCount } from './changes'
import { openedDataPath, partnerOf } from './chat-view'
import { busy, counts, error, fileName, model } from './core'
import { changes } from './edit-report'
import { positionDrafts } from './equipment-shape'
import { confirmations, flowVersion, ruleReport, selectedId } from './flow-rules'
import { future, history } from './history'
import { idfReport, isIdf, selectedZoneId, showZones } from './idf-zones'
import { note } from './keyboard'
import { selectedSystemId } from './kinds'
import { loadingPath } from './layout-storeys'
import { areaChanges, editNotice, storeyMoved } from './multi-select'
import { openMany, sourcesOf } from './open-many'
import { applyEditFile, beginProgress, endProgress, importInWorker, paint, progress } from './progress'
import { openedProject, openedSources, projectLoading, setProjectLoading } from './projects'
import { shiftMesh } from './redraw'
import { selectedSpaceId } from './rooms'
import { hasEdits, versionStat } from './versions'

// 설비 형상. **모델과 따로 들고 다닌다** — 모델은 내보내기가 그대로 읽는 것이라 여기에
// 삼각형이 섞이면 TTL 로 기하가 새는 길이 생긴다. 반응형으로 감쌀 이유도 없다(화면이
// 값을 읽지 않고 3D 에만 넘긴다). 926개짜리 Map 을 반응형으로 만들면 그만큼 느려진다.
export let meshes: MeshMap = new Map()
/**
 * 설비를 따라 늘인 구간의 늘이기 전 형상과 그때 좌표·축. 처음 늘일 때(또는 불러오기 직전에) 뜬다. 늘인 형상은 늘 이것에서 다시
 * 만든다 — 늘인 형상을 또 늘이면 꼭짓점의 축 위 비율이 바뀌어 되돌려도 제자리가 아니다.
 */
export let meshBase = new Map<string, { positions: Float32Array; at: Vec3; axis: SegmentAxis }>()
export let idfSource: { name: string; idf: IdfModel } | null = null
/**
 * 사람이 정한 IDF 평면 놓는 법(idf/place.ts). 없으면 겹친 넓이로 찾은 값을 쓴다. IFC 를 덧붙여 다시 얹을 때도 이 값을 쓴다.
 * 이번 탭에서만이다 — 편집 파일에는 아직 남지 않는다.
 */
export let idfPlacement: IdfPlacement | null = null
export function setIdfPlacement(v: typeof idfPlacement) {
  idfPlacement = v
}

export async function load(name: string, read: () => Promise<ArrayBuffer>) {
  if (
    hasEdits.value &&
    !window.confirm(
      `지금까지 편집한 내용이 사라집니다. 이어서 하려면 먼저 "편집 저장"(Ctrl+S)으로 내려받으세요.

${name} 파일을 열까요?`,
    )
  )
    return
  busy.value = true
  error.value = ''
  beginProgress('파일 읽는 중')
  try {
    let result: { model: Model; meshes: MeshMap }
    // 열려 있던 모델의 상태는 새 파일을 다 읽은 뒤에 바꾼다. 읽다가 실패하면 열려 있던 것이 그대로 남는다(OE-BIM-01#2).
    let idf: { source: NonNullable<typeof idfSource>; report: IdfAttachReport } | null = null
    if (isIdf(name)) {
      // IDF 만 연 것. 공조존과 담당 관계만 있고 방·설비 형상은 없다. 글이라 워커 없이 바로 읽는다.
      const source = { name, idf: readIdf(new TextDecoder().decode(await read())) }
      const done = modelFromIdf(source.idf, name)
      idf = { source, report: done.report }
      result = { model: done.model, meshes: new Map() }
    } else {
      result = await importInWorker(await read())
    }
    idfReport.value = idf?.report ?? null
    selectedZoneId.value = null
    idfSource = idf?.source ?? null
    idfPlacement = null
    progress.value = { label: '3D 그리는 중' }
    await paint()
    meshes = result.meshes
    meshBase = new Map()
    // 임포터가 이미 한 번 돌렸다. 계통별 채점표를 화면이 쓰려고 다시 받는다(같은 입력이면 같은 결과다).
    // 워커는 기본 소속 허용 거리로 판정했다. 사이트 설정이 다르면 이 값으로 다시 잰다(OE-MAP-01).
    if (assignSnapNow() !== SNAP) assignEquipmentToSpaces(result.model)
    ruleReport.value = inferFlowByRules(result.model)
    confirmations.value = []
    baseline.value = baselineOf(result.model)
    pristine = structuredClone(result.model)
    model.value = result.model
    loadedParts = isIdf(name) ? [] : [partOf(name, result.model)]
    fileName.value = name
    openedSources.value = [loadingPath]
    openedProject.value = projectLoading
    setProjectLoading(null)
    mergeReport.value = null
    selectedId.value = null
    selectedSpaceId.value = null
    editNotice.value = ''
    storeyMoved.value = new Set()
    positionDrafts.value = new Map()
    history.value = []
    future.value = []
    // 새 파일을 열면 이전 파일의 편집 이력은 뜻이 없다.
    changes.value = []
    areaChanges.value = []
    await nextTick()
    await paint()
  } catch (e) {
    // 열려 있던 모델·편집은 그대로 둔다(OE-BIM-01#2). 예전에는 모델을 비웠다 — 실패한 파일을 보여 주는 것처럼 보이지 않게 하려던
    // 것인데, 그러면 읽지 못한 파일 하나 때문에 열려 있던 파일과 저장하지 않은 편집까지 잃었다. 대신 문구에 실패한 파일 이름과
    // 아직 열려 있는 파일 이름을 같이 적는다.
    const detail = e instanceof Error ? e.message : String(e)
    // 워커 안쪽의 자바스크립트 오류 문구("Cannot read properties of undefined")는 사람에게 뜻이 없다. 무엇이 일어났는지
    // 먼저 말하고 원문은 괄호에 남긴다(버그 보고에 쓴다).
    const internal = /Cannot read properties|is not a function|is not iterable|undefined|null/.test(detail)
    const kind = isIdf(name) ? 'IDF' : 'IFC'
    const kept = model.value && fileName.value ? ` 열려 있던 ${fileName.value} 는 그대로입니다.` : ''
    error.value = internal
      ? `${kind}를 읽다가 멈췄습니다(${name}). 파일 구조가 깨졌거나 에디터가 모르는 형태입니다(원문: ${detail}).${kept}`
      : `${kind}를 읽지 못했습니다(${name}): ${detail}${kept}`
  } finally {
    busy.value = false
    endProgress()
  }
}

// --- 파일 덧붙이기 ------------------------------------------------------------
//
// 실제 프로젝트는 건축과 설비가 다른 파일이다. 설비 파일에는 방이 없어서 혼자 열면 소속
// 물리존(F11)이 안 나온다. 열린 모델에 다른 파일을 합친다.
const mergeReport = shallowRef<MergeReport | null>(null)

/** 외곽선이 있는 물리존 수. 이게 많은 쪽이 물리존을 대는 기준 모델이 된다. */
const drawnSpaces = (m: Model) => m.storeys.reduce((n, s) => n + s.spaces.filter((sp) => sp.footprint.length >= 3).length, 0)

// **편집한 뒤에도 덧붙인다.** 예전에는 막았다 — 합치기는 모델을 새로 만드는 일이라, 편집한 모델을 그대로 합치면 값은
// TTL 에 나가는데 "바뀐 것 0건" 이 되고 편집 파일·자동 저장·되돌리기에서 빠졌다(Q-1). 이제는 편집을 편집 파일로 떠서,
// **연 때의 모델(pristine)** 을 합친 뒤 그 파일을 다시 얹는다. 편집 파일 불러오기와 같은 길이라 소속·규칙 방향을 합친
// 모델에서 다시 판정하고, 못 찾은 것(합치며 걷어 낸 중복 방 등)은 센다. 되돌리기 이력만 합치기 전에서 끊긴다.
export const canAppend = computed(() => !!model.value)
/** 연 때(또는 마지막으로 합친 때)의 모델. 편집한 뒤 덧붙일 때 이것을 합치고 편집을 다시 얹는다. */
export let pristine: Model | null = null
export function setPristine(v: typeof pristine) {
  pristine = v
}
/** 지금 모델을 이룬 IFC 파일마다 분야·건물. 같은 건물의 같은 분야 파일을 또 덧붙이지 않게 본다(append-guard.ts, OE-HIST-06). */
let loadedParts: LoadedPart[] = []

/** 3D 형상을 연 때(pristine) 자리로 되돌린다. 덧붙이기 전과 편집 버리기가 쓴다. */
export function meshesToOpened() {
  if (!pristine || !model.value) return
  const opened = new Map(pristine.storeys.flatMap((st) => st.equipment).map((e) => [e.id, e.position]))
  for (const e of model.value.storeys.flatMap((st) => st.equipment)) {
    // 늘인 구간은 늘이기 전 형상으로 되돌리고 거기서 연 때 자리로 옮긴다.
    const base = meshBase.get(e.id)
    const mesh = meshes.get(e.id)
    if (base && mesh) {
      meshes.set(e.id, { ...mesh, positions: base.positions })
      shiftMesh(e.id, base.at, opened.get(e.id) ?? null)
    } else shiftMesh(e.id, e.position, opened.get(e.id) ?? null)
  }
  meshBase = new Map()
}

export async function append(name: string, read: () => Promise<ArrayBuffer>) {
  if (!model.value) return
  busy.value = true
  error.value = ''
  beginProgress('파일 읽는 중')
  // 편집이 있으면 떠 두고, 3D 형상도 연 때 자리로 되돌린다. 합친 뒤 편집을 다시 얹으면서 형상도 다시 옮긴다.
  const edits = hasEdits.value && baseline.value && pristine ? exportEdits(model.value, baseline.value, fileName.value) : null
  const unedited = () => (edits ? structuredClone(pristine!) : model.value!)
  const restoreMeshes = () => {
    if (edits) meshesToOpened()
  }
  const replay = () => {
    if (!edits) return
    const n = changeCount.value
    changes.value = []
    areaChanges.value = []
    confirmations.value = []
    storeyMoved.value = new Set()
    applyEditFile(edits, '덧붙이기 전에 한 편집')
    note(`덧붙이기 전에 한 편집 ${n}건을 합친 모델에 다시 얹었습니다. 되돌리기 이력은 여기서 끊깁니다`)
  }
  try {
    if (isIdf(name)) {
      // IDF 는 모델에 공조존과 담당 관계를 얹는다(idf/attach.ts). 방·설비는 그대로다.
      idfSource = { name, idf: readIdf(new TextDecoder().decode(await read())) }
      idfPlacement = null
      const done = attachIdf(unedited(), idfSource.idf, name)
      restoreMeshes()
      idfReport.value = done.report
      ruleReport.value = inferFlowByRules(done.model)
      baseline.value = baselineOf(done.model)
      pristine = structuredClone(done.model)
      model.value = done.model
      fileName.value = `${fileName.value} + ${name}`
      openedSources.value = [...openedSources.value, loadingPath]
      showZones.value = true
      history.value = []
      future.value = []
      // 파일 이름이 바뀌면 편집 파일 알림을 지우는 감시가 돈다. 그 뒤에 얹어야 다시 얹었다는 알림이 남는다.
      await nextTick()
      replay()
      await paint()
      return
    }
    const next = await importInWorker(await read())
    // 같은 건물의 같은 분야 파일이면 받지 않는다. 열린 모델·편집·되돌리기 이력은 그대로다.
    const incomingPart = partOf(name, next.model)
    const duplicate = duplicateOf(loadedParts, incomingPart)
    if (duplicate) {
      error.value = duplicateText(incomingPart, duplicate)
      return
    }
    progress.value = { label: '합치는 중' }
    await paint()
    const current = { name: fileName.value, model: unedited() }
    const incoming = { name, model: next.model }
    // 어느 파일을 먼저 열었는지와 무관하게 방을 더 많이 그린 쪽이 기준이다. 설비 파일을 먼저
    // 열고 건축 파일을 덧붙여도 결과가 같아야 한다.
    const [base, overlay] =
      drawnSpaces(incoming.model) > drawnSpaces(current.model) ? [incoming, current] : [current, incoming]
    const merged = mergeModels(base.model, overlay.model, { base: base.name, overlay: overlay.name })
    // 공조존은 층·방에 이어 둔 것이라, 합쳐서 층·방이 바뀌면 IDF 를 다시 얹는다(합치기는 공조존을 모른다).
    if (idfSource) {
      const again = attachIdf(
        { ...merged.model, hvac: undefined, storeys: merged.model.storeys.filter((s) => !s.id.startsWith('IDF_storey_')) },
        idfSource.idf,
        idfSource.name,
        idfPlacement ? { placement: idfPlacement } : {},
      )
      merged.model = again.model
      idfReport.value = again.report
    }

    progress.value = { label: '3D 그리는 중' }
    await paint()
    restoreMeshes()
    meshes = new Map([...meshes, ...next.meshes])
    ruleReport.value = inferFlowByRules(merged.model)
    baseline.value = baselineOf(merged.model)
    pristine = structuredClone(merged.model)
    model.value = merged.model
    mergeReport.value = merged.report
    loadedParts = [...loadedParts, incomingPart]
    fileName.value = `${base.name} + ${overlay.name}`
    openedSources.value = [...openedSources.value, loadingPath]
    selectedId.value = null
    selectedSpaceId.value = null
    positionDrafts.value = new Map()
    // 합치면 모델을 새로 만든다. 예전 모델을 가리키는 스냅숏은 뜻이 없다.
    history.value = []
    future.value = []
    selectedSystemId.value = null
    await nextTick()
    replay()
    await paint()
  } catch (e) {
    // 덧붙이기가 실패하면 열려 있던 모델은 그대로 둔다. 실패한 파일만 알린다.
    error.value = `덧붙이지 못했습니다(${name}): ${e instanceof Error ? e.message : String(e)}`
  } finally {
    busy.value = false
    endProgress()
  }
}

export function onAppendPick(event: Event) {
  const input = event.target as HTMLInputElement
  void openMany(sourcesOf(input.files), 'append')
  // 같은 파일을 다시 고를 수 있게 비운다.
  input.value = ''
}

/**
 * 한쪽만 연 파일에 모자란 반쪽. 설비만 있으면 방이 없어 소속(F11)이 안 나오고, 방만 있으면 설비가 없다. 요약 칸에서 바로
 * 덧붙이게 한다 — 도구막대의 [덧붙이기] 를 찾지 못했다.
 */
export const pairHint = computed(() => {
  const c = counts.value
  if (!model.value || !c) return null
  const partner = partnerOf(openedDataPath.value)
  if (c.spaces === 0 && c.devices > 0) {
    return { text: '방이 없는 설비 파일입니다. 건축 IFC를 덧붙이면 설비가 어느 방에 있는지(소속)가 나옵니다.', button: '건축 IFC 덧붙이기', partner }
  }
  if (c.devices === 0 && c.spaces > 0) {
    return { text: '설비가 없는 건축 파일입니다. 설비 IFC를 덧붙이면 설비·계통·연결이 이 방들에 얹힙니다.', button: '설비 IFC 덧붙이기', partner }
  }
  // 건축 파일에도 감지기·조명·CCTV 가 들어 있다(성수 건축 1,439대). 기기만 보고 가르면 덕트·배관이 하나도 없는 건축 파일에
  // 덧붙이라는 말이 안 떴다 — 목록은 같은 파일에 짝을 권하는데.
  if (c.conduits === 0 && c.spaces > 0) {
    return { text: '덕트·배관이 없는 건축 파일입니다. 설비 IFC를 덧붙이면 계통과 연결이 이 방들에 얹힙니다.', button: '설비 IFC 덧붙이기', partner }
  }
  return null
})


export async function fetchData(path: string) {
  const r = await fetch(`./__data/${path.split('/').map(encodeURIComponent).join('/')}`)
  if (!r.ok) throw new Error(`받지 못했습니다: data/${path} (HTTP ${r.status})`)
  // 크기를 알면 받은 만큼 막대를 채운다. 55 에서 203MB 를 받는 동안 멈춘 것처럼 보이지 않게.
  const total = Number(r.headers.get('Content-Length')) || 0
  if (!total || !r.body) return r.arrayBuffer()
  const buf = new Uint8Array(total)
  const reader = r.body.getReader()
  let done = 0
  for (;;) {
    const chunk = await reader.read()
    if (chunk.done) break
    buf.set(chunk.value, done)
    done += chunk.value.length
    progress.value = { label: '내려받는 중', done, total, unit: 'bytes' }
  }
  return buf.buffer
}

/** 합치기 보고를 한 줄씩. 문제는 경고가 말하고, 여기는 무엇을 했는지를 말한다. */
export const mergeLines = computed(() => {
  const r = mergeReport.value
  if (!r) return []
  const byName = r.storeys.filter((s) => s.by === 'name').length
  const byElevation = r.storeys.filter((s) => s.by === 'elevation').length
  const added = r.storeys.filter((s) => s.by === null).length
  const lines = [
    `층 ${r.storeys.length}개를 맞췄습니다: 이름으로 ${byName}개` +
      (byElevation ? `, 높이로 ${byElevation}개` : '') +
      (added ? `, 새 층 ${added}개` : ''),
  ]
  if (r.alignment) lines.push(`좌표 겹침 ${Math.round(r.alignment.ratio * 100)}%: 덧붙인 설비 ${r.alignment.placed}대 중 ${r.alignment.inside}대가 건축 공간 안에 있습니다.`)
  const { dropped, kept, borrowed } = r.spaces
  const spaceParts = [
    dropped ? `건축 파일과 겹치는 물리존 ${dropped}개는 뺐습니다` : '',
    kept ? `건축 파일에 없는 물리존 ${kept}개는 넣었습니다` : '',
    borrowed ? `외곽선이 없는 물리존 ${borrowed}개는 설비 파일의 외곽선을 썼습니다` : '',
  ].filter(Boolean)
  if (spaceParts.length) lines.push(spaceParts.join(', ') + '.')
  lines.push(`소속 방이 없는 설비: ${r.unlocated.before}대 → ${r.unlocated.after}대`)
  return lines
})

// 소속을 못 찾은 설비는 임포트 경고로 굳히지 않고 그때그때 센다. 경계 편집·설비 이동·
// 덧붙이기가 전부 이 값을 바꾼다. 기기와 도관을 나눠 말한다 — 이상 알림이 비는 것은 기기다.
const unlocatedLine = computed(() => {
  if (!model.value) return ''
  const all = model.value.storeys.flatMap((s) => s.equipment).filter((e) => e.spaceId === null)
  if (all.length === 0) return ''
  const conduits = all.filter((e) => isConduit(e.role)).length
  const devices = all.length - conduits
  const what = [devices ? `기기 ${devices}대` : '', conduits ? `덕트·배관 ${conduits}대` : ''].filter(Boolean).join(', ')
  return `${what}${josa(what, '은/는')} 소속 물리존을 찾지 못했습니다. 위치는 층까지만 내보냅니다.`
})

// 열린 모델의 등급 칩. 파일 목록의 칩과 같은 계산이라, 덧붙인 뒤 어느 칸이 찼는지 견줄 수 있다.
//
// 모델 전체를 다시 재므로 병원 MEP(1만 3천 개)에서 한 번에 0.14초가 든다. 편집마다 재면 방향키를 누를 때마다
// 그만큼 막힌다. 새 모델은 바로 재고, 편집은 멈춘 뒤(TIERS_DELAY) 한 번 잰다.
export const currentTiers = shallowRef<Profile['tiers']>([])
// 연 때의 모델(pristine)을 센 것. 등급 칩·판정의 본 숫자(BIM + 계산)가 여기서 나오고, 지금 모델과 다르면 보정 후 값이 보조 숫자로 붙는다
// (OE-BIM-16). pristine 은 열거나 덧붙일 때만 바뀌므로 그때 한 번 센다.
let countedPristine: Model | null = null
let pristineCountsCache: GradeCounts | undefined
export function pristineCounts(): GradeCounts | undefined {
  if (!pristine) return undefined
  if (pristine !== countedPristine) {
    countedPristine = pristine
    pristineCountsCache = gradeCounts(pristine)
  }
  return pristineCountsCache
}
// 요구사항 보고서(정본 4장). 등급 칩과 같은 때에 잰다 — 둘 다 모델 전체를 훑는다.
export const currentRequirements = shallowRef<RequirementRow[]>([])
const TIERS_DELAY = 400
let tiersTimer: number | undefined
let tieredModel: Model | null = null

export const warnings = computed(() => [...(model.value?.warnings ?? []), ...(unlocatedLine.value ? [unlocatedLine.value] : [])])

/** 화면이 붙을 때 한 번 — 이 모듈의 watch·이벤트·타이머. App.vue 가 부른다. */
export function setupOpenFile() {
  watch([model, flowVersion, versionStat, replayOpen], () => {
    window.clearTimeout(tiersTimer)
    const m = model.value
    if (!m) {
      currentTiers.value = []
      currentRequirements.value = []
      tieredModel = null
      return
    }
    // 편집 리플레이 중에는 재지 않는다(장면마다 모델 전체를 훑어 화면이 끊긴다). 닫으면 한 번 잰다.
    if (replayOpen.value) return
    const measure = () => {
      currentTiers.value = profileOf(m, pristineCounts()).tiers
      currentRequirements.value = requirementsReport(m, mergeReport.value, versionStat.value)
    }
    if (m !== tieredModel) {
      tieredModel = m
      // 새 모델도 한 태스크 뒤로 미룬다. 여는 태스크에 합치기·3D 준비가 몰려 있어서 여기까지 붙이면 화면이 1초 넘게 멈췄다.
      tiersTimer = window.setTimeout(measure, 0)
    } else {
      tiersTimer = window.setTimeout(measure, TIERS_DELAY)
    }
  }, { immediate: true })
}
