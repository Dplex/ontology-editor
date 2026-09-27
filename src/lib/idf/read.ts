// IDF 에서 공조존(F12)과 담당 관계를 읽는다.
//
// IDF 의 Zone 은 열·공조 계산의 단위라 DT 의 공조존이다(PRD 1.6 이 IDF 를 출처로 둔다). 바닥면(Surface Type = Floor)이
// 존의 평면이고, 공조 쪽은 노드 이름으로 이어진 그래프다 — 존의 설비 목록(ZoneHVAC:EquipmentList) → 말단(VAV·실내기 …)
// → 공조기(AirLoopHVAC, 급기 분기 ZoneSplitter 를 거쳐) 또는 VRF 실외기(ZoneTerminalUnitList). 이 사슬이 "이 공조기가
// 담당하는 존" 이고, 계통도가 묻는 것이다.
//
// **설비 좌표는 IDF 에 없다.** IDF 는 시뮬레이션 모델이라 공조기가 어디 놓였는지 말하지 않는다. 그래서 IDF 에서 온
// 설비는 3D 에 놓지 않고, BIM 설비와 이름이 맞으면 그 설비에 담당 관계를 얹는다(attach.ts).

import { indexIdf, num, parseIdf, type IdfIndex, type IdfObject } from './parse'
import type { Vec2 } from '../model'

export type IdfZone = {
  name: string
  /** 바닥면 조각(세계 좌표, 닫힌 고리). DesignBuilder 는 한 존의 바닥을 직사각형 여럿으로 잘라 낸다. */
  floors: { ring: Vec2[]; z: number }[]
  /** Zone 객체가 적은 바닥 넓이(없으면 null). 바닥면에서 잰 넓이와 견준다. */
  declaredArea: number | null
  multiplier: number
}

export type IdfEquipment = {
  name: string
  /** IDF 클래스(`AirTerminal:SingleDuct:VAV:Reheat`, `AirLoopHVAC` …). */
  idfClass: string
  /** 설비 종류(kinds.ts). 클래스로 정한다. 모르면 null. */
  kind: string | null
  /** 이 설비가 공급하는 것. 존 이름이거나 다른 IDF 설비 이름이다. */
  feeds: { zone?: string; equipment?: string }[]
}

export type IdfModel = {
  version: string | null
  zones: IdfZone[]
  equipment: IdfEquipment[]
  warnings: string[]
}

/**
 * IDF 클래스 → 설비 종류. 이름 사전(kinds.ts)의 종류를 쓴다 — Brick 클래스가 거기서 나온다. 여기 없는 존 설비는 종류를
 * 모르는 채 담당 관계만 남는다(지어내지 않는다).
 */
const KIND_BY_CLASS: [RegExp, string][] = [
  [/^airloophvac$/, 'ahu'],
  [/^airterminal:singleduct:vav/, 'vav'],
  [/^airterminal:dualduct:vav/, 'vav'],
  [/^zonehvac:terminalunit:variablerefrigerantflow$/, 'indoor_unit'],
  [/^airconditioner:variablerefrigerantflow/, 'outdoor_unit'],
  [/^zonehvac:fourpipefancoil$/, 'fcu'],
  [/^zonehvac:energyrecoveryventilator$/, 'heat_recovery'],
  [/^zonehvac:baseboard:/, 'radiator'],
]

export function idfKind(cls: string): string | null {
  const key = cls.toLowerCase()
  return KIND_BY_CLASS.find(([re]) => re.test(key))?.[1] ?? null
}

/** 시뮬레이션용 가상 설비. 실제 기기가 아니라 존 부하를 이상적으로 맞추는 장치라 담당 관계에 넣지 않는다. */
const VIRTUAL = /^zonehvac:idealloadsairsystem$/i

