// 건축 모델과 설비 모델을 하나로 합친다.
//
// 실제 프로젝트는 디스플린마다 파일이 갈린다. 건축 모델에는 물리존이 있고 설비가 없으며,
// 설비 모델에는 설비가 있고 물리존이 없다(`docs/ifc-coverage.md` §3 ④). 설비 소속 물리존
// (F11)은 둘이 만나야 나오므로, 한 번에 파일 하나만 여는 동안에는 실제 프로젝트에서 F11 이
// 원천적으로 안 된다.
//
// **층은 GUID 가 아니라 이름으로 맞춘다.** 같은 건물의 두 판본이어도 층의 GlobalId 가 다르다
// (Duplex 건축 판본 `1xS3BCk…`, 설비 판본 `0o8nNAb…`). 저작 도구가 디스플린 파일마다 층을
// 따로 만들기 때문이다. 이름이 같고 높이가 같으면 같은 층으로 본다.
//
// **좌표계가 같다는 보장은 없다.** 어긋나면 오류 없이 모든 설비가 물리존 밖으로 나간다 —
// 파싱도 합치기도 성공하고 숫자만 "미소속 N대" 로 조용히 늘어난다. 그래서 합치기 전에 두
// 모델이 같은 자리를 차지하는지부터 재고, 결과를 보고서로 돌려준다.

import { ratioLabel, storeyScaleMismatch, type ScaleMismatch } from './unit-check'
import { assignEquipmentToSpaces, distanceToRing, interiorPoint, pointInPolygon } from './mapping'
import { inferFlowByRules } from './flow-rules'
import type { Connection, Model, Space, Storey, System, Vec2 } from './model'

/** 두 층의 높이가 이 안이면 같은 층으로 본다(미터). 저작 도구의 반올림을 흡수할 만큼만 둔다. */
export const ELEVATION_TOLERANCE = 0.05

/**
 * 설비 좌표가 기준 모델의 공간 범위에서 이만큼 벗어나도 "같은 자리" 로 본다(미터).
 *
 * 외벽 바깥의 실외기, 지붕 위 설비, 벽 속 배관이 공간 외곽선 바로 밖에 있는 것이 정상이다.
 * 좌표계가 어긋난 경우는 수 미터가 아니라 수십~수천 미터 단위로 벗어나므로(측량 원점과
 * 프로젝트 원점의 차이) 이 여유가 판정을 흐리지 않는다.
 */
export const ALIGNMENT_MARGIN = 2

/** 설비의 이 비율 미만이 기준 모델 범위 안에 들면 좌표계가 어긋났다고 경고한다. */
export const ALIGNMENT_MIN_RATIO = 0.5

export type StoreyMatch = {
  /** 덧붙인 모델의 층 이름. */
  name: string
  /** 짝지은 기준 모델의 층 이름. `null` 이면 짝이 없어 새 층으로 들어갔다. */
  matchedTo: string | null
  by: 'name' | 'elevation' | null
  /** 덧붙인 층 높이 - 기준 층 높이(미터). 짝이 없으면 null. */
  elevationDelta: number | null
}

export type MergeReport = {
  storeys: StoreyMatch[]
  /**
   * 덧붙인 모델의 설비 중 좌표가 있는 것이 기준 모델의 공간 범위(±ALIGNMENT_MARGIN)에 든 비율.
   * 기준 모델에 공간이 없으면 잴 수 없어 null 이다.
   */
  alignment: { placed: number; inside: number; ratio: number } | null
  /**
   * 덧붙인 모델의 물리존을 어떻게 받았나.
   *
   * `dropped` 는 같은 자리에 이미 방이 있어 버린 것이다. 둘 다 두면 같은 방이 온톨로지에 두 번
   * 들어간다(Revit 의 "MEP Space" 는 건축 Room 을 베낀 것이고, 설비 판본에는 건축 Room 의
   * 사본까지 같이 들어 있었다). `kept` 는 기준 모델에 없는 자리를 채워서 받은 것이다.
   * `borrowed` 는 기준 모델의 물리존에 외곽선이 없어서, 같은 층·같은 방 번호의 외곽선을
   * 빌려 준 것이다 — id 는 기준 모델 것을 그대로 둔다.
   */
  spaces: { dropped: number; kept: number; borrowed: number }
  /**
   * 덧붙인 모델이 **BIM 으로 말해 준 소속**이 겹쳐서 버린 물리존을 가리킨 설비. `remapped` 는
   * 같은 자리의 남은 물리존으로 옮겨 적은 것이고, 나머지는 좌표 판정으로 넘겼다.
   */
  declaredRemapped: { total: number; remapped: number }
  /** 두 모델에 같은 GlobalId 로 들어 있던 요소. 기준 모델 것을 남긴다. */
  duplicateIds: number
  /** 덧붙인 모델 설비의 미소속 대수. 합치기 전(그 파일 혼자)과 후. */
  unlocated: { before: number; after: number }
  /**
   * 이름이 같은 층의 높이가 단위 배수(1000·1/1000·3.28 …)만큼 다르다 — 한쪽의 길이 단위 선언이 실제 값과 다르다(OE-BIM-11,
   * unit-check.ts). 비는 덧붙인 모델 / 기준 모델. 없으면 null.
   */
  unitScale?: ScaleMismatch | null
}

