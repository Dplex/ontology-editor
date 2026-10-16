<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch } from 'vue'
import type { Model, Vec2, Storey } from '../../../../src/lib/model'
import type { MeshMap } from '../../../../src/lib/ifc/import'
import { createViewer, type Viewer, type CeilingView, type CeilingMark } from '../../../../src/lib/viewer'
import { withReferenceWalls } from './refwalls'
import { ceilingOf } from '../../../../src/lib/ceiling'
const props = defineProps<{ model: Model; floorId: string; floorIds?: string[]; revision: number; selected: string; zoneShow?: {space:boolean;custom:boolean;hvac:boolean}; layers?: {walls:boolean;ceiling:boolean}; ceilingMode?: boolean; ceilingMarks?: CeilingMark[]; dim?: ReadonlySet<string>; hidden?: ReadonlySet<string>; selectedHvac?: string; place: boolean; meshes?: MeshMap; original?: Record<string,Storey> }>()
const emit = defineEmits<{ pick: [id: string]; place: [at: Vec2]; failed: [message: string] }>()
const canvas = ref<HTMLCanvasElement>()
let viewer: Viewer | undefined
function draw(keepView = true) {
  if (!viewer) return
  const show = props.zoneShow ?? {space:true,custom:true,hvac:true}
  // 물리존을 끄면 물리존이 없는 모델로 그린다(화면에서만 — 편집 상태는 그대로다).
  const base = withReferenceWalls(props.model,props.meshes)
  const shown = show.space ? base : {...base,storeys:base.storeys.map(s => ({...s,spaces:[]}))}
  viewer.setModel(shown,props.meshes,{keepView})
    const positions=new Map(Object.values(props.original??{}).flatMap(s=>s.equipment.filter(e=>e.position).map(e=>[e.id,e.position!] as const)))
  for(const floor of props.model.storeys)for(const e of floor.equipment){
    const before=positions.get(e.id), after=e.position
    if(before && after && props.meshes?.has(e.id) && before.some((v,i)=>v!==after[i]))
      viewer.shiftEquipment(e.id,[after[0]-before[0],after[1]-before[1],after[2]-before[2]])
  }
  const floor = props.model.storeys.find(s => s.id === props.floorId)
  // 다중층 보기면 범위의 층을 함께 그린다(OE-ML-01). 아니면 한 층만(OE-UI-12).
  const shownFloors = new Set(props.floorIds?.length ? props.floorIds : [props.floorId])
  const hidden = new Set(props.model.storeys.filter(s => !shownFloors.has(s.id)).flatMap(s => s.equipment.map(e => e.id)))
  for(const id of props.hidden ?? [])hidden.add(id)
  viewer.setStoreyFilter(shownFloors,hidden)
  viewer.setCustomZones(show.custom ? props.model : null,props.selected)
  viewer.setHvacZones(show.hvac ? props.model : null,props.selectedHvac || null)
  const layers = props.layers ?? {walls:true,ceiling:true}
  viewer.setArchitecture(props.model,null)
  viewer.setWallsVisible(layers.walls)
  // 천장면은 반자 높이를 아는 층만 그린다(BIM 값 또는 사람이 정한 값). 모르면 지어내지 않는다.
  const planes: CeilingView['planes'] = []
  for(const st of props.model.storeys){
    const c = ceilingOf(st)
    if(!c || st.id!==props.floorId) continue
    const rings = st.spaces.filter(sp => sp.footprint.length>=4).map(sp => sp.footprint)
    if(rings.length) planes.push({storeyId:st.id,z:st.elevation+c.height,rings})
  }
  // 천장면은 천장 편집 모드이거나 레이어의 천장이 켜져 있으면 반투명으로 그린다(OE-OBJ-08 · OE-UI-19). 평소 천장 설비는 바닥 링으로도 보인다(OE-EQP-04).
  const ceilingOn = props.ceilingMode || layers.ceiling
  viewer.setCeilingView(ceilingOn && planes.length ? {planes,dim:props.ceilingMode ? (props.dim ?? new Set()) : new Set()} : null)
  const hiddenSet = props.hidden ?? new Set<string>()
  viewer.setCeilingMarks(props.ceilingMode ? [] : (props.ceilingMarks ?? []).filter(m => !hiddenSet.has(m.id)),props.selected || null)
  viewer.setPlaceMode(props.place ? floor?.elevation ?? 0 : null)
  viewer.setHighlight(props.selected ? {selected:props.selected,upstream:new Set(),downstream:new Set(),linked:new Set()} : null)
}
onMounted(() => {
  try {
    viewer = createViewer(canvas.value!)
    viewer.onPick(id => emit('pick',id ?? ''))
    viewer.onPickSpace(id => emit('pick',id ?? ''))
    viewer.onPlace(at => emit('place',at))
    draw(false)
    viewer.frameAll()
  } catch(e) { emit('failed',e instanceof Error ? e.message : '3D 화면 초기화 실패') }
})
watch(() => [props.revision,props.floorId,props.floorIds?.join(','),props.selected,props.place,props.zoneShow?.space,props.zoneShow?.custom,props.zoneShow?.hvac,props.selectedHvac,props.layers?.walls,props.layers?.ceiling,props.ceilingMode,props.ceilingMarks,props.dim,props.hidden],() => draw())
onBeforeUnmount(() => viewer?.dispose())
defineExpose({frame:() => viewer?.frameAll(),top:() => viewer?.topView()})
</script>
<template><canvas ref="canvas" class="studio-canvas" aria-label="온톨로지 3D 모델. 드래그로 이동, Shift 드래그로 회전, 휠로 확대합니다." /></template>
