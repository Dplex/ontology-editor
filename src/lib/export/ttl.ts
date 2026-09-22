// 의미를 Brick TTL 로 내보낸다. 기하는 여기 넣지 않는다.
//
// 기하와 의미를 한 파일로 합치지 않기로 한 결정이 이 파일의 전제다. Brick 에는 다각형을
// 담을 자리가 없어서 넣으려면 WKT 문자열로 박아야 하는데, 그러면 "이 물리존이 저 공조존과
// 겹치는가" 같은 질문에 답할 수 없다. 그 교집합 연산이 PRD #12(설비-물리존 재매핑)의 본체라,
// 문자열로 만들면 핵심 기능이 막힌다. 그래서 기하는 GeoJSON 에 두고 id 로 잇는다.
//
// 계층은 기존 온톨로지와 같은 술어만 쓴다: brick:hasPart, rdfs:label
// (ieum-pipeline/internal/ontology/ttl.go 가 읽는 술어가 hasPoint·feeds·hasLocation·hasPart 뿐이다).

import { isConduit, type Equipment, type Model } from '../model'
import { deviceFlows } from '../topology'

const PREFIXES = [
  '@prefix brick: <https://brickschema.org/schema/Brick#> .',
  // 덕트·배관 구간은 Brick 이 맡지 않는다. FSO 가 그 자리다 — 아래 classOf 주석 참조.
  // 네임스페이스는 FSO 공식 문서(alikucukavci.github.io/FSO)가 적은 것을 그대로 쓴다.
  '@prefix fso: <http://www.w3id.org/fso#> .',
  '@prefix ex: <http://example.org/building#> .',
  '@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .',
]

/**
 * IFC GlobalId 를 Turtle 의 지역 이름으로 안전하게 만든다.
 *
 * IFC GUID 는 base64 변형이라 `$` 와 `_` 가 섞여 나온다. Turtle 문법에서 `_` 는 그냥 쓰지만
 * **`$` 는 역슬래시로 이스케이프해야 한다.** 안 하면 파일 전체가 문법 오류가 나는 게 아니라
 * 그 줄만 다르게 읽혀서, 주어가 조용히 둘로 갈라진다.
 *
 * 공백처럼 **이스케이프로도 못 살리는 문자**는 `_` 로 바꾼다. id 자리에 이름이 흘러들어
 * 오면(예: 건물 이름 "MEP Building") 그런 문자가 들어오는데, 그대로 두면 파일이 통째로
 * 깨진다. 여기서 막되, 애초에 id 자리에는 GlobalId 를 쓴다.
 */
const ESCAPABLE = new Set("$.-~!&'()*+,;=/?#@%")

export function escapeLocalName(id: string): string {
  // 한 글자씩 본다. 두 번에 나눠 치환하면 먼저 붙인 역슬래시의 짝이 두 번째 치환에
  // 휩쓸려 사라진다.
  return Array.from(id, (c) => {
    if (/[\w\uAC00-\uD7A3]/.test(c)) return c
    if (ESCAPABLE.has(c)) return `\\${c}`
    return '_'
  }).join('')
}

/**
 * IFC 클래스를 Brick 클래스로 옮긴다.
 *
 * 목록에 없는 것은 `ex:` 로 뺀다. 기존 SR 온톨로지가 그렇게 돼 있다 — Brick 표준에 없는
 * 설비(DVM, Convector 등)를 작성자가 `ex:` 로 빼 뒀고, ieum-pipeline 의 파서는 두
 * 네임스페이스를 같게 취급한다. 없는 Brick 클래스를 지어내는 것보다 이쪽이 안전하다.
 */
const BRICK_CLASS: Record<string, string> = {
  UnitaryEquipment: 'brick:Air_Handling_Unit',
  AirTerminal: 'brick:Air_Diffuser',
  AirTerminalBox: 'brick:Variable_Air_Volume_Box',
  Fan: 'brick:Fan',
  Pump: 'brick:Pump',
  Chiller: 'brick:Chiller',
  Boiler: 'brick:Boiler',
  Sensor: 'brick:Sensor',
  LightFixture: 'brick:Lighting_Equipment',
}