const normalize = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase()

/**
 * 덧붙인 층의 짝을 기준 모델에서 찾는다.
 *
 * 이름이 먼저다. 층 이름은 사람이 도면에 적는 값이라 디스플린 사이에서 맞춰 두는 것이
 * 관례이고, DT 쪽 층 표기와 맞추는 요구사항도 이미 있다(`docs/bim-to-dt-ontology.md` 4장).
 * 이름이 안 맞으면 높이로 찾되 **하나만 맞을 때만** 짝짓는다. 둘 이상이면 고를 근거가 없다.
 */
export function matchStorey<T extends Pick<Storey, 'name' | 'elevation'>>(storey: Pick<Storey, 'name' | 'elevation'>, base: readonly T[]): { target: T; by: 'name' | 'elevation' } | null {
  const byName = base.filter((b) => normalize(b.name) === normalize(storey.name) && storey.name.trim() !== '')
  if (byName.length === 1) return { target: byName[0], by: 'name' }

  const byElevation = base.filter((b) => Math.abs(b.elevation - storey.elevation) <= ELEVATION_TOLERANCE)
  if (byElevation.length === 1) return { target: byElevation[0], by: 'elevation' }
  return null
}

function unlocatedCount(model: Model): number {
  return model.storeys.reduce((n, s) => n + s.equipment.filter((e) => e.spaceId === null).length, 0)
}

/**
 * 두 모델을 합친다. 입력은 건드리지 않고 새 모델을 돌려준다.
 *
 * `base` 가 물리존을 대는 쪽(보통 건축), `overlay` 가 설비를 대는 쪽(보통 설비)이다.
 * 같은 자리에 양쪽 다 물리존이 있으면 `base` 것만 남긴다. 설비·벽·문·창·계통·연결은 양쪽
 * 것을 다 모은다. 합친 뒤 설비 소속을 **한 번에 다시 판정한다** — 판정을 호출부에 맡기면
 * 설비는 들어왔는데 소속은 빈 상태가 조용히 남는다.
 *
 * 경고는 파일마다 이름표를 붙여 모은다. 어느 파일에 대한 말인지 모르면 고객사에 무엇을
 * 고쳐 달라고 할지 정할 수 없다.
 */
