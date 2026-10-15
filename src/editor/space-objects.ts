import type { Object3D } from 'three'
import { computed, ref, shallowRef, triggerRef, watch } from 'vue'
import { snapshotSpaceObjects } from '../lib/edit'
import { josa } from '../lib/josa'
import type { Model, Vec2 } from '../lib/model'
import { snapAxis } from '../lib/shortcuts'
import { addCustomItem, addSpaceObject, deleteSpaceObject, findSpaceObject, libraryItem, libraryOf, MODEL_MAX_BYTES, moveSpaceObject, renameSpaceObject, resizeSpaceObject } from '../lib/space-object'
import { lambertize } from '../lib/viewer'
import { baseline } from './changes'
import { connectFrom } from './connections'
import { model } from './core'
import { adding, selectedElementId, stopAdd } from './equipment-edit'
import { cm } from './equipment-shape'
import { flowVersion, selectedId } from './flow-rules'
import { mark, remember } from './history'
import { note } from './keyboard'
import { selectedSystemId } from './kinds'
import { areaChanges, editNotice } from './multi-select'
import { viewStorey } from './multi-view'
import { stopDraw, stopPlace } from './place'
import { sceneVersion } from './redraw'
import { selectedRoomId, selectedSpaceId } from './rooms'
import { viewer } from './scene'
import { askStorey, selectedCustomZoneId, targetStorey } from './space-edit'

// --- 추가 공간 오브젝트 (OE-OBJ-09 · OE-SPC-14 · OE-SPC-16 · OE-P3-08) ---------------------------------
/**
 * 리포트의 오브젝트 줄 — 사람이 놓은 것. BIM 에서 받은 가구·주변 모델(`source: 'bim'`)은 연 때 있던 것이라 편집이 아니다. 그것을 옮기거나
 * 지운 것은 편집 파일의 `bimObjects` 로 세고(edit-file.ts), 리포트에는 `bimObjectLines` 로 따로 보인다.
 */
export const objectLines = computed(() =>
  (model.value?.storeys ?? []).flatMap((st) =>
    (st.spaceObjects ?? []).filter((o) => o.source !== 'bim').map((o) => ({
      id: o.id,
      name: o.name,
      storey: st.name,
      item: (model.value && libraryItem(model.value, o.item)?.name) ?? o.item,
      size: o.size.map((v) => v.toFixed(2)).join(' × '),
    })),
  ),
)
/** BIM 에서 받은 오브젝트 중 연 때와 달라진 것(옮김·크기·이름·종류·지움). 편집 파일의 `bimObjects` 와 같은 셈이다(edit-file.ts). */
export const bimObjectLines = computed(() => {
  void flowVersion.value
  const m = model.value
  const was = baseline.value?.bimObjects
  if (!m || !was) return []
  const now = new Map(m.storeys.flatMap((st) => (st.spaceObjects ?? []).filter((o) => o.source === 'bim').map((o) => [o.id, o] as const)))
  const out: { id: string; name: string; what: string }[] = []
  for (const [id, w] of was) {
    const o = now.get(id)
    if (!o) out.push({ id, name: w.name, what: '지움' })
    else {
      const what = [
        o.at[0] !== w.at[0] || o.at[1] !== w.at[1] ? '옮김' : '',
        o.size.some((v, k) => v !== w.size[k]) ? '크기' : '',
        o.name !== w.name ? '이름' : '',
        o.item !== w.item ? '종류' : '',
      ].filter(Boolean)
      if (what.length) out.push({ id, name: o.name, what: what.join('·') })
    }
  }
  return out
})
export const selectedObjectId = ref<string | null>(null)
export const selectedObject = computed(() => {
  const m = model.value
  const id = selectedObjectId.value
  if (!m || !id) return null
  const found = findSpaceObject(m, id)
  return found ? { ...found, item: libraryItem(m, found.object.item) } : null
})
/** 겹쳐서 막은 상대 오브젝트. 잠깐 붉게 보인다(OE-SPC-15). */
const objectConflict = ref<string | null>(null)
let objectConflictTimer: number | undefined
/** 넣은 모델(OE-P3-08)을 읽은 장면. 열쇠는 라이브러리 항목 열쇠다. 읽는 동안은 회색 상자로 그린다. */
const objectModels = shallowRef(new Map<string, Object3D>())
/** 팔레트의 라이브러리 목록을 편 상태. */
export const objectsOpen = ref(false)
export const objectLibrary = computed(() => (model.value ? libraryOf(model.value) : []))
export function selectObject(id: string | null) {
  selectedObjectId.value = id
  if (!id) return
  selectedId.value = null
  selectedSpaceId.value = null
  selectedRoomId.value = null
  selectedSystemId.value = null
  selectedElementId.value = null
  selectedCustomZoneId.value = null
}
/**
 * 오브젝트를 고친다. 층의 오브젝트를 통째로 떠 두고 되돌린다(snapshotSpaceObjects). 막히면 이유를 알리고 겹친 상대를 붉게
 * 짚는다. 끌던 것은 다시 그려 원래 자리로 돌아간다(OE-SPC-15).
 */
