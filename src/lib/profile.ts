// IFC 하나가 온톨로지를 어디까지 채우는지 요약한다. 파일 목록과 검토 화면이 쓴다.
//
// 기준은 `docs/bim-to-dt-ontology.md` §3.5 의 등급표다(공간 → 설비 → 소속 → 연결망 → 방향).
// **등급을 숫자 하나로 접지 않는다.** 설비 전용 파일(ifc4Mep)은 방이 없어서 누적 등급으로는
// 0 인데, 연결 방향은 샘플 중 유일하게 100% 다. 한 숫자로 말하면 "쓸모없는 파일" 로 읽히지만
// 실제로는 건축 파일과 합칠 짝이다. 그래서 칸마다 따로 채움 정도를 보인다.

import { countOf, isConduit, type Model } from './model'
import { deviceFlows } from './topology'
import { withInferred } from './flow-rules'
import { matchStorey } from './merge'

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
  /**
   * 평면 범위 [x0, y0, x1, y1](미터). 방 외곽선과 기기 좌표를 다 담는다. 짝 파일을 권할 때 두 파일이 같은 자리에 있는지
   * 본다 — 다른 건물을 합쳐도 오류 없이 합쳐진다(merge.ts). 잴 것이 없으면 null.
   */
  extent?: [number, number, number, number] | null
  /** 층 이름과 높이. 합칠 때처럼(merge.ts 의 matchStorey) 층이 짝지어지는지를 짝 파일 권하기에서 본다. */
  levels?: { name: string; elevation: number }[]
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
  // 등급은 내보내는 것과 같은 기준으로 잰다. 포트 방향 + 사람이 확정한 규칙 방향이다.
  const flows = deviceFlows(withInferred(model.connections, true), (id) => conduitIds.has(id), devices.map((e) => e.id))
  // 확정 전 규칙 방향까지 넣으면 얼마나 채워지는지. 칩 설명에만 쓴다.
  const confirmedRules = model.connections.some((x) => x.inferred?.confirmed)
  const candidate = model.connections.some((x) => x.inferred && !x.inferred.confirmed)
    ? deviceFlows(withInferred(model.connections), (id) => conduitIds.has(id), devices.map((e) => e.id)).fed.size
    : null
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
          ? '기기가 없다(MEP 미포함)'
          : `기기 ${devices.length}대 중 좌표가 있는 것 ${placed}대 · 덕트·배관 ${c.conduits}개는 제외`,
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
      // 목표선(등급 4)은 두 수치를 출처와 같이 보인다(OE-BIM-16, D12 권고안). 앞은 BIM 포트(+ 사람이 확정한 규칙 방향),
      // 뒤는 확정 전 규칙 방향까지 — 규칙은 화면의 출처 "사전"(Src.vue 의 dict)이다. `0/27(BIM) → 23/27(사전)`.
      figure:
        candidate !== null && candidate > fed && linked > 0
          ? `${fed}/${linked}(${confirmedRules ? 'BIM+확정' : 'BIM'}) → ${candidate}/${linked}(사전)`
          : figure(fed, linked),
      note:
        (linked === 0
          ? '덕트·배관으로 다른 기기와 이어진 기기가 없다'
          : fed === 0
            ? `다른 기기와 이어진 기기 ${linked}대 중 흐름 방향으로 이어진 것이 없다. brick:feeds가 기기에 닿지 않는다 (연결 단위로는 ${c.directedConnections}/${c.connections})`
            : `다른 기기와 이어진 기기 ${linked}대 중 흐름 방향으로 이어진(공급하거나 공급받는) 것 ${fed}대 (연결 단위로는 ${c.directedConnections}/${c.connections})`) +
        (candidate !== null ? ` · 확정 전 규칙 방향까지 넣으면 ${candidate}대` : ''),
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
    extent: extentOf(model),
    levels: model.storeys.map((s) => ({ name: s.name, elevation: s.elevation })),
  }
}