export function mergeModels(
  base: Model,
  overlay: Model,
  labels: { base: string; overlay: string } = { base: '기준', overlay: '덧붙임' },
): { model: Model; report: MergeReport } {
  const a = structuredClone(base)
  const b = structuredClone(overlay)
  const unlocatedBefore = unlocatedCount(overlay)

  // --- 좌표계가 같은가 ------------------------------------------------------
  // 기준 모델의 물리존이 차지하는 범위에 덧붙인 모델의 설비가 드는지 본다. 층을 맞추기
  // 전에 잰다 — 층 짝짓기가 틀려도 이 값은 흔들리지 않아야 원인을 가를 수 있다.
  const ringPoints = a.storeys.flatMap((s) => s.spaces.flatMap((sp) => sp.footprint))
  let alignment: MergeReport['alignment'] = null
  if (ringPoints.length > 0) {
    const minX = Math.min(...ringPoints.map((p) => p[0])) - ALIGNMENT_MARGIN
    const maxX = Math.max(...ringPoints.map((p) => p[0])) + ALIGNMENT_MARGIN
    const minY = Math.min(...ringPoints.map((p) => p[1])) - ALIGNMENT_MARGIN
    const maxY = Math.max(...ringPoints.map((p) => p[1])) + ALIGNMENT_MARGIN
    const placed = b.storeys.flatMap((s) => s.equipment).filter((e) => e.position !== null)
    const inside = placed.filter((e) => {
      const [x, y] = e.position!
      return x >= minX && x <= maxX && y >= minY && y <= maxY
    }).length
    if (placed.length > 0) alignment = { placed: placed.length, inside, ratio: inside / placed.length }
  }

  // --- 층 짝짓기 ------------------------------------------------------------
  const storeyReport: StoreyMatch[] = []
  /**
   * 버린 물리존 id → 같은 자리에 있어 대신 남은 물리존 id. BIM 이 말한 소속이 버린 물리존을
   * 가리키면, 다시 판정한 결과가 이 id 와 같은지로 좌표 판정을 채점한다.
   */
  const dropped = new Map<string, string | null>()
  const spaceTally = { dropped: 0, kept: 0, borrowed: 0 }
  const seenIds = new Set<string>(
    a.storeys.flatMap((s) => [
      ...s.spaces.map((x) => x.id),
      ...s.walls.map((x) => x.id),
      ...s.openings.map((x) => x.id),
      ...s.equipment.map((x) => x.id),
    ]),
  )
  let duplicateIds = 0
  const fresh = <T extends { id: string }>(items: T[]): T[] =>
    items.filter((item) => {
      if (seenIds.has(item.id)) {
        duplicateIds++
        return false
      }
      seenIds.add(item.id)
      return true
    })

  /**
   * 덧붙인 층의 물리존을 기준 층에 받아들인다. **같은 자리에 방이 이미 있으면 버리고, 빈 자리를
   * 채우는 것만 받는다.**
   *
   * "기준 모델 것만 남긴다" 로 두었다가 Duplex 에서 미소속 설비가 424 → 493 으로 늘었다.
   * 건축 판본의 복도 둘이 외곽선이 없어서(SurfaceModel), 설비 판본이 채워 주던 복도까지 버린
   * 탓이다. 같은 자리인지는 들어오는 방의 안쪽 점 하나가 이미 있는 방 안에 드는지로 본다.
   * 받은 방도 다음 방의 비교 대상에 넣는다 — 설비 판본 안에서도 같은 방이 두 번 나온다.
   */
  function absorbSpaces(target: Storey, incoming: Space[]) {
    // 외곽선이 없는 기준 물리존은 같은 방 번호(Name)의 외곽선을 빌린다. 방 번호는 도면에 적히는
    // 값이라 디스플린 파일 사이에서 유지된다(A201 은 양쪽 다 A201 이었다). 이름이 빈 방끼리는
    // 짝짓지 않는다 — 빈 이름은 같다는 증거가 아니다.
    for (const space of target.spaces) {
      if (space.footprint.length > 0 || !space.name.trim()) continue
      const donor = incoming.find((s) => s.footprint.length > 0 && normalize(s.name) === normalize(space.name))
      if (!donor) continue
      space.footprint = donor.footprint.map((p) => [p[0], p[1]] as Vec2)
      space.areaM2 = donor.areaM2
      spaceTally.borrowed++
    }

    for (const space of incoming) {
      if (seenIds.has(space.id)) {
        duplicateIds++
        continue
      }
      const p = interiorPoint(space.footprint)
      const sameSpot = p
        ? target.spaces.find((s) => pointInPolygon(p, s.footprint))
        : // 외곽선이 없는 방은 자리로 비교할 수 없다. 방 번호가 같은 것이 있으면 같은 방이다.
          target.spaces.find((s) => space.name.trim() !== '' && normalize(s.name) === normalize(space.name))
      if (sameSpot) {
        dropped.set(space.id, sameSpot.id)
        spaceTally.dropped++
        continue
      }
      seenIds.add(space.id)
      target.spaces.push(space)
      spaceTally.kept++
    }
  }

  // 수직 관통 오브젝트 조각(OE-ML-02). 같은 오브젝트가 두 판본에 다 있으면 바탕 것만 둔다 — 층마다 섞이면 한 오브젝트가 두 모양이 된다.
  const baseParents = new Set(a.storeys.flatMap((s) => (s.verticalParts ?? []).map((p) => p.parentId)))
  const freshParts = (storey: Storey) => (storey.verticalParts ?? []).filter((p) => !baseParents.has(p.parentId))

  for (const storey of b.storeys) {
    const match = matchStorey(storey, a.storeys)
    if (!match) {
      storeyReport.push({ name: storey.name, matchedTo: null, by: null, elevationDelta: null })
      const parts = freshParts(storey)
      const added: Storey = { ...storey, spaces: [], walls: fresh(storey.walls), openings: fresh(storey.openings), equipment: fresh(storey.equipment), verticalParts: parts.length ? parts : undefined }
      absorbSpaces(added, storey.spaces)
      a.storeys.push(added)
      continue
    }

    const target = match.target
    storeyReport.push({
      name: storey.name,
      matchedTo: target.name,
      by: match.by,
      elevationDelta: storey.elevation - target.elevation,
    })

    absorbSpaces(target, storey.spaces)
    // BIM 이 적은 층 높이는 바탕 파일 것을 쓰고, 바탕에 없을 때만 덧붙인 파일 것을 쓴다(OE-BIM-02).
    if (!target.declaredHeight && storey.declaredHeight) target.declaredHeight = { ...storey.declaredHeight }
    // 반자 높이(OE-EQP-03)도 비어 있을 때만 채운다. 설비 판본의 방 높이는 임포터가 이미 거른다(ceiling.ts).
    if (!target.ceiling && storey.ceiling) target.ceiling = { ...storey.ceiling }
    target.walls.push(...fresh(storey.walls))
    target.openings.push(...fresh(storey.openings))
    target.equipment.push(...fresh(storey.equipment))
    const parts = freshParts(storey)
    if (parts.length) target.verticalParts = [...(target.verticalParts ?? []), ...parts]
  }
  a.storeys.sort((x, y) => x.elevation - y.elevation)

  // --- BIM 이 말한 소속 중 버린 물리존을 가리키는 것 --------------------------
  //
  // 그대로 두면 온톨로지에 없는 물리존을 가리키는 `brick:hasLocation` 이 나간다. **같은 자리의
  // 남은 물리존으로 옮겨 적고 'bim' 을 유지한다.** BIM 이 한 말은 "이 설비는 이 방에 있다" 이고,
  // 우리가 한 일은 "그 방이 곧 이 방이다" 를 방 단위로 맞춘 것뿐이다. 설비 좌표로 다시 판정하면
  // 벽에 붙은 설비가 외곽선 위에 떨어져 다시 틀린다 — 처음에 그렇게 했다가 Duplex 에서 말단
  // 105대 중 41대의 소속을 잃었다.
  let remapped = 0
  let orphaned = 0
  for (const storey of a.storeys) {
    for (const e of storey.equipment) {
      if (e.spaceSource !== 'bim' || e.spaceId === null || !dropped.has(e.spaceId)) continue
      const counterpart = dropped.get(e.spaceId)!
      if (counterpart !== null) {
        e.spaceId = counterpart
        remapped++
      } else {
        // 짝을 못 찾은 방을 가리키면 좌표 판정에 맡긴다. 지금 규칙에선 버린 방에는 늘 짝이
        // 있지만, 규칙이 바뀌어도 없는 방을 가리키는 소속이 새어 나가지 않게 막아 둔다.
        e.spaceId = null
        e.spaceSource = null
        orphaned++
      }
    }
  }

  // --- 계통과 연결 ------------------------------------------------------------
  // 계통은 id 가 같으면 합친다. Revit `System Name` 에서 세운 계통은 이름이 곧 id 라서,
  // 두 파일이 같은 계통 이름을 쓰면 한 계통의 두 조각이다.
  const systems = new Map<string, System>(a.systems.map((s) => [s.id, s]))
  for (const s of b.systems) {
    const had = systems.get(s.id)
    if (had) {
      had.memberIds = [...new Set([...had.memberIds, ...s.memberIds])]
      // 유체를 한쪽 판본만 말했으면(분야별로 이름을 달리 적는다) 그 값을 쓴다.
      if (!had.fluid && s.fluid) {
        had.fluid = s.fluid
        if (s.fluidSource) had.fluidSource = s.fluidSource
      }
    } else systems.set(s.id, s)
  }

  const key = (c: Connection) => (c.directed ? `${c.from}>${c.to}` : [c.from, c.to].sort().join('-'))
  const connections = new Map<string, Connection>(a.connections.map((c) => [key(c), c]))
  for (const c of b.connections) if (!connections.has(key(c))) connections.set(key(c), c)

  const merged: Model = {
    schema: a.schema === b.schema ? a.schema : `${a.schema} + ${b.schema}`,
    siteName: a.siteName || b.siteName,
    // 건물 주어는 기준 모델 것을 쓴다. 두 판본의 IfcBuilding GUID 도 서로 다른 게 보통이다.
    buildingId: a.buildingId,
    buildingName: a.buildingName || b.buildingName,
    storeys: a.storeys,
    systems: [...systems.values()],
    connections: [...connections.values()],
    warnings: [...a.warnings.map((w) => `[${labels.base}] ${w}`), ...b.warnings.map((w) => `[${labels.overlay}] ${w}`)],
    ...(a.skipped || b.skipped ? { skipped: [...new Set([...(a.skipped ?? []), ...(b.skipped ?? [])])] } : {}),
    ...(a.facts && b.facts
      ? {
          facts: {
            lengthUnit: a.facts.lengthUnit && b.facts.lengthUnit,
            mapConversion: a.facts.mapConversion && b.facts.mapConversion,
            siteLatLong: a.facts.siteLatLong || b.facts.siteLatLong,
            ...(a.facts.proxies || b.facts.proxies
              ? {
                  proxies: {
                    total: (a.facts.proxies?.total ?? 0) + (b.facts.proxies?.total ?? 0),
                    ported: (a.facts.proxies?.ported ?? 0) + (b.facts.proxies?.ported ?? 0),
                    named: (a.facts.proxies?.named ?? 0) + (b.facts.proxies?.named ?? 0),
                    louvers: (a.facts.proxies?.louvers ?? 0) + (b.facts.proxies?.louvers ?? 0),
                    skipped: [...new Set([...(a.facts.proxies?.skipped ?? []), ...(b.facts.proxies?.skipped ?? [])])].slice(0, 5),
                  },
                }
              : {}),
          },
        }
      : {}),
  }

  assignEquipmentToSpaces(merged)
  // 규칙 방향도 합친 뒤 다시 정한다. 공조기는 설비 파일에, 계통은 다른 파일에 있을 수 있어서
  // 한 파일 안에서 정한 방향만으로는 모자란다. 확정된 것은 그대로 둔다(inferFlowByRules 주석).
  inferFlowByRules(merged)

  const report: MergeReport = {
    storeys: storeyReport,
    alignment,
    spaces: spaceTally,
    declaredRemapped: remapped + orphaned === 0 ? { total: 0, remapped: 0 } : { total: remapped + orphaned, remapped },
    duplicateIds,
    unlocated: { before: unlocatedBefore, after: 0 },
    unitScale: storeyScaleMismatch(base.storeys, overlay.storeys),
  }

  // 덧붙인 모델에서 온 설비만 센다. 기준 모델의 설비까지 세면 before 와 견줄 수 없다.
  const overlayIds = new Set(overlay.storeys.flatMap((s) => s.equipment.map((e) => e.id)))
  report.unlocated.after = merged.storeys.reduce(
    (n, s) => n + s.equipment.filter((e) => overlayIds.has(e.id) && e.spaceId === null).length,
    0,
  )

  merged.warnings.push(...mergeWarnings(report, labels))
  return { model: merged, report }
}