export function changeObjects(objectId: string | null, label: string, apply: (m: Model) => unknown, storeyId?: string): boolean {
  const m = model.value
  if (!m) return false
  const sid = storeyId ?? (objectId ? findSpaceObject(m, objectId)?.storey.id : undefined)
  if (!sid) return false
  const snapshot = snapshotSpaceObjects(m, sid)
  const at = mark()
  const done = apply(m) as boolean | { refused: string; blocked?: string } | null
  if (!done) {
    sceneVersion.value++
    return false
  }
  if (typeof done === 'object' && 'refused' in done) {
    editNotice.value = done.refused
    if (done.blocked) {
      objectConflict.value = done.blocked
      window.clearTimeout(objectConflictTimer)
      objectConflictTimer = window.setTimeout(() => (objectConflict.value = null), 1600)
    }
    sceneVersion.value++
    return false
  }
  editNotice.value = ''
  remember(label, snapshot, at)
  triggerRef(model)
  return true
}
export function startAddObject(itemKey: string) {
  const storey = targetStorey()
  if (!storey) return askStorey('오브젝트를 놓을')
  const item = model.value && libraryItem(model.value, itemKey)
  if (!item) return
  stopPlace()
  stopDraw()
  connectFrom.value = null
  if (model.value!.storeys.length > 1) viewStorey.value = storey.id
  adding.value = { storeyId: storey.id, elevation: storey.elevation, what: 'object', item: itemKey }
  viewer?.setPlaceMode(storey.elevation)
  note(`${storey.name} 바닥을 눌러 ${item.name}${josa(item.name, '을/를')} 놓습니다. 다른 오브젝트와 겹치는 자리는 막힙니다 (Esc 취소)`)
}
export function addObjectAt(at: Vec2) {
  const target = adding.value
  stopAdd()
  if (!target?.item) return
  let created: string | null = null
  const ok = changeObjects(null, '오브젝트 놓기', (m) => {
    const done = addSpaceObject(m, target.storeyId, target.item!, [cm(at[0]), cm(at[1])])
    if (done && !('refused' in done)) created = done.id
    return done
  }, target.storeyId)
  if (ok && created) {
    selectObject(created)
    note('오브젝트를 놓았습니다. 끌거나 방향키로 옮기고, 오른쪽 패널에서 크기를 바꿉니다')
  }
}
export function removeObject() {
  const o = selectedObject.value
  if (!o) return
  const name = o.object.name
  if (changeObjects(o.object.id, `${name} 지우기`, (m) => deleteSpaceObject(m, o.object.id))) {
    selectedObjectId.value = null
    note(`${name}${josa(name, '을/를')} 지웠습니다. Ctrl+Z 로 되돌립니다`)
  }
}
export function applyObjectName(name: string) {
  const o = selectedObject.value
  if (o) changeObjects(o.object.id, `오브젝트 이름 ${name.trim()}`, (m) => renameSpaceObject(m, o.object.id, name))
}
/** 가로·세로·높이 칸 하나를 고친다. 바닥 가운데 자리는 그대로다. 막히면 칸을 원래 값으로 되돌린다(모델 값이 그대로라 화면이 다시 안 그린다). */
export function applyObjectSize(axis: 0 | 1 | 2, input: HTMLInputElement) {
  const o = selectedObject.value
  if (!o) return
  const before = o.object.size[axis]
  const v = Number(input.value)
  const size = [...o.object.size] as [number, number, number]
  size[axis] = cm(v)
  if (input.value === '' || !Number.isFinite(v) || !changeObjects(o.object.id, `${o.object.name} 크기`, (m) => resizeSpaceObject(m, o.object.id, size))) input.value = String(before)
}
/** 방향키로 고른 오브젝트를 옮긴다(10cm, Shift 1m). 화면 방향에 가장 가까운 평면 축이다. */
export function nudgeObject(code: string, step: number): boolean {
  const o = selectedObject.value
  if (!o || !viewer) return false
  const { right, up } = viewer.planeAxes()
  const [ax, ay] = code === 'ArrowLeft' || code === 'ArrowRight' ? snapAxis(...right) : snapAxis(...up)
  const sign = code === 'ArrowLeft' || code === 'ArrowDown' ? -1 : 1
  changeObjects(o.object.id, `${o.object.name} 옮김`, (m) => moveSpaceObject(m, o.object.id, [cm(sign * ax * step), cm(sign * ay * step)]))
  return true
}
/** 넣은 모델(glb)을 읽어 장면으로 둔다. 같은 열쇠는 한 번만 읽는다. */
async function loadObjectModel(key: string, base64: string): Promise<Object3D | null> {
  const have = objectModels.value.get(key)
  if (have) return have
  const bytes = Uint8Array.from(atob(base64), (ch) => ch.charCodeAt(0))
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js')
  const scene = lambertize((await new GLTFLoader().parseAsync(bytes.buffer, '')).scene)
  objectModels.value = new Map(objectModels.value).set(key, scene)
  return scene
}
export const modelInput = ref<HTMLInputElement | null>(null)
/** 3D 모델 넣기(OE-P3-08). 모델 상자를 재서 라이브러리 항목을 만들고, 바로 놓기를 시작한다. */
export async function importObjectModel(file: File) {
  const m = model.value
  if (!m) return
  if (file.size > MODEL_MAX_BYTES) {
    note(`모델 파일이 ${MODEL_MAX_BYTES / 1024 / 1024}MB 를 넘습니다(${(file.size / 1024 / 1024).toFixed(1)}MB)`)
    return
  }
  const bytes = new Uint8Array(await file.arrayBuffer())
  let base64 = ''
  for (let i = 0; i < bytes.length; i += 0x8000) base64 += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  base64 = btoa(base64)
  let scene: Object3D
  try {
    const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js')
    scene = lambertize((await new GLTFLoader().parseAsync(bytes.buffer, '')).scene)
  } catch (err) {
    note(`3D 모델을 읽지 못했습니다: ${err instanceof Error ? err.message : String(err)} (glb, 또는 자료를 품은 glTF)`)
    return
  }
  const { Box3, Vector3 } = await import('three')
  const ext = new Box3().setFromObject(scene).getSize(new Vector3())
  // glTF 는 y 가 위다. 가로 x · 세로 z · 높이 y.
  const item = addCustomItem(m, file.name, [ext.x, ext.z, ext.y], base64)
  if ('refused' in item) {
    note(item.refused)
    return
  }
  objectModels.value = new Map(objectModels.value).set(item.key, scene)
  triggerRef(model)
  objectsOpen.value = true
  startAddObject(item.key)
}

