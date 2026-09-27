// 고객사 BIM 요구사항(정본 docs/bim-to-dt-ontology.md 4장)을 열린 모델에 대 본다.
//
// **IDS 와 다른 점은 "다른 자리"를 따로 센다는 것이다.** IDS 는 표준 자리에 없으면 실패로 본다. 그런데 Revit 파일에서
// 권장이 떨어지는 것은 대부분 값이 없어서가 아니라 자리가 달라서다 — 방 분류는 `Category Code` 속성에, 계통은
// `System Name` 속성에, 용량은 `PSet_Revit_*` 에 있다. 우리는 그 자리도 읽는다. 셋을 가르면 고객사에 할 말이
// 달라진다. 표준 자리에 있으면 할 말이 없고, 다른 자리에 있으면 내보내기 설정을 바꿔 달라고 하고, 없으면 값을
// 넣어 달라고 한다(또는 우리가 메운다).
//
// 필수·권장과 제목은 정본의 표를 옮긴 것이다. requirements-ids.test.ts 가 정본과 같은지 본다.

import * as WebIFC from 'web-ifc'
import { isStandardCapacity } from './capacity'
import { equipmentKind, equipmentKindOfIfc, IFC_REJECTED } from './kinds'
import type { MergeReport } from './merge'
import { isConduit, type Equipment, type Model } from './model'

export type RequirementLevel = '필수' | '권장'

/**
 * - `standard` 표준 자리에 있다. IDS 도 통과한다.
 * - `elsewhere` 다른 자리에 있다. 우리는 읽는다. 내보내기 설정을 바꾸면 표준 자리로 간다.
 * - `partial` 일부만 있다.
 * - `missing` 없다.
 * - `none` 이 파일에는 해당하는 것이 없다(건축 파일의 설비처럼).
 * - `unmeasured` 파일 하나로는 잴 수 없다(3D 로 열어 보거나, 두 파일을 합치거나, 재내보내기가 있어야 한다).
 */
export type RequirementState = 'standard' | 'elsewhere' | 'partial' | 'missing' | 'none' | 'unmeasured'

export type RequirementRow = {
  id: string
  level: RequirementLevel
  title: string
  state: RequirementState
  /** 표준 자리 / 다른 자리 / 대상. 셀 수 없는 요구는 null. */
  counts: { standard: number; elsewhere: number; of: number } | null
  /** 무엇을 셌는지, 다른 자리면 어디인지, 없으면 우리가 무엇으로 메우는지. */
  note: string
}

/** 정본 4.1·4.2 의 R 번호와 등급. */
export const REQUIREMENTS: { id: string; level: RequirementLevel; title: string }[] = [
  { id: 'R0', level: '필수', title: '파일 구문' },
  { id: 'R1', level: '필수', title: '층 이름' },
  { id: 'R2', level: '필수', title: '공간과 바닥 외곽선' },
  { id: 'R3', level: '필수', title: '공간 이름과 방 번호' },
  { id: 'R4', level: '필수', title: '문·창의 개구부 관계' },
  { id: 'R6', level: '필수', title: '길이 단위' },
  { id: 'R7', level: '필수', title: '스캔과 같은 원점·북방향' },
  { id: 'R8', level: '필수', title: '형상 정확도 LOD 300' },
  { id: 'R9', level: '필수', title: 'MEP 포함' },
  { id: 'R11', level: '필수', title: '설비 위치' },
  { id: 'R12', level: '필수', title: '건축·설비 좌표계 일치' },
  { id: 'R13', level: '필수', title: 'GUID 유지' },
  { id: 'R5', level: '권장', title: '공간 경계' },
  { id: 'R14', level: '권장', title: '방 분류(OmniClass)' },
  { id: 'R10', level: '권장', title: 'IFC4 형식' },
  { id: 'R25', level: '권장', title: '설비 종류' },
  { id: 'R24', level: '권장', title: 'Proxy를 쓰지 않음' },
  { id: 'R16', level: '권장', title: '설비 형상이 서로 맞닿음' },
  { id: 'R17', level: '권장', title: '계통과 계통 종류' },
  { id: 'R18', level: '권장', title: '포트의 흐름 방향' },
  { id: 'R19', level: '권장', title: '공조기와 말단을 같은 계통으로' },
  { id: 'R20', level: '권장', title: '공조존' },
  { id: 'R21', level: '권장', title: '센서의 측정 대상 설비' },
  { id: 'R22', level: '권장', title: '용량' },
  { id: 'R23', level: '권장', title: '벽의 내력 여부' },
]

