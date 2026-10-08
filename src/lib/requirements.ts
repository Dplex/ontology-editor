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
import { CAPACITY_KINDS, isStandardCapacity } from './capacity'
import { equipmentKind, equipmentKindOfIfc, IFC_REJECTED } from './kinds'
import { isPlaceholder, type MergeReport } from './merge'
import { isConduit, type Equipment, type Model } from './model'
import { ratioLabel, type ScaleMismatch } from './unit-check'

export type RequirementLevel = '필수' | '권장'

/**
 * - `standard` 표준 자리에 있다. IDS 도 통과한다.
 * - `elsewhere` 다른 자리에 있다. 우리는 읽는다. **내보내기 설정을 바꾸면** 표준 자리로 간다(EXPORT_SETTING). 모델을 고쳐야
 *   하는 것(배치점이 형상에서 떨어짐)은 다른 자리가 아니라 일부다 — 고객사에 할 말이 다르다.
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
  /**
   * 고객사에 할 요청(정본 4장 "상태" 표의 셋째 칸). 표준·해당 없음이면 빈 문자열. 다른 자리면 늘 ASK_SETTING 으로 시작하고
   * 무엇을 바꿀지(EXPORT_SETTING)를 붙인다(OE-BIM-17).
   */
  ask: string
}

/** 다른 자리일 때 고객사에 하는 요청의 첫머리. 정본 4장 "상태" 표와 같은 말이다. */
export const ASK_SETTING = '내보내기 설정을 바꿔 달라'

/**
 * 다른 자리를 표준 자리로 옮기는 내보내기 설정. **다른 자리를 셀 수 있는 R 은 여기 다 있어야 한다** — "다른 자리" 라고 하면서
 * 무엇을 바꿔 달라는지 말하지 못하면 고객사에 할 말이 없다. requirements.test.ts 가 다른 자리가 나온 줄마다 이 표를 본다.
 * IfcExportAs·IfcExportType 은 Revit 의 IFC 내보내기 매개변수 이름이다.
 */
export const EXPORT_SETTING: Readonly<Record<string, string>> = {
  R10: 'IFC 버전을 IFC4로',
  // 정본 4.1 의 R13 은 "GUID 유지 설정" 이다. 같은 Revit 으로 다시 낸 Duplex MEP 에서 설비 63% 의 GUID 가 바뀌었다 — 모델이 아니라
  // 내보내기가 GUID 를 새로 지은 것이다. Revit IFC 내보내기의 "내보낸 뒤 IFC GUID 를 요소 매개변수에 저장" 을 켜면 다음 판본이 같은 GUID 로 나간다.
  R13: 'IFC GUID를 요소 매개변수에 저장해 다음 내보내기에도 같은 GUID로',
  R14: '방 분류를 분류 관계(IfcClassificationReference)로 — 지금은 Category Code 속성에만 있다',
  R16: '계통을 IfcSystem으로 — 지금은 System Name 속성에만 있다',
  R21: '용량 속성을 표준 Pset 이름으로 매핑(속성 매핑 파일)',
  R23: '설비를 Proxy 대신 알맞은 IFC 클래스로(IfcExportAs)',
  R24: '설비 종류를 PredefinedType으로(IfcExportType)',
}

/** 없음·일부에서 "값을 넣어 달라" 보다 구체적으로 할 말이 있는 것. */
const FIX: Readonly<Record<string, string>> = {
  R6: '길이 단위 선언을 좌표·높이에 실제로 쓴 단위에 맞춰 달라',
  R7: 'IfcMapConversion을 넣어 달라(또는 기준점을 협의)',
  R11: '좌표 없는 설비에 배치를, 배치점이 형상에서 떨어진 설비는 삽입점을 형상 위로 고쳐 달라',
}

