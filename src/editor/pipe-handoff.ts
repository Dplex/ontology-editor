import { createCustomZone, splitCustomZone } from '../lib/custom-zone'
import { addWall, createSpace, drawSpaceFootprint, newWallThickness, splitSpace } from '../lib/edit'
import { createZoneFromOutline, reshapeHvacZone } from '../lib/hvac-zone'
import { josa } from '../lib/josa'
import type { Model, Vec3, Wall } from '../lib/model'
import { outlineWarnings } from '../lib/outline-fill'
import { createRoom } from '../lib/room'
import type { PathPoint } from '../lib/storey-z'
import { bgStep } from './background'
import { changeCustomZones } from './ceiling'
import { model } from './core'
import { makeBranch } from './cross-storey'
import { selectedElementId } from './equipment-edit'
import { cm } from './equipment-shape'
import { changeElements } from './facade'
import { note } from './keyboard'
import { changeHvacZones, makePipe } from './manual-draw'
import { editNotice } from './multi-select'
import { multiRange, openMultiView, viewStorey } from './multi-view'
import { changeFootprint, stopDraw } from './place'
import { elementSettings, WALL_FROM } from './read-settings'
import { changeRooms, selectedRoomId, selectedSpaceId } from './rooms'
import { viewer } from './scene'
import { changeSpaces, selectedCustomZoneId } from './space-edit'
import { drawing, type Drawing } from './space-objects'
import { multiView, verticalCreate } from './vertical'
import { fillRange, nextFill, rangeGiven } from './vertical-create'

