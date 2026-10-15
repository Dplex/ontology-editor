import { computed, ref, triggerRef, watch } from 'vue'
import { anchorBackground, type Background, backgroundCorners, calibrateScale, dwgBackground, type DwgStats, initialBackground, switchPdfPage } from '../lib/background'
import { snapshotRelease } from '../lib/connection-release'
import { type Snapshot, snapshotEquipment } from '../lib/edit'
import type { Storey, Vec2 } from '../lib/model'
import { renderPdfPage } from '../lib/pdf-page'
import { retargetEnd } from '../lib/retarget'
import { stage } from './chat-view'
import { connectFrom, nameOfId } from './connections'
import { editing, model } from './core'
import { stopAdd } from './equipment-edit'
import { placeStretched, segmentAxis, shortName } from './equipment-shape'
import { equipmentById, flowVersion, ruleReport, selected, selectedId } from './flow-rules'
import { mark, remember } from './history'
import { note } from './keyboard'
import { pipeDraft } from './manual-draw'
import { storeyOf } from './multi-select'
import { viewStorey } from './multi-view'
import { stopPlace } from './place'
import { sceneVersion } from './redraw'
import { viewer } from './scene'
import { targetStorey } from './space-edit'
import { drawing } from './space-objects'

// --- 평면도 배경 이미지 (OE-MAN-02, background.ts) ------------------------------------------------
// 층마다 하나. 온톨로지·편집 파일에 나가지 않고 이 브라우저 탭에만 있다(다시 열면 다시 깐다).

/** 층 id → 배경. */
const backgrounds = ref<Record<string, Background>>({})
/** 두 점·한 점을 찍은 뒤 값을 기다리는 단계. */
export const bgStep = ref<{ kind: 'scale'; a: Vec2; b: Vec2; meters: string | number } | { kind: 'anchor'; at: Vec2; x: string | number; y: string | number } | null>(null)
/** 배경을 다루는 층. 층 하나만 보는 중이거나 고른 것의 층이다. */
export const bgStorey = computed(() => (model.value && editing.value ? targetStorey() : null))
export const bgHere = computed(() => (bgStorey.value ? (backgrounds.value[bgStorey.value.id] ?? null) : null))
/** 서버가 DWG 를 그림으로 바꿀 수 있는지(src/server/dwg.ts). 못 하면 도면 칸의 안내가 까닭을 말한다. */
export const dwgServer = ref<{ enabled: boolean; reason?: string }>({ enabled: false, reason: 'DWG 변환 서버를 확인하는 중입니다' })
/** PDF 로 깐 층의 원본 바이트. 쪽을 바꿔 다시 그릴 때 쓴다(층 id → 바이트). 화면에 보이지 않아 반응형으로 두지 않는다. */
const bgPdfs = new Map<string, ArrayBuffer>()
/** PDF 를 그리는 중(큰 도면은 몇 초). 그동안 고르기 칸과 쪽 칸을 막는다. */
export const bgBusy = ref(false)
export function pickBackground(input: HTMLInputElement) {
  const file = input.files?.[0]
  input.value = ''
  const st = bgStorey.value
  if (!file || !st) return
  if (file.type === 'application/pdf' || /\.pdf$/i.test(file.name)) return void pickPdfBackground(st, file)
  if (/\.dwg$/i.test(file.name)) return void pickDwgBackground(st, file)
  const url = URL.createObjectURL(file)
  const img = new Image()
  img.onload = () => {
    bgPdfs.delete(st.id)
    placeBackground(st, { url, name: file.name, width: img.naturalWidth, height: img.naturalHeight })
    note(`${file.name}을 ${st.name} 바닥에 깔았습니다. [스케일 맞추기] 로 두 점의 실제 거리를, [원점 맞추기] 로 한 점의 실제 좌표를 넣으세요`)
  }
  img.onerror = () => {
    URL.revokeObjectURL(url)
    note('이미지를 읽지 못했습니다. PNG·JPG·PDF·DWG 도면을 고르세요')
  }
  img.src = url
}
/** 처음 깔 때. 이 층 물리존 외곽선의 범위에 너비를 맞춘다. 없으면 1px = 1cm 로 원점에 둔다. */
function placeBackground(st: Storey, spec: { url: string; name: string; width: number; height: number }, pdf?: Background['pdf']) {
  const pts = st.spaces.flatMap((sp) => sp.footprint)
  const box = pts.length ? { x0: Math.min(...pts.map((p) => p[0])), x1: Math.max(...pts.map((p) => p[0])), y0: Math.min(...pts.map((p) => p[1])), y1: Math.max(...pts.map((p) => p[1])) } : null
  const old = backgrounds.value[st.id]
  if (old) URL.revokeObjectURL(old.url)
  backgrounds.value = { ...backgrounds.value, [st.id]: { ...initialBackground(spec, box), ...(pdf ? { pdf } : {}) } }
}
/** PDF 도면은 첫 쪽을 이미지로 그려 깐다(pdf-page.ts). 여러 쪽이면 [쪽] 칸에서 바꾼다. */
async function pickPdfBackground(st: Storey, file: File) {
  bgBusy.value = true
  try {
    const data = await file.arrayBuffer()
    const r = await renderPdfPage(data, 1)
    bgPdfs.set(st.id, data)
    placeBackground(st, { url: URL.createObjectURL(r.blob), name: file.name, width: r.width, height: r.height }, { page: r.page, pages: r.pages, pxPerPt: r.pxPerPt })
    note(
      `${file.name}${r.pages > 1 ? ` ${r.pages}쪽 중 1쪽` : ''}을 ${st.name} 바닥에 깔았습니다. ` +
        (r.pages > 1 ? '다른 쪽은 [쪽] 칸에서 고르고, ' : '') +
        '[스케일 맞추기] 로 두 점의 실제 거리를, [원점 맞추기] 로 한 점의 실제 좌표를 넣으세요',
    )
  } catch (e) {
    note(`PDF 를 읽지 못했습니다: ${e instanceof Error ? e.message : String(e)}`)
  } finally {
    bgBusy.value = false
  }
}
/**
 * DWG 도면은 서버가 PNG 로 바꿔 준다(src/server/dwg.ts — LibreDWG + ezdxf). 브라우저에는 DWG 를 읽을 길이 없다. 서버가 도면 단위를 알려 주면
 * 축척을 그 단위로 맞추고, 도면 좌표가 건물과 겹치면 그 자리에 둔다(background.ts 의 dwgBackground).
 */