/** 두 외곽선이 같은 자리라고 보는 차(미터). 꼭짓점마다 상대 외곽선까지의 거리 중 가장 큰 것이 이 안이어야 한다. */
export const SAME_FOOTPRINT = 0.01

/**
 * 이름이 같은 방을 말하는가. 같거나, 한쪽이 다른 쪽에 꼬리를 붙인 것이다 — 이름은 `Foyer` · `Foyer MEP Space`,
 * 방 번호는 `A104` · `A104-M`. 이름만 보면 Duplex 의 `Bathroom 1` · `Bathroom MEP Space` 를 놓치고, 번호만 보면 병원의
 * `2D04-A` · `2D04A-M`(이름은 둘 다 COMPUTER ROOM)을 놓친다.
 */
function sameRoomLabel(a: string, b: string): boolean {
  const x = normalize(a)
  const y = normalize(b)
  if (!x || !y) return false
  const tail = (long: string, short: string) => long.startsWith(`${short} `) || long.startsWith(`${short}-`)
  return x === y || tail(x, y) || tail(y, x)
}

/**
 * Revit 이 이름을 안 붙인 방·공간에 넣는 기본 이름. 성수 건축은 이름 붙은 Room 마다 같은 외곽선의 Space 를 하나씩 더
 * 두었는데(425쌍) 그 이름이 전부 기본값 "공간" 이고 번호도 따로 매겨져서(`742 TPS` · `836 공간`) 이름으로는 같은 방인 줄
 * 몰랐다. 기본 이름은 아무 방도 가리키지 않으므로, 외곽선이 같으면 같은 방으로 본다.
 */
