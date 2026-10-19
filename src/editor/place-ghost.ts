// --- 놓기 전 미리보기 (OE-SPC-14 · OE-SPC-15) ---
// [설비 더하기]·[같은 모양으로 더하기]·추가 공간 오브젝트 놓기 중에 커서를 따라 놓을 것의 반투명 모양을 3D 에 세운다. 겹치는 자리면 붉게
// 칠하고 막을 상대를 붉은 외곽선으로 짚는다 — 전에는 눌러 봐야 막히는 줄 알았다. 판정은 실제로 놓을 때와 같은 함수다
// (설비 overlapForNew · 오브젝트 placeRefusal). 자리는 놓을 때처럼 cm 로 반올림한다. 다중층 뷰와 문·창 놓기에는 세우지 않는다.
import type { Vec2, Vec3 } from '../lib/model'
import { MARKER_SIZE, overlapForNew } from '../lib/overlap'
import { libraryItem, placeRefusal } from '../lib/space-object'
import { model } from './core'
import { adding } from './equipment-edit'
import { cm } from './equipment-shape'
import { equipmentById } from './flow-rules'
import { multiView } from './vertical'
import { currentBox } from './redraw'
import { viewer } from './scene'

export function updatePlaceGhost(at: Vec2 | null) {
  if (!viewer) return
  const a = adding.value
  const m = model.value
  if (!a || !at || !m || multiView.value || (a.what !== 'equipment' && a.what !== 'object')) return viewer.setPlaceGhost(null)
  const p: Vec2 = [cm(at[0]), cm(at[1])]
  if (a.what === 'object') {
    const item = a.item ? libraryItem(m, a.item) : null
    if (!item) return viewer.setPlaceGhost(null)
    const refused = placeRefusal(m, a.storeyId, p, item.size)
    viewer.setPlaceGhost({ at: p, elevation: a.elevation, size: item.size, item, blocked: refused?.blocked ? { kind: 'object', id: refused.blocked } : null })
    return
  }
  const position: Vec3 = [p[0], p[1], cm(a.elevation)]
  const blocker = overlapForNew(m, a.storeyId, position, currentBox)
  const blocked = blocker ? { kind: 'equipment' as const, id: blocker.id } : null
  // 같은 모양으로 더하기(ADR-0059)는 원본 형상의 상자, 아니면 3D 가 새 설비를 그리는 좌표 상자(가운데가 좌표)다.
  const src = a.copyOf ? equipmentById.value.get(a.copyOf) : null
  const box = src?.position ? currentBox(src.id) : null
  if (src?.position && box) {
    const size: Vec3 = [box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]]
    const center: Vec2 = [p[0] + (box.min[0] + box.max[0]) / 2 - src.position[0], p[1] + (box.min[1] + box.max[1]) / 2 - src.position[1]]
    viewer.setPlaceGhost({ at: center, elevation: position[2] + box.min[2] - src.position[2], size, blocked })
    return
  }
  viewer.setPlaceGhost({ at: p, elevation: position[2] - MARKER_SIZE / 2, size: [MARKER_SIZE, MARKER_SIZE, MARKER_SIZE], blocked })
}