async function pickDwgBackground(st: Storey, file: File) {
  bgBusy.value = true
  try {
    const r = await fetch('./__data/__dwg', { method: 'POST', body: file })
    if (!r.ok) {
      const why = ((await r.json().catch(() => null)) as { error?: string } | null)?.error ?? `서버가 ${r.status} 로 답했습니다`
      note(`DWG 를 깔지 못했습니다: ${why}. PDF 나 이미지로 내보내 고를 수 있습니다`)
      return
    }
    const stats = JSON.parse(r.headers.get('X-Dwg2png') ?? 'null') as DwgStats | null
    if (!stats) {
      note('DWG 를 깔지 못했습니다: 서버가 도면 범위를 알려 주지 않았습니다')
      return
    }
    const url = URL.createObjectURL(await r.blob())
    const pts = st.spaces.flatMap((sp) => sp.footprint)
    const box = pts.length ? { x0: Math.min(...pts.map((p) => p[0])), x1: Math.max(...pts.map((p) => p[0])), y0: Math.min(...pts.map((p) => p[1])), y1: Math.max(...pts.map((p) => p[1])) } : null
    const old = backgrounds.value[st.id]
    if (old) URL.revokeObjectURL(old.url)
    bgPdfs.delete(st.id)
    const bg = dwgBackground({ url, name: file.name }, stats, box)
    backgrounds.value = { ...backgrounds.value, [st.id]: bg }
    const how = bg.dwg?.unit ? `도면 단위(${bg.dwg.unit})로 실제 크기에 맞췄${bg.dwg.placed === 'drawing' ? '고, 도면 좌표가 건물과 겹쳐 그 자리에 두었' : ''}습니다. ` : '도면 단위를 몰라 건물 너비에 맞췄습니다. [스케일 맞추기] 로 두 점의 실제 거리를 넣으세요. '
    const lost = stats.minimal ? ' 도면의 블록 정의를 읽지 못해 블록으로 넣은 기호(문·가구 등)는 빠졌을 수 있습니다.' : ''
    note(`${file.name}을 ${st.name} 바닥에 깔았습니다. ${how}어긋나면 [원점 맞추기] 로 한 점의 실제 좌표를 넣으세요.${lost}`)
  } catch (e) {
    note(`DWG 를 깔지 못했습니다: ${e instanceof Error ? e.message : String(e)}`)
  } finally {
    bgBusy.value = false
  }
}
/** PDF 의 다른 쪽을 깐다. 맞춘 스케일(종이 위 축척)과 왼쪽 위는 그대로다(switchPdfPage). */
export async function setBackgroundPage(page: number) {
  const st = bgStorey.value
  const bg = bgHere.value
  const data = st ? bgPdfs.get(st.id) : undefined
  if (!st || !bg?.pdf || !data || page === bg.pdf.page || bgBusy.value) return
  bgBusy.value = true
  try {
    const r = await renderPdfPage(data, page)
    const now = backgrounds.value[st.id]
    if (!now) return
    URL.revokeObjectURL(now.url)
    backgrounds.value = { ...backgrounds.value, [st.id]: switchPdfPage(now, { url: URL.createObjectURL(r.blob), width: r.width, height: r.height, page: r.page, pages: r.pages, pxPerPt: r.pxPerPt }) }
    note(`${bg.name} ${r.page}/${r.pages}쪽을 깔았습니다. 스케일과 왼쪽 위는 그대로입니다`)
  } catch (e) {
    note(`PDF 쪽을 그리지 못했습니다: ${e instanceof Error ? e.message : String(e)}`)
  } finally {
    bgBusy.value = false
  }
}
export function startBackgroundStep(kind: 'bgScale' | 'bgAnchor') {
  const st = bgStorey.value
  if (!st || !bgHere.value) return
  stopPlace()
  stopAdd()
  bgStep.value = null
  if (model.value!.storeys.length > 1) viewStorey.value = st.id
  drawing.value = { purpose: kind, spaceId: null, storeyId: st.id, name: kind === 'bgScale' ? '배경 스케일' : '배경 원점', elevation: st.elevation, points: [] }
  viewer?.setPlaceMode(st.elevation)
  stage.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  note(kind === 'bgScale' ? '도면에서 길이를 아는 두 점을 찍으세요 (Esc 취소)' : '도면에서 좌표를 아는 한 점을 찍으세요 (Esc 취소)')
}
export function applyBackgroundStep() {
  const st = bgStorey.value
  const bg = bgHere.value
  const step = bgStep.value
  if (!st || !bg || !step) return
  if (step.kind === 'scale') {
    const next = calibrateScale(bg, step.a, step.b, Number(step.meters))
    if (!next) return note('거리는 0 보다 큰 숫자로 넣으세요')
    backgrounds.value = { ...backgrounds.value, [st.id]: next }
    note(`스케일을 맞췄습니다: 1px = ${(next.scale * 1000).toFixed(1)}mm`)
  } else {
    // 숫자 칸의 v-model 은 숫자를, 비운 칸은 '' 를 준다.
    const [x, y] = [String(step.x).trim(), String(step.y).trim()]
    const to: Vec2 = [Number(x), Number(y)]
    if (x === '' || y === '' || !to.every((v) => Number.isFinite(v))) return note('x, y 를 숫자로 넣으세요')
    backgrounds.value = { ...backgrounds.value, [st.id]: anchorBackground(bg, step.at, to) }
    note(`원점을 맞췄습니다: 찍은 점이 (${to[0]}, ${to[1]}) 입니다`)
  }
  bgStep.value = null
}
export function setBackgroundOpacity(v: number) {
  const st = bgStorey.value
  const bg = bgHere.value
  if (st && bg) backgrounds.value = { ...backgrounds.value, [st.id]: { ...bg, opacity: v } }
}
export function removeBackground() {
  const st = bgStorey.value
  const bg = bgHere.value
  if (!st || !bg) return
  URL.revokeObjectURL(bg.url)
  bgPdfs.delete(st.id)
  const { [st.id]: _gone, ...rest } = backgrounds.value
  backgrounds.value = rest
  bgStep.value = null
}