export function readIdf(text: string): IdfModel {
  const objects = parseIdf(text)
  const idf = indexIdf(objects)
  const warnings: string[] = []
  const version = idf.all('Version')[0]?.fields[0] ?? null

  // --- 좌표 규칙 -------------------------------------------------------------------
  // Relative 면 표면 꼭짓점이 존 원점·존 북쪽 기준이다. World(Absolute) 면 그대로다. 건물 북쪽(Building 의 North Axis)은
  // 적용하지 않는다 — BIM 도 건물 좌표(프로젝트 원점)로 읽으므로 같은 틀에 두려면 건물 회전을 빼야 한다.
  const rules = idf.all('GlobalGeometryRules')[0]
  const relative = (rules?.fields[2] ?? 'Relative').toLowerCase() === 'relative'

  const zones = new Map<string, IdfZone & { origin: [number, number, number]; north: number }>()
  for (const z of idf.all('Zone')) {
    const name = z.fields[0]
    if (!name) continue
    zones.set(name.toLowerCase(), {
      name,
      floors: [],
      declaredArea: num(z.fields[9]),
      multiplier: num(z.fields[6]) ?? 1,
      north: num(z.fields[1]) ?? 0,
      origin: [num(z.fields[2]) ?? 0, num(z.fields[3]) ?? 0, num(z.fields[4]) ?? 0],
    })
  }

  // --- 바닥면 ------------------------------------------------------------------------
  // EnergyPlus 9.6 부터 Zone Name 뒤에 Space Name 칸이 생겨서 꼭짓점이 한 칸 밀린다. 판을 믿지 않고 남은 값이 꼭짓점
  // 개수 × 3 과 맞는 자리를 찾는다.
  let floorless = 0
  for (const cls of ['BuildingSurface:Detailed', 'Floor:Detailed']) {
    for (const s of idf.all(cls)) {
      const isDetailed = s.key === 'buildingsurface:detailed'
      if (isDetailed && (s.fields[1] ?? '').toLowerCase() !== 'floor') continue
      const zoneName = (isDetailed ? s.fields[3] : s.fields[2]) ?? ''
      const zone = zones.get(zoneName.toLowerCase())
      if (!zone) continue
      const vertices = vertexList(s.fields, isDetailed ? [10, 9] : [9, 8])
      if (!vertices) {
        floorless++
        continue
      }
      const world = vertices.map(([x, y, zz]) => toWorld([x, y, zz], zone, relative))
      const ring: Vec2[] = world.map(([x, y]) => [x, y])
      ring.push([ring[0][0], ring[0][1]])
      zone.floors.push({ ring, z: Math.min(...world.map((p) => p[2])) })
    }
  }
  if (floorless) warnings.push(`바닥면 ${floorless}개는 꼭짓점을 읽지 못했습니다.`)
  const noFloor = [...zones.values()].filter((z) => z.floors.length === 0)
  if (noFloor.length) warnings.push(`공조존 ${noFloor.length}개에 바닥면이 없습니다(${noFloor.slice(0, 3).map((z) => z.name).join(', ')}${noFloor.length > 3 ? ' 외' : ''}).`)

  // --- 담당 관계 --------------------------------------------------------------------
  const equipment = new Map<string, IdfEquipment>()
  const touch = (name: string, idfClass: string): IdfEquipment => {
    const key = name.toLowerCase()
    let e = equipment.get(key)
    if (!e) {
      e = { name, idfClass, kind: idfKind(idfClass), feeds: [] }
      equipment.set(key, e)
    }
    return e
  }
  const feed = (from: IdfEquipment, to: { zone?: string; equipment?: string }) => {
    if (!from.feeds.some((f) => f.zone === to.zone && f.equipment === to.equipment)) from.feeds.push(to)
  }

  // 존마다 설비 목록. 목록 안에서 (클래스, 이름) 짝을 찾는다 — 판마다 한 설비가 차지하는 칸 수가 달라서(4 또는 6)
  // 자리로 세지 않고, 앞 값이 이 파일에 있는 클래스이고 뒤 값이 그 클래스의 이름인 짝을 고른다.
  let virtual = 0
  for (const conn of idf.all('ZoneHVAC:EquipmentConnections')) {
    const zone = zones.get((conn.fields[0] ?? '').toLowerCase())
    const list = idf.named('ZoneHVAC:EquipmentList', conn.fields[1] ?? '')
    if (!zone || !list) continue
    for (const [cls, name] of classNamePairs(list.fields.slice(1), idf)) {
      if (VIRTUAL.test(cls)) {
        virtual++
        continue
      }
      // 공기 분배기(ADU)는 말단을 싼 껍데기다. 안의 말단(VAV 등)을 설비로 삼는다.
      if (cls.toLowerCase() === 'zonehvac:airdistributionunit') {
        const adu = idf.named(cls, name)
        const terminalCls = adu?.fields[2]
        const terminalName = adu?.fields[3]
        if (terminalCls && terminalName) feed(touch(terminalName, terminalCls), { zone: zone.name })
        continue
      }
      feed(touch(name, cls), { zone: zone.name })
    }
  }
  if (virtual) warnings.push(`이상 부하 장치(IdealLoadsAirSystem) ${virtual}개는 실제 설비가 아니라 담당 관계에 넣지 않았습니다.`)

  // 공조기 → 말단. 말단의 입구 노드가 급기 분기(ZoneSplitter)의 출구이고, 그 분기가 든 공급 경로의 입구가 공조기의
  // 수요측 입구다. 노드 이름은 NodeList 이름일 수도 있어서 펼쳐서 본다.
  const expand = (name: string): string[] => {
    const list = idf.named('NodeList', name)
    return list ? list.fields.slice(1).filter(Boolean).map((x) => x.toLowerCase()) : [name.toLowerCase()]
  }
  const splitterOfNode = new Map<string, string>()
  for (const s of idf.all('AirLoopHVAC:ZoneSplitter')) {
    for (const node of s.fields.slice(2)) if (node) splitterOfNode.set(node.toLowerCase(), s.fields[0].toLowerCase())
  }
  const inletOfSplitter = new Map<string, string>()
  for (const path of idf.all('AirLoopHVAC:SupplyPath')) {
    const inlet = (path.fields[1] ?? '').toLowerCase()
    for (let i = 2; i + 1 < path.fields.length; i += 2) {
      if (path.fields[i].toLowerCase() === 'airloophvac:zonesplitter') inletOfSplitter.set(path.fields[i + 1].toLowerCase(), inlet)
    }
  }
  const loopOfInlet = new Map<string, IdfObject>()
  for (const loop of idf.all('AirLoopHVAC')) {
    for (const node of expand(loop.fields[8] ?? '')) loopOfInlet.set(node, loop)
  }
  let terminalsOnLoops = 0
  for (const e of [...equipment.values()]) {
    if (!/^airterminal:/i.test(e.idfClass)) continue
    const obj = idf.named(e.idfClass, e.name)
    const splitter = obj?.fields.map((f) => splitterOfNode.get(f.toLowerCase())).find(Boolean)
    const loop = splitter ? loopOfInlet.get(inletOfSplitter.get(splitter) ?? '') : undefined
    if (!loop) continue
    feed(touch(loop.fields[0], 'AirLoopHVAC'), { equipment: e.name })
    terminalsOnLoops++
  }

  // VRF 실외기 → 실내기. 실외기 객체의 값 중 하나가 ZoneTerminalUnitList 이름이다.
  for (const outdoor of idf.all('AirConditioner:VariableRefrigerantFlow')) {
    const list = outdoor.fields.map((f) => idf.named('ZoneTerminalUnitList', f)).find(Boolean)
    if (!list) continue
    const unit = touch(outdoor.fields[0], outdoor.cls)
    for (const name of list.fields.slice(1)) if (name && equipment.has(name.toLowerCase())) feed(unit, { equipment: equipment.get(name.toLowerCase())!.name })
  }

  const airTerminals = [...equipment.values()].filter((e) => /^airterminal:/i.test(e.idfClass)).length
  if (airTerminals > terminalsOnLoops) {
    warnings.push(`공기 말단 ${airTerminals - terminalsOnLoops}개는 어느 공조기에 붙었는지 노드로 찾지 못했습니다.`)
  }

  return {
    version,
    zones: [...zones.values()].map(({ origin: _o, north: _n, ...z }) => z),
    equipment: [...equipment.values()],
    warnings,
  }
}