/**
 * 설비 하나의 클래스. **기기는 Brick, 도관은 FSO 다.**
 *
 * Brick 은 기기(공조기, 칠러, 토출구)의 어휘이지 덕트 한 토막의 어휘가 아니다. 구간과
 * 이음쇠를 `ex:FlowSegment` 같은 이름으로 밀어 넣으면 읽는 쪽에서 기기와 구별할 수 없고,
 * 설비 대수를 세면 여섯 배로 부푼다(실측: Duplex MEP 926대 중 785대가 도관).
 * 최근 BIM→Brick 연구들이 Brick 과 FSO 를 짝으로 쓰는 이유가 이것이다.
 *
 * **IFC 클래스가 아니라 역할로 가른다.** IFC2x3 파일은 구체 클래스가 없어서 구간이
 * `IfcFlowSegment` 그 자체로 들어오고, IFC4 파일은 `IfcPipeSegment`·`IfcDuctSegment` 로
 * 갈린다. 이름으로 가르면 한쪽을 놓친다.
 */
export function classOf(equipment: Equipment): string {
  if (equipment.role === 'segment') return 'fso:Segment'
  if (equipment.role === 'fitting') return 'fso:Fitting'
  return BRICK_CLASS[equipment.ifcClass] ?? `ex:${equipment.ifcClass}`
}

function label(text: string): string {
  // 큰따옴표와 역슬래시만 막으면 된다. 줄바꿈은 이름에 들어올 일이 없지만 같이 처리한다.
  const escaped = text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')
  return `"${escaped}"`
}

/**
 * 중간 모델을 Brick TTL 문자열로.
 *
 * 계층은 사이트 > 건물 > 층 > 물리존이고, 각 단계를 brick:hasPart 로 잇는다.
 * 벽·문·창은 담지 않는다. Brick 은 설비와 공간의 의미 체계라 건축 부재를 표현할 클래스가
 * 없고, 그 정보는 기하 파일 쪽에 있다.
 */