function extentOf(model: Model): [number, number, number, number] | null {
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity]
  const add = (x: number, y: number) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return
    x0 = Math.min(x0, x)
    y0 = Math.min(y0, y)
    x1 = Math.max(x1, x)
    y1 = Math.max(y1, y)
  }
  for (const s of model.storeys) {
    for (const sp of s.spaces) for (const p of sp.footprint) add(p[0], p[1])
    for (const e of s.equipment) if (e.position && !isConduit(e.role)) add(e.position[0], e.position[1])
  }
  return x0 <= x1 ? [x0, y0, x1, y1] : null
}

/**
 * 두 범위가 겹친 넓이 / **큰 쪽** 넓이. 작은 쪽으로 나누면 작은 건물이 큰 건물 범위 안에 들기만 해도 1 에 가깝다 —
 * AC20 주택(11×9m)과 ifc4Mep(41×22m)이 0.94 였다. 큰 쪽으로 나누면 0.12, 같은 건물의 건축·설비는 Duplex 0.64, 병원 0.95 다.
 * 한 줄로 늘어선 범위(넓이 0)는 1m 두께로 본다.
 */
export function extentOverlap(a: readonly number[], b: readonly number[]): number {
  const area = (r: readonly number[]) => Math.max(r[2] - r[0], 1) * Math.max(r[3] - r[1], 1)
  const w = Math.min(a[2], b[2]) - Math.max(a[0], b[0])
  const h = Math.min(a[3], b[3]) - Math.max(a[1], b[1])
  if (w < 0 || h < 0) return 0
  return (Math.max(w, 1) * Math.max(h, 1)) / Math.max(area(a), area(b))
}

/** 짝으로 권할 만큼 두 파일이 같은 자리에 있는가(extentOverlap). 범위를 모르면 권하지 않는다. */
export const PARTNER_OVERLAP = 0.5

/**
 * 층 수가 적은 쪽의 층 중 합칠 때 짝이 지어지는 몫(이름, 아니면 하나뿐인 높이). 범위만 보면 C20 연구소와 ifc4Mep
 * (다른 건물)이 0.5 넘게 겹쳐 짝으로 권했는데, 합쳐 보니 ifc4Mep 층 다섯 중 넷이 새 층으로 들어갔다. 모르면 1 로 본다.
 */
export function levelFit(a: Profile['levels'], b: Profile['levels']): number {
  if (!a?.length || !b?.length) return 1
  const [few, many] = a.length <= b.length ? [a, b] : [b, a]
  return few.filter((s) => matchStorey(s, many)).length / few.length
}

/**
 * 짝 파일(건축 ↔ 설비). 방이 없는 설비 파일이면 같은 폴더에서 방이 있는 파일, 방이 있는 파일이면 같은 폴더에서 방이 없는
 * 설비 파일이다. 건축 파일에도 조명·소화기 같은 기기가 섞여 있어서 "설비가 없다" 로 가르지 않는다. **후보가 하나뿐일 때만** 돌려준다 — Duplex 폴더처럼 판본이 여럿이면 어느 것과 합칠지 우리가 모른다.
 */
export function partnerOf(path: string, files: readonly { path: string; profile: Profile | null }[]): string | null {
  const me = files.find((f) => f.path === path)?.profile
  if (!me) return null
  const dir = (p: string) => p.slice(0, Math.max(0, p.lastIndexOf('/')))
  const fits = (p: Profile) =>
    me.needsArchitecture ? p.spaces > 0 && !p.needsArchitecture : me.spaces > 0 ? p.needsArchitecture : false
  // 같은 자리에 있어야 한다. data/ 바로 아래처럼 서로 다른 샘플을 모아 둔 폴더에서 다른 건물을 권했다.
  const near = (p: Profile) =>
    !!me.extent && !!p.extent && extentOverlap(me.extent, p.extent) >= PARTNER_OVERLAP && levelFit(me.levels, p.levels) >= PARTNER_OVERLAP
  const found = files.filter((f) => f.path !== path && dir(f.path) === dir(path) && f.profile && fits(f.profile) && near(f.profile))
  return found.length === 1 ? found[0].path : null
}
