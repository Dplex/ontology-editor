<script setup lang="ts">
import { computed, reactive, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import type { Model, Storey, Vec2 } from '../../../../src/lib/model'
import type { MeshMap } from '../../../../src/lib/ifc/import'
import { isSelfIntersecting } from '../../../../src/lib/mapping'
import { countOf, polygonArea } from '../../../../src/lib/model'
import { addEquipment, createSpace, deleteEquipment, moveEquipment, renameEquipment, renameSpace, newId } from '../../../../src/lib/edit'
import { createCustomZone } from '../../../../src/lib/custom-zone'
import { hvacZonesOf, createZoneFromOutline, createZoneFromSpaces } from '../../../../src/lib/hvac-zone'
import type { IdfAttachReport } from '../../../../src/lib/idf/attach'
import ZoneTools from './ZoneTools.vue'
import OutputPanel from './OutputPanel.vue'
import WarningsPanel from './WarningsPanel.vue'
import GradeChips from './GradeChips.vue'
import { equipmentKind as kindInfo } from '../../../../src/lib/kinds'
import { splitSpace, moveSpaceVertex, deleteSpaceVertex } from '../../../../src/lib/edit'
import { splitCustomZone } from '../../../../src/lib/custom-zone'
import HvacPanel from './HvacPanel.vue'
import HvacCreate from './HvacCreate.vue'
import IdfReview from './IdfReview.vue'
import { hasRealWalls, referenceWalls } from './refwalls'
import { ceilingOf, setCeiling, judgeAll, ceilingZone, ceilingRange, checkCeilingZ, setEquipmentSurface, outsideAllowed, type Judged } from '../../../../src/lib/ceiling'
import { storeyHeights } from '../../../../src/lib/storey-height'
import { SURFACE_LABEL, allowedLabel, canMountOn, surfaceOf, type Surface } from '../../../../src/lib/mount'
import type { CeilingMark } from '../../../../src/lib/viewer'
import { equipmentKind, EQUIPMENT_KINDS } from '../../../../src/lib/kinds'
import { mergeModels } from '../../../../src/lib/merge'
import { readIdf } from '../../../../src/lib/idf/read'
import { attachIdf, modelFromIdf } from '../../../../src/lib/idf/attach'
import { storeyFiles } from '../../../../src/lib/export/storey-export'
import { readOntologyTTL } from '../../../../src/lib/export/read-ttl'
import { catalog } from './catalog'
import { exportModelOf, addLog, isCommitted, type IdfState, applyVersion, baselineFor, clone, demoProject, emptyModel, gateFor, makeProject, modeFor, reportFor, restoreVersion, saveDraft, STORAGE_KEY, summaryFor, snapshotFloor, applyFloorSnapshot, type FloorSnapshot, type Project, type Version } from './state'
import Scene from './Scene.vue'

type Page = 'dashboard' | 'editor' | 'requirements' | 'versions' | 'report' | 'log'
type Modal = '' | 'idf' | 'hvac-new' | 'preview' | 'apply' | 'leave' | 'restore' | 'new' | 'add-equipment'
const projects = ref<Project[]>([])
const storageError = ref('')
try {
  const saved = localStorage.getItem(STORAGE_KEY)
  if (saved) {
    const data = JSON.parse(saved)
    if (!Array.isArray(data) || !data.length || !data.every(p => p.id && p.model?.storeys?.length && p.original && p.published && p.drafts && p.versions)) throw new Error('저장 형식이 올바르지 않습니다.')
    projects.value = data
  } else projects.value = [demoProject()]
} catch(e) {
  projects.value = [demoProject()]
  storageError.value = '저장본을 읽지 못했습니다. 데모를 임시로 표시합니다. 기존 저장본은 자동 덮어쓰지 않습니다.'
}
const projectId = ref(projects.value[0].id)
const project = computed(() => projects.value.find(p => p.id === projectId.value) ?? projects.value[0])
const floorId = ref(project.value.model.storeys[0].id)
const floor = computed(() => project.value.model.storeys.find(s => s.id === floorId.value) ?? project.value.model.storeys[0])
const page = ref<Page>('dashboard')
const revision = ref(0)
const selected = ref('')
const editMode = ref<'space'|'equipment'>('space')
const view = ref<'3d'|'plan'>('3d')
const layer = ref<'spaces'|'equipment'|'custom'|'hvac'>('spaces')
const search = ref('')
const query = ref('')
const release = ref('all')
const ticketStatus = ref('all')
const ticket = ref(catalog[0])
const modal = ref<Modal>('')
const busy = ref(false)
const progress = ref('')
const message = ref('')
const sourceError = ref('')
const fileInput = ref<HTMLInputElement>()
const stage = ref<InstanceType<typeof Scene>>()
const meshMaps = new Map<string,MeshMap>()
const meshes = computed(() => meshMaps.get(projectId.value))
const history = ref<FloorSnapshot[]>([])
const future = ref<FloorSnapshot[]>([])
const lastSaved = ref('')
const dirty = computed(() => page.value === 'editor' && lastSaved.value !== JSON.stringify(floor.value))
const mode = computed(() => modeFor(project.value,floor.value.id))
const initial = computed(() => mode.value === '초기 구축')
const report = computed(() => { void revision.value; return reportFor(project.value.model,floor.value.id) })
const gate = computed(() => report.value.gate)
const counts = computed(() => countOf(project.value.model))
const changes = computed(() => { void revision.value; return summaryFor(project.value,floor.value.id) })
const versions = computed(() => (project.value.versions[floor.value.id] ?? []).filter(v => Date.now()-Date.parse(v.at) <= 7*86400000))
const chosenVersion = ref<Version>()
const rows = computed(() => {
  const f = floor.value
  const items = layer.value === 'spaces' ? f.spaces.map(x => ({id:x.id,name:x.longName || x.name,detail:x.name + ' · ' + x.areaM2.toFixed(1) + ' ㎡',type:'물리존'}))
    : layer.value === 'equipment' ? f.equipment.map(x => ({id:x.id,name:x.name,detail:(x.position ? (x.spaceId ? '소속 있음' : '소속 없음') : '미배치') + ' · ' + judgedLabel(judgedMap.value.get(x.id)),type:'설비'})).filter(x => surfaceMatch(x.id,surfaceFilter.value))
    : layer.value === 'custom' ? (f.customZones ?? []).map(x => ({id:x.id,name:x.name,detail:'사용자 정의 구역',type:'커스텀존'}))
    : hvacHere.value.map(x => ({id:x.id,name:x.name,detail:x.spaceIds.length + '개 물리존 · ' + (x.source==='edit'?'사람이 만듦':'IDF'),type:'공조존'}))
  return items.filter(x => (x.name+x.detail).toLowerCase().includes(search.value.toLowerCase()))
})
const selectedSpace = computed(() => floor.value.spaces.find(s => s.id === selected.value))
const selectedEquipment = computed(() => floor.value.equipment.find(e => e.id === selected.value))
// OE-UI-16 존 종류별 보기 필터 — 화면에서만 적용되고 저장본·내보내기에는 남지 않는다.
const zoneShow = ref({space:true,custom:true,hvac:true})
// 벽·천장 보기. 바닥은 물리존 면으로 보인다(존 보기의 물리존). 천장면은 반자 높이를 알 때만 — 모르면 입력칸으로 정한다.
const layers = ref({walls:true,ceiling:true})
const ceilingHere = computed(() => { void revision.value; return ceilingOf(floor.value) })
// 화면용 벽: BIM 벽 형상이 없는 층은 물리존 외곽선을 따라 세운 '참고 벽'(화면에서만).
const wallsHere = computed(() => { void revision.value; return hasRealWalls(floor.value,meshes.value) ? floor.value.walls : [...floor.value.walls,...referenceWalls(floor.value)] })
const refWalls = computed(() => !hasRealWalls(floor.value,meshes.value) && floor.value.spaces.length>0)
const ceilingInput = ref('')
watch([floorId,ceilingHere],() => { ceilingInput.value = ceilingHere.value ? String(ceilingHere.value.height) : '' },{immediate:true})
function applyCeiling() {
  const raw = String(ceilingInput.value ?? '').trim()
  const v = raw===''?null:Number(raw)
  if(v!==null && !(Number.isFinite(v) && v>0)){toast('천장 높이는 0 보다 큰 숫자(m)로 입력하세요.');return}
  checkpoint()
  setCeiling(project.value.model,floor.value.id,v)
  revision.value++
}
// --- 설치면 판정(OE-EQP-03)·표시(OE-EQP-04)·필터(OE-EQP-05·UI-10)·천장/바닥 편집 모드(OE-OBJ-08) ---
type SurfaceFilter = 'all' | Surface | 'unknown'
const surfaceFilter = ref<SurfaceFilter>('all')
const surfaceMode = ref<'floor' | 'ceiling'>('floor')
const ceilingModeOn = computed(() => surfaceMode.value === 'ceiling' && editMode.value === 'equipment')
const heights = computed(() => { void revision.value; return storeyHeights(project.value.model.storeys) })
const storeyH = (id: string) => heights.value.get(id)?.value ?? null
const surfaceRows = computed(() => { void revision.value; return judgeAll(project.value.model, storeyH) })
const judgedMap = computed(() => new Map(surfaceRows.value.map(r => [r.equipment.id, r.judged] as const)))
const judgedLabel = (j: Judged | null | undefined) => j === 'plenum' ? '천장(플레넘)' : j ? SURFACE_LABEL[j] : '미정'
const surfaceStats = computed(() => {
  const here = surfaceRows.value.filter(r => r.storey.id === floor.value.id)
  const n = (f: (j: Judged | null) => boolean) => here.filter(r => f(r.judged)).length
  return { ceiling: n(j => j === 'ceiling' || j === 'plenum'), floor: n(j => j === 'floor'), wall: n(j => j === 'wall'), unknown: n(j => j === null), total: here.length }
})
const surfaceMatch = (id: string, f: SurfaceFilter) => {
  if (f === 'all') return true
  const j = judgedMap.value.get(id) ?? null
  if (f === 'unknown') return j === null
  if (f === 'ceiling') return j === 'ceiling' || j === 'plenum'
  return j === f
}
// 천장 설비: 판정이 천장·플레넘이거나(Q9: 허용 설치면 밖이면 허용 설치면이 앞선다), 천장고를 몰라도 종류가 천장 전용이면.
const ceilingMarks = computed<CeilingMark[]>(() => {
  const out: CeilingMark[] = []
  for (const r of surfaceRows.value) {
    const e = r.equipment
    if (r.storey.id !== floor.value.id || !e.position) continue
    const onCeiling = r.judged === 'ceiling' || r.judged === 'plenum' || (r.judged === null && !ceilingOf(r.storey) && surfaceOf(e) === 'ceiling')
    if (!onCeiling || !canMountOn(e, 'ceiling')) continue
    out.push({ id: e.id, storeyId: r.storey.id, at: e.position, floor: r.storey.elevation, zone: ceilingZone(e.kind) ?? (r.judged === 'plenum' ? 'plenum' : 'attached') })
  }
  return out
})
const ceilingIds = computed(() => new Set(ceilingMarks.value.map(m => m.id)))
const hiddenEquipment = computed(() => new Set(floor.value.equipment.filter(e => !surfaceMatch(e.id, surfaceFilter.value)).map(e => e.id)))
const dimmed = computed(() => ceilingModeOn.value ? new Set(floor.value.equipment.filter(e => !ceilingIds.value.has(e.id)).map(e => e.id)) : new Set<string>())
const IN_CEILING_MODE = '천장 설비는 천장 편집 모드에서 편집합니다([천장] 토글).'
const NOT_ON_CEILING = '천장에 설치할 수 없는 설비입니다.'
const IN_FLOOR_SIDE = '천장 편집 모드에서는 천장 설비만 편집합니다. 바닥·벽 쪽에서 편집하세요.'
function setSurfaceMode(next: 'floor' | 'ceiling') {
  if (next === surfaceMode.value) return
  surfaceMode.value = next
  selected.value = ''; drawTool.value = ''; points.value = []; placeEquipment.value = false
  if (next === 'ceiling') {
    editMode.value = 'equipment'; view.value = '3d'
    if (!ceilingHere.value) toast('이 층의 천장고(h_c)를 모릅니다. 위 [천장고] 칸에 입력해야 천장 설비를 놓을 수 있습니다.')
    else toast('천장 편집 모드 — 천장 설비만 편집합니다. 이동은 x·y 만이고 z 는 속성에서 고칩니다.')
    nextTick(() => stage.value?.top())
  } else toast('바닥·벽 편집으로 돌아왔습니다.')
}
const hvacHere = computed(() => hvacZonesOf(project.value.model).filter(z => z.storeyId === floor.value.id))
const zoneKinds = computed(() => [
  {key:'space' as const,name:'물리존',count:floor.value.spaces.length},
  {key:'custom' as const,name:'커스텀존',count:(floor.value.customZones ?? []).length},
  {key:'hvac' as const,name:'공조존',count:hvacHere.value.length},
])
// OE-IDF-11 AC3 공조존 선택 상세정보 — 이름·층·담당 설비·담당 물리존, 풍량은 값이 있을 때만.
const selectedHvac = computed(() => hvacHere.value.find(z => z.id === selected.value))
const selectedCustom = computed(() => floor.value.customZones?.find(z => z.id === selected.value))
const form = ref({name:'',number:'',x:0,y:0,z:0})
watch(selected,() => {
  const s = selectedSpace.value, e = selectedEquipment.value
  form.value = {name:s?.longName ?? e?.name ?? selectedCustom.value?.name ?? '',number:s?.name ?? '',x:e?.position?.[0] ?? 0,y:e?.position?.[1] ?? 0,z:e?.position?.[2] ?? floor.value.elevation}
})
const filteredTickets = computed(() => catalog.filter(t => (t.id+t.title+t.epic).toLowerCase().includes(query.value.toLowerCase()) && (release.value === 'all' || t.release === release.value) && (ticketStatus.value === 'all' || t.status === ticketStatus.value)))
const drawTool = ref<''|'room'|'custom'|'hvac'|'split'>('')
const points = ref<Vec2[]>([])
const newName = ref('회의실')
const newNumber = ref('108')
const equipmentName = ref('TEMP-NEW')
const equipmentType = ref('fcu')
const placeEquipment = ref(false)
const newSite = ref('새 사이트')
const planSvg = ref<SVGSVGElement>()
const bounds = computed(() => {
  const ps = floor.value.spaces.flatMap(s => s.footprint)
  if (!ps.length) return {x:-2,y:-2,w:34,h:23}
  const xs = ps.map(p=>p[0]), ys = ps.map(p=>p[1])
  const x = Math.min(...xs)-3, y = Math.min(...ys)-3
  return {x,y,w:Math.max(18,Math.max(...xs)-x+3),h:Math.max(16,Math.max(...ys)-y+3)}
})
const pathOf = (ps: readonly Vec2[]) => ps.map(p => p.join(',')).join(' ')
const center = (ps: readonly Vec2[]) => { const p=ps.slice(0,-1); return [p.reduce((n,v)=>n+v[0],0)/(p.length||1),p.reduce((n,v)=>n+v[1],0)/(p.length||1)] }
function persist() {
  if (storageError.value) return false
  try { localStorage.setItem(STORAGE_KEY,JSON.stringify(projects.value)); return true }
  catch { storageError.value = '브라우저 저장 공간이 부족하거나 차단됐습니다. 현재 작업은 탭에만 있습니다. 산출물을 내려받으세요.'; return false }
}
function toast(s: string) { message.value = s }
function checkpoint() { history.value.push(snapshotFloor(project.value.model,floor.value.id)); if(history.value.length>30) history.value.shift(); future.value=[] }
function replaceFloor(s: FloorSnapshot) {
  const at = project.value.model.storeys.findIndex(f => f.id === floor.value.id)
  applyFloorSnapshot(project.value.model,s); revision.value++; selected.value=''
}
function undo() { const s=history.value.pop(); if(s){ future.value.push(snapshotFloor(project.value.model,floor.value.id)); replaceFloor(s) } }
function redo() { const s=future.value.pop(); if(s){ history.value.push(snapshotFloor(project.value.model,floor.value.id)); replaceFloor(s) } }
function savedSignature() { lastSaved.value=JSON.stringify(floor.value) }
function enter(id: string) {
  floorId.value=id
  const p=project.value
  const saved=p.drafts[id] ?? p.published[id] ?? p.original[id]
  if(saved) applyFloorSnapshot(p.model,saved)
  selected.value=''; points.value=[]; drawTool.value=''; placeEquipment.value=false; history.value=[]; future.value=[]
  page.value='editor'; revision.value++; savedSignature()
  seen.value={...seen.value,[id]:p.versions[id]?.[0]?.number ?? 0}
  if(p.drafts[id]) toast('이 층의 임시 저장본을 이어서 편집합니다.')
}
let pending: (()=>void) | undefined
function navigate(action: ()=>void) {
  if(dirty.value){pending=action; modal.value='leave'} else action()
}
function go(to: Page) { navigate(()=>{page.value=to}) }
function switchFloor(event: Event) {
  const id=(event.target as HTMLSelectElement).value
  ;(event.target as HTMLSelectElement).value=floor.value.id
  navigate(()=>enter(id))
}
function chooseProject(event: Event) {
  const id=(event.target as HTMLSelectElement).value
  ;(event.target as HTMLSelectElement).value=projectId.value
  navigate(()=>{projectId.value=id; floorId.value=project.value.model.storeys[0].id;page.value='dashboard'; selected.value=''})
}
function save() {
  saveDraft(project.value,floor.value.id)
  addLog(project.value,'임시 저장',floor.value.name,null,'복구용 · 확정 아님')
  if(persist()){savedSignature();toast('임시 저장 완료 · 이 브라우저에 저장됨 · DT 미반영')}
}
function leave(choice:'save'|'discard') {
  if(choice==='save'){save();if(dirty.value)return}
  else {
    const p=project.value; replaceFloor(p.drafts[floor.value.id] ?? baselineFor(p,floor.value.id));savedSignature()
  }
  modal.value=''; pending?.(); pending=undefined
}
// 레이아웃 배너·알림(OE-WF-15·16, OE-XPRD-02) — 이 층의 최신 버전이 내가 연 버전보다 새로우면 배너, 반영·되돌리기마다 GNB 알림 한 건.
const seen = ref<Record<string, number>>({})
const latestVersion = computed(() => (project.value.versions[floor.value.id]?.[0]?.number ?? 0))
const newer = computed(() => page.value === 'editor' && latestVersion.value > (seen.value[floor.value.id] ?? 0))
const notifOpen = ref(false)
const notifs = computed(() => (project.value.log ?? []).filter(isCommitted).slice(0, 8))
const unread = ref(0)
watch(() => project.value.log?.length ?? 0, (n, o) => { if (n > (o ?? 0) && isCommitted(project.value.log![0])) unread.value++ })
function refreshLayout() { navigate(() => enter(floor.value.id)) }
function simulateOther() {
  try {
    const v = applyVersion(project.value, floor.value.id, '다른 사용자 반영(시뮬레이션)')
    addLog(project.value, '반영', floor.value.name, v.number, '다른 사용자(시뮬레이션)'); persist(); revision.value++
    toast('다른 사용자가 v' + v.number + ' 을 반영한 것처럼 시험했습니다. 에디터를 열면 배너가 뜹니다.')
  } catch (e) { toast(String(e)) }
}
function select(id: string) { selected.value=id }
function saveProperties() {
  const name=form.value.name.trim()
  if(!name){toast('이름을 입력하세요.');return}
  const s=selectedSpace.value,e=selectedEquipment.value
  if(s && editMode.value!=='space'){toast('공간 편집 모드에서 편집하세요.');return}
  if(e && editMode.value!=='equipment'){toast('설비 편집 모드에서 편집하세요.');return}
  if(e && ceilingIds.value.has(e.id) && !ceilingModeOn.value){toast(IN_CEILING_MODE);return}
  if(e && ceilingModeOn.value && !ceilingIds.value.has(e.id)){toast(IN_FLOOR_SIDE);return}
  if(e && ceilingIds.value.has(e.id)){
    const zone=ceilingZone(e.kind)
    const ok=zone?checkCeilingZ(zone,form.value.z-floor.value.elevation,ceilingHere.value?.height ?? null,storeyH(floor.value.id)):true
    if(ok!==true){toast(ok);return}
  }
  if(s && (!form.value.number.trim() || floor.value.spaces.some(x=>x.id!==s.id && x.name===form.value.number.trim()))){toast('층 안에서 고유한 방번호를 입력하세요.');return}
  if(e && ![form.value.x,form.value.y,form.value.z].every(Number.isFinite)){toast('좌표에는 유효한 숫자를 입력하세요.');return}
  checkpoint()
  if(s){renameSpace(project.value.model,s.id,name);s.name=form.value.number.trim()}
  const beforeSpace=e?.spaceId ?? null
  if(e){renameEquipment(project.value.model,e.id,name);moveEquipment(project.value.model,e.id,[form.value.x,form.value.y,form.value.z])}
  const roomName=(id:string|null)=>id?(floor.value.spaces.find(x=>x.id===id)?.longName||floor.value.spaces.find(x=>x.id===id)?.name||id):'소속 없음'
  revision.value++;toast(e && (e.spaceId ?? null)!==beforeSpace ? '속성을 수정했습니다. 소속 물리존이 '+roomName(beforeSpace)+' → '+roomName(e.spaceId ?? null)+'(으)로 바뀌었습니다(좌표로 다시 판정).' : '속성을 수정했습니다. 검증·미리보기 후 저장하세요.')
}
function startDraw(tool:'room'|'custom'|'hvac') { drawTool.value=tool;points.value=[];view.value='plan';newNumber.value=String(100+floor.value.spaces.length+1);editMode.value='space';toast('평면에서 꼭짓점을 찍고 Enter로 완성하세요. Esc는 취소입니다.') }
function planClick(event: MouseEvent) {
  if(!drawTool.value && !placeEquipment.value)return
  const svg=planSvg.value!
  const p=svg.createSVGPoint();p.x=event.clientX;p.y=event.clientY
  const m=svg.getScreenCTM();if(!m)return
  const at=p.matrixTransform(m.inverse())
  const xy:Vec2=[Math.round(at.x*2)/2,Math.round(at.y*2)/2]
  if(drawTool.value==='split'){points.value.push(xy);if(points.value.length===2)finishSplit();return}
  if(placeEquipment.value) placeAt(xy)
  else points.value.push(xy)
}
// --- 공간 단위 편집: 나누기(선 긋기)·경계 꼭짓점 끌기(OE-SPC-02·03·08) ---
const selectedZoneKind = computed<'space'|'custom'|''>(() => selectedSpace.value ? 'space' : selectedCustom.value ? 'custom' : '')
function startSplit() {
  if(!selectedZoneKind.value)return
  drawTool.value='split';points.value=[];view.value='plan';editMode.value='space';toast('평면에서 점 두 개를 찍어 나눌 선을 그으세요. 선이 경계를 두 번 지나야 합니다. Esc 는 취소입니다.')
}
function finishSplit() {
  const [a,b]=points.value
  const kind=selectedZoneKind.value, id=selected.value
  const before=snapshotFloor(project.value.model,floor.value.id)
  points.value=[];drawTool.value=''
  const r=kind==='space'?splitSpace(project.value.model,id,a,b):kind==='custom'?splitCustomZone(project.value.model,id,a,b):null
  if(!r || ('refused' in r)){toast(r && 'refused' in r ? r.refused : '나눌 수 없습니다.');return}
  history.value.push(before);future.value=[];revision.value++
  toast((kind==='space'?'물리존':'커스텀존')+'을 둘로 나눴습니다. '+(kind==='space'?'새 조각의 방번호를 넣어 주세요. 공조존 담당은 두 조각 모두 이어받습니다.':'넓은 쪽이 원래 이름을 이어받습니다.'))
}
const dragIndex = ref<number | null>(null)
const vertexRing = computed<readonly Vec2[] | null>(() => {
  if(view.value!=='plan' || editMode.value!=='space' || drawTool.value || placeEquipment.value) return null
  const ring = selectedSpace.value?.footprint ?? selectedCustom.value?.footprint
  return ring && ring.length>=3 ? ring : null
})
const vertexList = computed(() => { const r=vertexRing.value; if(!r) return []; const closed=r.length>1&&r[0][0]===r[r.length-1][0]&&r[0][1]===r[r.length-1][1]; return closed?r.slice(0,-1):r })
const edgeLabels = computed(() => {
  const v=vertexList.value; if(v.length<3)return []
  return v.map((a,i)=>{const b=v[(i+1)%v.length];return {i,x:(a[0]+b[0])/2,y:(a[1]+b[1])/2,len:Math.hypot(b[0]-a[0],b[1]-a[1])}})
})
// MAP-01~03 이 방과 연결: 소속 설비 수, 이 방을 담당하는 공조존(N:M)
const spaceRelations = computed(() => {
  const s=selectedSpace.value; if(!s)return null
  const equip=floor.value.equipment.filter(e=>e.spaceId===s.id)
  const zones=hvacHere.value.filter(z=>z.spaceIds.includes(s.id))
  return {equip,zones,nm:zones.length>1}
})
// OE-EQP-14 종류 지정(사람) — 종류를 모르는 설비는 사람이 정한다. 출처는 사람.
function setKind(value:string) {
  const e=selectedEquipment.value; if(!e)return
  if(value && !kindInfo(value)){toast('알 수 없는 종류입니다.');return}
  checkpoint()
  if(!e.kindEdited)e.kindEdited={from:e.kind ?? null}
  e.kind=value||null
  if(e.kindEdited.from===e.kind)delete e.kindEdited
  revision.value++;toast('종류를 '+(value?kindInfo(value)?.label:'모름')+'(으)로 정했습니다(출처: 사람).')
}
function planXY(event: MouseEvent): Vec2 | null {
  const svg=planSvg.value; if(!svg)return null
  const pt=svg.createSVGPoint();pt.x=event.clientX;pt.y=event.clientY
  const m=svg.getScreenCTM(); if(!m)return null
  const at=pt.matrixTransform(m.inverse())
  return [Math.round(at.x*2)/2,Math.round(at.y*2)/2]
}
function beginVertex(i:number) { checkpoint(); dragIndex.value=i }
function dragVertex(event: MouseEvent) {
  const i=dragIndex.value; if(i===null)return
  const xy=planXY(event); if(!xy)return
  const cur=vertexList.value[i]; if(cur && cur[0]===xy[0] && cur[1]===xy[1])return
  if(selectedSpace.value){ moveSpaceVertex(project.value.model,selected.value,i,xy) }
  else if(selectedCustom.value){
    const ring=selectedCustom.value.footprint
    ring[i]=xy
    if(i===0 && ring.length>1 && ring[0]!==ring[ring.length-1]) ring[ring.length-1]=xy
  }
  revision.value++
}
function endVertex() { if(dragIndex.value!==null){dragIndex.value=null;revision.value++} }
function removeVertex(i:number) {
  if(!selectedSpace.value) { toast('커스텀존 꼭짓점 삭제는 지원하지 않습니다.'); return }
  checkpoint(); const r=deleteSpaceVertex(project.value.model,selected.value,i)
  if(!r){history.value.pop();toast('꼭짓점이 세 개 미만이 되어 지울 수 없습니다.');return}
  revision.value++
}
function zoneChanged(message: string) { revision.value++; toast(message) }
function finishDraw() {
  if(points.value.length<3){toast('꼭짓점을 3개 이상 찍으세요.');return}
  if(!newName.value.trim()){toast('구역 이름을 입력하세요.');return}
  if(drawTool.value==='room' && (!newNumber.value.trim() || floor.value.spaces.some(s=>s.name===newNumber.value.trim()))){toast('고유한 방번호를 입력하세요.');return}
  const ring=[...points.value,points.value[0]]
  if(isSelfIntersecting(ring)||polygonArea(ring)<.01){toast('변이 교차하거나 넓이가 없는 구역입니다. 점을 차례로 찍으세요.');return}
  const before=snapshotFloor(project.value.model,floor.value.id)
  if(drawTool.value==='hvac'){
    const z=createZoneFromOutline(project.value.model,floor.value.id,{footprint:points.value,name:newName.value})
    if(!z || ('refused' in z)){toast(z && 'refused' in z ? z.refused : '공조존을 만들 수 없습니다.');return}
    history.value.push(before);future.value=[];points.value=[];drawTool.value='';layer.value='hvac';selected.value=z.id;revision.value++;toast('공조존을 그려 만들었습니다. 겹치는 물리존이 담당입니다.');return
  }
  const result=drawTool.value==='room'
    ? createSpace(project.value.model,floor.value.id,{name:newNumber.value.trim(),longName:newName.value.trim(),footprint:points.value})
    : createCustomZone(project.value.model,floor.value.id,{name:newName.value.trim(),footprint:points.value})
  if(!result || ('refused' in result)){toast(result && 'refused' in result ? result.refused : '구역을 만들 수 없습니다.');return}
  history.value.push(before);future.value=[];points.value=[];drawTool.value='';revision.value++;toast('구역을 만들고 설비 소속을 다시 계산했습니다.')
}
function placeAt(at: Vec2) {
  if(!placeEquipment.value)return
  const target=selectedEquipment.value?.position===null?selectedEquipment.value:null
  const kind=target?.kind ?? equipmentType.value
  let z=floor.value.elevation
  if(ceilingModeOn.value){
    if(!ceilingHere.value){toast('천장고(h_c)를 모릅니다. [천장고] 칸에 먼저 입력하세요.');return}
    if(!canMountOn({kind},'ceiling')){toast(NOT_ON_CEILING);return}
    const range=ceilingRange(ceilingZone(kind) ?? 'attached',ceilingHere.value.height,storeyH(floor.value.id))
    z=floor.value.elevation+(range?.base ?? ceilingHere.value.height)
  }
  checkpoint()
  if(target) moveEquipment(project.value.model,selected.value,[at[0],at[1],z])
  else {
    const e=addEquipment(project.value.model,floor.value.id,{name:equipmentName.value.trim(),kind:equipmentType.value,position:[at[0],at[1],z]})
    if(e){layer.value='equipment';selected.value=e.id}
  }
  placeEquipment.value=false;revision.value++;toast('설비를 배치하고 소속을 계산했습니다.')
}
function beginEquipment() {
  if(!equipmentName.value.trim()){toast('설비 이름을 입력하세요.');return}
  if(ceilingModeOn.value && !ceilingHere.value){modal.value='';toast('천장고(h_c)를 모릅니다. [천장고] 칸에 먼저 입력하세요.');return}
  if(ceilingModeOn.value && !canMountOn({kind:equipmentType.value},'ceiling')){modal.value='';toast(NOT_ON_CEILING);return}
  modal.value='';placeEquipment.value=true;editMode.value='equipment';selected.value='';toast('선택한 층 바닥을 클릭해 설비를 배치하세요. Esc로 취소합니다.')
}
function setSurface(value: string) {
  const e = selectedEquipment.value; if (!e) return
  checkpoint()
  const r = setEquipmentSurface(project.value.model, e.id, (value || null) as Surface | null)
  if (typeof r === 'object') { history.value.pop(); toast(r.refused); return }
  revision.value++; toast('설치면을 ' + (value ? SURFACE_LABEL[value as Surface] : '자동 판정') + '(으)로 정했습니다.')
}
const outside = computed(() => selectedEquipment.value ? outsideAllowed(selectedEquipment.value.kind, judgedMap.value.get(selectedEquipment.value.id) ?? null) : false)
function removeEquipment() {
  if(!selectedEquipment.value || editMode.value!=='equipment')return
  if(ceilingIds.value.has(selected.value) && !ceilingModeOn.value){toast(IN_CEILING_MODE);return}
  if(ceilingModeOn.value && !ceilingIds.value.has(selected.value)){toast(IN_FLOOR_SIDE);return}
  checkpoint();deleteEquipment(project.value.model,selected.value);selected.value='';revision.value++
}
// --- IDF 검토(OE-IDF-11) · 공조존 만들기(OE-ZON-01·02) ---
type Review = { model: Model; idf: IdfState; pending: boolean; existing: number }
const review = ref<Review | null>(null)
const idfInput = ref<HTMLInputElement>()
function openIdfReview() {
  const pr = project.value
  if (!pr.idf) return
  review.value = { model: pr.model, idf: pr.idf, pending: false, existing: 0 }
  modal.value = 'idf'
}
function confirmReview() {
  const r = review.value; if (!r) return
  const pr = project.value
  if (r.pending) { pr.model = r.model; pr.idf = { ...r.idf, confirmed: true } }
  else pr.idf!.confirmed = true
  addLog(pr, 'IDF 검토', floor.value.name, null, r.idf.name)
  persist(); revision.value++; modal.value = ''; review.value = null
  toast('IDF 검토를 마쳤습니다. 확인한 존↔물리존 매칭과 담당 설비가 온톨로지에 포함됩니다.')
}
function cancelReview() { const was = review.value?.pending; modal.value = ''; review.value = null; if (was) toast('IDF 반영을 취소했습니다. 기존 데이터는 그대로입니다.') }
async function appendIdf(event: Event) {
  const f = (event.target as HTMLInputElement).files?.[0]
  ;(event.target as HTMLInputElement).value = ''
  if (!f) return
  busy.value = true; sourceError.value = ''
  try {
    if (!/\.idf$/i.test(f.name)) throw new Error('IDF 파일을 선택하세요.')
    const idf = readIdf(await f.text())
    const next = attachIdf(clone(project.value.model), idf, f.name)
    const state = reactive<IdfState>({ name: f.name, confirmed: false, matchOk: {}, report: next.report })
    review.value = { model: next.model, idf: state, pending: true, existing: project.value.model.hvac?.zones.length ?? 0 }
    modal.value = 'idf'
  } catch (e) { sourceError.value = e instanceof Error ? e.message : String(e) }
  finally { busy.value = false }
}
function openHvacNew() {
  if (!floor.value) return
  page.value = 'editor'; editMode.value = 'space'; modal.value = 'hvac-new'
}
function createHvac(spec: { name: string; spaceIds: string[]; servedBy: string[] }) {
  const before = snapshotFloor(project.value.model, floor.value.id)
  const z = createZoneFromSpaces(project.value.model, { spaceIds: spec.spaceIds, name: spec.name, servedBy: spec.servedBy })
  if (!z || ('refused' in z)) { toast(z && 'refused' in z ? z.refused : '공조존을 만들 수 없습니다.'); return }
  history.value.push(before); future.value = []
  modal.value = ''; layer.value = 'hvac'; selected.value = z.id; revision.value++; toast('공조존을 만들었습니다. 고른 물리존이 담당입니다.')
}
function drawHvac(name: string) { if (name.trim()) newName.value = name; modal.value = ''; startDraw('hvac') }
function hvacChanged(message: string) { revision.value++; toast(message) }
function download(name:string,body:BlobPart,type:string) {
  addLog(project.value,'파일 다운로드',floor.value.name,null,name)
  const url=URL.createObjectURL(new Blob([body],{type}))
  const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000)
}
const output = shallowRef<{ttl:string;geojson:string;hash:string;entities:number;unread:number}>()
watch([projectId,floorId,revision],()=>{output.value=undefined})
async function buildOutput() {
  const files=storeyFiles(exportModelOf(project.value),floor.value.id)
  if(!files)throw new Error('내보낼 층이 없습니다.')
  const parsed=readOntologyTTL(files.ttl)
  const bytes=new TextEncoder().encode(files.ttl+files.geojson)
  const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('')
  output.value={ttl:files.ttl,geojson:files.geojson,hash,entities:parsed.entities.length,unread:parsed.unread.length}
  return files
}
async function commit() {
  if(busy.value)return
  busy.value=true
  try {
    const wasInitial=initial.value
    const files=await buildOutput()
    const artifact=output.value
    const v=applyVersion(project.value,floor.value.id)
    addLog(project.value,'반영',floor.value.name,v.number,wasInitial?'최초 구축':undefined)
    seen.value={...seen.value,[floor.value.id]:v.number}
    const stored=persist()
    savedSignature();modal.value='';page.value='report';revision.value++
    await nextTick();output.value=artifact
    download(files.ttlName,files.ttl,'text/turtle');download(files.geojsonName,files.geojson,'application/geo+json')
    toast('v'+v.number+' '+(wasInitial?'구축':'반영')+' 완료 · '+(stored?'브라우저 데모 저장':'현재 탭에만 저장')+' · DT 등록은 내려받은 파일로 진행하세요.')
  } catch(e){toast(e instanceof Error?e.message:String(e))}
  finally{busy.value=false}
}
async function exportAgain() {
  try{const f=await buildOutput();download(f.ttlName,f.ttl,'text/turtle');download(f.geojsonName,f.geojson,'application/geo+json')}
  catch(e){toast(String(e))}
}
function reportDownload() {
  download(floor.value.name+'.report.json',JSON.stringify({generatedAt:new Date().toISOString(),project:project.value.name,source:project.value.source,
    ...report.value,scopeName:floor.value.name,artifacts:output.value?{sha256:output.value.hash,entities:output.value.entities,unread:output.value.unread}:null},null,2),'application/json')
}
function restoreChosen() {
  if(!chosenVersion.value)return
  try{
    const nv=restoreVersion(project.value,floor.value.id,chosenVersion.value.number);addLog(project.value,'되돌리기',floor.value.name,nv.number,'v'+chosenVersion.value.number+' 기준');persist();revision.value++;modal.value='';toast('복원 결과를 새 버전으로 저장했습니다. DT 미연동 데모입니다.')
  }catch(e){toast(String(e))}
}
function newProject() {
  if(!newSite.value.trim()){toast('사이트 이름을 입력하세요.');return}
  const p=makeProject(emptyModel(newSite.value.trim()),'빈 층 · 수동 구축')
  projects.value.push(p);projectId.value=p.id;floorId.value=p.model.storeys[0].id;persist();modal.value='';enter(floorId.value)
}
function addFloor() {
  const p=project.value
  const s:Storey={id:newId(),name:String(p.model.storeys.length+1)+'F',elevation:p.model.storeys.length*4,spaces:[],walls:[],openings:[],equipment:[]}
  p.model.storeys.push(s);p.original[s.id]=clone(s);persist();enter(s.id)
}
let worker:Worker|undefined
function importIfc(bytes:ArrayBuffer):Promise<{model:Model;meshes:MeshMap}> {
  worker=new Worker(new URL('../../../../src/lib/ifc/import.worker.ts',import.meta.url),{type:'module'})
  const w=worker
  return new Promise((resolve,reject)=>{
    w.onmessage=e=>{
      const d=e.data
      if(d.type==='progress')progress.value=d.progress.stage+' '+(d.progress.done??'')
      else { w.terminate();worker=undefined;d.type==='done'?resolve({model:d.model,meshes:new Map(d.meshes)}):reject(new Error(d.message)) }
    }
    w.onerror=e=>{w.terminate();worker=undefined;reject(new Error(e.message || 'IFC 워커 오류'))}
    w.postMessage({bytes,wasmBase:new URL(import.meta.env.BASE_URL,location.href).href},[bytes])
  })
}
async function importFiles(event: Event) {
  const files=Array.from((event.target as HTMLInputElement).files??[])
  if(!files.length)return
  ;(event.target as HTMLInputElement).value=''
  busy.value=true;sourceError.value=''
  try {
    if(files.some(f=>!/\.(ifc|idf)$/i.test(f.name)))throw new Error('IFC 또는 IDF 파일을 선택하세요.')
    let model:Model|undefined
    const mm:MeshMap=new Map()
    const ifcs=files.filter(f=>/\.ifc$/i.test(f.name))
    const idfs=files.filter(f=>/\.idf$/i.test(f.name))
    if(idfs.length>1)throw new Error('IDF는 한 번에 하나를 선택하세요.')
    for(const f of ifcs){
      progress.value=f.name+' 읽는 중'
      const done=await importIfc(await f.arrayBuffer())
      if(model){const merged=mergeModels(model,done.model);model=merged.model}else model=done.model
      for(const [id,mesh] of done.meshes)mm.set(id,mesh)
    }
    let idfState:IdfState|undefined
    for(const f of idfs){
      const idf=readIdf(await f.text())
      const done=model?attachIdf(model,idf,f.name):modelFromIdf(idf,f.name)
      model=done.model
      idfState={name:f.name,confirmed:false,matchOk:{},report:done.report as IdfAttachReport}
    }
    if(!model?.storeys.length)throw new Error('층 정보가 없습니다. 건축 IFC를 함께 선택하거나 빈 층에서 시작하세요.')
    const p=makeProject(model,files.map(f=>f.name).join(' + '))
    p.name=model.buildingName || files[0].name
    if(idfState)p.idf=idfState
    projects.value.push(p);meshMaps.set(p.id,mm);projectId.value=p.id;floorId.value=model.storeys[0].id
    persist();page.value='dashboard';toast('임포트 완료 · 층을 선택해 검토하세요. 형상 메시 캐시는 이 탭에만 유지됩니다.')
    if(idfState)openIdfReview()
  }catch(e){sourceError.value=e instanceof Error?e.message:String(e)}
  finally{busy.value=false;progress.value=''}
}
function trapFocus(event: KeyboardEvent) {
  const els = Array.from((event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('button:not(:disabled),input,select'))
  if (!els.length) return
  if (event.shiftKey && document.activeElement === els[0]) { event.preventDefault(); els.at(-1)?.focus() }
  else if (!event.shiftKey && document.activeElement === els.at(-1)) { event.preventDefault(); els[0].focus() }
}
function keyboard(e:KeyboardEvent) {
  if(e.key==='Escape'){modal.value='';drawTool.value='';points.value=[];placeEquipment.value=false;return}
  if((e.target as HTMLElement).matches('input,textarea,select'))return
  if(page.value!=='editor' || modal.value)return
  if(e.key==='Enter' && drawTool.value){e.preventDefault();finishDraw()}
  if((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?redo():undo()}
  if((e.ctrlKey||e.metaKey) && e.key.toLowerCase()==='s'){e.preventDefault();save()}
}
function beforeUnload(e:BeforeUnloadEvent){if(dirty.value){e.preventDefault();e.returnValue=''}}
watch(modal,async value=>{if(value){await nextTick();document.querySelector<HTMLElement>('.modal input,.modal button')?.focus()}})
onMounted(()=>{window.addEventListener('keydown',keyboard);window.addEventListener('beforeunload',beforeUnload)})
onBeforeUnmount(()=>{window.removeEventListener('keydown',keyboard);window.removeEventListener('beforeunload',beforeUnload);worker?.terminate()})
</script>

<template>
<div class="studio">
  <aside class="sidebar">
    <a class="brand" href="./prototype.html"><span class="brand-icon">O</span><span>Ontology<span class="brand-sub">STUDIO</span></span></a>
    <div class="workspace-label">WORKSPACE <span>R1</span></div>
    <nav aria-label="주 메뉴">
      <button :class="{active:page==='dashboard'}" @click="go('dashboard')"><span>▦</span> 구축 워크스페이스</button>
      <button :class="{active:page==='editor'}" @click="navigate(()=>enter(floor.id))"><span>◇</span> 레이아웃 에디터</button>
      <button :class="{active:page==='report'}" @click="go('report')"><span>▤</span> 검증 &amp; 리포트</button>
      <button :class="{active:page==='versions'}" @click="go('versions')"><span>↶</span> 버전 히스토리</button>
      <button :class="{active:page==='log'}" data-testid="nav-log" @click="go('log')"><span>☰</span> 시스템 로그</button>
      <div class="nav-divider"></div>
      <button :class="{active:page==='requirements'}" @click="go('requirements')"><span>≡</span> 요구사항 탐색</button>
      <a href="./index.html" target="_blank" rel="noopener"><span>↗</span> BIM 상세 에디터</a>
    </nav>
    <div class="sidebar-note"><span class="dot"></span> 로컬 프로토타입<p>PRD_011 기반<br>DT 연결: 파일 내보내기</p></div>
    <div class="profile-avatar"><b>김</b><div>구축 담당자<small>Prototype workspace</small></div></div>
  </aside>
  <main>
    <header class="topbar"><div class="breadcrumb">워크스페이스 <span>/</span> {{ project.model.siteName }}</div><div class="topbar-right"><button class="bell" aria-label="알림" data-testid="bell" @click="notifOpen=!notifOpen;unread=0">🔔<b v-if="unread" data-testid="bell-count">{{ unread }}</b></button><span class="pill neutral">브라우저 저장 데모</span><a href="./viewer.html" target="_blank" rel="noopener">산출물 뷰어 ↗</a><span class="avatar">김</span></div></header>
    <div v-if="notifOpen" class="notif-pop" data-testid="notif-pop" role="region" aria-label="알림"><b>시스템 알림</b><p v-if="!notifs.length" class="footnote">알림이 없습니다.</p><button v-for="n in notifs" :key="n.at" @click="notifOpen=false">레이아웃 변경 {{ n.type=='되돌리기'?'되돌리기':'반영' }} · {{ n.floor }} · v{{ n.version }} <small>{{ new Date(n.at).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}) }}</small></button></div>
    <div v-if="newer" class="notice banner" role="status" data-testid="layout-banner">레이아웃이 v{{ latestVersion }} 로 바뀌었습니다. <button @click="refreshLayout">새로고침</button></div>
    <div v-if="storageError" class="notice error" role="alert">{{ storageError }}</div>
    <div v-if="message" class="notice toast" role="status">{{ message }}<button aria-label="알림 닫기" @click="message=''">×</button></div>
    <div v-if="sourceError" class="notice error" role="alert">{{ sourceError }}</div>
    <div v-if="busy" class="notice" role="status"><span class="spinner"></span> {{ progress || '산출물을 생성하는 중…' }}</div>
    <input ref="idfInput" class="file-input" aria-label="IDF 추가로 가져오기" type="file" accept=".idf" @change="appendIdf">
    <input ref="fileInput" class="file-input" aria-label="IFC IDF 가져오기" type="file" accept=".ifc,.idf" multiple @change="importFiles">

    <section v-if="page==='dashboard'" class="content dashboard">
      <div class="page-heading"><div><div class="eyebrow">ONTOLOGY AUTOMATION PLATFORM</div><h1>온톨로지 구축 워크스페이스</h1><p>공간과 설비를 연결하고, 디지털 트윈의 기준을 만드세요.</p></div><button class="primary" :disabled="busy" @click="modal='new'">＋ 새 사이트</button></div>
      <div class="hero"><div><span class="pill blue">초기 구축 → 운영 편집</span><h2>BIM에서 온톨로지까지,<br>하나의 워크플로우로.</h2><p>가져오기 · 검토 · 보정 · 검증 · 생성<br>층별 상태를 확인하고 다음 작업을 이어가세요.</p><div class="button-row"><button class="primary" :disabled="busy" @click="fileInput?.click()">↥ IFC / IDF 가져오기</button><button @click="modal='new'">빈 층에서 시작</button></div></div><div class="hero-visual" aria-hidden="true"><svg viewBox="0 0 370 220"><defs><linearGradient id="slab" x2="0" y2="1"><stop stop-color="#e2ecff"/><stop offset="1" stop-color="#f3f6fe"/></linearGradient></defs><path d="M30 155 170 85 330 155 190 222Z" fill="#e5eaf3"/><path d="M30 126 170 56 330 126 190 193Z" fill="url(#slab)" stroke="#bcccec"/><path d="M30 96 170 26 330 96 190 164Z" fill="#fff" stroke="#b5c8ee"/><path d="M30 96v30l160 67v-29M330 96v30l-140 67" fill="#dce6f8" opacity=".7"/><g fill="none" stroke="#a1b9e5"><path d="m82 70 158 68M130 46l160 68M82 118l142-68M137 142l142-69"/></g><g fill="#3975e7" stroke="#fff" stroke-width="3"><circle cx="137" cy="91" r="7"/><circle cx="224" cy="110" r="7"/><circle cx="198" cy="65" r="7"/></g><path d="m137 91 61-26 26 45" fill="none" stroke="#3975e7" stroke-dasharray="5 4"/><rect x="232" y="24" width="116" height="31" rx="8" fill="#fff" stroke="#dce4f0"/><text x="243" y="44" fill="#3568bf" font-size="12">hasLocation ✓</text></svg><span class="visual-caption">Geometry + Semantics</span></div></div>
      <div class="metrics"><article><span>전체 층</span><strong>{{ counts.storeys }}<small>개</small></strong><p>층 단위 구축 · 편집</p></article><article><span>물리존</span><strong>{{ counts.spaces }}<small>개</small></strong><p>방과 공간의 경계</p></article><article><span>설비</span><strong>{{ counts.devices }}<small>대</small></strong><p>덕트·배관 {{ counts.conduits }}개 별도</p></article><article><span>구축 완료</span><strong>{{ Object.keys(project.published).length }}<small>/ {{ counts.storeys }}</small></strong><p>이 브라우저의 반영본</p></article></div>
      <div class="hvac-guide" data-testid="hvac-guide"><b>공조존 생성 방법</b><span>IDF 가 있으면 공조존과 담당 설비를 가져오고, 없으면 직접 만듭니다.</span><button :disabled="busy" @click="idfInput?.click()">IDF 추가로 가져오기</button><button @click="openHvacNew">공조존 직접 만들기</button><span v-if="project.idf?.report?.alignment != null && project.idf.report.alignment < 0.5" class="notice error" data-testid="align-warn">좌표 정합 경고: IDF 공조존 중 BIM 물리존 범위에 든 것이 {{ Math.round(project.idf.report.alignment*100) }}% 뿐입니다. 두 파일의 원점이 다를 수 있습니다.</span><button v-if="project.idf" @click="openIdfReview">IDF 검토 열기<span> {{ project.idf.confirmed?'· 확인됨':'· 미확인' }}</span></button></div>
      <div class="section-heading"><div><h2>사이트 &amp; 층</h2><p>{{ project.source }}</p></div><div class="button-row"><select aria-label="사이트 선택" :value="projectId" @change="chooseProject"><option v-for="p in projects" :key="p.id" :value="p.id">{{ p.name }}</option></select><button @click="addFloor">＋ 층 추가</button></div></div>
      <div class="floor-grid"><article v-for="s in project.model.storeys" :key="s.id" class="floor-card"><div class="floor-top"><span class="floor-icon">◇</span><span class="pill" :class="project.published[s.id]?'green':'neutral'">{{ project.published[s.id]?'구축 완료':'초기 구축 대기' }}</span></div><h3>{{ s.name }} <small>{{ project.name }}</small></h3><div class="floor-plan-thumb"><svg viewBox="0 0 300 95" aria-hidden="true"><path d="M24 15h252v65H24zM98 15v65M204 15v65M24 44h252" fill="#f0f4fc" stroke="#b8c8e2" stroke-width="1.5"/><g fill="#5c86d5"><circle cx="62" cy="30" r="3"/><circle cx="151" cy="61" r="3"/><circle cx="244" cy="30" r="3"/></g><text v-if="!s.spaces.length" x="115" y="55" fill="#6b7587" font-size="12">빈 층</text></svg></div><div class="floor-data"><span>물리존 <b>{{ s.spaces.length }}</b></span><span>설비 <b>{{ s.equipment.length }}</b></span><span>높이 <b>{{ s.elevation }} m</b></span></div><div class="floor-bottom"><span>{{ project.drafts[s.id]?'임시 저장본 있음':project.published[s.id]?'v'+(project.versions[s.id]?.[0]?.number??1):'온톨로지 없음' }}</span><button :class="{primary:!project.published[s.id]}" @click="enter(s.id)">{{ modeFor(project,s.id) }} →</button></div></article></div>
      <div class="workflow-strip"><span><b>01</b> 가져오기</span><i>→</i><span><b>02</b> 검토 &amp; 보정</span><i>→</i><span><b>03</b> 검증</span><i>→</i><span><b>04</b> 생성 &amp; 내보내기</span></div>
      <p class="footnote">SR 캠퍼스는 합성 데모입니다. 새 IFC/IDF를 가져오면 실제 파일을 분석한 별도 사이트가 만들어집니다.</p>
    </section>

    <section v-else-if="page==='editor'" class="editor-page">
      <div class="editor-heading"><div><span class="pill blue">{{ mode }}</span><h1>{{ project.name }} <span>/</span> {{ floor.name }}</h1><span class="save-state">{{ dirty?'● 저장하지 않은 변경':project.drafts[floor.id]?'임시 저장본 편집 중':'저장됨' }}</span></div><div class="button-row"><button @click="save">임시 저장</button><button @click="modal='preview'">미리보기</button><button class="primary" :disabled="!gate.pass||busy" :title="gate.pass?'검증 후 내보내기':gate.blocking.join(' / ')" @click="modal='apply'">{{ initial?'구축하기':'반영하기' }}</button><button @click="go('dashboard')">편집 종료</button></div></div>
      <div class="editor-context"><select aria-label="작업 층" :value="floor.id" @change="switchFloor"><option v-for="s in project.model.storeys" :key="s.id" :value="s.id">{{ s.name }}</option></select><div class="segmented"><button :class="{active:editMode==='space'}" @click="editMode='space'">공간 편집</button><button :class="{active:editMode==='equipment'}" @click="editMode='equipment'">설비 편집</button></div><div v-if="editMode==='equipment'" class="segmented" role="group" aria-label="설치면 편집 모드"><button :class="{active:surfaceMode==='floor'}" data-testid="mode-floor" @click="setSurfaceMode('floor')">바닥·벽</button><button :class="{active:surfaceMode==='ceiling'}" data-testid="mode-ceiling" @click="setSurfaceMode('ceiling')">천장</button></div><div class="button-row"><button aria-label="되돌리기" :disabled="!history.length" @click="undo">↶</button><button aria-label="다시 실행" :disabled="!future.length" @click="redo">↷</button></div><button v-if="project.idf" @click="openIdfReview">IDF 검토<span> {{ project.idf.confirmed?'✓':'· 미확인' }}</span></button><button data-testid="sim-other-editor" title="데모: 다른 사용자가 이 층을 반영한 상황을 만듭니다" @click="simulateOther">데모: 다른 사용자 반영</button><span class="context-note">좌표: 건물 로컬 · m <span class="separator">|</span> {{ project.source }}</span></div>
      <div class="editor-grid">
        <aside class="objects"><h3>오브젝트 <span>{{ rows.length }}</span></h3><div class="layer-tabs"><button v-for="l in [{key:'spaces',name:'물리존'},{key:'equipment',name:'설비'},{key:'custom',name:'커스텀존'},{key:'hvac',name:'공조존'}]" :key="l.key" :class="{active:layer===l.key}" @click="layer=l.key as typeof layer">{{ l.name }}</button></div><input v-model="search" placeholder="이름 · 방번호 검색" aria-label="오브젝트 검색"><div v-if="layer==='equipment'" class="surface-filter" role="group" aria-label="설치면 필터"><button v-for="f in [{k:'all',n:'전체',c:surfaceStats.total},{k:'ceiling',n:'천장',c:surfaceStats.ceiling},{k:'floor',n:'바닥',c:surfaceStats.floor},{k:'wall',n:'벽',c:surfaceStats.wall},{k:'unknown',n:'미정',c:surfaceStats.unknown}]" :key="f.k" :class="{active:surfaceFilter===f.k}" :data-testid="'sf-'+f.k" @click="surfaceFilter=f.k as SurfaceFilter">{{ f.n }} <small>{{ f.c }}</small></button></div><div class="object-list"><button v-for="r in rows.slice(0,200)" :key="r.id" :class="{selected:selected===r.id}" @click="select(r.id); if(editMode==='equipment'&&selectedEquipment?.position===null) placeEquipment=true"><span class="object-icon">{{ r.type==='설비'?'⊙':'◇' }}</span><div>{{ r.name }}<small>{{ r.detail }}</small></div></button><p v-if="!rows.length" class="empty-text">아직 오브젝트가 없습니다.</p><p v-if="rows.length>200" class="footnote">앞 200개 표시 · 검색으로 좁히세요.</p></div><div class="tools"><span>편집 도구</span><template v-if="editMode==='space'"><button @click="startDraw('room')">＋ 물리존 그리기</button><button @click="startDraw('custom')">＋ 커스텀존 그리기</button><button @click="modal='hvac-new'">＋ 공조존 만들기</button></template><button v-else @click="modal='add-equipment'">＋ 설비 배치</button><a href="./index.html" target="_blank" rel="noopener">벽·문·배관 상세 편집 ↗</a></div></aside>
        <div class="model-stage"><div class="view-switch segmented"><button :class="{active:view==='3d'}" @click="view='3d';drawTool='';points=[]">3D</button><button :class="{active:view==='plan'}" @click="view='plan'">평면도</button></div>
          <div class="zone-filter" role="group" aria-label="존 종류별 보기 필터"><span>존 보기</span><button v-for="k in zoneKinds" :key="k.key" :class="{active:zoneShow[k.key]}" :aria-pressed="zoneShow[k.key]" :disabled="!k.count" :title="k.count?'화면에서만 켜고 끕니다. 저장본·내보내기에는 남지 않습니다.':k.name+'이 이 층에 없습니다'+(k.key==='hvac'?' — IDF 를 가져오면 보입니다':'')" @click="zoneShow[k.key]=!zoneShow[k.key]">{{ k.name }} <small>{{ k.count }}</small></button><i class="zf-sep"></i><button :class="{active:layers.walls}" :aria-pressed="layers.walls" :disabled="!wallsHere.length" :title="refWalls?'BIM 벽에 형상이 없어 물리존 외곽선을 따라 세운 참고 벽입니다(화면에서만)':wallsHere.length?'벽을 켜고 끕니다':'이 층에는 벽이 없습니다'" @click="layers.walls=!layers.walls">벽<span v-if="refWalls"> (참고)</span> <small>{{ wallsHere.length }}</small></button><span class="zf-label" title="이 층의 반자 높이 h_c. 모르면 천장 설비를 놓을 수 없습니다">천장고(h_c)</span><label class="zf-ceiling" title="이 층의 반자 높이(m). 비우면 BIM 값으로 돌아갑니다"><input v-model="ceilingInput" type="number" step=".1" min="0" aria-label="천장 높이(m)" placeholder="m" @change="applyCeiling"></label></div>
          <Scene v-if="view==='3d'" ref="stage" :model="project.model" :floor-id="floor.id" :revision="revision" :selected="selected" :place="placeEquipment" :meshes="meshes" :original="project.original" :zone-show="zoneShow" :layers="layers" :ceiling-mode="ceilingModeOn" :ceiling-marks="ceilingMarks" :dim="dimmed" :hidden="hiddenEquipment" :selected-hvac="selectedHvac?.id ?? ''" @pick="select" @place="placeAt" @failed="view='plan';toast('3D를 시작하지 못해 평면도를 표시합니다: '+$event)" />
          <svg v-else ref="planSvg" class="plan" :viewBox="[bounds.x,bounds.y,bounds.w,bounds.h].join(' ')" aria-label="층 평면도" @click="planClick" @mousemove="dragVertex" @mouseup="endVertex" @mouseleave="endVertex"><defs><pattern id="grid" width="1" height="1" patternUnits="userSpaceOnUse"><path d="M 1 0 L 0 0 0 1" fill="none" stroke="#dee4ed" stroke-width=".02"/></pattern></defs><rect :x="bounds.x" :y="bounds.y" :width="bounds.w" :height="bounds.h" fill="url(#grid)"/><g v-for="(s,i) in (zoneShow.space?floor.spaces:[])" :key="s.id" class="plan-room" @click="!drawTool&&!placeEquipment&&select(s.id)"><polygon :points="pathOf(s.footprint)" :fill="selected===s.id?'#cbdcff':i%2?'#e7edf8':'#eef2f9'" :stroke="selected===s.id?'#3975e7':'#aebcd4'" stroke-width=".08"/><text :x="center(s.footprint)[0]" :y="center(s.footprint)[1]" text-anchor="middle" font-size=".65" fill="#4b5f7f">{{ s.longName || s.name }}</text></g><polygon v-for="z in (zoneShow.custom?floor.customZones:[])" :key="z.id" :points="pathOf(z.footprint)" :fill="selected===z.id?'#3975e744':'#3975e722'" stroke="#3975e7" :stroke-width="selected===z.id?.12:.06" stroke-dasharray=".3 .2" @click="!drawTool&&!placeEquipment&&select(z.id)"/><g v-if="layers.walls" class="plan-walls"><polygon v-for="w in wallsHere.flatMap(w=>(w.footprint??[]).map((r,i)=>({k:w.id+':'+i,r})))" :key="w.k" :points="pathOf(w.r)" fill="#39424e33" stroke="#39424e" stroke-width=".05"/></g><template v-if="zoneShow.hvac"><g v-for="z in hvacHere" :key="z.id" class="plan-hvac" @click="!drawTool&&!placeEquipment&&select(z.id)"><polygon v-for="(ring,ri) in z.footprint" :key="ri" :points="pathOf(ring)" :fill="selected===z.id?'#ffb34744':'#ffb34714'" :stroke="selected===z.id?'#d9822b':'#e59a45'" :stroke-width="selected===z.id?.12:.07" stroke-dasharray=".5 .25"/></g></template><g v-for="m in ceilingMarks.filter(m=>!hiddenEquipment.has(m.id))" :key="'ring-'+m.id" class="plan-ring"><circle :cx="m.at[0]" :cy="m.at[1]" r=".5" fill="none" :stroke="m.zone==='plenum'?'#8b5cf6':'#0ea5a4'" stroke-width=".07" stroke-dasharray=".18 .12"/></g><g v-for="e in floor.equipment.filter(e=>e.position && !hiddenEquipment.has(e.id))" :key="e.id" :opacity="dimmed.has(e.id)?.3:1" @click.stop="!drawTool&&!placeEquipment&&select(e.id)"><circle :cx="e.position![0]" :cy="e.position![1]" :r="selected===e.id ? .28 : .19" :fill="selected===e.id?'#1c50b7':'#4c83e3'" stroke="#fff" stroke-width=".06"><title>{{ e.name }}</title></circle></g><g v-if="vertexList.length" class="plan-handles"><circle v-for="(p,i) in vertexList" :key="i" :cx="p[0]" :cy="p[1]" r=".28" fill="#fff" stroke="#e5484d" stroke-width=".1" style="cursor:grab" :data-testid="'vertex-'+i" @mousedown.stop.prevent="beginVertex(i)" @dblclick.stop="removeVertex(i)"><title>끌어서 옮기기 · 두 번 눌러 지우기</title></circle></g><g v-if="vertexList.length" class="plan-dims" data-testid="plan-dims"><text v-for="l in edgeLabels" :key="l.i" :x="l.x" :y="l.y" text-anchor="middle">{{ l.len.toFixed(2) }}m</text></g><polyline v-if="points.length" :points="pathOf(points)" fill="#3975e71a" stroke="#3975e7" stroke-width=".08"/><circle v-for="(p,i) in points" :key="i" :cx="p[0]" :cy="p[1]" r=".12" fill="#3975e7"/></svg>
          <div v-if="drawTool==='split'" class="draw-bar" data-testid="split-bar"><span>나눌 선: 점 {{ points.length }}/2 · 0.5m 그리드 · Esc 취소</span><button @click="drawTool='';points=[]">취소</button></div><div v-else-if="drawTool" class="draw-bar"><input v-model="newName" aria-label="구역 이름" placeholder="구역 이름"><input v-if="drawTool==='room'" v-model="newNumber" aria-label="새 방번호" placeholder="방번호"><span>{{ points.length }}점 · 0.5m 그리드</span><button class="primary" @click="finishDraw">완성</button><button @click="drawTool='';points=[]">취소</button></div><div v-if="placeEquipment" class="stage-hint">바닥을 클릭하여 {{ selectedEquipment?.name || equipmentName }} 배치 · Esc 취소</div>
          <div class="stage-footer"><span><i class="dot"></i> {{ floor.name }} · {{ floor.spaces.length }}개 물리존 · {{ floor.equipment.length }}대 설비</span><button @click="stage?.frame()">전체 보기 ⤢</button></div><div class="axis" aria-hidden="true"><b>Z</b><span>Y ↗</span><span> X →</span></div>
        </div>
        <aside class="inspector"><div class="section-heading"><h3>{{ selected?'선택 속성':'구축 상태' }}</h3><span class="pill neutral">{{ selectedHvac?'공조존':selectedEquipment?'설비':selectedSpace?'물리존':'층' }}</span></div>
          <template v-if="selectedHvac||(layer==='hvac'&&!selectedSpace&&!selectedEquipment)"><HvacPanel :model="project.model" :floor="floor" :zone="selectedHvac" :revision="revision" @before="checkpoint" @changed="hvacChanged" @refused="toast" @deleted="selected=''" /></template>
          <template v-else-if="selectedCustom"><div class="selected-title">{{ selectedCustom.name }}</div><span class="source-chip">사람 · 편집</span><label>면적<span class="field-value">{{ polygonArea(selectedCustom.footprint).toFixed(1) }} ㎡</span></label><ZoneTools v-if="editMode==='space'" :model="project.model" :floor="floor" kind="custom" :id="selected" @before="checkpoint" @changed="zoneChanged" @refused="toast" @deleted="selected=''" @split="startSplit" /><p v-else class="footnote">공간 편집 모드에서 편집하세요.</p></template><template v-else-if="selectedSpace||selectedEquipment"><div class="selected-title">{{ selectedSpace?.longName || selectedEquipment?.name }}</div><span class="source-chip">{{ (selectedSpace?.added||selectedEquipment?.added)?'사람 · 편집':'BIM / 원본' }}</span><label>이름<input v-model="form.name" aria-label="선택 이름"></label><label v-if="selectedSpace">방번호<input v-model="form.number" aria-label="선택 방번호"></label><template v-if="selectedEquipment"><label>설비 종류<span class="field-value">{{ equipmentKind(selectedEquipment.kind)?.label || selectedEquipment.kind || '미분류' }}</span></label><div class="coordinate-fields"><label>X<input v-model.number="form.x" type="number" step=".1" aria-label="X 좌표"></label><label>Y<input v-model.number="form.y" type="number" step=".1" aria-label="Y 좌표"></label><label>Z<input v-model.number="form.z" type="number" step=".1" aria-label="Z 좌표"></label></div><label>소속 물리존<span class="field-value">{{ floor.spaces.find(s=>s.id===selectedEquipment?.spaceId)?.longName || '소속 없음' }} <small>{{ selectedEquipment.spaceSource==='bim'?'BIM':selectedEquipment.spaceSource?'계산 / 사람':'미정' }}</small></span></label><label>종류 지정<select :value="selectedEquipment.kind ?? ''" aria-label="설비 종류 지정" @change="setKind(($event.target as HTMLSelectElement).value)"><option value="">모름</option><option v-for="k in EQUIPMENT_KINDS" :key="k.kind" :value="k.kind">{{ k.label }}</option></select><small v-if="selectedEquipment.kindEdited">출처: 사람</small></label><label>설치면<span class="field-value" data-testid="surface-row">{{ judgedLabel(judgedMap.get(selectedEquipment.id)) }} <small>허용 {{ allowedLabel(selectedEquipment.kind) ?? '미정' }}</small></span></label><p v-if="outside" class="footnote warn">판정 설치면이 허용 설치면 밖입니다. 허용 설치면이 앞섭니다(Q9).</p><label v-if="allowedLabel(selectedEquipment.kind)!==null || judgedMap.get(selectedEquipment.id)===null">설치면 지정<select :value="selectedEquipment.surfaceSet ?? ''" aria-label="설치면 지정" @change="setSurface(($event.target as HTMLSelectElement).value)"><option value="">자동 판정</option><option v-for="(n,k) in SURFACE_LABEL" :key="k" :value="k">{{ n }}</option></select></label><p class="footnote">좌표 출처: {{ selectedEquipment.positionSource==='edited'?'사람':selectedEquipment.positionSource?'형상 계산':'BIM' }}</p></template><label v-if="selectedSpace">면적<span class="field-value">{{ selectedSpace.areaM2.toFixed(1) }} ㎡</span></label><div v-if="spaceRelations" class="relation-box" data-testid="space-relations"><b>이 방과 연결</b><span>소속 설비 {{ spaceRelations.equip.length }}대 <small>(좌표로 판정 · OE-MAP-01)</small></span><span>공조존 {{ spaceRelations.zones.length }}개<span v-if="spaceRelations.zones.length"> — {{ spaceRelations.zones.map(z=>z.name).join(", ") }}</span><small v-if="spaceRelations.nm"> · 한 방이 여러 공조존에 걸침(N:M 허용)</small></span></div><button class="primary wide" @click="saveProperties">속성 적용</button><ZoneTools v-if="selectedSpace && editMode==='space'" :model="project.model" :floor="floor" kind="space" :id="selected" @before="checkpoint" @changed="zoneChanged" @refused="toast" @deleted="selected=''" @split="startSplit" /><button v-if="selectedEquipment && editMode==='equipment'" class="wide danger" @click="removeEquipment">설비 삭제</button><details><summary>고유 ID</summary><code>{{ selected }}</code></details></template>
          <template v-else><p class="muted">오브젝트를 선택하면 속성과 출처를 확인할 수 있습니다.</p><div class="gate-title"><span class="pill" :class="gate.pass?'green':'amber'">{{ gate.pass?'생성 가능':'보정 필요' }}</span><small>D1 제안 기준</small></div><div v-for="r in gate.rows" :key="r.label" class="gauge-row"><div><span>{{ r.label }}</span><b>{{ r.have }}/{{ r.total }}</b></div><div class="gauge"><i :style="{width:r.value*100+'%'}" :class="{warn:!r.pass}"></i></div><small>기준 {{ r.threshold*100 }}% · 현재 {{ r.total?Math.round(r.value*100)+'%':'해당 없음' }}</small></div><div class="inspector-note"><b>생성 게이트 등급 2</b><p>계통·연결은 목표선입니다. 기준선 미달과 방번호 중복은 생성을 막습니다.</p></div><GradeChips :model="project.model" :revision="revision" /><WarningsPanel :model="project.model" :floor="floor" :revision="revision" /><h4>온톨로지 관계</h4><div class="relation"><span>{{ floor.name }}</span><i>hasPart</i><span>물리존</span><i>hasLocation ←</i><span>설비</span></div><p class="footnote">임시 저장과 버전은 이 브라우저에만 남습니다. 실제 DT에 반영되지 않습니다.</p></template>
        </aside>
      </div>
    </section>

    <section v-else-if="page==='requirements'" class="content">
      <div class="page-heading"><div><div class="eyebrow">PRODUCT REQUIREMENTS</div><h1>요구사항 탐색</h1><p>docs/prd의 정본 {{ catalog.length }}개 기능 · 작성 상태를 구현 완료로 해석하지 않습니다.</p></div><span class="pill blue">PRD_011</span></div>
      <div class="filters"><input v-model="query" placeholder="기능 ID · 기능명 · Epic 검색" aria-label="요구사항 검색"><select v-model="release" aria-label="릴리즈 필터"><option value="all">전체 릴리즈</option><option>R1</option><option>R2</option></select><select v-model="ticketStatus" aria-label="기획 상태 필터"><option value="all">전체 기획 상태</option><option value="prd-done">기획 작성 완료</option><option value="prd-updated">기획 수정됨</option><option value="prd-review">기획 검토 중</option></select><span>{{ filteredTickets.length }}개</span></div>
      <div class="requirements-grid"><div class="ticket-list"><button v-for="t in filteredTickets" :key="t.id" :class="{selected:ticket.id===t.id}" @click="ticket=t"><span class="ticket-id">{{ t.id }} <small>{{ t.release }} · {{ t.priority }}</small></span><b>{{ t.title }}</b><span>{{ t.epic }}</span><i class="pill" :class="{green:t.status==='prd-done',blue:t.status==='prd-updated',amber:t.status==='prd-review'}">{{ {'prd-done':'기획 작성 완료','prd-updated':'기획 수정됨'}[t.status] ?? '기획 검토 중' }}</i></button></div><article class="ticket-detail"><span class="eyebrow">{{ ticket.id }} · {{ ticket.release }} · {{ ticket.priority }}</span><h2>{{ ticket.title }}</h2><p class="muted">{{ ticket.epic }}</p><h3>요구사항</h3><pre>{{ ticket.requirement }}</pre><h3>수용 기준</h3><pre>{{ ticket.criteria }}</pre><div class="inspector-note">정본을 빌드 시 읽어 표시합니다. 검토 중인 기능은 구현 완료를 의미하지 않습니다.</div></article></div>
    </section>

    <section v-else-if="page==='log'" class="content" data-testid="log-page">
      <div class="page-heading"><div><div class="eyebrow">SYSTEM LOG</div><h1>시스템 로그</h1><p>반영과 되돌리기는 한 번에 한 줄이고 확정 저장입니다. 임시 저장·파일 다운로드는 복구용 기록으로 따로 적습니다(OE-COM-04·GEN-05).</p></div></div>
      <table class="log-table"><tbody><tr><th>이벤트 유형</th><th>일시</th><th>사용자</th><th>대상 층</th><th>버전</th><th>구분</th></tr>
        <tr v-for="e in project.log ?? []" :key="e.at+e.type"><td>{{ e.type }}</td><td>{{ new Date(e.at).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}) }}</td><td>{{ e.user }}</td><td>{{ e.floor }}</td><td>{{ e.version ? 'v'+e.version : '-' }}</td><td>{{ isCommitted(e)?'확정 저장':'복구용 기록' }}<small v-if="e.note"> · {{ e.note }}</small></td></tr></tbody></table>
      <p v-if="!(project.log ?? []).length" class="footnote">아직 기록이 없습니다.</p>
    </section>

    <section v-else-if="page==='versions'" class="content">
      <div class="page-heading"><div><div class="eyebrow">VERSION HISTORY</div><h1>버전 히스토리</h1><p>최근 1주일의 반영본 · 되돌리기는 기존 이력을 보존하고 새 버전을 만듭니다.</p></div><select v-model="floorId" aria-label="히스토리 층"><option v-for="s in project.model.storeys" :key="s.id" :value="s.id">{{ s.name }}</option></select></div>
      <div class="notice">브라우저 데모입니다. 다중 사용자 동기화·잠금·DT 서버 반영은 연결하지 않았습니다. <button data-testid="sim-other" @click="simulateOther">다른 사용자 반영 시뮬레이션</button></div>
      <article v-for="(v,i) in versions" :key="v.number" class="version-card"><div class="version-marker">v{{ v.number }}</div><div><h3>{{ v.summary }} <span v-if="i===0" class="pill blue">현재 버전</span></h3><p>{{ floor.name }} · {{ new Date(v.at).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'}) }} · {{ v.author }}</p></div><div class="button-row"><button @click="chosenVersion=v;toast('v'+v.number+' 리포트: 물리존 '+v.report.counts.spaces+'개, 설비 '+v.report.counts.devices+'대, 게이트 '+(v.report.gate.pass?'통과':'미달'));download(floor.name+'-v'+v.number+'.report.json',JSON.stringify(v.report,null,2),'application/json')">결과 리포트</button><button :disabled="i===0" @click="chosenVersion=v;modal='restore'">되돌리기</button></div></article><div v-if="!versions.length" class="empty-state"><span>↶</span><h2>아직 반영한 버전이 없습니다</h2><p>초기 구축을 완료하면 첫 버전이 만들어집니다.</p><button class="primary" @click="enter(floor.id)">초기 구축 시작 →</button></div>
    </section>

    <section v-else class="content report-page">
      <div class="page-heading"><div><div class="eyebrow">VALIDATION &amp; BUILD REPORT</div><h1>검증 &amp; 생성 리포트</h1><p>{{ project.name }} / {{ floor.name }} · 현재 작업 모델 기준</p></div><div class="button-row"><select v-model="floorId" aria-label="리포트 층"><option v-for="s in project.model.storeys" :key="s.id" :value="s.id">{{ s.name }}</option></select><button @click="reportDownload">리포트 JSON ↓</button><button class="primary" :disabled="!gate.pass" @click="exportAgain">TTL + GeoJSON ↓</button></div></div>
      <div class="report-summary" :class="{blocked:!gate.pass}"><span>{{ gate.pass?'✓':'!' }}</span><div><h2>{{ gate.pass?'온톨로지 생성 기준을 충족했습니다':'생성 전 보정이 필요합니다' }}</h2><p>{{ gate.policy }} · DT 등록 경로는 파일 내보내기</p></div><button @click="enter(floor.id)">에디터에서 확인 →</button></div>
      <div class="report-grid"><article class="report-card"><h3>01 파일 요약</h3><p>{{ project.source }}</p><div class="key-values"><span>스키마<b>{{ project.model.schema }}</b></span><span>대상 층<b>{{ floor.name }}</b></span><span>물리존 / 설비<b>{{ report.counts.spaces }}개 / {{ report.counts.devices }}대</b></span></div></article><article class="report-card"><h3>02 판정 등급</h3><div v-for="r in gate.rows" :key="r.label" class="report-line"><span>{{ r.label }}</span><b :class="r.pass?'text-blue':'text-amber'">{{ r.have }}/{{ r.total }} · {{ r.pass?'통과':'미달' }}</b></div><p class="footnote">계통·방향은 목표선이며 생성 차단과 구분합니다.</p></article><article class="report-card"><h3>03 자동 생성 범위 · 출처</h3><p>물리존: {{ floor.spaces.filter(s=>!s.added).length }} 원본 · {{ floor.spaces.filter(s=>s.added).length }} 사람</p><p>설비: {{ floor.equipment.filter(e=>!e.added).length }} 원본 · {{ floor.equipment.filter(e=>e.added).length }} 사람</p><p>소속: BIM {{ floor.equipment.filter(e=>e.spaceSource==='bim').length }} · 계산/사람 {{ floor.equipment.filter(e=>e.spaceSource && e.spaceSource!=='bim').length }}</p></article><article class="report-card"><h3>04 요구사항 판정</h3><p>필수 누락 {{ report.requirements.filter(r=>r.level==='필수'&&r.state==='missing').length }} · 권장 누락 {{ report.requirements.filter(r=>r.level==='권장'&&r.state==='missing').length }}</p><details><summary>요구사항별 결과</summary><div v-for="r in report.requirements" :key="r.id" class="requirement-result"><b>{{ r.id }} {{ r.title }}</b><span>{{ r.state }} · {{ r.note }}</span></div></details></article><article class="report-card"><h3>05 보정 항목</h3><p v-for="b in gate.blocking" :key="b" class="text-amber">{{ b }}</p><p v-if="gate.pass">기준선 필수 보정 없음</p><p>미배치 설비 {{ report.excluded.length }}대</p><button @click="enter(floor.id);layer='equipment'">설비 목록에서 보정 →</button></article><article class="report-card"><h3>06 자동 보정 내역</h3><p>형상 배치점 보정 {{ floor.equipment.filter(e=>e.positionSource==='geometry').length }}대</p><p>분전반 좌표 보정 {{ floor.equipment.filter(e=>e.positionSource==='panel').length }}대</p><p class="footnote">기존 임포터의 출처 필드로 집계합니다.</p></article><article class="report-card"><h3>07 좌표 정합</h3><p>건물 로컬 좌표 · 단위 m</p><p>지리 변환: {{ project.model.facts?.mapConversion?'BIM 명시':'미확인' }}</p><p class="footnote">파일 합치기는 기존 merge 규칙을 사용합니다. 좌표 정합은 사용자 검토가 필요합니다.</p></article><article class="report-card"><h3>08 BIM 밖 항목</h3><p v-for="item in report.outsideBim" :key="item">{{ item }}</p></article><article class="report-card"><h3>09 사람 확정 현황</h3><p>미확정 규칙 방향 {{ report.unconfirmed }}개</p><p>커스텀존 {{ floor.customZones?.length??0 }}개</p><p class="footnote">규칙 방향은 확정 전 feeds로 내보내지 않습니다.</p></article><article class="report-card"><h3>10 검증 결과</h3><div v-for="c in report.checks" :key="c.key" class="check-result"><span>{{ c.rule }}</span><b>{{ c.skipped?'측정 불가':c.total===0?'대상 없음':c.failed.length?'위반 '+c.failed.length:'통과' }}</b></div><details v-if="report.warnings.length"><summary>임포트 경고 {{ report.warnings.length }}개</summary><p v-for="w in report.warnings" :key="w">{{ w }}</p></details></article><article class="report-card artifacts"><h3>11 산출물</h3><div class="artifact-pair"><div><span>TTL</span><b>Brick 의미 모델</b><small>계층 · 소속 · 연결</small></div><div><span>GEO</span><b>GeoJSON 공간 모델</b><small>경계 · 위치 · 동일 ID</small></div></div><p v-if="output">DT 수신 규칙 reader: {{ output.entities }}개 엔티티 · 수신 대상 밖 {{ output.unread }}개</p><details v-if="output"><summary>SHA-256</summary><code>{{ output.hash }}</code></details><p v-else class="footnote">내보내기를 실행하면 파서 확인 결과와 해시가 표시됩니다.</p><p class="footnote">{{ report.parser }}</p></article></div>
      <article class="output-panel"><GradeChips :model="project.model" :revision="revision" /></article>
      <OutputPanel :model="project.model" :floor="floor" :meshes="meshes" :output="output" :busy="busy" @build="buildOutput().catch(e=>toast(String(e)))" @download="download" @notice="toast" />
    </section>
  </main>
  <div v-if="modal" class="modal-backdrop" @click.self="modal=''"><section class="modal" :class="{'wide-modal':modal==='idf'||modal==='hvac-new'}" role="dialog" aria-modal="true" :aria-label="modal==='leave'?'저장하지 않은 변경':'작업 확인'" @keydown.tab="trapFocus">
    <button class="modal-close" aria-label="대화상자 닫기" @click="modal=''">×</button>
    <template v-if="modal==='idf'&&review"><IdfReview :model="review.model" :idf="review.idf" :report="review.idf.report" :pending="review.pending" :existing="review.existing" @confirm="confirmReview" @cancel="cancelReview" /></template>
    <template v-else-if="modal==='hvac-new'"><HvacCreate :floor="floor" @create="createHvac" @draw="drawHvac" @cancel="modal=''" /></template>
    <template v-else-if="modal==='new'"><div class="eyebrow">NEW WORKSPACE</div><h2>빈 층에서 시작</h2><p>물리존과 설비를 직접 배치하여 첫 온톨로지를 만듭니다.</p><label>사이트 이름<input v-model="newSite" aria-label="새 사이트 이름" @keydown.enter="newProject"></label><p class="footnote">수동 구축은 R2 기능의 체험용 구현입니다.</p><button class="primary wide" @click="newProject">사이트 만들기 →</button></template>
    <template v-else-if="modal==='leave'"><h2>저장하지 않은 변경이 있습니다</h2><p>임시 저장하면 이 브라우저에서 이어서 편집할 수 있습니다.</p><div class="button-row"><button @click="modal=''">취소</button><button @click="leave('discard')">저장 안 함</button><button class="primary" @click="leave('save')">임시 저장 후 이동</button></div></template>
    <template v-else-if="modal==='add-equipment'"><h2>설비 배치</h2><label>설비 이름<input v-model="equipmentName" aria-label="새 설비 이름"></label><label>종류<select v-model="equipmentType" aria-label="새 설비 종류"><option v-for="k in EQUIPMENT_KINDS.filter(k=>!ceilingModeOn||canMountOn({kind:k.kind},'ceiling'))" :key="k.kind" :value="k.kind">{{ k.label }}</option></select></label><p v-if="ceilingModeOn" class="footnote">천장 편집 모드라 천장에 놓을 수 있는 종류만 보입니다.</p><p>다음 화면에서 층 바닥을 클릭하여 놓습니다.</p><button class="primary wide" @click="beginEquipment">배치 시작 →</button></template>
    <template v-else-if="modal==='restore'"><h2>v{{ chosenVersion?.number }}로 되돌릴까요?</h2><p>선택한 {{ floor.name }}의 레이아웃을 새 버전으로 반영합니다. 기존 이력은 유지됩니다.</p><p class="footnote">브라우저 데모 · DT에는 전송하지 않습니다.</p><button class="primary wide" @click="restoreChosen">새 버전으로 되돌리기</button></template>
    <template v-else><div class="eyebrow">{{ modal==='preview'?'CHANGE PREVIEW':'PUBLISH CHECK' }}</div><h2>{{ modal==='preview'?'변경 미리보기':initial?'온톨로지를 구축할까요?':'변경을 반영할까요?' }}</h2><p>{{ project.name }} / {{ floor.name }}</p><div v-if="modal==='preview'" class="preview-scene"><Scene :model="project.model" :floor-id="floor.id" :revision="revision" selected="" :place="false" :meshes="meshes" :original="project.original" @failed="toast('미리보기 3D 초기화 실패: '+$event)" /></div><ul class="change-list"><li v-for="c in changes" :key="c">{{ c }}</li><li v-if="!changes.length">{{ initial?'임포트 모델의 최초 구축':'반영본과 변경 없음' }}</li></ul><WarningsPanel v-if="modal==='preview'" compact :model="project.model" :floor="floor" :revision="revision" /><p class="footnote">영향: 현재 층의 공간·설비 소속·온톨로지 파일. 관제·알림·AI 서비스 영향은 DT 미연동으로 측정하지 않습니다.</p><div class="notice" :class="{error:!gate.pass}">{{ gate.pass?'생성 기준 통과':gate.blocking.join(' / ') }}</div><p class="footnote">TTL·GeoJSON을 내려받고 새 버전을 이 브라우저에 저장합니다. 실제 DT 등록은 파일로 진행합니다.</p><div class="button-row"><button @click="modal=''">편집 계속</button><button class="primary" :disabled="!gate.pass||busy" @click="modal==='preview'?modal='apply':commit()">{{ modal==='preview'?'다음: 생성 확인':initial?'구축 & 내보내기':'데모 반영 & 내보내기' }}</button></div></template>
  </section></div>
</div>
</template>