/**
 * 용량을 요구하는 종류. requirements.ids 의 R22 가 요구하는 클래스(공조기·FCU 류, 팬, 펌프, 냉동기, 냉각탑,
 * 방열기, VAV, 에어 터미널)와 같다. 보일러는 IFC4 표준 Pset 에 출력 자리가 없어 빠진다.
 */
const CAPACITY_KINDS = new Set([
  'ahu', 'fcu', 'indoor_unit', 'heat_pump', 'ground_source_heat_pump',
  'fan', 'exhaust_fan', 'pump', 'chiller', 'cooling_tower', 'radiator',
  'vav', 'air_diffuser', 'air_grille', 'outdoor_louver',
])

/**
 * `클래스.값` 의 값이 IFC 표준 열거값인가(IFC2x3·IFC4·IFC4X3 중 하나에라도 있으면). USERDEFINED 로 적은 유형 이름
 * (`Fan.200 mm`)은 아니다. requirements.ids 의 R25 가 허용하는 것과 같은 기준이다.
 */
function isStandardPredefined(declared: string | null | undefined): boolean {
  const dot = declared?.indexOf('.') ?? -1
  if (!declared || dot < 0 || IFC_REJECTED.includes(declared)) return false
  const cls = declared.slice(0, dot)
  const value = declared.slice(dot + 1)
  return [WebIFC.IFC2X3, WebIFC.IFC4, WebIFC.IFC4X3].some((schema) => {
    const e = (schema as unknown as Record<string, object | undefined>)[`Ifc${cls}TypeEnum`]
    return !!e && value in e && value !== 'USERDEFINED' && value !== 'NOTDEFINED'
  })
}

function stateOf(standard: number, elsewhere: number, of: number): RequirementState {
  if (of === 0) return 'none'
  if (standard >= of) return 'standard'
  if (standard + elsewhere >= of) return 'elsewhere'
  if (standard + elsewhere === 0) return 'missing'
  return 'partial'
}

function counted(standard: number, elsewhere: number, of: number) {
  return { state: stateOf(standard, elsewhere, of), counts: { standard, elsewhere, of } }
}

/**
 * `versions` 는 이전 판본과 견준 결과(versions.ts)다. 두 판본에 다 있는 물리존·설비 중 GUID 가 그대로인 것(kept)과
 * GUID 는 바뀌었지만 Revit 요소 ID·이름·위치로 찾은 것(rematched)이다. 없으면 R13 은 잴 수 없다.
 */