function askOf(id: string, level: RequirementLevel, state: RequirementState, counts: RequirementRow['counts']): string {
  if (state === 'standard' || state === 'none' || state === 'unmeasured') return ''
  const fill = FIX[id] ?? (level === '필수' ? '값을 넣어 달라' : '값을 넣어 달라, 또는 우리가 보완한 값을 확인해 달라')
  if (state === 'elsewhere' || (counts?.elsewhere ?? 0) > 0) {
    const setting = `${ASK_SETTING} — ${EXPORT_SETTING[id] ?? '(정할 설정이 없다)'}`
    return state === 'elsewhere' ? setting : `${setting}. 나머지는 ${fill}`
  }
  return fill
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
  { id: 'R9', level: '필수', title: 'MEP 포함' },
  { id: 'R11', level: '필수', title: '설비 위치' },
  { id: 'R12', level: '필수', title: '건축·설비 좌표계 일치' },
  { id: 'R13', level: '필수', title: 'GUID 유지' },
  { id: 'R5', level: '권장', title: '공간 경계' },
  { id: 'R14', level: '권장', title: '방 분류(OmniClass)' },
  { id: 'R10', level: '권장', title: 'IFC4 형식' },
  { id: 'R24', level: '권장', title: '설비 종류' },
  { id: 'R23', level: '권장', title: 'Proxy를 쓰지 않음' },
  { id: 'R15', level: '권장', title: '설비 형상이 서로 맞닿음' },
  { id: 'R8', level: '권장', title: '형상 정확도 LOD 300' },
  { id: 'R16', level: '권장', title: '계통과 계통 종류' },
  { id: 'R17', level: '권장', title: '포트의 흐름 방향' },
  { id: 'R18', level: '권장', title: '공조기와 말단을 같은 계통으로' },
  { id: 'R19', level: '권장', title: '공조존' },
  { id: 'R20', level: '권장', title: '센서의 측정 대상 설비' },
  { id: 'R21', level: '권장', title: '용량' },
  { id: 'R22', level: '권장', title: '벽의 내력 여부' },
]

