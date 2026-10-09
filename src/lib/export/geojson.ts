// 기하를 GeoJSON 으로 내보낸다. 층 하나가 FeatureCollection 하나다.
//
// 좌표는 위경도가 아니라 **건물 로컬 미터**다. GeoJSON 명세는 WGS84 를 기본으로 하지만,
// 여기서 위경도로 바꾸면 BIM 이 준 정확한 치수가 투영 오차를 뒤집어쓴다. 에디터와 DT(Unity)가
// 같은 원점·축·단위(m)를 쓰기로 되어 있으므로(PRD 1.7), 그 좌표계를 그대로 둔다.
// 지도 위에 얹을 일이 생기면 그때 사이트 원점의 위경도와 방위를 받아 한 번에 변환한다.

import { capacityQuantity } from '../capacity'
import { polygonArea, segmentPath, SEGMENT_PATH_ISSUES, type CustomZone, type Equipment, type HvacZone, type Model, type Opening, type Room, type Space, type SpaceObject, type Storey, type VerticalPart, type Wall } from '../model'
import { verticalConnections } from '../vertical'
import { partId, partLinks, partSpaces, verticalObjects } from '../vertical-object'
import { judgeExternal, type ExternalJudgement } from '../exterior'
import { zoneEquipment, zoneSpaces } from '../custom-zone'
import { libraryOf } from '../space-object'
import { hvacZonesOf } from '../hvac-zone'
import { rectRing } from '../room'

export type Geometry =
  | { type: 'Polygon'; coordinates: number[][][] }
  | { type: 'MultiPolygon'; coordinates: number[][][][] }
  | { type: 'Point'; coordinates: number[] }
  | { type: 'LineString'; coordinates: number[][] }

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
  /**
   * 임포트 때 읽지 않은 피처(OE-BIM-25, 2026-10-03 사용자 결정). 벽·문·창을 끄고 연 파일은 벽 feature 가 0 이어도 "벽이 없다" 가
   * 아니라 "읽지 않았다" 다. 받는 쪽이 둘을 가르도록 층 파일 머리에 적는다. RFC 7946 은 모르는 멤버(foreign member)를 허용한다.
   * 다 읽었으면 없다.
   */
  skipped?: ('walls' | 'doors' | 'windows')[]
}

/** 층 사이 연결: 가리키는 feature id 와 출처. 물리존과 수직 관통 오브젝트 조각이 같은 모양으로 받는다. */
export type VerticalRef = { to: readonly string[]; source: string }

function spaceFeature(space: Space, storey: Storey, vertical?: VerticalRef): Feature {
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
      // 옮길 자리다. 다른 층 파일의 물리존 id 를 가리킨다. 출처는 계단 오브젝트가 말한 것(bim)과 겹침 추정(calc)을
      // 가른다(ADR-0032·0033). 모호 후보는 여기 오지 않는다.
      ...(vertical?.to.length ? { verticalConnects: [...vertical.to], verticalConnectsSource: vertical.source } : {}),
    },
  }
}