export function requirementsReport(
  model: Model,
  merge: MergeReport | null = null,
  versions: { name: string; kept: number; rematched: number } | null = null,
): RequirementRow[] {
  const spaces = model.storeys.flatMap((s) => s.spaces)
  const all = model.storeys.flatMap((s) => s.equipment)
  const devices = all.filter((e) => !isConduit(e.role))
  const openings = model.storeys.flatMap((s) => s.openings)
  const walls = model.storeys.flatMap((s) => s.walls)
  const facts = model.facts
  const systemById = new Map(model.systems.map((s) => [s.id, s]))
  // 두 파일을 합치면 `IFC2X3 + IFC4` 처럼 적힌다. 둘 다 IFC4 여야 IFC4 다.
  const ifc4 = model.schema.split(' + ').every((x) => x.toUpperCase().startsWith('IFC4'))

  const rows = new Map<string, Omit<RequirementRow, 'id' | 'level' | 'title'>>()
  const set = (id: string, row: Omit<RequirementRow, 'id' | 'level' | 'title'>) => rows.set(id, row)
  const unmeasured = (note: string) => ({ state: 'unmeasured' as const, counts: null, note })

  set('R0', { state: 'standard', counts: null, note: '문제없이 열립니다.' })

  {
    const named = model.storeys.filter((s) => s.name.trim()).length
    const matched = merge?.storeys ?? []
    const byElevation = matched.filter((s) => s.by === 'elevation').length
    set('R1', byElevation > 0
      ? {
          ...counted(matched.filter((s) => s.by === 'name').length, 0, matched.length),
          note: `덧붙인 파일의 층 ${byElevation}개는 이름이 달라 높이로 맞췄습니다. 두 파일의 층 이름을 같게 맞춰야 합니다.`,
        }
      : { ...counted(named, 0, model.storeys.length), note: '이름이 있는 층입니다. DT 층 표기와 같은지는 직접 확인하세요.' })
  }

  {
    const drawn = spaces.filter((s) => s.footprint.length >= 3).length
    set('R2', {
      ...counted(drawn, 0, spaces.length),
      note: spaces.length === 0
        ? '공간이 없습니다. 설비 파일이면 건축 파일을 덧붙이세요.'
        : '바닥 외곽선(FootPrint 또는 SweptSolid)이 있는 공간입니다. 나머지는 Brep·SurfaceModel이거나 형상이 없습니다.',
    })
  }

  {
    const both = spaces.filter((s) => s.name.trim() && s.longName.trim()).length
    set('R3', { ...counted(both, 0, spaces.length), note: spaces.length ? '방 번호(Name)와 이름(LongName)이 모두 있는 공간입니다.' : '공간이 없습니다.' })
  }

  // 임포트 때 읽지 않기로 한 피처는 "없음" 이 아니라 잴 수 없음이다(Model.skipped).
  const skipped = new Set(model.skipped ?? [])
  if (skipped.has('walls') || (skipped.has('doors') && skipped.has('windows'))) {
    set('R4', unmeasured(skipped.has('walls') ? '벽을 읽지 않고 열었습니다. 벽·문·창을 읽도록 켜고 다시 여세요.' : '문·창을 읽지 않고 열었습니다.'))
  } else {
    const hung = openings.filter((o) => o.wallId !== null).length
    set('R4', { ...counted(hung, 0, openings.length), note: openings.length ? '어느 벽에 있는지 아는 문·창입니다.' : '문·창이 없습니다. 설비 파일이면 건축 파일을 덧붙이세요.' })
  }

  if (!facts) set('R6', unmeasured('파일에서 읽은 모델이 아닙니다.'))
  else set('R6', facts.lengthUnit
    ? { state: 'standard', counts: null, note: '길이 단위가 선언되어 있습니다.' }
    : { state: 'missing', counts: null, note: '선언이 없어 미터로 가정했습니다. 치수가 모두 틀릴 수 있습니다.' })

  if (!facts) set('R7', unmeasured('파일에서 읽은 모델이 아닙니다.'))
  else if (facts.mapConversion) set('R7', { state: 'standard', counts: null, note: 'IfcMapConversion이 있습니다. 스캔과 맞는지는 3D에서 확인하세요.' })
  else set('R7', {
    state: 'missing',
    counts: null,
    note: (facts.siteLatLong ? '위경도만 있습니다. ' : '') +
      (ifc4 ? 'IfcMapConversion을 넣거나 기준점을 협의해야 합니다.' : 'IFC2x3에는 IfcMapConversion 자리가 없습니다. 기준점을 협의해야 합니다.'),
  })

  set('R8', unmeasured('형상 정확도는 3D에서 확인하세요.'))

  set('R9', devices.length > 0
    ? { state: 'standard', counts: { standard: devices.length, elsewhere: 0, of: devices.length }, note: `설비 ${devices.length}대가 있습니다.` }
    : { state: 'missing', counts: null, note: '설비가 없습니다. 건축 파일이면 정상이며, 설비 파일을 덧붙이면 됩니다.' })

  {
    const placed = devices.filter((e) => e.position !== null)
    const moved = placed.filter((e) => e.positionSource === 'geometry').length
    set('R11', {
      ...counted(placed.length - moved, moved, devices.length),
      note: moved > 0
        ? `배치점이 형상과 떨어져 있어 형상 중심을 쓴 설비가 ${moved}대입니다(다른 자리). 위치가 없는 설비는 미배치 목록으로 갑니다.`
        : '위치가 있는 설비입니다. 위치가 없는 설비는 미배치 목록으로 갑니다.',
    })
  }

  if (!merge?.alignment) set('R12', unmeasured('두 파일을 합치면 잴 수 있습니다.'))
  else {
    const { placed, inside } = merge.alignment
    set('R12', { ...counted(inside, 0, placed), note: '덧붙인 파일의 설비 중 건축 공간 범위 안에 있는 것입니다.' })
  }

  if (!versions) set('R13', unmeasured('판본 비교에서 이전 판본을 열면 잴 수 있습니다.'))
  else set('R13', {
    ...counted(versions.kept, versions.rematched, versions.kept + versions.rematched),
    note: `이전 판본(${versions.name})과 비교. 양쪽에 있는 물리존·설비 중 GUID가 그대로인 것입니다` +
      (versions.rematched ? `. 다른 자리 ${versions.rematched}개는 GUID가 바뀌어 Revit 요소 ID·이름·위치로 찾았습니다. 편집은 적용되지만 DT 쪽 id는 바뀝니다.` : '.'),
  })

  {
    const bounded = spaces.filter((s) => s.boundedBy.length > 0).length
    const byCoords = openings.filter((o) => o.connectsSource === 'calc').length
    set('R5', {
      ...counted(bounded, 0, spaces.length),
      note: bounded < spaces.length && byCoords > 0
        ? `공간 경계가 없는 곳은 문 ${byCoords}개 양쪽의 좌표로 방-문-방 연결을 채웠습니다(출처: 계산).`
        : '공간 경계가 있는 공간입니다.',
    })
  }

  {
    const std = spaces.filter((s) => s.omniclass && s.omniclassSource === 'classification').length
    const prop = spaces.filter((s) => s.omniclass && s.omniclassSource === 'property').length
    set('R14', {
      ...counted(std, prop, spaces.length),
      note: prop > 0
        ? `${prop}개는 Revit 속성(Category Code)에 있습니다. 분류 관계(IfcClassificationReference)로 내보내면 표준 자리로 옮겨집니다.`
        : 'OmniClass Table 13 코드가 있는 공간입니다.',
    })
  }

  set('R10', ifc4
    ? { state: 'standard', counts: null, note: model.schema }
    : {
        state: 'elsewhere',
        counts: null,
        note: `${model.schema}. 종류는 타입 객체에서 읽습니다. 계통 종류와 지도 변환을 담을 자리가 없습니다.`,
      })

  {
    // 묻는 것은 "IFC 자리에 종류가 있나"다. 이름 사전이 먼저 잡았어도 IFC 가 같은 것을 말하면 표준 자리다. 우리 표에
    // 없어도 IFC 표준 값이면(차단기 RESIDUALCURRENTCIRCUITBREAKER, 태양광 SOLARPANEL) 표준 자리다 — IDS 도 통과한다.
    const said = devices.filter((e) => equipmentKindOfIfc(e.declaredType) || isStandardPredefined(e.declaredType))
    const byName = devices.filter((e) => e.kind && !said.includes(e))
    const unknown = devices.length - said.length - byName.length
    set('R25', {
      ...counted(said.length, byName.length, devices.length),
      note: [
        byName.length > 0 ? `${byName.length}대는 IFC에 종류가 없어 패밀리 이름으로 정했습니다.` : 'IFC 클래스·PredefinedType에 종류가 있는 설비입니다.',
        unknown > 0 ? `${unknown}대는 IFC에도 이름에도 종류가 없습니다(USERDEFINED에 유형 이름만 있는 경우 등).` : '',
      ].join(' ').trim(),
    })
  }

  {
    const proxies = devices.filter((e) => e.ifcClass === 'BuildingElementProxy').length
    set('R24', {
      ...counted(devices.length - proxies, proxies, devices.length),
      note: proxies > 0
        ? `${proxies}대가 IfcBuildingElementProxy입니다. 포트가 있거나 이름이 사전에 있어 설비로 읽었습니다.`
        : 'Proxy로 들어온 설비가 없습니다.',
    })
  }

  set('R16', unmeasured('형상이 맞닿는지는 3D의 연결망에서 확인하세요.'))

  {
    const std = all.filter((e) => e.systemId && systemById.get(e.systemId)?.source === 'ifc').length
    const prop = all.filter((e) => e.systemId && systemById.get(e.systemId)?.source === 'property').length
    const kinds = model.systems.filter((s) => s.kind)
    const kindBim = kinds.filter((s) => s.kindSource === 'bim').length
    set('R17', {
      ...counted(std, prop, all.length),
      note: [
        prop > 0 ? `${prop}개는 IfcSystem 대신 Revit System Name 속성으로 묶었습니다.` : '계통에 묶인 설비·덕트·배관입니다.',
        `계통 ${model.systems.length}개 중 종류를 PredefinedType·약어로 안 것 ${kindBim}개, 이름으로 안 것 ${kinds.length - kindBim}개입니다.`,
      ].join(' '),
    })
  }

  {
    const ported = model.connections.filter((c) => c.source === 'port')
    const directed = ported.filter((c) => c.directed).length
    set('R18', ported.length === 0
      ? {
          state: model.connections.length > 0 ? 'missing' : 'none',
          counts: null,
          note: model.connections.length > 0 ? '포트가 없습니다. 연결은 형상으로 추정했고, 방향은 규칙으로 정합니다(확정하기 전에는 내보내지 않습니다).' : '연결이 없습니다.',
        }
      : {
          ...counted(directed, 0, ported.length),
          note: '포트에 SOURCE→SINK 방향이 있는 연결입니다. 나머지는 SOURCEANDSINK입니다.',
        })
  }

  {
    const role = new Map(all.map((e) => [e.id, e.role]))
    const both = model.systems.filter((s) => {
      const r = s.memberIds.map((id) => role.get(id))
      return r.some((x) => x === 'conversion' || x === 'moving') && r.includes('terminal')
    }).length
    set('R19', model.systems.length === 0
      ? { state: 'none', counts: null, note: '계통이 없습니다.' }
      : { state: both > 0 ? 'standard' : 'missing', counts: null, note: `계통 ${model.systems.length}개 중 원천 기기와 말단을 함께 묶은 것이 ${both}개입니다.` })
  }

  set('R20', unmeasured('공조존은 IFC에서 읽지 않고 IDF에서 받습니다.'))
  set('R21', unmeasured('센서와 측정 대상 설비의 관계는 읽지 않습니다. 관제점과 함께 BAS에서 연결합니다.'))

  {
    const want = devices.filter((e: Equipment) => CAPACITY_KINDS.has(equipmentKind(e.kind)?.kind ?? ''))
    const std = want.filter((e) => e.capacity !== null && isStandardCapacity(e.capacityProperty)).length
    const other = want.filter((e) => e.capacity !== null && !isStandardCapacity(e.capacityProperty))
    const names = [...new Set(other.map((e) => e.capacityProperty))].slice(0, 3).join(', ')
    set('R22', {
      ...counted(std, other.length, want.length),
      note: other.length > 0
        ? `${other.length}대는 저작 도구 속성명(${names})으로 들어 있습니다. 표준 Pset으로 매핑하면 표준 자리로 옮겨집니다.`
        : '공조·열원 기기와 말단 중 용량이 있는 것입니다.',
    })
  }

  if (skipped.has('walls')) set('R23', unmeasured('벽을 읽지 않고 열었습니다. 벽을 읽도록 켜고 다시 여세요.'))
  else {
    const known = walls.filter((w) => w.loadBearing !== null)
    const trues = known.filter((w) => w.loadBearing).length
    const uniform = known.length >= 20 && (trues === 0 || trues === known.length)
    set('R23', {
      ...counted(known.length, 0, walls.length),
      note: walls.length === 0
        ? '벽이 없습니다.'
        : uniform
          ? `벽 ${known.length}장이 전부 ${trues === 0 ? '비내력' : '내력'}입니다. 모델러가 정한 값이 아니라 Revit 기본값일 수 있습니다.`
          : `내력 ${trues} · 비내력 ${known.length - trues}. 값이 없는 벽은 "모름"으로 둡니다.`,
    })
  }

  return REQUIREMENTS.map((r) => ({ ...r, ...rows.get(r.id)! }))
}
