// --- 고른 것이 내보내면 어디에 남나 — TTL 블록·가리키는 줄·GeoJSON feature (components/editor/ExportLines.vue) ---
// "이 설비를 옮기면 무엇이 바뀌나", "이 방은 TTL 에 어떻게 나가나" 를 파일을 내려받아 찾지 않고 옆 패널에서 본다.
// 내보내기 함수(modelToTTL·modelToGeoJSON)를 그대로 돌려 받는 쪽 규칙(read-ttl.ts)으로 다시 읽은 것이라 내려받는 파일과 같다.
// 성수 건축+기계에서 TTL 136ms(2026-10-15)라 칸을 펼쳤을 때만, 편집이 멎은 뒤에 계산한다(ExportLines.vue).
import { computed } from 'vue'
import { entityExport, exportIndex, type ExportIndex } from '../lib/export/entity-export'
import { modelToGeoJSON } from '../lib/export/geojson'
import { modelToTTL } from '../lib/export/ttl'
import { model } from './core'
import { selectedElementId } from './equipment-edit'
import { selectedElement, selectFromCompare } from './export-compare'
import { equipmentById, selected } from './flow-rules'
import { selectedSystem, selectedSystemId } from './kinds'
import { groupItems } from './multi-select'
import { viewStorey } from './multi-view'
import { selectedCustomZone } from './space-edit'
import { selectedObject, selectedSpace } from './space-objects'
import { selectedRoom } from './rooms'
import { select } from './systems'
import { multiView } from './vertical'

/** 옆 패널이 지금 보이는 엔티티. 인스펙터 순서(SidePanel.vue)와 같고, 아무것도 없으면 고른 계통이다. */
export const inspected = computed<{ id: string; what: string } | null>(() => {
  if (groupItems.value.length >= 2) return null
  if (selected.value) return { id: selected.value.id, what: '설비' }
  if (selectedElement.value) return { id: selectedElementId.value!, what: selectedElement.value.kind === 'wall' ? '벽' : selectedElement.value.kind === 'door' ? '문' : '창' }
  if (selectedObject.value) return { id: selectedObject.value.object.id, what: '공간 오브젝트' }
  if (selectedRoom.value) return { id: selectedRoom.value.room.id, what: '룸' }
  if (selectedCustomZone.value) return { id: selectedCustomZone.value.zone.id, what: '커스텀존' }
  if (selectedSpace.value) return { id: selectedSpace.value.space.id, what: '물리존' }
  if (selectedSystem.value) return { id: selectedSystem.value.id, what: '계통' }
  return null
})

/** 지금 모델을 내보낸 결과의 색인. 부르는 쪽이 언제 다시 만들지 정한다. */
export function buildExportIndex(): ExportIndex | null {
  const m = model.value
  return m ? exportIndex(modelToTTL(m), modelToGeoJSON(m)) : null
}

export { entityExport }

/** 관계의 상대를 누르면 그것을 고른다. 고를 수 없는 것(건물·IDF 공조존)은 false. */
export function canShow(id: string): boolean {
  const m = model.value
  if (!m) return false
  return (
    equipmentById.value.has(id) ||
    m.storeys.some((s) => s.id === id || s.spaces.some((x) => x.id === id) || (s.customZones ?? []).some((z) => z.id === id)) ||
    m.systems.some((s) => s.id === id)
  )
}

export function showEntity(id: string) {
  const m = model.value
  if (!m) return
  if (m.systems.some((s) => s.id === id)) {
    select(null)
    selectedSystemId.value = id
    return
  }
  const storey = m.storeys.find((s) => s.id === id)
  if (storey) {
    if (!multiView.value) viewStorey.value = storey.id
    return
  }
  // 설비·물리존·벽·문·창·존·오브젝트는 나란히 보기 판에서 고를 때와 같은 길이다. 고른 층만 보는 중이면 그 층으로 간다.
  const home = m.storeys.find((s) => s.spaces.some((x) => x.id === id) || (s.customZones ?? []).some((z) => z.id === id))
  if (home && viewStorey.value && !multiView.value) viewStorey.value = home.id
  selectFromCompare(id, '')
}