function equipmentFeature(equipment: Equipment, storey: Storey): Feature {
  // 덕트·배관 구간은 경로(두 끝)로 낸다(OE-PIP-13). 배치점 하나로 경로를 만들지 않으니, 경로를 쓸 수 없는 구간은 geometry 를
  // 비우고 `pathIssue` 에 까닭을 적는다. 연결·계통은 형상과 따로라 TTL 에 그대로 나간다.
  const path = segmentPath(equipment)
  return {
    type: 'Feature',
    id: equipment.id,
    // 좌표가 없는 설비도 남긴다. geometry 가 null 이면 "놓을 자리를 아직 모른다" 는 뜻이고,
    // 그 목록이 곧 사람이 3D 에서 배치해야 할 일감이다(PRD #13).
    geometry: path
      ? 'path' in path
        ? { type: 'LineString', coordinates: path.path.map((p) => [p[0], p[1], p[2]]) }
        : null
      : equipment.position
        ? { type: 'Point', coordinates: [equipment.position[0], equipment.position[1], equipment.position[2]] }
        : null,
    properties: {
      kind: 'equipment',
      name: equipment.name,
      ifcClass: equipment.ifcClass,
      storeyId: storey.id,
      spaceId: equipment.spaceId,
      // 소속의 출처(요구조건 S4). 'bim' 은 BIM 이 설비를 그 방에 담았다고 말한 것, 'calc' 는 좌표가 외곽선에 드는지 우리가
      // 계산한 것(사람이 옮긴 설비도 다시 계산한다), 'edit' 은 기계가 확신하지 못한 설비에 사람이 정한 것(K17)이다. TTL 의
      // hasLocation 은 같은 방이라 셋을 가를 수 없어 여기 둔다 — 문의 connectsSource·벽의 externalSource 와 같은 낱말이다(ADR-0008).
      // 방이 없으면 null.
      spaceSource: equipment.spaceId === null ? null : equipment.spaceSource === 'bim' ? 'bim' : equipment.spaceSource === 'edit' ? 'edit' : 'calc',
      systemId: equipment.systemId,
      capacity: equipment.capacity,
      // 용량이 무엇의 양인지(풍량·물 유량·출력·모름). 숫자만 두면 풍량과 출력이 섞인다(capacity.ts).
      capacityQuantity: equipment.capacity === null ? null : capacityQuantity(equipment.capacityProperty),
      // 사람이 벽 면에 붙인 설비의 벽 id(OE-OBJ-04, 외벽 루버·외기 센서). 벽 feature 의 id 다. 붙이지 않았으면 키가 없다.
      ...(equipment.wallId ? { wallId: equipment.wallId } : {}),
      // 경로를 쓸 수 없는 덕트·배관 구간의 까닭(좌표 없음 · 형상 없음 · 수치 오류 · 길이 0). 경로가 있거나 구간이 아니면 키가 없다.
      ...(path && 'issue' in path ? { pathIssue: SEGMENT_PATH_ISSUES[path.issue] } : {}),
      // 사람이 그린 배관의 Flow Type(OE-OBJ-12, SA·CHWS 등). BIM 배관에는 없다.
      ...(equipment.flowType ? { flowType: equipment.flowType } : {}),
    },
  }
}

// 벽·문·창은 **GeoJSON 에만 있다.** Brick 에는 건축 부재 클래스가 없어서 TTL 에 주어로 나가지 않는다.
// 3D Map 과 로봇 경로가 쓰는 기하 층이다. 문의 `connects` 는 TTL 주어인 물리존 id 를 가리키므로, 방-문-방
// 그래프는 두 파일을 id 로 잇는 원칙 안에서 선다.

function wallFeature(wall: Wall, storey: Storey, external: ExternalJudgement | undefined): Feature {
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
      // 높이(미터). 형상의 위아래 폭으로 쟀거나 사람이 고친 값이다(OE-OBJ-04). null 은 모름 — 층고로 채우지 않는다.
      height: wall.height ?? null,
      // null 은 "모름" 이다. false 와 섞지 않는다.
      loadBearing: wall.loadBearing,
      // 외벽 여부(OE-EXT-01). BIM(Pset_WallCommon.IsExternal)이 말하지 않으면 건물 바깥에 닿는지로 계산하고,
      // 어느 쪽인지 externalSource 에 적는다('bim'·'calc'). 외곽선이 없어 계산도 못 하면 둘 다 null(모름)이다.
      external: external?.external ?? null,
      externalSource: external?.source ?? null,
      // 로봇이 지나갈 수 없다(OE-OBJ-05). 문·창의 passable 과 같은 열쇠로 둬서 읽는 쪽이 한 열쇠로 막힌 곳을 고른다.
      passable: false,
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

/** 공조존(IDF·사람이 만든 것)의 바닥. 조각이 여럿이면 MultiPolygon 이다. 든 방은 TTL 주어 id 로 적는다. */
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
      // 사람이 만든 공조존(OE-ZON-01·02)은 `edit` 이고 담당 설비를 적는다. IDF 공조존의 담당 설비는 TTL 의 feeds 에만 있다.
      source: zone.source === 'edit' ? 'edit' : 'IDF',
      ...(zone.servedBy ? { servedBy: [...zone.servedBy] } : {}),
    },
  }
}

