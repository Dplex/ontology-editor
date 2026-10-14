<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch } from 'vue'
import type { Model, Vec2, Storey } from '../lib/model'
import type { MeshMap } from '../lib/ifc/import'
import { createViewer, type Viewer } from '../lib/viewer'
const props = defineProps<{ model: Model; floorId: string; revision: number; selected: string; place: boolean; meshes?: MeshMap; original?: Record<string,Storey> }>()
const emit = defineEmits<{ pick: [id: string]; place: [at: Vec2]; failed: [message: string] }>()
const canvas = ref<HTMLCanvasElement>()
let viewer: Viewer | undefined
function draw(keepView = true) {
  if (!viewer) return
  viewer.setModel(props.model,props.meshes,{keepView})
    const positions=new Map(Object.values(props.original??{}).flatMap(s=>s.equipment.filter(e=>e.position).map(e=>[e.id,e.position!] as const)))
  for(const floor of props.model.storeys)for(const e of floor.equipment){
    const before=positions.get(e.id), after=e.position
    if(before && after && props.meshes?.has(e.id) && before.some((v,i)=>v!==after[i]))
      viewer.shiftEquipment(e.id,[after[0]-before[0],after[1]-before[1],after[2]-before[2]])
  }
  const floor = props.model.storeys.find(s => s.id === props.floorId)
  const hidden = new Set(props.model.storeys.filter(s => s.id !== props.floorId).flatMap(s => s.equipment.map(e => e.id)))
  viewer.setStoreyFilter(new Set([props.floorId]),hidden)
  viewer.setCustomZones(props.model,props.selected)
  viewer.setHvacZones(props.model,null)
  viewer.setArchitecture(props.model,null)
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
watch(() => [props.revision,props.floorId,props.selected,props.place],() => draw())
onBeforeUnmount(() => viewer?.dispose())
defineExpose({frame:() => viewer?.frameAll()})
</script>
<template><canvas ref="canvas" class="studio-canvas" aria-label="온톨로지 3D 모델. 드래그로 이동, Shift 드래그로 회전, 휠로 확대합니다." /></template>