/**
 * `클래스.값` 의 값이 IFC 표준 열거값인가(IFC2x3·IFC4·IFC4X3 중 하나에라도 있으면). USERDEFINED 로 적은 유형 이름
 * (`Fan.200 mm`)은 아니다. requirements.ids 의 R24 가 허용하는 것과 같은 기준이다.
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
  versions: { name: string; kept: number; rematched: number; storeyScale?: ScaleMismatch | null } | null = null,
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

  const rows = new Map<string, Omit<RequirementRow, 'id' | 'level' | 'title' | 'ask'>>()
  const set = (id: string, row: Omit<RequirementRow, 'id' | 'level' | 'title' | 'ask'>) => rows.set(id, row)
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
    // 이름이 Revit 기본 이름("공간" 등)이면 없는 것으로 센다. 성수 건축은 508개 중 42개가 번호만 다르고 이름이 "공간" 이라
    // 탐색기에 같은 이름이 줄지어 나왔다. IDS 는 같은 이름들을 금지 명세("R3 방 이름에 기본값을 두지 않음")로 본다.
    const named = spaces.filter((s) => s.name.trim() && s.longName.trim())
    const both = named.filter((s) => !isPlaceholder(s)).length
    const placeholders = named.length - both
    set('R3', {
      ...counted(both, 0, spaces.length),
      note: !spaces.length
        ? '공간이 없습니다.'
        : `방 번호(Name)와 이름(LongName)이 모두 있는 공간입니다.${placeholders ? ` 이름이 기본값("공간" 등)인 ${placeholders}개는 이름이 없는 것으로 셉니다.` : ''}`,
    })
  }

  // 임포트 때 읽지 않기로 한 피처는 "없음" 이 아니라 잴 수 없음이다(Model.skipped).
  const skipped = new Set(model.skipped ?? [])
  if (skipped.has('walls') || (skipped.has('doors') && skipped.has('windows'))) {
    set('R4', unmeasured(skipped.has('walls') ? '벽을 읽지 않고 열었습니다. 벽·문·창을 읽도록 켜고 다시 여세요.' : '문·창을 읽지 않고 열었습니다.'))
  } else {
    const hung = openings.filter((o) => o.wallId !== null).length
    set('R4', { ...counted(hung, 0, openings.length), note: openings.length ? '어느 벽에 있는지 아는 문·창입니다.' : '문·창이 없습니다. 설비 파일이면 건축 파일을 덧붙이세요.' })
  }

  // 선언이 있어도 실제 값과 다를 수 있다. 덧붙인 파일·이전 판본과 같은 이름 층의 높이가 단위 배수로 다르면 일부다(OE-BIM-11, unit-check.ts).
  // 합친 모델은 어느 쪽이 틀렸든 일부다 — 틀린 파일이 들어 있다. 판본 비교는 이 파일이 맞고 이전 판본이 틀렸으면(층간 높이로 판단) 표준이다.
  const scale = merge?.unitScale ?? versions?.storeyScale ?? null
  const scaleNote = (other: string, otherWrong: string, thisWrong: string) =>
    `${other}과 같은 이름 층의 높이가 ${ratioLabel(scale!.ratio)}로 다릅니다(${scale!.what}). ` +
    (scale!.suspect === 'first' ? `층간 높이로 보면 ${otherWrong}의 선언이 실제 값과 다릅니다.` : scale!.suspect === 'second' ? `층간 높이로 보면 ${thisWrong}의 선언이 실제 값과 다릅니다.` : '한쪽 선언이 실제 값과 다릅니다.')
  if (!facts) set('R6', unmeasured('파일에서 읽은 모델이 아닙니다.'))
  else if (!facts.lengthUnit) set('R6', { state: 'missing', counts: null, note: '선언이 없어 미터로 가정했습니다. 치수가 모두 틀릴 수 있습니다.' + (scale ? ` ${scaleNote(merge?.unitScale ? '덧붙인 파일' : `이전 판본(${versions!.name})`, merge?.unitScale ? '기준 파일' : '이전 판본', merge?.unitScale ? '덧붙인 파일' : '이 파일')}` : '') })
  else if (scale && merge?.unitScale) set('R6', { state: 'partial', counts: null, note: `길이 단위는 선언되어 있지만, ${scaleNote('덧붙인 파일', '기준 파일', '덧붙인 파일')}` })
  else if (scale?.suspect === 'first') set('R6', {
    state: 'standard',
    counts: null,
    note: `길이 단위가 선언되어 있습니다. 이전 판본(${versions!.name})은 같은 이름 층의 높이가 이 파일의 ${ratioLabel(1 / scale.ratio)}로, 층간 높이로 보면 그 판본의 선언이 실제 값과 다릅니다(${scale.what}).`,
  })
  else if (scale) set('R6', { state: 'partial', counts: null, note: `길이 단위는 선언되어 있지만, ${scaleNote(`이전 판본(${versions!.name})`, '이전 판본', '이 파일')}` })
  else set('R6', { state: 'standard', counts: null, note: '길이 단위가 선언되어 있습니다.' })

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
    const inPanel = placed.filter((e) => e.positionSource === 'panel').length
    // 형상 중심으로 옮긴 설비는 "다른 자리" 가 아니다 — 설정을 바꿔서는 고쳐지지 않고 모델의 삽입점을 고쳐야 한다(OE-BIM-17).
    // 분전반 자리에 놓은 부품도 BIM 좌표가 아니라 짐작이라 표준에서 뺀다(OE-BIM-07).
    const notes = [
      moved > 0 ? `배치점이 형상과 떨어져 있어 형상 중심을 쓴 설비가 ${moved}대입니다(계산, 표준에서 뺌).` : '',
      inPanel > 0 ? `좌표가 없는 분전반 부품 ${inPanel}대는 같은 층에 하나뿐인 분전반 자리에 놓았습니다(계산, 표준에서 뺌).` : '',
    ].filter(Boolean)
    set('R11', {
      ...counted(placed.length - moved - inPanel, 0, devices.length),
      note: notes.length
        ? `${notes.join(' ')} 위치가 없는 설비는 미배치 목록으로 갑니다.`
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
    // 다른 열쇠로 찾은 것은 다른 자리다 — 내보내기가 GUID 를 새로 지은 것이라 설정으로 고쳐진다(EXPORT_SETTING.R13).
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
    set('R24', {
      ...counted(said.length, byName.length, devices.length),
      note: [
        byName.length > 0 ? `${byName.length}대는 IFC에 종류가 없어 패밀리 이름으로 정했습니다.` : 'IFC 클래스·PredefinedType에 종류가 있는 설비입니다.',
        unknown > 0 ? `${unknown}대는 IFC에도 이름에도 종류가 없습니다(USERDEFINED에 유형 이름만 있는 경우 등).` : '',
      ].join(' ').trim(),
    })
  }

  {
    const proxies = devices.filter((e) => e.ifcClass === 'BuildingElementProxy').length
    // 파일의 Proxy 중 설비로 읽지 않은 것(OE-BIM-13). 설비로 읽은 것만 세면 빠뜨린 것이 보이지 않는다.
    const p = facts?.proxies
    const louvers = p?.louvers ?? 0
    const left = p ? p.total - p.ported - p.named - louvers : 0
    set('R23', {
      ...counted(devices.length - proxies, proxies, devices.length),
      note:
        (proxies > 0
          ? `${proxies}대가 IfcBuildingElementProxy입니다. 포트가 있거나 이름이 사전에 있어 설비로 읽었습니다.`
          : 'Proxy로 들어온 설비가 없습니다.') +
        (left > 0 ? ` 파일의 Proxy ${p!.total}개 중 ${left}개는 포트도 이름도 없어 건축 부재로 보고 읽지 않았습니다(예: ${p!.skipped.join(', ')}).` : '') +
        // 이름은 루버지만 포트가 없는 것(OE-EXT-05). 차양·외장 마감이라 설비가 아니다.
        (louvers > 0 ? ` 이름이 루버이지만 포트가 없는 ${louvers}개는 건축 루버(차양·외장 마감)로 보고 설비로 받지 않았습니다.` : ''),
    })
  }

  set('R15', unmeasured('형상이 맞닿는지는 3D의 연결망에서 확인하세요.'))

  {
    const std = all.filter((e) => e.systemId && systemById.get(e.systemId)?.source === 'ifc').length
    const prop = all.filter((e) => e.systemId && systemById.get(e.systemId)?.source === 'property').length
    const kinds = model.systems.filter((s) => s.kind)
    const kindBim = kinds.filter((s) => s.kindSource === 'bim').length
    set('R16', {
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
    set('R17', ported.length === 0
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
    set('R18', model.systems.length === 0
      ? { state: 'none', counts: null, note: '계통이 없습니다.' }
      : { state: both > 0 ? 'standard' : 'missing', counts: null, note: `계통 ${model.systems.length}개 중 원천 기기와 말단을 함께 묶은 것이 ${both}개입니다.` })
  }

  set('R19', unmeasured('공조존은 IFC에서 읽지 않고 IDF에서 받습니다.'))
  set('R20', unmeasured('센서와 측정 대상 설비의 관계는 읽지 않습니다. 관제점과 함께 BAS에서 연결합니다.'))

  {
    const want = devices.filter((e: Equipment) => CAPACITY_KINDS.has(equipmentKind(e.kind)?.kind ?? ''))
    const std = want.filter((e) => e.capacity !== null && isStandardCapacity(e.capacityProperty)).length
    const other = want.filter((e) => e.capacity !== null && !isStandardCapacity(e.capacityProperty))
    const names = [...new Set(other.map((e) => e.capacityProperty))].slice(0, 3).join(', ')
    set('R21', {
      ...counted(std, other.length, want.length),
      note: other.length > 0
        ? `${other.length}대는 저작 도구 속성명(${names})으로 들어 있습니다. 표준 Pset으로 매핑하면 표준 자리로 옮겨집니다.`
        : '공조·열원 기기와 말단 중 용량이 있는 것입니다.',
    })
  }

  if (skipped.has('walls')) set('R22', unmeasured('벽을 읽지 않고 열었습니다. 벽을 읽도록 켜고 다시 여세요.'))
  else {
    const known = walls.filter((w) => w.loadBearing !== null)
    const trues = known.filter((w) => w.loadBearing).length
    const uniform = known.length >= 20 && (trues === 0 || trues === known.length)
    set('R22', {
      ...counted(known.length, 0, walls.length),
      note: walls.length === 0
        ? '벽이 없습니다.'
        : uniform
          ? `벽 ${known.length}장이 전부 ${trues === 0 ? '비내력' : '내력'}입니다. 모델러가 정한 값이 아니라 Revit 기본값일 수 있습니다.`
          : `내력 ${trues} · 비내력 ${known.length - trues}. 값이 없는 벽은 "모름"으로 둡니다.`,
    })
  }

  return REQUIREMENTS.map((r) => {
    const row = rows.get(r.id)!
    return { ...r, ...row, ask: askOf(r.id, r.level, row.state, row.counts) }
  })
}
