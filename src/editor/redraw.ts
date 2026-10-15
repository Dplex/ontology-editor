import { ref } from 'vue'
import type { Vec3 } from '../lib/model'
import { type Box3, meshBox } from '../lib/overlap'
import { toScene } from '../lib/viewer'
import { model } from './core'
import { meshes } from './open-file'
import { viewer } from './scene'

// --- 3D 다시 그리기 --------------------------------------------------------------
//
// 편집은 모델을 그 자리에서 고치고 triggerRef 로 알린다. 그때마다 3D 를 통째로 다시 만들면 성수에서
// 수십 초 멈추고 시점도 건물 전체로 튄다. 그래서 새 모델을 열었을 때만 새로 그리고, 편집 뒤에 무엇을
// 다시 그릴지는 편집하는 쪽이 정한다. 다시 그린 뒤에는 강조·손잡이·화살표를 다시 넘겨야 해서 판을 센다.
export const sceneVersion = ref(0)
export function redraw() {
  if (!viewer || !model.value) return
  viewer.setModel(model.value, meshes, { keepView: true })
  sceneVersion.value++
}

/**
 * 옮긴 설비의 형상을 같이 옮긴다. 형상은 임포트 때의 자리를 들고 있어서, 안 옮기면 다시 그릴 때
 * 예전 자리로 튄다. 형상이 없는 설비(상자로 찍는 것)는 좌표에서 바로 그리므로 할 일이 없다.
 */
/**
 * 설비 형상을 감싸는 상자(IFC 좌표). 겹침 판정(lib/overlap.ts)이 쓴다. 형상을 옮기면 shiftMesh 가 좌표 배열을 새로 만들어서
 * 배열마다 한 번만 잰다(성수 배관 없는 설비 1,152대를 방향키마다 다시 재지 않는다).
 */
const ifcBoxes = new WeakMap<Float32Array, Box3>()
export function currentBox(id: string): Box3 | null {
  const mesh = meshes.get(id)
  if (!mesh) return null
  const had = ifcBoxes.get(mesh.positions)
  if (had) return had
  const box = meshBox(mesh)
  if (box) ifcBoxes.set(mesh.positions, box)
  return box
}

export function shiftMesh(id: string, from: Vec3 | null, to: Vec3 | null) {
  const mesh = meshes.get(id)
  if (!mesh || !from || !to) return
  const [dx, dy, dz] = toScene([to[0] - from[0], to[1] - from[1], to[2] - from[2]])
  if (!dx && !dy && !dz) return
  const positions = mesh.positions.slice()
  for (let i = 0; i < positions.length; i += 3) {
    positions[i] += dx
    positions[i + 1] += dy
    positions[i + 2] += dz
  }
  meshes.set(id, { ...mesh, positions })
}