export const selectedSpace = computed(() => {
  const m = model.value
  const id = selectedSpaceId.value
  if (!m || !id) return null
  for (const storey of m.storeys) {
    const space = storey.spaces.find((s) => s.id === id)
    if (space) {
      return {
        storey,
        space,
        equipment: storey.equipment.filter((e) => e.spaceId === id),
        edited: areaChanges.value.some((c) => c.spaceId === id),
      }
    }
  }
  return null
})
/** 외곽선이 없던 물리존에 3D 에서 찍어 가는 꼭짓점. 아래 "외곽선 그리기" 참조. */
/**
 * 3D 바닥에 점을 찍는 편집. `footprint` 는 외곽선이 없던 물리존에 외곽선을 그리는 것, `create` 는 새 물리존을 그리는
 * 것(E3), `split` 은 두 점으로 나눌 선을 긋는 것(E3)이다.
 */
/** `custom`·`customSplit` 은 커스텀존(OE-OBJ-01) 그리기·나누기다. `customSplit` 의 spaceId 자리에는 존 id 가 든다. */
export type Drawing = {
  purpose: 'footprint' | 'create' | 'split' | 'wall' | 'custom' | 'customSplit' | 'room' | 'hvacZone' | 'hvacZoneOutline' | 'pipe' | 'bgScale' | 'bgAnchor' | 'verticalFootprint' | 'verticalPoint'
  /** 수직 관통 오브젝트 구간 바꾸기(OE-ML-08)에서 찍는 지점이 진입인지 종료인지. */
  which?: 'entry' | 'exit'
  /**
   * 층간 배관(다중층 뷰, OE-ML-12·14). 꺾임점마다 찍을 때의 작업 높이(층 + 그 층 바닥에서 m). 공통 z 로는 마칠 때 바꾼다(OE-ML-18).
   * 있으면 층간 배관이다. `work` 는 지금 작업 높이 — 바닥을 누르면 이 높이에 찍힌다.
   */
  levels?: { storeyId: string; height: number }[]
  work?: { storeyId: string; height: number }
  /** 층별 분기(OE-ML-13)면 분기를 낼 구간 id. 첫 점이 분기 자리다. */
  branchOf?: string
  spaceId: string | null
  storeyId: string
  name: string
  elevation: number
  points: Vec2[]
}
export const drawing = ref<Drawing | null>(null)

/** 화면이 붙을 때 한 번 — 이 모듈의 watch·이벤트·타이머. App.vue 가 부른다. */
export function setupSpaceObjects() {
  // 편집 파일로 들어온 넣은 모델도 읽어 둔다. 못 읽으면 회색 상자로 남는다.
  watch(
    () => model.value?.objectLibrary?.length,
    () => {
      for (const item of model.value?.objectLibrary ?? []) {
        if (!objectModels.value.has(item.key)) loadObjectModel(item.key, item.glb).catch(() => undefined)
      }
    },
  )
  watch([model, sceneVersion, selectedObjectId, objectConflict, objectModels], () =>
    viewer?.setSpaceObjects(model.value, (key) => (model.value ? libraryItem(model.value, key) : null), objectModels.value, selectedObjectId.value, objectConflict.value),
  )
}
