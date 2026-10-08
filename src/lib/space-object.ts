// 추가 공간 오브젝트(OE-OBJ-09 · OE-SPC-14 · OE-SPC-16 · OE-P3-08). 책상·의자·소파처럼 공간을 꾸미는 사물이다.
//
// - 라이브러리(LIBRARY)에서 골라 층 바닥에 놓는다. 항목마다 3D 모델(상자 조각 몇 개)과 기본 크기가 있다. 사람이 glb 를
//   넣으면 그 모델이 항목이 된다(`Model.objectLibrary`, 파일을 그대로 들고 있다).
// - 놓기·옮기기·크기 바꾸기·지우기·이름 고치기. 축에 나란한 상자로 둔다(돌리기는 없다. 작게 시작한다).
// - **서로 겹칠 수 없다**(OE-OBJ-16). 점유 영역은 바닥(층 높이)에서 높이만큼 선 상자이고, 맞닿는 것(1cm 안)은 겹침이 아니다.
//   막을 때 겹친 상대를 돌려준다 — 화면이 붉게 짚는다(OE-SPC-15). 설비·벽과는 견주지 않는다(원칙 표가 추가 공간 오브젝트끼리만 막는다).
// - 층마다 둔다(`Storey.spaceObjects`). 편집 파일에 층 단위로 남는다. 온톨로지(TTL·GeoJSON)로는 아직 나가지 않는다.

import type { CustomObjectItem, Model, SpaceObject, Storey, Vec2, Vec3 } from './model'
import { boxesOverlap, type Box3 } from './overlap'
import { newId } from './edit'

export type { SpaceObject }

/** 모델 조각 하나. 항목 상자 안의 비율(0~1) 좌표 [x0, y0, z0, x1, y1, z1] 와 재질이다. y 는 평면의 세로, z 는 높이다. */
export type ObjectPart = { box: readonly [number, number, number, number, number, number]; material: ObjectMaterial }
export type ObjectMaterial = 'wood' | 'frame' | 'fabric' | 'panel' | 'board' | 'pot' | 'leaf'

/** 라이브러리 항목. 내장 항목은 조각(`parts`)으로, 사람이 넣은 항목은 glb 로 모양을 든다. */
export type LibraryItem = { key: string; name: string; size: Vec3; parts?: readonly ObjectPart[]; glb?: string }

/** 한 변의 최소·최대(미터). 1cm 보다 작으면 고를 수도 없고, 20m 넘는 가구는 잘못 친 값이다. */
export const OBJECT_MIN = 0.05
export const OBJECT_MAX = 20
/**
 * 넣을 수 있는 모델 파일 상한(바이트). 편집 파일에 그대로(base64, 1.33배) 들어가고, 편집 파일은 자동 저장·임시 저장으로 브라우저
 * 저장소(사이트마다 약 5MB)에 두 벌 남는다. 1MB 면 두 벌이 2.7MB 다. 저가구 모델(수십~수백 KB)은 넉넉히 들어간다.
 */
export const MODEL_MAX_BYTES = 1024 * 1024

/** 네 다리. `inset` 만큼 모서리에서 들인다. */
const legs = (w: number, d: number, top: number, inset = 0): ObjectPart[] =>
  [
    [inset, inset],
    [1 - inset - w, inset],
    [inset, 1 - inset - d],
    [1 - inset - w, 1 - inset - d],
  ].map(([x, y]) => ({ box: [x, y, 0, x + w, y + d, top] as const, material: 'frame' as const }))

const table = (legW: number, legD: number): ObjectPart[] => [{ box: [0, 0, 0.94, 1, 1, 1], material: 'wood' }, ...legs(legW, legD, 0.94)]

/**
 * 내장 라이브러리(OE-SPC-16). 크기는 사무 가구의 흔한 치수다(가로 × 세로 × 높이, 미터). 모양은 상자 조각이라 크기를 바꾸면
 * 비율대로 늘어난다.
 */