export const PLACEHOLDER_NAMES = new Set(['공간', '방', 'space', 'room'])
/** 이름이 Revit 기본 이름("공간" 등)인 방. 아무 방도 가리키지 않는 이름이다. */
export const isPlaceholder = (s: Pick<Space, 'longName'>) => PLACEHOLDER_NAMES.has(normalize(s.longName ?? ''))

/**
 * **한 파일 안에서 같은 방이 두 번 들어 있으면 하나만 남긴다.** 모델을 그 자리에서 고치고 버린 수를 돌려준다.
 *
 * Revit 설비 판본은 건축 Room 의 사본과 그것을 베낀 "MEP Space" 를 같이 낸다(Duplex MEP 42 = 21 × 2, 병원 MEP
 * 526개 중 257쌍). 합칠 때만 걷어 내던 것이라, 설비 파일 하나만 열면 같은 방이 TTL 에 두 번 나갔다.
 *
 * 같은 방이라는 기준은 둘이다 — **외곽선이 같고(SAME_FOOTPRINT) 이름이 같은 방을 말한다.** 가진 파일에서 사본은
 * 외곽선 차가 전부 0 이었다. 자리만 보면 안 된다. 병원 HVAC 의 지붕 `R-Roof` 와 `R-AT1 Roof` 는 외곽선이 똑같은
 * 다른 공간이고, Duplex 건축의 현관과 계단실은 서로의 안쪽 점을 품는다(넓이 비 0.76). 합칠 때의 기준(안쪽 점 하나)을
 * 여기 쓰면 병원 건축에서 대기실이 접수대를 먹는다.
 *
 * 한쪽 이름이 Revit 기본 이름("공간" 등)이면 이름은 보지 않는다(PLACEHOLDER_NAMES). 그때는 이름 있는 쪽을 남긴다.
 *
 * 그 밖에는 **BIM 이 말한 설비 소속이 걸린 것**을 남긴다(가진 파일에서 사본 쌍의 소속은 늘 한쪽에만 걸려 있었다).
 * 둘 다 걸렸으면 앞의 것을 남기고 버린 쪽을 가리키던 소속·문이 잇는 방을 남긴 쪽으로 옮겨 적는다.
 */