export function modelToTTL(model: Model): string {
  const lines: string[] = [...PREFIXES, '']
  const ref = (id: string) => `ex:${escapeLocalName(id)}`

  // 흐름 방향을 아는 연결만 brick:feeds 로 적는다.
  //
  // **형상이 맞닿은 것으로 추정한 연결은 넣지 않는다.** feeds 는 방향이 있는 술어라,
  // 방향을 모르는 연결을 넣으려면 둘 중 하나를 찍어야 한다. 찍으면 온톨로지를 읽는 쪽은
  // 그게 BIM 이 말한 것인지 우리가 찍은 것인지 알 수 없다. 포트가 없는 BIM 에서 이 절이
  // 통째로 비는 것이 맞고, 그 사실이 고객사에 요구할 스펙(포트에 흐름 방향)의 근거다.
  //
  // **주어 자신의 블록 안에 적는다.** 한때 `ex:A brick:feeds ex:B .` 로 따로 떼어 적었는데,
  // Turtle 로는 맞지만 ieum-pipeline 의 ttl.go 는 `ex:X a 클래스` 로 시작하는 블록만 읽어서
  // **흐름 연결이 받는 쪽에서 전부 사라졌다**(ifc4Mep 1,995개 → 0). 문자열만 보던 테스트는
  // 이걸 못 잡았다. 지금은 check:sample 이 실제 ttl.go 로 읽어 본다.
  // **기기에는 덕트·배관을 건너뛴 하류 기기도 적는다.** 덕트·배관은 fso: 라서 ttl.go 가 블록째
  // 버리는데, 흐름은 대부분 덕트에서 출발한다. 기기 → 덕트까지만 적으면 받는 쪽은 공조기에서
  // 토출구에 닿지 못한다. Brick 은 원래 덕트를 모델링하지 않고 "공조기 feeds VAV" 처럼 기기끼리
  // 잇는 것이 관례라, 이렇게 적는 것이 Brick 에도 맞다. 건너뛸 때는 방향을 아는 변만 탄다
  // (deviceFlows 주석 참조) — 이어 붙인 결과도 BIM 포트가 말한 것이어야 한다.
  const all = model.storeys.flatMap((s) => s.equipment)
  const conduits = new Set(all.filter((e) => isConduit(e.role)).map((e) => e.id))
  const flows = deviceFlows(model.connections, (id) => conduits.has(id), all.filter((e) => !conduits.has(e.id)).map((e) => e.id))
  const feeds = new Map<string, string[]>()
  for (const c of model.connections) {
    if (!c.directed) continue
    feeds.set(c.from, [...(feeds.get(c.from) ?? []), c.to])
  }
  for (const [from, targets] of flows.directed) {
    feeds.set(from, [...new Set([...(feeds.get(from) ?? []), ...targets])])
  }

  lines.push(`${ref(model.buildingId)} a brick:Building ;`)
  lines.push(`    rdfs:label ${label(model.buildingName)} ;`)
  lines.push(`    brick:hasPart ${model.storeys.map((s) => ref(s.id)).join(', ')} .`)
  lines.push('')

  for (const storey of model.storeys) {
    lines.push(`${ref(storey.id)} a brick:Floor ;`)
    lines.push(`    rdfs:label ${label(storey.name)} ;`)
    if (storey.spaces.length > 0) {
      lines.push(`    brick:hasPart ${storey.spaces.map((s) => ref(s.id)).join(', ')} ;`)
    }
    lines.push(`    ex:elevation ${storey.elevation} .`)
    lines.push('')

    for (const space of storey.spaces) {
      // 사람이 부르는 이름이 LongName 에 있고, Name 은 방 번호인 일이 많다. 둘 다 남긴다.
      lines.push(`${ref(space.id)} a brick:Room ;`)
      lines.push(`    rdfs:label ${label(space.longName || space.name)} ;`)
      lines.push(`    ex:roomNumber ${label(space.name)} ;`)
      lines.push(`    ex:areaM2 ${Number(space.areaM2.toFixed(4))} .`)
      lines.push('')
    }

    for (const equipment of storey.equipment) {
      lines.push(`${ref(equipment.id)} a ${classOf(equipment)} ;`)
      lines.push(`    rdfs:label ${label(equipment.name)} ;`)
      // 소속 물리존. 좌표로 판정한 결과이고(PRD #12), 이상 알림의 '발생 위치' 가 이걸 쓴다.
      // 못 찾았으면 아예 안 적는다 — 빈 값을 적으면 "어디에도 없다" 와 "모른다" 가 섞인다.
      if (equipment.spaceId) lines.push(`    brick:hasLocation ${ref(equipment.spaceId)} ;`)
      const targets = feeds.get(equipment.id)
      if (targets) lines.push(`    brick:feeds ${targets.map(ref).join(', ')} ;`)
      if (equipment.capacity !== null) lines.push(`    ex:nominalAirFlowRate ${equipment.capacity} ;`)
      lines.push(`    ex:ifcClass ${label(equipment.ifcClass)} .`)
      lines.push('')
    }
  }

  // 계통은 층에 속하지 않아서 마지막에 따로 적는다. 여러 층에 걸치는 것이 정상이다.
  for (const system of model.systems) {
    lines.push(`${ref(system.id)} a ex:Distribution_System ;`)
    lines.push(`    rdfs:label ${label(system.name)} ;`)
    lines.push(`    brick:hasPart ${system.memberIds.map(ref).join(', ')} .`)
    lines.push('')
  }

  return lines.join('\n')
}