export const LIBRARY: readonly LibraryItem[] = [
  { key: 'desk', name: '책상', size: [1.2, 0.7, 0.72], parts: table(0.05, 0.07) },
  { key: 'desk-double', name: '2인 책상', size: [1.6, 0.8, 0.72], parts: table(0.04, 0.06) },
  { key: 'meeting-table', name: '회의 테이블', size: [2.4, 1.2, 0.72], parts: table(0.03, 0.05) },
  {
    key: 'chair',
    name: '의자',
    size: [0.5, 0.5, 0.9],
    parts: [
      { box: [0.05, 0.05, 0.45, 0.95, 0.95, 0.52], material: 'fabric' },
      { box: [0.05, 0.86, 0.52, 0.95, 0.96, 1], material: 'fabric' },
      ...legs(0.08, 0.08, 0.45, 0.1),
    ],
  },
  {
    key: 'sofa',
    name: '소파',
    size: [1.8, 0.8, 0.8],
    parts: [
      { box: [0, 0, 0, 1, 1, 0.5], material: 'fabric' },
      { box: [0, 0.72, 0.5, 1, 1, 1], material: 'fabric' },
      { box: [0, 0, 0.5, 0.08, 0.72, 0.75], material: 'fabric' },
      { box: [0.92, 0, 0.5, 1, 0.72, 0.75], material: 'fabric' },
    ],
  },
  {
    key: 'bookshelf',
    name: '책장',
    size: [0.9, 0.35, 1.8],
    parts: [
      { box: [0, 0, 0, 0.04, 1, 1], material: 'wood' },
      { box: [0.96, 0, 0, 1, 1, 1], material: 'wood' },
      { box: [0.04, 0.92, 0, 0.96, 1, 1], material: 'wood' },
      ...[0, 0.25, 0.5, 0.75, 0.98].map((z) => ({ box: [0.04, 0, z, 0.96, 0.92, z + 0.02] as const, material: 'wood' as const })),
    ],
  },
  {
    key: 'partition',
    name: '파티션',
    size: [1.2, 0.05, 1.5],
    parts: [
      { box: [0, 0, 0.02, 1, 1, 1], material: 'panel' },
      { box: [0.02, 0, 0, 0.12, 1, 0.02], material: 'frame' },
      { box: [0.88, 0, 0, 0.98, 1, 0.02], material: 'frame' },
    ],
  },
  {
    key: 'whiteboard',
    name: '칠판',
    size: [1.8, 0.5, 1.9],
    parts: [
      { box: [0, 0.45, 0.4, 1, 0.55, 1], material: 'board' },
      { box: [0.02, 0.45, 0.03, 0.05, 0.55, 0.4], material: 'frame' },
      { box: [0.95, 0.45, 0.03, 0.98, 0.55, 0.4], material: 'frame' },
      { box: [0, 0, 0, 0.07, 1, 0.03], material: 'frame' },
      { box: [0.93, 0, 0, 1, 1, 0.03], material: 'frame' },
    ],
  },
  {
    key: 'plant',
    name: '화분',
    size: [0.4, 0.4, 1],
    parts: [
      { box: [0.2, 0.2, 0, 0.8, 0.8, 0.35], material: 'pot' },
      { box: [0, 0, 0.35, 1, 1, 1], material: 'leaf' },
    ],
  },
]

/** 사람이 넣은 항목의 열쇠 앞머리. 내장 항목과 겹치지 않는다. */
export const CUSTOM_PREFIX = 'custom:'

/** 열쇠로 라이브러리 항목을 찾는다. 내장 항목 다음 사람이 넣은 항목이다. */
export function libraryItem(model: Model, key: string): LibraryItem | null {
  return LIBRARY.find((i) => i.key === key) ?? model.objectLibrary?.find((i) => i.key === key) ?? null
}

/** 화면에 늘어놓을 라이브러리 전부. */
export function libraryOf(model: Model): LibraryItem[] {
  return [...LIBRARY, ...(model.objectLibrary ?? [])]
}

export function findSpaceObject(model: Model, id: string): { storey: Storey; object: SpaceObject } | null {
  for (const storey of model.storeys) {
    const object = storey.spaceObjects?.find((o) => o.id === id)
    if (object) return { storey, object }
  }
  return null
}

/** 점유 영역(IFC 좌표, z 가 위). 층 바닥에서 높이만큼 선 상자다. */
export function objectBox(elevation: number, at: Vec2, size: Vec3): Box3 {
  const [w, d, h] = size
  return { min: [at[0] - w / 2, at[1] - d / 2, elevation], max: [at[0] + w / 2, at[1] + d / 2, elevation + h] }
}

export type ObjectRefusal = { refused: string; blocked?: string }

const OVERLAP_MESSAGE = '이미 오브젝트가 있는 위치입니다. 추가 공간 오브젝트는 서로 겹칠 수 없습니다.'

/** 이 자리·크기가 된다면 null, 안 되면 이유(겹친 상대와 함께). 모든 층의 오브젝트와 견준다(겹침은 3차원 자리로 정한다). */
function refusalAt(model: Model, elevation: number, at: Vec2, size: Vec3, exceptId?: string): ObjectRefusal | null {
  if (size.some((v) => !Number.isFinite(v) || v < OBJECT_MIN || v > OBJECT_MAX)) return { refused: `크기는 한 변이 ${OBJECT_MIN}~${OBJECT_MAX}m 여야 합니다.` }
  if (!at.every(Number.isFinite)) return { refused: '자리가 숫자가 아닙니다.' }
  const next = objectBox(elevation, at, size)
  for (const storey of model.storeys) {
    for (const other of storey.spaceObjects ?? []) {
      if (other.id === exceptId) continue
      if (boxesOverlap(next, objectBox(storey.elevation, other.at, other.size))) return { refused: OVERLAP_MESSAGE, blocked: other.id }
    }
  }
  return null
}

