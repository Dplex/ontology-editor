// IFC 하나가 온톨로지를 어디까지 채우는지 요약한다. 파일 목록과 검토 화면이 쓴다.
//
// 기준은 `docs/bim-to-dt-ontology.md` §2 의 등급표다(공간 → 설비 → 소속 → 연결망 → 방향).
// **등급을 숫자 하나로 접지 않는다.** 설비 전용 파일(ifc4Mep)은 방이 없어서 누적 등급으로는
// 0 인데, 연결 방향은 샘플 중 유일하게 100% 다. 한 숫자로 말하면 "쓸모없는 파일" 로 읽히지만
// 실제로는 건축 파일과 합칠 짝이다. 그래서 칸마다 따로 채움 정도를 보인다.

import { countOf, isConduit, type Model } from './model'
import { deviceFlows } from './topology'

/** 한 등급이 얼마나 찼나. 분수로 들고 다니고, 화면이 채움·일부·없음으로 칠한다. */
export type Tier = {
  key: 'space' | 'equipment' | 'location' | 'network' | 'direction'
  /** 칩에 쓰는 짧은 이름. */
  label: string
  /** 채운 것 / 채워야 할 것. 분모가 0 이면 이 파일에는 해당하는 것이 없다. */
  have: number
  of: number
  level: 'full' | 'partial' | 'none'
  /** 칩에 보이는 숫자. 다 찼으면 개수만, 덜 찼으면 분수, 해당이 없으면 대시. */
  figure: string
  /** 칩에 마우스를 올리면 보이는 설명. 무엇을 셌는지와 비었을 때 왜 비었는지. */
  note: string
}

export type Profile = {
  schema: string
  storeys: number
  spaces: number
  devices: number
  conduits: number
  systems: number
  connections: number
  tiers: Tier[]
  /** 방이 없고 설비만 있다. 건축 파일과 합쳐야 소속이 나온다. */
  needsArchitecture: boolean
  /** 방은 있고 설비가 없다. 설비 파일을 덧붙일 자리다. */
  needsEquipment: boolean
}

function figure(have: number, of: number): string {
  if (of === 0) return '—'
  return have >= of ? String(of) : `${have}/${of}`
}

function level(have: number, of: number): Tier['level'] {
  if (of === 0 || have === 0) return 'none'
  return have >= of ? 'full' : 'partial'
}

/**
 * 모델을 등급별로 잰다.
 *
 * 설비 쪽 분모는 **기기만** 센다. 덕트·배관은 대수가 기기의 여섯 배라(Duplex MEP 785 대 141)
 * 분모에 넣으면 기기가 다 소속돼도 "20%" 로 보인다. 이상 알림이 비는 것은 기기다.
 */
export function profileOf(model: Model): Profile {
  const c = countOf(model)
  const all = model.storeys.flatMap((s) => s.equipment)
  const devices = all.filter((e) => !isConduit(e.role))
  const drawn = model.storeys.reduce((n, s) => n + s.spaces.filter((sp) => sp.footprint.length >= 3).length, 0)
  const placed = devices.filter((e) => e.position !== null).length
  const located = devices.filter((e) => e.spaceId !== null).length
  const ported = model.connections.filter((x) => x.source === 'port').length
  // 방향은 연결이 아니라 **기기 쌍**으로 센다. DT 가 받는 것은 덕트·배관을 건너뛴 기기 → 기기
  // 흐름이라(deviceFlows 주석 참조), 연결 단위로 세면 받는 것보다 좋아 보인다.
  const conduitIds = new Set(all.filter((e) => isConduit(e.role)).map((e) => e.id))
  const flows = deviceFlows(model.connections, (id) => conduitIds.has(id), devices.map((e) => e.id))
  // 받는 쪽에 가는 흐름 대부분이 방향을 모르는 형상 추정이면 fed 가 비어 있다. linked 에는 없는데
  // fed 에만 있는 기기는 없다(방향 있는 길은 방향 없는 길이기도 하다).
  const fed = flows.fed.size
  const linked = flows.linked.size

  const tiers: Tier[] = [
    {
      key: 'space',
      label: '공간',
      have: drawn,
      of: c.spaces,
      level: level(drawn, c.spaces),
      figure: figure(drawn, c.spaces),
      note:
        c.spaces === 0
          ? '물리존(IfcSpace)이 없다'
          : `물리존 ${c.spaces}개 중 바닥 외곽선을 얻은 것 ${drawn}개`,
    },
    {
      key: 'equipment',
      label: '설비',
      have: placed,
      of: devices.length,
      level: level(placed, devices.length),
      figure: figure(placed, devices.length),
      note:
        devices.length === 0
          ? '기기가 없다(MEP 가 안 들어 있다)'
          : `기기 ${devices.length}대 중 좌표가 있는 것 ${placed}대 · 덕트·배관 ${c.conduits}개는 따로`,
    },
    {
      key: 'location',
      label: '소속',
      have: located,
      of: devices.length,
      level: level(located, devices.length),
      figure: figure(located, devices.length),
      note:
        devices.length === 0
          ? '기기가 없다'
          : c.spaces === 0
            ? `기기 ${devices.length}대가 있는데 방이 없다. 건축 파일과 합쳐야 한다`
            : `기기 ${devices.length}대 중 소속 물리존을 찾은 것 ${located}대`,
    },
    {
      key: 'network',
      label: '연결망',
      // 계통과 연결 둘 다 있어야 "연결망" 이다. 하나만 있으면 반쯤 찬 것으로 본다.
      have: (c.systems > 0 ? 1 : 0) + (c.connections > 0 ? 1 : 0),
      of: all.length > 0 ? 2 : 0,
      level: level((c.systems > 0 ? 1 : 0) + (c.connections > 0 ? 1 : 0), all.length > 0 ? 2 : 0),
      // 칸 둘(계통·연결)을 센 분수는 뜻이 없다. 사람이 궁금한 것은 연결 개수다.
      figure: all.length === 0 ? '—' : String(c.connections),
      note:
        all.length === 0
          ? '설비가 없다'
          : `계통 ${c.systems}개 · 연결 ${c.connections}개(포트 ${ported} · 형상 추정 ${c.connections - ported})`,
    },
    {
      key: 'direction',
      label: '방향',
      have: fed,
      of: linked,
      level: level(fed, linked),
      figure: figure(fed, linked),
      note:
        linked === 0
          ? '덕트·배관으로 다른 기기와 이어진 기기가 없다'
          : fed === 0
            ? `다른 기기와 이어진 기기 ${linked}대 중 흐름 방향으로 이어진 것이 없다. brick:feeds 가 기기에 닿지 않는다 (연결 단위로는 ${c.directedConnections}/${c.connections})`
            : `다른 기기와 이어진 기기 ${linked}대 중 흐름 방향으로 이어진(공급하거나 공급받는) 것 ${fed}대 (연결 단위로는 ${c.directedConnections}/${c.connections})`,
    },
  ]

  return {
    schema: model.schema,
    storeys: c.storeys,
    spaces: c.spaces,
    devices: devices.length,
    conduits: c.conduits,
    systems: c.systems,
    connections: c.connections,
    tiers,
    needsArchitecture: c.spaces === 0 && devices.length > 0,
    needsEquipment: drawn > 0 && all.length === 0,
  }
}
