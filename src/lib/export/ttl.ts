// 의미를 Brick TTL 로 내보낸다. 기하는 여기 넣지 않는다.
//
// 기하와 의미를 한 파일로 합치지 않기로 한 결정이 이 파일의 전제다. Brick 에는 다각형을
// 담을 자리가 없어서 넣으려면 WKT 문자열로 박아야 하는데, 그러면 "이 물리존이 저 공조존과
// 겹치는가" 같은 질문에 답할 수 없다. 그 교집합 연산이 PRD #12(설비-물리존 재매핑)의 본체라,
// 문자열로 만들면 핵심 기능이 막힌다. 그래서 기하는 GeoJSON 에 두고 id 로 잇는다.
//
// 계층은 기존 온톨로지와 같은 술어만 쓴다: brick:hasPart, rdfs:label
// (ieum-pipeline/internal/ontology/ttl.go 가 읽는 술어가 hasPoint·feeds·hasLocation·hasPart 뿐이다).

import type { Equipment, Model } from '../model'

const PREFIXES = [
  '@prefix brick: <https://brickschema.org/schema/Brick#> .',
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

export function brickClassOf(equipment: Equipment): string {
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
      lines.push(`${ref(equipment.id)} a ${brickClassOf(equipment)} ;`)
      lines.push(`    rdfs:label ${label(equipment.name)} ;`)
      // 소속 물리존. 좌표로 판정한 결과이고(PRD #12), 이상 알림의 '발생 위치' 가 이걸 쓴다.
      // 못 찾았으면 아예 안 적는다 — 빈 값을 적으면 "어디에도 없다" 와 "모른다" 가 섞인다.
      if (equipment.spaceId) lines.push(`    brick:hasLocation ${ref(equipment.spaceId)} ;`)
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