/** 오브젝트를 놓는다. 이름이 비면 "항목 이름 n". */
export function addSpaceObject(model: Model, storeyId: string, itemKey: string, at: Vec2, spec: { name?: string; id?: string; size?: Vec3 } = {}): SpaceObject | ObjectRefusal | null {
  const storey = model.storeys.find((s) => s.id === storeyId)
  const item = libraryItem(model, itemKey)
  if (!storey || !item) return null
  const size = spec.size ?? item.size
  const refused = refusalAt(model, storey.elevation, at, size)
  if (refused) return refused
  const n = model.storeys.reduce((k, s) => k + (s.spaceObjects ?? []).filter((o) => o.item === itemKey).length, 0) + 1
  const object: SpaceObject = { id: spec.id ?? newId(), name: spec.name?.trim() || `${item.name} ${n}`, item: itemKey, at: [at[0], at[1]], size: [size[0], size[1], size[2]] }
  storey.spaceObjects = [...(storey.spaceObjects ?? []), object]
  return object
}

/** 지운다. */
export function deleteSpaceObject(model: Model, id: string): boolean {
  const found = findSpaceObject(model, id)
  if (!found) return false
  found.storey.spaceObjects = found.storey.spaceObjects!.filter((o) => o.id !== id)
  if (!found.storey.spaceObjects.length) delete found.storey.spaceObjects
  return true
}

export function renameSpaceObject(model: Model, id: string, name: string): boolean {
  const found = findSpaceObject(model, id)
  const next = name.trim()
  if (!found || !next || found.object.name === next) return false
  found.object.name = next
  return true
}

/** 새 자리로 옮긴다. 겹치면 막고 그대로 둔다(끌던 것은 원래 자리로 돌아간다). */
export function placeSpaceObject(model: Model, id: string, at: Vec2): boolean | ObjectRefusal {
  const found = findSpaceObject(model, id)
  if (!found || (found.object.at[0] === at[0] && found.object.at[1] === at[1])) return false
  const refused = refusalAt(model, found.storey.elevation, at, found.object.size, id)
  if (refused) return refused
  found.object.at = [at[0], at[1]]
  return true
}

export function moveSpaceObject(model: Model, id: string, delta: Vec2): boolean | ObjectRefusal {
  const found = findSpaceObject(model, id)
  if (!found) return false
  return placeSpaceObject(model, id, [found.object.at[0] + delta[0], found.object.at[1] + delta[1]])
}

/** 크기를 바꾼다. 바닥 가운데 자리는 그대로다. 겹치게 커지면 막는다. */
export function resizeSpaceObject(model: Model, id: string, size: Vec3): boolean | ObjectRefusal {
  const found = findSpaceObject(model, id)
  if (!found || size.every((v, k) => v === found.object.size[k])) return false
  const refused = refusalAt(model, found.storey.elevation, found.object.at, size, id)
  if (refused) return refused
  found.object.size = [size[0], size[1], size[2]]
  return true
}

/**
 * 사람이 넣은 3D 모델을 라이브러리에 더한다(OE-P3-08). `size` 는 모델 상자에서 잰 크기다(부르는 쪽이 glb 를 읽어 잰다).
 * 이름이 같은 항목이 있어도 새 항목이다 — 같은 이름의 다른 모델일 수 있다.
 */
export function addCustomItem(model: Model, name: string, size: Vec3, glb: string): CustomObjectItem | ObjectRefusal {
  const clean = name.trim().replace(/\.(glb|gltf)$/i, '') || '넣은 모델'
  if (size.some((v) => !Number.isFinite(v) || v <= 0)) return { refused: '모델의 크기를 잴 수 없습니다. 형상이 없는 파일입니다.' }
  if (glb.length * 0.75 > MODEL_MAX_BYTES) return { refused: `모델 파일이 ${MODEL_MAX_BYTES / 1024 / 1024}MB 를 넘습니다.` }
  // 모델 단위가 mm·cm 로 저장된 파일이 흔하다. 한 변이 상한을 넘으면 그대로 두지 않고 기본 크기만 1m 안팎으로 줄인다(모양 비율은 같다).
  const longest = Math.max(...size)
  const scale = longest > OBJECT_MAX ? 1 / longest : 1
  const fit = size.map((v) => Math.max(OBJECT_MIN, Math.round(v * scale * 100) / 100)) as unknown as Vec3
  const item: CustomObjectItem = { key: `${CUSTOM_PREFIX}${newId()}`, name: clean, size: fit, glb }
  model.objectLibrary = [...(model.objectLibrary ?? []), item]
  return item
}

/** 깊은 사본(되돌리기·편집 파일). */
export function copySpaceObjects(objects: readonly SpaceObject[]): SpaceObject[] {
  return objects.map((o) => ({ id: o.id, name: o.name, item: o.item, at: [o.at[0], o.at[1]] as Vec2, size: [o.size[0], o.size[1], o.size[2]] as Vec3 }))
}