export function dropDuplicateSpaces(model: Pick<Model, 'storeys'>): number {
  const declared = new Map<string, number>()
  for (const e of model.storeys.flatMap((s) => s.equipment)) {
    if (e.spaceSource === 'bim' && e.spaceId) declared.set(e.spaceId, (declared.get(e.spaceId) ?? 0) + 1)
  }
  const replaced = new Map<string, string>()
  for (const storey of model.storeys) {
    const kept: Space[] = []
    for (const space of storey.spaces) {
      const twin =
        space.footprint.length >= 3
          ? kept.find(
              (k) =>
                k.footprint.length >= 3 &&
                Math.abs(k.areaM2 - space.areaM2) <= 0.01 * Math.max(k.areaM2, space.areaM2) &&
                (sameRoomLabel(k.longName, space.longName) || sameRoomLabel(k.name, space.name) || isPlaceholder(k) || isPlaceholder(space)) &&
                Math.max(...space.footprint.map((p) => distanceToRing(p, k.footprint)), ...k.footprint.map((p) => distanceToRing(p, space.footprint))) <=
                  SAME_FOOTPRINT,
            )
          : undefined
      if (!twin) {
        kept.push(space)
        continue
      }
      // 이름이 기본값인 쪽은 버린다(이름이 온톨로지의 rdfs:label 이다). 아니면 소속이 걸린 쪽을 남긴다. 버린 쪽을 가리키던
      // 소속은 아래에서 남긴 쪽으로 옮겨 적는다. 버리는 쪽에만 있던 값(분류·경계)은 남기는 쪽이 비었을 때만 채운다.
      const [keep, drop] =
        isPlaceholder(space) !== isPlaceholder(twin)
          ? isPlaceholder(space)
            ? [twin, space]
            : [space, twin]
          : (declared.get(space.id) ?? 0) > (declared.get(twin.id) ?? 0)
            ? [space, twin]
            : [twin, space]
      if (keep === space) kept[kept.indexOf(twin)] = space
      keep.boundedBy = [...new Set([...keep.boundedBy, ...drop.boundedBy])]
      if (!keep.omniclass && drop.omniclass) {
        keep.omniclass = drop.omniclass
        if (drop.omniclassSource) keep.omniclassSource = drop.omniclassSource
      }
      if (!keep.kind && drop.kind) {
        keep.kind = drop.kind
        if (drop.kindSource) keep.kindSource = drop.kindSource
      }
      replaced.set(drop.id, keep.id)
    }
    storey.spaces = kept
  }
  if (replaced.size === 0) return 0
  for (const storey of model.storeys) {
    for (const e of storey.equipment) {
      if (e.spaceId && replaced.has(e.spaceId)) e.spaceId = replaced.get(e.spaceId)!
    }
    for (const o of storey.openings) {
      if (o.connects) o.connects = [...new Set(o.connects.map((id) => replaced.get(id) ?? id))]
    }
  }
  return replaced.size
}

