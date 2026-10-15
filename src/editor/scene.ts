import { watch } from 'vue'
import type { Model } from '../lib/model'
import { findSpaceObject, moveSpaceObject } from '../lib/space-object'
import { createViewer, type Viewer } from '../lib/viewer'
import { editLock, refuseLock } from './ceiling'
import { connectFrom, connectTo } from './connections'
import { openContext } from './context-menu'
import { canvas, dark, editing, model } from './core'
import { selectedElementId } from './equipment-edit'
import { cm, dropEquipment } from './equipment-shape'
import { cycleFlow, equipmentById, selectedId } from './flow-rules'
import { dragAlign, onPlaceHover } from './grid-snap'
import { onHover } from './hover-tip'
import { showWalls } from './idf-zones'
import { dropVertex, pickVertex } from './keyboard'
import { addBoxToGroup, editNotice, group, toggleGroup } from './multi-select'
import { meshes } from './open-file'
import { placeAt } from './place'
import { sceneVersion } from './redraw'
import { pickSpace } from './rooms'
import { changeObjects, selectObject } from './space-objects'
import { multiView, onRotate, rotateHandle } from './vertical'

export let viewer: Viewer | null = null

let drawn: Model | null = null
let drawTimer: number | undefined

/** 화면이 붙을 때 한 번 — 이 모듈의 watch·이벤트·타이머. App.vue 가 부른다. */
export function setupScene() {
  watch([model, canvas], ([m, el]) => {
    if (!m || !el) return
    if (!viewer) {
      viewer = createViewer(el)
      viewer.onContext(openContext)
      viewer.onPick((id, additive) => {
        if (connectFrom.value && id) return connectTo(id)
        if (additive && id) return toggleGroup(id)
        group.value = []
        selectedId.value = id
      })
      viewer.onBoxSelect(addBoxToGroup)
      viewer.onHover(onHover)
      viewer.onPlace((at) => placeAt(at))
      viewer.onPlaceHover(onPlaceHover)
      viewer.setDragSnap(dragAlign)
      viewer.onPickSpace(pickSpace)
      viewer.onEquipmentMove(dropEquipment)
      viewer.onFrozenGrab((id) => {
        const e = equipmentById.value.get(id)
        const lock = e ? editLock(e) : null
        if (e && lock) refuseLock(e, lock)
      })
      viewer.onPickElement((id) => (selectedElementId.value = id))
      viewer.onPickObject(selectObject)
      viewer.onObjectMove((id, delta) => {
        const o = model.value && findSpaceObject(model.value, id)
        if (o) changeObjects(id, `${o.object.name} 옮김`, (m) => moveSpaceObject(m, id, [cm(delta[0]), cm(delta[1])]))
      })
      viewer.onVertexPick(pickVertex)
      viewer.onVertexMove(dropVertex)
      viewer.onRotate(onRotate)
      viewer.setRotateHandle(rotateHandle.value)
      viewer.onArrowClick(cycleFlow)
      viewer.setWallsVisible(showWalls.value)
      viewer.setEditMode(editing.value && !multiView.value)
      viewer.setHandleEdit(editing.value && !!multiView.value)
      viewer.setDark(dark.value)
    }
    // 편집이 보낸 갱신(triggerRef)으로는 다시 만들지 않는다(redraw 참조). 새 모델일 때만이다.
    if (m === drawn) return
    // 한 태스크 뒤에 그린다. 여는 태스크에 합치기가 이미 0.4초라, 3D 준비(성수 0.35초)까지 붙이면 그만큼 더 멈췄다.
    window.clearTimeout(drawTimer)
    drawTimer = window.setTimeout(() => {
      const now = model.value
      if (!viewer || !now || now === drawn) return
      drawn = now
      viewer.setModel(now, meshes)
      sceneVersion.value++
    }, 0)
  })
  watch(editing, (on) => {
    viewer?.setEditMode(on && !multiView.value)
    editNotice.value = ''
  })
}