// --- 그리던 배관을 들고 다중층 뷰로 (진입 경로 ③, OE-ML-01 · OE-PIP-15) ---
// 층 편집 화면에서 배관을 그리다 [다중층 뷰에서 편집] 을 누르면, 지금 층과 바로 위층을 보기 범위로 다중층 뷰를 열고 그리던 꺾임점을 층간 배관 그리기로
// 이어 간다(시작 설비·끝 대상·Flow Type 그대로, 찍은 점은 그 층 + 같은 높이). [층 편집으로] 로 돌아오면 옮기기 전의 그리기로 되돌린다(전환 취소).
/** 옮기기 전의 그리기. 다중층 뷰에서 마치거나 그리기를 그만두면 비운다. */
export let pipeHandoff: Drawing | null = null
export function setPipeHandoff(v: typeof pipeHandoff) {
  pipeHandoff = v
}
export async function pipeToMulti() {
  const d = drawing.value
  const m = model.value
  const home = m?.storeys.find((st) => st.id === d?.storeyId)
  if (!d || d.purpose !== 'pipe' || d.levels || !home || multiView.value) return
  const saved: Drawing = { ...d, points: [...d.points] }
  const height = cm(d.elevation - home.elevation)
  viewStorey.value = home.id
  if (!(await openMultiView())) return
  drawing.value = { ...d, levels: d.points.map(() => ({ storeyId: home.id, height })), work: { storeyId: home.id, height } }
  pipeHandoff = saved
  viewer?.setPlaceMode(d.elevation)
  note(`다중층 뷰로 옮겼습니다. 그리던 꺾임점 ${d.points.length}개를 이어서 찍습니다 — 작업 층·높이를 바꿔 다른 층까지 잇습니다. [층 편집으로] 를 누르면 옮기기 전으로 돌아갑니다`)
}
export function undoDrawPoint() {
  const d = drawing.value
  if (d) drawing.value = { ...d, points: d.points.slice(0, -1), ...(d.levels ? { levels: d.levels.slice(0, -1) } : {}) }
}
export function finishDraw(): boolean {
  const d = drawing.value
  if (!d) return false
  // 구간 바꾸기에서 빈 층을 채운다(OE-ML-08). 모델은 [구간 적용] 때 한 번에 바꾼다 — 그리기만으로는 이력이 생기지 않는다.
  if (d.purpose === 'verticalFootprint' || d.purpose === 'verticalPoint') {
    if (d.purpose === 'verticalFootprint' && d.points.length < 3) {
      note('형상은 꼭짓점 셋 이상을 찍어야 합니다')
      return true
    }
    stopDraw()
    const next = new Map(rangeGiven.value)
    const had = next.get(d.storeyId) ?? {}
    next.set(d.storeyId, d.purpose === 'verticalFootprint' ? { ...had, footprint: d.points } : { ...had, [d.which!]: d.points[0] })
    rangeGiven.value = next
    // 남은 것이 있으면 바로 이어서 그린다. 다 채웠으면 무엇을 누르면 끝나는지 알린다.
    const after = nextFill()
    if (after) fillRange(after.storeyId, after.what, `${d.name} 채움 → 다음: `)
    else note(`${d.name}${josa(d.name, '을/를')} 채웠습니다. 다 채웠으니 [${verticalCreate.value ? '만들기' : '구간 적용'}] 를 누릅니다(그 전까지는 점선 미리보기)`)
    return true
  }
  if (d.purpose === 'bgScale' || d.purpose === 'bgAnchor') {
    stopDraw()
    bgStep.value = d.purpose === 'bgScale' ? { kind: 'scale', a: d.points[0], b: d.points[1], meters: '' } : { kind: 'anchor', at: d.points[0], x: '', y: '' }
    note(d.purpose === 'bgScale' ? '두 점 사이의 실제 거리(m)를 넣으세요' : '찍은 점의 실제 좌표(x, y)를 넣으세요')
    return true
  }
  if (d.purpose === 'pipe' && d.levels) {
    // 층간 배관: 꺾임점은 찍을 때의 층 + 높이다. 보기 범위 밖이거나 층 높이를 모르면 그리던 것을 둔 채 이유를 보인다 — 범위를 넓혀 이어 그린다.
    const via = d.points.map((at, i): PathPoint => ({ at, ...d.levels![i] }))
    const range = multiRange.value?.map((st) => st.id) ?? []
    if (d.branchOf ? makeBranch(d.branchOf, via, range) : makePipe(via, d.spaceId, range)) stopDraw()
    return true
  }
  if (d.purpose === 'pipe') {
    // 꺾임점은 시작 설비 높이의 수평면에 찍힌다. 마지막 변은 끝 대상 높이로 내려가거나 올라간다.
    stopDraw()
    makePipe(d.points.map((p) => [p[0], p[1], d.elevation] as Vec3), d.spaceId)
    return true
  }
  if (d.purpose === 'wall') {
    if (d.points.length < 2) {
      note('벽의 두 끝점을 찍어야 합니다')
      return true
    }
    stopDraw()
    const [a, b] = d.points
    let made: Wall | null = null
    let thick: ReturnType<typeof newWallThickness> | null = null
    const draw = (m: Model) => {
      const storey = m.storeys.find((st) => st.id === d.storeyId)
      const done = storey ? addWall(m, d.storeyId, a, b, (thick = newWallThickness(storey, elementSettings.value.interiorWall)).thickness) : null
      if (done && !('refused' in done)) made = done
      return done
    }
    if (changeElements(d.storeyId, '벽 긋기', draw) && made) {
      selectedElementId.value = (made as Wall).id
      const t = thick as ReturnType<typeof newWallThickness> | null
      note(`벽을 그었습니다. 두께 ${t ? `${t.thickness}m(${WALL_FROM[t.from]})` : ''}는 오른쪽 패널에서 고칩니다. 내력 여부도 거기서 정합니다`)
    }
    return true
  }
  if (d.purpose === 'customSplit') {
    if (d.points.length < 2) {
      note('나눌 선의 두 점을 찍어야 합니다')
      return true
    }
    stopDraw()
    const [a, b] = d.points
    const zoneId = d.spaceId!
    let pieceName = ''
    const split = (m: Model) => {
      const done = splitCustomZone(m, zoneId, a, b)
      if (done && !('refused' in done)) pieceName = done.name
      return done
    }
    if (changeCustomZones(d.storeyId, `${d.name} 나누기`, split)) {
      selectedCustomZoneId.value = zoneId
      note(`${d.name}${josa(d.name, '을/를')} 둘로 나눴습니다. 넓은 쪽이 ${d.name}, 좁은 쪽이 새 커스텀존 ${pieceName}입니다(별명 없음)`)
    }
    return true
  }
  if (d.purpose === 'split') {
    if (d.points.length < 2) {
      note('나눌 선의 두 점을 찍어야 합니다')
      return true
    }
    stopDraw()
    const [a, b] = d.points
    let piece: string | null = null
    const split = (m: Model) => {
      const done = splitSpace(m, d.spaceId!, a, b)
      if (done && !('refused' in done)) piece = done.created[0] ?? null
      return done
    }
    if (changeSpaces(d.storeyId, `${d.name} 나누기`, split)) {
      // 새 조각의 방번호는 사람이 넣는다(OE-SPC-02). 그 칸이 바로 보이게 새 조각을 고른다.
      selectedSpaceId.value = piece ?? d.spaceId
      note(`${d.name}${josa(d.name, '을/를')} 둘로 나눴습니다. 좁은 쪽이 새 물리존이고 방번호가 비어 있습니다 — 오른쪽 패널에서 방번호를 넣으세요`)
    }
    return true
  }
  if (d.purpose === 'room') {
    if (d.points.length < 2) {
      note('룸의 대각선 두 꼭짓점을 찍어야 합니다')
      return true
    }
    stopDraw()
    let created: string | null = null
    const ok = changeRooms(null, '룸 만들기', (m) => {
      const done = createRoom(m, d.storeyId, d.points[0], d.points[1])
      if (done && !('refused' in done)) created = done.id
      return done
    }, d.storeyId)
    if (ok && created) {
      selectedRoomId.value = created
      note('룸을 만들었습니다. 꼭짓점을 끌어 크기를, 방향키로 자리를 바꿉니다')
    }
    return true
  }
  if (d.points.length < 3) {
    note('꼭짓점을 셋 이상 찍어야 합니다')
    return true
  }
  stopDraw()
  if (d.purpose === 'hvacZoneOutline') {
    changeHvacZones(d.storeyId, `${d.name} 경계`, (m) => reshapeHvacZone(m, d.spaceId!, d.points)) &&
      note(`${d.name}의 경계를 다시 그렸습니다. 새 경계와 겹치는 물리존이 담당입니다`)
    return true
  }
  if (d.purpose === 'hvacZone') {
    changeHvacZones(d.storeyId, '공조존 그리기', (m) => createZoneFromOutline(m, d.storeyId, { footprint: d.points })) &&
      note('공조존을 그렸습니다. 겹치는 물리존이 담당입니다. 담당 설비는 아래 "공조존" 에서 고릅니다')
    return true
  }
  if (d.purpose === 'custom') {
    let created: string | null = null
    const ok = changeCustomZones(d.storeyId, '커스텀존 만들기', (m) => {
      const done = createCustomZone(m, d.storeyId, { footprint: d.points })
      if (done && !('refused' in done)) created = done.id
      return done
    })
    if (ok && created) {
      selectedCustomZoneId.value = created
      note('커스텀존을 만들었습니다. 이름은 오른쪽 패널에서 고칩니다')
    }
    return true
  }
  if (d.purpose === 'create') {
    const n = (model.value?.storeys ?? []).reduce((k, st) => k + st.spaces.filter((x) => x.added).length, 0) + 1
    let created: string | null = null
    const ok = changeSpaces(d.storeyId, '물리존 만들기', (m) => {
      const done = createSpace(m, d.storeyId, { name: '', longName: `새 물리존 ${n}`, footprint: d.points })
      created = done?.created[0] ?? null
      return done
    })
    if (ok && created) {
      selectedSpaceId.value = created
      note(`새 물리존 ${n}${josa(String(n), '을/를')} 만들었습니다. 방번호와 공간명은 오른쪽 패널에서 넣습니다`)
    }
    return true
  }
  const spaceId = d.spaceId!
  if (changeFootprint(spaceId, `${d.name} 외곽선 그리기`, (m) => drawSpaceFootprint(m, spaceId, d.points))) {
    selectedSpaceId.value = spaceId
    note(`${d.name}의 외곽선을 그렸습니다. 꼭짓점은 끌거나 [ ]로 골라 고칩니다`)
    // 막지 않고 알린다(OE-MAN-03): BIM 면적과 다름, 다른 물리존과 겹침, 자기교차.
    const warn = outlineWarnings(model.value!, spaceId)
    if (warn.length) editNotice.value = `${d.name}: ${warn.join(' ')} 외곽선을 확인하세요.`
  }
  return true
}