/** 보고서에서 사람이 봐야 할 것만 문장으로. 문제가 없으면 아무것도 말하지 않는다. */
function mergeWarnings(report: MergeReport, labels: { base: string; overlay: string }): string[] {
  const out: string[] = []

  if (report.alignment && report.alignment.ratio < ALIGNMENT_MIN_RATIO) {
    const pct = Math.round(report.alignment.ratio * 100)
    out.push(
      `${labels.overlay}의 설비 ${report.alignment.placed}대 중 ${pct}%만 ${labels.base}의 공간 범위 안에 있습니다. ` +
        '두 파일의 좌표계(원점·북방향)가 다른 것 같습니다. 이대로면 설비 소속이 틀립니다.',
    )
  }

  const unmatched = report.storeys.filter((s) => s.matchedTo === null)
  if (unmatched.length > 0) {
    out.push(
      `${labels.base}에 없는 층이라 새 층으로 넣었습니다: ${unmatched.map((s) => `"${s.name}"`).join(', ')}(${labels.overlay}). 두 파일의 층 이름을 맞춰야 합니다.`,
    )
  }

  // 높이가 단위 배수로 다르면 "기준점이 다를 수 있다" 가 아니라 단위가 틀린 것이다. 그 층들은 아래 경고에서 뺀다.
  const scale = report.unitScale
  if (scale) {
    out.push(
      `이름이 같은 층의 높이가 ${labels.overlay}에서 ${labels.base}의 ${ratioLabel(scale.ratio)}입니다(${scale.storeys
        .slice(0, 3)
        .map(([name, x, y]) => `${name} ${+x.toPrecision(4)}m → ${+y.toPrecision(4)}m`)
        .join(', ')}). ${scale.suspect ? `층간 높이로 보면 ${scale.suspect === 'second' ? labels.overlay : labels.base}` : '한쪽'}의 길이 단위 선언이 실제 값과 다른 것 같습니다(${scale.what}). 치수·좌표가 모두 그 배수로 틀립니다(요구사항 R6).`,
    )
  }
  const scaled = new Set(scale?.storeys.map(([name]) => name) ?? [])
  const shifted = report.storeys.filter((s) => !scaled.has(s.name)).filter(
    (s) => s.elevationDelta !== null && Math.abs(s.elevationDelta) > ELEVATION_TOLERANCE,
  )
  if (shifted.length > 0) {
    out.push(
      `이름은 같은데 높이가 다른 층이 있습니다(${shifted.map((s) => `${s.name} ${s.elevationDelta! > 0 ? '+' : ''}${s.elevationDelta!.toFixed(2)}m`).join(', ')}). 높이 기준점이 다를 수 있습니다.`,
    )
  }

  const lost = report.declaredRemapped.total - report.declaredRemapped.remapped
  if (lost > 0) {
    out.push(
      `${labels.overlay}에 적힌 설비 소속 ${lost}건은 물리존을 찾지 못해 좌표로 다시 정했습니다.`,
    )
  }

  if (report.duplicateIds > 0) {
    out.push(`두 파일에 같은 GlobalId가 ${report.duplicateIds}개 있어 ${labels.base} 쪽을 남겼습니다.`)
  }
  return out
}