/** 구간 끝의 연결 대상 바꾸기(OE-PIP-10, retarget.ts). 고른 구간이 바뀌면 비운다. */
export const retargetDraft = ref<{ from: string; to: string }>({ from: '', to: '' })
/** 고른 구간의 끝에 이어진 것(바꿀 끝). */
export const segmentEnds = computed(() => {
  void sceneVersion.value
  const m = model.value
  const e = selected.value
  if (!m || !e || e.role !== 'segment') return []
  return m.connections.flatMap((c) => (c.from === e.id ? [c] : c.to === e.id ? [c] : [])).map((c) => {
    const other = c.from === e.id ? c.to : c.from
    return { id: other, name: nameOfId(other), port: c.source === 'port' }
  })
})
/** 새 대상 후보: 같은 층의 좌표 있는 설비·배관, 바꿀 끝의 지금 대상에서 가까운 순 30개. 이미 이어진 것과 구간 자신은 뺀다. */
export const retargetChoices = computed(() => {
  const e = selected.value
  const from = retargetDraft.value.from ? equipmentById.value.get(retargetDraft.value.from) : null
  const home = e ? storeyOf(e.id) : null
  if (!e || !from?.position || !home) return []
  const linked = new Set(segmentEnds.value.map((x) => x.id))
  const p = from.position
  return home.equipment
    .filter((x) => x.id !== e.id && !linked.has(x.id) && !!x.position)
    .map((x) => ({ id: x.id, name: shortName(x.name), d: Math.hypot(x.position![0] - p[0], x.position![1] - p[1], x.position![2] - p[2]) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, 30)
})
export function applyRetarget() {
  const m = model.value
  const e = selected.value
  const { from, to } = retargetDraft.value
  if (!m || !e || !from || !to) return
  const old = m.connections.find((c) => (c.from === e.id && c.to === from) || (c.to === e.id && c.from === from))
  if (!old) return
  // 되돌리기 한 번에: 옛 연결(해제 보정 또는 지움), 새 연결(없던 상태), 구간 형상.
  const log = [...(m.connectionLog ?? [])]
  const parts: Snapshot[] = [snapshotRelease(m, old), snapshotEquipment(m, e.id)!]
  const at = mark()
  const done = retargetEnd(m, e.id, from, to, segmentAxis)
  if ('refused' in done) return note(done.refused)
  const label = `${shortName(e.name)} 끝 대상 ${nameOfId(from)} → ${nameOfId(to)}`
  remember(label, { kind: 'many', parts: [parts[0], { kind: 'release', connection: done.added, state: { where: 'absent' }, log }, parts[1]] }, at)
  if (done.stretched) placeStretched(e.id)
  ruleReport.value = done.rules
  retargetDraft.value = { from: '', to: '' }
  triggerRef(model)
  flowVersion.value++
  note(`${label}. ${done.released ? '옛 BIM 포트 연결은 해제 보정으로 남겼습니다' : '옛 연결은 지웠습니다'}${done.stretched ? '. 그 끝을 새 대상 자리로 늘였습니다' : ''}`)
}
export function startPipe() {
  const from = selected.value
  const home = from ? storeyOf(from.id) : null
  if (!from?.position || !home) return
  if (!pipeDraft.value.to) return note('끝 대상을 먼저 고르세요')
  stopPlace()
  stopAdd()
  connectFrom.value = null
  if (model.value!.storeys.length > 1) viewStorey.value = home.id
  drawing.value = { purpose: 'pipe', spaceId: from.id, storeyId: home.id, name: `${shortName(from.name)} 배관`, elevation: from.position[2], points: [] }
  viewer?.setPlaceMode(from.position[2])
  stage.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  note(`배관이 꺾일 자리를 바닥에 찍습니다(높이 ${from.position[2].toFixed(2)}m). Enter 로 마치면 끝 대상까지 연결합니다 (Esc 취소)`)
}

/** 화면이 붙을 때 한 번 — 이 모듈의 watch·이벤트·타이머. App.vue 가 부른다. */
export function setupBackground() {
  watch([bgHere, bgStorey, viewStorey, sceneVersion], () => {
    const bg = bgHere.value
    const st = bgStorey.value
    viewer?.setBackground(bg && st ? { url: bg.url, corners: backgroundCorners(bg), elevation: st.elevation, opacity: bg.opacity } : null)
  })
  fetch('./__data/__dwg')
    .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
    .then((p: { enabled?: boolean; reason?: string }) => (dwgServer.value = { enabled: p.enabled === true, reason: p.reason }))
    .catch(() => (dwgServer.value = { enabled: false, reason: 'DWG 는 서버가 변환합니다. 이 화면에서는 서버에 연결되지 않습니다' }))
  watch(selectedId, () => (retargetDraft.value = { from: '', to: '' }))
}