/**
 * 커스텀존(OE-OBJ-01). 다각형은 여기에만 있고 TTL 에는 같은 id 의 brick:Zone 이 있다. 품는 방(TTL hasPart 와 같다)과
 * 안에 든 설비를 같이 적어, 지도에서 존을 누르면 무엇이 드는지 TTL 을 다시 읽지 않고 보인다.
 */
function customZoneFeature(zone: CustomZone, storey: Storey): Feature {
  return {
    type: 'Feature',
    id: zone.id,
    geometry: { type: 'Polygon', coordinates: [zone.footprint.map((p) => [p[0], p[1]])] },
    properties: {
      kind: 'customZone',
      name: zone.name,
      ...(zone.aliases?.length ? { aliases: [...zone.aliases] } : {}),
      storeyId: storey.id,
      elevation: storey.elevation,
      spaceIds: zoneSpaces(storey, zone),
      equipmentIds: zoneEquipment(storey, zone),
    },
  }
}

/**
 * 룸(OE-OBJ-03). 물리존 안에서 사람이 그린 편집 단위다. 3D Map 에 보이도록 GeoJSON 에만 적는다 — TTL 에는 없다. DT 탐색기에서 찾거나
 * 설비 위치로 가리키는 대상이 아니어서다(#45 PM 답, ADR-0023). 설비 소속은 지금처럼 물리존이다. 든 물리존은 `spaceId` 다.
 */
function roomFeature(room: Room, storey: Storey): Feature {
  return {
    type: 'Feature',
    id: room.id,
    geometry: { type: 'Polygon', coordinates: [room.footprint.map((p) => [p[0], p[1]])] },
    properties: {
      kind: 'room',
      name: room.name,
      storeyId: storey.id,
      elevation: storey.elevation,
      spaceId: room.spaceId,
      areaM2: Number(Math.abs(polygonArea(room.footprint)).toFixed(4)),
    },
  }
}

/**
 * 추가 공간 오브젝트(OE-OBJ-09). 바닥에 선 축 정렬 상자라 바닥 사각형과 높이로 적는다. 룸과 같이 GeoJSON 에만 있다(#51 PM 답,
 * ADR-0023). 모양은 라이브러리 항목(`item`, 이름은 `itemName`)이 정한다 — 받는 쪽은 상자를 세우거나 같은 항목의 모델을 상자에 맞춰 늘인다.
 */
function spaceObjectFeature(object: SpaceObject, storey: Storey, itemNames: ReadonlyMap<string, string>): Feature {
  const [w, d, h] = object.size
  const ring = rectRing([object.at[0] - w / 2, object.at[1] - d / 2], [object.at[0] + w / 2, object.at[1] + d / 2])
  return {
    type: 'Feature',
    id: object.id,
    geometry: { type: 'Polygon', coordinates: [ring.map((p) => [p[0], p[1]])] },
    properties: {
      kind: 'spaceObject',
      name: object.name,
      storeyId: storey.id,
      elevation: storey.elevation,
      item: object.item,
      itemName: itemNames.get(object.item) ?? null,
      size: [w, d, h],
      height: h,
    },
  }
}

/**
 * 수직 관통 오브젝트의 한 층 조각(OE-ML-02, vertical-object.ts). id 는 `오브젝트 id@층 id` 다. 형상이 있으면 평면 다각형, 없으면
 * 종료 지점(끝 층)이다. 계단은 구조로 이어져 있어도 로봇이 지나가지 못한다(OE-ML-04) — `verticalConnects` 와 `passable` 은 따로다.
 * TTL 에는 아직 내보내지 않는다(ADR-0033).
 */
