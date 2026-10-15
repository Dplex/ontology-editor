import { computed, shallowRef } from 'vue'
import { type Baseline, diffBaseline } from '../lib/edit'
import { flowEditLines } from './checks'
import { releaseLines } from './connections'
import { model } from './core'
import { areaLines, report } from './edit-report'
import { confirmations } from './flow-rules'
import { assignLines, kindEditLines } from './kinds'
import { roomLines } from './rooms'
import { bimObjectLines, objectLines } from './space-objects'
import { spaceKindLines, storeyNameLines } from './storey-name'

/** 편집 막대에 보이는 바뀐 것의 수. 리포트(바뀌는 것)에 적히는 줄과 같은 단위로 센다. */
export const changeCount = computed(
  () =>
    report.value.length +
    assignLines.value.length +
    areaLines.value.length +
    confirmations.value.length +
    flowEditLines.value.length +
    kindEditLines.value.length +
    spaceKindLines.value.length +
    storeyNameLines.value.length +
    sinceOpen.value.renamed.length +
    (sinceOpen.value.renumbered?.length ?? 0) +
    sinceOpen.value.restoreyed.length +
    sinceOpen.value.moved.length +
    sinceOpen.value.connected.length +
    sinceOpen.value.disconnected.length +
    releaseLines.value.length +
    sinceOpen.value.spacesAdded.length +
    sinceOpen.value.spacesRemoved.length +
    sinceOpen.value.equipmentAdded.length +
    sinceOpen.value.equipmentRemoved.length +
    sinceOpen.value.equipmentRenamed.length +
    sinceOpen.value.equipmentMounted.length +
    (sinceOpen.value.equipmentShaft?.length ?? 0) +
    sinceOpen.value.wallsAdded.length +
    sinceOpen.value.wallsRemoved.length +
    (sinceOpen.value.verticals?.length ?? 0) +
    sinceOpen.value.wallsChanged.length +
    sinceOpen.value.openingsAdded.length +
    sinceOpen.value.openingsRemoved.length +
    sinceOpen.value.openingsMoved.length +
    sinceOpen.value.customZones.length +
    sinceOpen.value.hvacZones.length +
    roomLines.value.length +
    objectLines.value.length +
    bimObjectLines.value.length +
    sinceOpen.value.systemMoved.length +
    sinceOpen.value.systemKinds.length +
    sinceOpen.value.systemNames.length +
    sinceOpen.value.systemsAdded.length +
    sinceOpen.value.systemsRemoved.length,
)

// 연 때의 값. 소속 관계 말고도 내보내는 파일을 바꾸는 편집(이름·방 안 이동·층)을 이것과 견줘 리포트에 올린다
// (edit.ts 의 diffBaseline). 파일을 열거나 합칠 때 뜬다.
export const baseline = shallowRef<Baseline | null>(null)
export const sinceOpen = computed(() => {
  const m = model.value
  return m && baseline.value
    ? diffBaseline(m, baseline.value)
    : {
        renamed: [],
        moved: [],
        restoreyed: [],
        connected: [],
        disconnected: [],
        spacesAdded: [],
        spacesRemoved: [],
        equipmentAdded: [],
        equipmentRemoved: [],
        equipmentRenamed: [],
        equipmentMounted: [],
        wallsAdded: [],
        wallsRemoved: [],
        wallsChanged: [],
        openingsAdded: [],
        openingsRemoved: [],
        openingsMoved: [],
        hvacZones: [],
        customZones: [],
        systemMoved: [],
        systemKinds: [],
        systemNames: [],
        systemsAdded: [],
        systemsRemoved: [],
      }
})
export const MOVED_NAMES = 5
