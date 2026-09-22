// 기하를 GeoJSON 으로 내보낸다. 층 하나가 FeatureCollection 하나다.
//
// 좌표는 위경도가 아니라 **건물 로컬 미터**다. GeoJSON 명세는 WGS84 를 기본으로 하지만,
// 여기서 위경도로 바꾸면 BIM 이 준 정확한 치수가 투영 오차를 뒤집어쓴다. 에디터와 DT(Unity)가
// 같은 원점·축·단위(m)를 쓰기로 되어 있으므로(PRD 1.7), 그 좌표계를 그대로 둔다.
// 지도 위에 얹을 일이 생기면 그때 사이트 원점의 위경도와 방위를 받아 한 번에 변환한다.

import type { Equipment, Model, Space, Storey } from '../model'

export type Geometry =
  | { type: 'Polygon'; coordinates: number[][][] }
  | { type: 'Point'; coordinates: number[] }

export type Feature = {
  type: 'Feature'
  /** 중간 모델의 id. TTL 쪽 주어와 같은 값이고, 두 파일은 이걸로만 이어진다. */
  id: string
  geometry: Geometry | null
  properties: Record<string, unknown>
}

export type FeatureCollection = {
  type: 'FeatureCollection'
  features: Feature[]
}

function spaceFeature(space: Space, storey: Storey): Feature {
  // 외곽선을 못 만든 공간도 빼지 않는다. geometry 를 null 로 둔 Feature 는 GeoJSON 에서
  // 적법하고, 빼 버리면 "온톨로지에는 있는데 지도에는 없는" 공간이 조용히 생긴다.
  const ring = space.footprint
  const closed =
    ring.length >= 3 && (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1])
      ? [...ring, ring[0]]
      : ring

  return {
    type: 'Feature',
    id: space.id,
    geometry: closed.length >= 4 ? { type: 'Polygon', coordinates: [closed.map((p) => [p[0], p[1]])] } : null,
    properties: {
      kind: 'space',
      name: space.name,
      longName: space.longName,
      storeyId: storey.id,
      elevation: storey.elevation,
      areaM2: Number(space.areaM2.toFixed(4)),
    },
  }
}

function equipmentFeature(equipment: Equipment, storey: Storey): Feature {
  return {
    type: 'Feature',
    id: equipment.id,
    // 좌표가 없는 설비도 남긴다. geometry 가 null 이면 "놓을 자리를 아직 모른다" 는 뜻이고,
    // 그 목록이 곧 사람이 3D 에서 배치해야 할 일감이다(PRD #13).
    geometry: equipment.position
      ? { type: 'Point', coordinates: [equipment.position[0], equipment.position[1], equipment.position[2]] }
      : null,
    properties: {
      kind: 'equipment',
      name: equipment.name,
      ifcClass: equipment.ifcClass,
      storeyId: storey.id,
      spaceId: equipment.spaceId,
      systemId: equipment.systemId,
      capacity: equipment.capacity,
    },
  }
}

/** 층 하나를 FeatureCollection 으로. 물리존과 설비가 같은 파일에 들어간다. */
export function storeyToGeoJSON(storey: Storey): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: [
      ...storey.spaces.map((s) => spaceFeature(s, storey)),
      ...storey.equipment.map((e) => equipmentFeature(e, storey)),
    ],
  }
}

/** 층별 파일 이름과 내용의 짝. 파일로 떨어뜨리는 일은 호출부가 한다. */
export function modelToGeoJSON(model: Model): { fileName: string; collection: FeatureCollection }[] {
  return model.storeys.map((storey) => ({
    // 층 이름에는 공백이나 슬래시가 들어올 수 있다. 파일 이름으로 쓰기 전에 걸러 낸다.
    fileName: `floor-${storey.name.replace(/[^\w가-힣-]+/g, '_') || storey.id}.geojson`,
    collection: storeyToGeoJSON(storey),
  }))
}