function verticalPartFeature(part: VerticalPart, storey: Storey, vertical?: VerticalRef): Feature {
  const ring = part.footprint
  const point = part.exit ?? part.entry
  return {
    type: 'Feature',
    id: partId(part.parentId, storey.id),
    geometry:
      ring.length >= 3
        ? { type: 'Polygon', coordinates: [[...ring, ring[0]].map((p) => [p[0], p[1]])] }
        : point
          ? { type: 'Point', coordinates: [...point] }
          : null,
    properties: {
      kind: 'vertical',
      verticalKind: part.kind,
      parentId: part.parentId,
      name: part.name,
      storeyId: storey.id,
      elevation: storey.elevation,
      source: part.source,
      // 사람이 다중층 뷰에서 옮긴 조각(OE-ML-07). source 는 처음 온 곳(bim)이고, 형상·지점은 보정 값이다(OE-ML-02 "원본과 보정 구분").
      ...(part.edited ? { edited: true } : {}),
      entry: part.entry ? [...part.entry] : null,
      exit: part.exit ? [...part.exit] : null,
      spaceIds: partSpaces(storey, part),
      passable: false,
      ...(vertical?.to.length ? { verticalConnects: [...vertical.to], verticalConnectsSource: vertical.source } : {}),
    },
  }
}

/** 층 하나를 FeatureCollection 으로. 물리존·설비·벽·문·창(과 IDF 공조존·커스텀존·룸·추가 공간 오브젝트)이 같은 파일에 들어간다. */
export function storeyToGeoJSON(
  storey: Storey,
  zones: readonly HvacZone[] = [],
  vertical: ReadonlyMap<string, VerticalRef> = new Map(),
  itemNames: ReadonlyMap<string, string> = new Map(),
): FeatureCollection {
  const external = judgeExternal(storey)
  return {
    type: 'FeatureCollection',
    features: [
      ...storey.spaces.map((s) => spaceFeature(s, storey, vertical.get(s.id))),
      ...storey.equipment.map((e) => equipmentFeature(e, storey)),
      ...storey.walls.map((w) => wallFeature(w, storey, external.get(w.id))),
      ...storey.openings.map((o) => openingFeature(o, storey)),
      ...zones.filter((z) => z.storeyId === storey.id).map((z) => hvacZoneFeature(z, storey)),
      ...(storey.customZones ?? []).map((z) => customZoneFeature(z, storey)),
      ...(storey.rooms ?? []).map((r) => roomFeature(r, storey)),
      ...(storey.spaceObjects ?? []).map((o) => spaceObjectFeature(o, storey, itemNames)),
      ...(storey.verticalParts ?? []).map((p) => verticalPartFeature(p, storey, vertical.get(partId(p.parentId, storey.id)))),
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
  const vertical = verticalRefs(model)
  const itemNames = new Map(libraryOf(model).map((i) => [i.key, i.name]))
  return model.storeys.map((storey) => {
    // 층 이름에는 공백이나 슬래시가 들어올 수 있다. 파일 이름으로 쓰기 전에 걸러 낸다.
    const stem = `floor-${storey.name.replace(/[^\w가-힣-]+/g, '_') || storey.id}`
    let fileName = `${stem}.geojson`
    for (let n = 2; taken.has(fileName.toLowerCase()); n++) fileName = `${stem}-${n}.geojson`
    taken.add(fileName.toLowerCase())
    const collection = storeyToGeoJSON(storey, hvacZonesOf(model), vertical, itemNames)
    return { fileName, collection: model.skipped?.length ? { ...collection, skipped: [...model.skipped] } : collection }
  })
}

/** 물리존·오브젝트 조각 feature id → 층 사이 연결. 조각끼리는 오브젝트의 출처로 잇는다. */
function verticalRefs(model: Model): Map<string, VerticalRef> {
  const spaces = verticalConnections(model)
  const out = new Map<string, VerticalRef>()
  for (const [id, to] of spaces.links) out.set(id, { to, source: spaces.sources.get(id) ?? 'calc' })
  for (const o of verticalObjects(model)) for (const [id, to] of partLinks([o])) out.set(id, { to, source: o.source })
  return out
}