/** 꼭짓점 개수 칸의 자리 후보들 중 뒤에 남은 값이 개수 × 3 인 곳을 찾아 꼭짓점을 돌려준다. */
function vertexList(fields: string[], countAt: number[]): [number, number, number][] | null {
  for (const k of countAt) {
    const rest = fields.length - (k + 1)
    if (rest < 9 || rest % 3 !== 0) continue
    const declared = num(fields[k])
    const n = rest / 3
    if (declared !== null && declared !== n) continue
    const values = fields.slice(k + 1).map((v) => num(v))
    if (values.some((v) => v === null)) continue
    const out: [number, number, number][] = []
    for (let i = 0; i < n; i++) out.push([values[i * 3]!, values[i * 3 + 1]!, values[i * 3 + 2]!])
    return out
  }
  return null
}

/**
 * 존 좌표를 건물 좌표로. 존 북쪽은 건물 북쪽에서 시계 방향으로 잰 각이다. EnergyPlus 가 존 좌표를 건물 좌표로
 * 바꾸는 식과 같게 돌린 뒤 원점을 더한다. 가진 IDF 는 존 원점·북쪽이 전부 0 이었다.
 */
function toWorld(p: [number, number, number], zone: { origin: [number, number, number]; north: number }, relative: boolean): [number, number, number] {
  if (!relative) return p
  const a = (-zone.north * Math.PI) / 180
  const x = p[0] * Math.cos(a) - p[1] * Math.sin(a)
  const y = p[0] * Math.sin(a) + p[1] * Math.cos(a)
  return [x + zone.origin[0], y + zone.origin[1], p[2] + zone.origin[2]]
}

function classNamePairs(fields: string[], idf: IdfIndex): [string, string][] {
  const out: [string, string][] = []
  for (let i = 0; i + 1 < fields.length; i++) {
    const cls = fields[i]
    const name = fields[i + 1]
    if (!cls.includes(':') || !name || !idf.has(cls) || !idf.named(cls, name)) continue
    out.push([cls, name])
    i++
  }
  return out
}
