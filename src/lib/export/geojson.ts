// 기하를 GeoJSON 으로 내보낸다. 층 하나가 FeatureCollection 하나다.
//
// 좌표는 위경도가 아니라 **건물 로컬 미터**다. GeoJSON 명세는 WGS84 를 기본으로 하지만,
// 여기서 위경도로 바꾸면 BIM 이 준 정확한 치수가 투영 오차를 뒤집어쓴다. 에디터와 DT(Unity)가
// 같은 원점·축·단위(m)를 쓰기로 되어 있으므로(PRD 1.7), 그 좌표계를 그대로 둔다.
// 지도 위에 얹을 일이 생기면 그때 사이트 원점의 위경도와 방위를 받아 한 번에 변환한다.

import { capacityQuantity } from '../capacity'
import type { Equipment, HvacZone, Model, Opening, Space, Storey, Wall } from '../model'
import { verticalLinks } from '../vertical'

export type Geometry =
  | { type: 'Polygon'; coordinates: number[][][] }
  | { type: 'MultiPolygon'; coordinates: number[][][][] }
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

function spaceFeature(space: Space, storey: Storey, vertical?: readonly string[]): Feature {
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
      // 계단실·승강로가 아래·위층에서 이어진 방(vertical.ts). 방-문-방 연결이 층 안에서만 서므로, 로봇 경로가 층을
      // 옮길 자리다. 다른 층 파일의 물리존 id 를 가리킨다.
      ...(vertical?.length ? { verticalConnects: vertical } : {}),
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
      // 용량이 무엇의 양인지(풍량·물 유량·출력·모름). 숫자만 두면 풍량과 출력이 섞인다(capacity.ts).
      capacityQuantity: equipment.capacity === null ? null : capacityQuantity(equipment.capacityProperty),
    },
  }
}

// 벽·문·창은 **GeoJSON 에만 있다.** Brick 에는 건축 부재 클래스가 없어서 TTL 에 주어로 나가지 않는다.
// 3D Map 과 로봇 경로가 쓰는 기하 층이다. 문의 `connects` 는 TTL 주어인 물리존 id 를 가리키므로, 방-문-방
// 그래프는 두 파일을 id 로 잇는 원칙 안에서 선다.

function wallFeature(wall: Wall, storey: Storey): Feature {
  const rings = (wall.footprint ?? []).map((r) => r.map((p) => [p[0], p[1]]))
  return {
    type: 'Feature',
    id: wall.id,
    // 외곽선을 못 읽은 벽도 남긴다. 물리존·설비와 같은 까닭이다.
    geometry:
      rings.length === 0
        ? null
        : rings.length === 1
          ? { type: 'Polygon', coordinates: [rings[0]] }
          : { type: 'MultiPolygon', coordinates: rings.map((r) => [r]) },
    properties: {
      kind: 'wall',
      name: wall.name,
      storeyId: storey.id,
      elevation: storey.elevation,
      thickness: wall.thickness,
      // null 은 "모름" 이다. false 와 섞지 않는다.
      loadBearing: wall.loadBearing,
    },
  }
}

function openingFeature(opening: Opening, storey: Storey): Feature {
  return {
    type: 'Feature',
    id: opening.id,
    geometry: opening.position
      ? { type: 'Point', coordinates: [opening.position[0], opening.position[1], opening.position[2]] }
      : null,
    properties: {
      kind: opening.kind,
      name: opening.name,
      storeyId: storey.id,
      width: opening.width,
      height: opening.height,
      wallId: opening.wallId,
      passable: opening.passable,
      ...(opening.kind === 'door' ? { connects: opening.connects ?? [], connectsSource: opening.connectsSource ?? null } : {}),
    },
  }
}

/** 공조존(IDF)의 바닥. 조각이 여럿이면 MultiPolygon 이다. 든 방은 TTL 주어 id 로 적는다. */
function hvacZoneFeature(zone: HvacZone, storey: Storey): Feature {
  const rings = zone.footprint.map((r) => r.map((p) => [p[0], p[1]]))
  return {
    type: 'Feature',
    id: zone.id,
    geometry:
      rings.length === 0 ? null : rings.length === 1 ? { type: 'Polygon', coordinates: [rings[0]] } : { type: 'MultiPolygon', coordinates: rings.map((r) => [r]) },
    properties: {
      kind: 'hvacZone',
      name: zone.name,
      storeyId: storey.id,
      elevation: storey.elevation,
      areaM2: Number(zone.areaM2.toFixed(4)),
      spaceIds: zone.spaceIds,
      source: 'IDF',
    },
  }
}

/** 층 하나를 FeatureCollection 으로. 물리존·설비·벽·문·창(과 IDF 공조존)이 같은 파일에 들어간다. */
export function storeyToGeoJSON(
  storey: Storey,
  zones: readonly HvacZone[] = [],
  vertical: ReadonlyMap<string, string[]> = new Map(),
): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: [
      ...storey.spaces.map((s) => spaceFeature(s, storey, vertical.get(s.id))),
      ...storey.equipment.map((e) => equipmentFeature(e, storey)),
      ...storey.walls.map((w) => wallFeature(w, storey)),
      ...storey.openings.map((o) => openingFeature(o, storey)),
      ...zones.filter((z) => z.storeyId === storey.id).map((z) => hvacZoneFeature(z, storey)),
    ],
  }
}

/**
 * 층별 파일 이름과 내용의 짝. 파일로 떨어뜨리는 일은 호출부가 한다.
 *
 * **파일 이름이 겹치지 않게 한다.** 층 이름을 걸러 쓰므로 `B1/B2` 와 `B1 B2` 가 같아지고, IFC 는 이름이 같은 층도
 * 막지 않는다. 겹치면 뒤의 것에 번호를 붙인다 — 그러지 않으면 한 층이 다른 층을 덮거나 브라우저가 `(1)` 을 붙여
 * 어느 층인지 모르게 된다.
 */
export function modelToGeoJSON(model: Model): { fileName: string; collection: FeatureCollection }[] {
  const taken = new Set<string>()
  const vertical = verticalLinks(model)
  return model.storeys.map((storey) => {
    // 층 이름에는 공백이나 슬래시가 들어올 수 있다. 파일 이름으로 쓰기 전에 걸러 낸다.
    const stem = `floor-${storey.name.replace(/[^\w가-힣-]+/g, '_') || storey.id}`
    let fileName = `${stem}.geojson`
    for (let n = 2; taken.has(fileName.toLowerCase()); n++) fileName = `${stem}-${n}.geojson`
    taken.add(fileName.toLowerCase())
    return { fileName, collection: storeyToGeoJSON(storey, model.hvac?.zones ?? [], vertical) }
  })
}
