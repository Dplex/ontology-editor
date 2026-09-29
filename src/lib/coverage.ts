// BIM 하나로 DT 온톨로지의 피처(F1~F16, 정본 2장)를 얼마나 채우는지 잰다.
//
// 등급 칩(profile.ts)은 "어느 등급까지 열리나"를 다섯 칸으로 보인다. 이것은 한 걸음 더 들어가서, 피처마다 대상이
// 몇 개이고 그중 **누가 채웠는지**를 가른다: BIM 이 말한 것, BIM 의 좌표·형상으로 계산한 것, 이름 사전·흐름 규칙으로
// 정한 것, 사람이 편집한 것, 그리고 비어 남은 것. "필수 요구만 갖춘 BIM 으로 온톨로지를 어디까지 만드나" 에 답하는 표다
// (정본 3.9). 출처를 가르는 기준은 화면의 출처 표시(3.7)와 같다.
//
// BIM 밖에서 오는 피처(공조존 F12·관제점 F13·커스텀존 F14)는 대상을 세되 `outside` 로 표시한다. 0 이 "BIM 이 비었다" 가
// 아니라 "BIM 이 줄 자리가 아니다" 인 경우를 섞지 않기 위해서다.

import { isPlaceholder } from './merge'
import { withInferred } from './flow-rules'
import { isConduit, type Model } from './model'
import { deviceFlows } from './topology'

export type Coverage = {
  key: string
  feature: string
  /** 무엇을 셌나(대상). */
  unit: string
  of: number
  bim: number
  calc: number
  dict: number
  edit: number
  /** 대상 중 아무도 채우지 않은 것. of - (bim + calc + dict + edit). */
  missing: number
  /** BIM 이 줄 자리가 아닌 피처(공조존·관제점·커스텀존). 채움은 IDF·BAS·사람 몫이다. */
  outside?: string
  /** 빈 것을 누가 메우나, 또는 무엇을 셌는지의 단서. */
  note?: string
}

const row = (r: Omit<Coverage, 'missing'>): Coverage => ({ ...r, missing: Math.max(0, r.of - r.bim - r.calc - r.dict - r.edit) })

export function featureCoverage(model: Model): Coverage[] {
  const spaces = model.storeys.flatMap((s) => s.spaces)
  const walls = model.storeys.flatMap((s) => s.walls)
  const openings = model.storeys.flatMap((s) => s.openings)
  const doors = openings.filter((o) => o.kind === 'door')
  const all = model.storeys.flatMap((s) => s.equipment)
  const devices = all.filter((e) => !isConduit(e.role))
  const conduitIds = new Set(all.filter((e) => isConduit(e.role)).map((e) => e.id))
  const skipped = new Set(model.skipped ?? [])
  const count = <T>(xs: T[], f: (x: T) => boolean) => xs.reduce((n, x) => n + (f(x) ? 1 : 0), 0)

  // 흐름: 받는 쪽은 덕트를 건너뛴 기기 → 기기 흐름을 본다(profile.ts 와 같은 기준). 대상은 연결망에 든 기기다.
  const ids = devices.map((e) => e.id)
  const port = deviceFlows(model.connections.filter((c) => c.source === 'port' && c.directed), (id) => conduitIds.has(id), ids)
  const exported = deviceFlows(withInferred(model.connections, true), (id) => conduitIds.has(id), ids)
  const withRules = deviceFlows(withInferred(model.connections), (id) => conduitIds.has(id), ids)
  const network = exported.linked.size
  const byPort = port.fed.size
  // 사람이 정한 방향(연결 하나, 계통 확정)까지 넣은 것에서 포트만으로 된 것을 뺀다.
  const byEdit = Math.max(0, exported.fed.size - byPort)
  const byRule = Math.max(0, withRules.fed.size - exported.fed.size)

  const zoned = new Set((model.hvac?.zones ?? []).flatMap((z) => z.spaceIds))
  const systems = model.systems

  return [
    row({ key: 'F1', feature: '공간 계층', unit: '물리존', of: spaces.length, bim: spaces.length, calc: 0, dict: 0, edit: 0, note: '층 > 물리존(hasPart)' }),
    row({
      key: 'F2',
      feature: '물리존 기하',
      unit: '물리존',
      of: spaces.length,
      bim: count(spaces, (s) => s.footprint.length >= 3),
      calc: 0,
      dict: 0,
      edit: 0,
      note: '외곽선이 없는 방은 3D 에서 그린다',
    }),
    row({
      key: 'F3',
      feature: '공간 이름',
      unit: '물리존',
      of: spaces.length,
      bim: count(spaces, (s) => !!s.longName?.trim() && !isPlaceholder(s)),
      calc: 0,
      dict: 0,
      edit: 0,
      note: '기본 이름("공간")·빈 이름은 사람이 짓는다',
    }),
    row({
      key: 'F3+',
      feature: '방 종류',
      unit: '물리존',
      of: spaces.length,
      bim: count(spaces, (s) => !!s.kind && s.kindSource === 'bim'),
      calc: 0,
      dict: count(spaces, (s) => !!s.kind && s.kindSource !== 'bim'),
      edit: 0,
      note: 'OmniClass 코드(BIM) → 이름 사전',
    }),
    row({
      key: 'F4',
      feature: '벽 형상',
      unit: '벽',
      of: walls.length,
      bim: count(walls, (w) => (w.footprint?.length ?? 0) > 0),
      calc: 0,
      dict: 0,
      edit: 0,
      note: skipped.has('walls') ? '벽을 읽지 않았다' : undefined,
    }),
    row({ key: 'F5', feature: '개구부 소속', unit: '문·창', of: openings.length, bim: count(openings, (o) => !!o.wallId), calc: 0, dict: 0, edit: 0 }),
    row({ key: 'F6', feature: '공간 경계', unit: '물리존', of: spaces.length, bim: count(spaces, (s) => s.boundedBy.length > 0), calc: 0, dict: 0, edit: 0, note: '없으면 문 양쪽을 좌표로 짚는다(F15)' }),
    row({ key: 'F7', feature: '내력벽', unit: '벽', of: walls.length, bim: count(walls, (w) => w.loadBearing !== null), calc: 0, dict: 0, edit: 0, note: '값이 없으면 "모름"' }),
    row({
      key: 'F8',
      feature: '설비 종류',
      unit: '기기',
      of: devices.length,
      bim: count(devices, (e) => !!e.kind && e.kindSource === 'bim' && !e.kindEdited),
      calc: 0,
      dict: count(devices, (e) => !!e.kind && e.kindSource !== 'bim' && !e.kindEdited),
      edit: count(devices, (e) => !!e.kind && !!e.kindEdited),
      note: '모르는 것은 패밀리 단위로 사람이 고른다',
    }),
    row({
      key: 'F9',
      feature: '설비 위치',
      unit: '기기',
      of: devices.length,
      bim: count(devices, (e) => !!e.position && !e.positionSource),
      calc: count(devices, (e) => !!e.position && e.positionSource === 'geometry'),
      dict: 0,
      edit: count(devices, (e) => !!e.position && e.positionSource === 'edited'),
      note: '배치점이 형상에서 떨어지면 형상 중심(계산)',
    }),
    row({
      key: 'F10',
      feature: '계통 소속',
      unit: '기기',
      of: devices.length,
      bim: count(devices, (e) => !!e.systemId && !e.systemEdited),
      calc: 0,
      dict: 0,
      edit: count(devices, (e) => !!e.systemId && !!e.systemEdited),
    }),
    row({
      key: 'F10+',
      feature: '계통 종류',
      unit: '계통',
      of: systems.length,
      bim: count(systems, (s) => !!s.kind && s.kindSource === 'bim' && s.source !== 'edit'),
      calc: 0,
      dict: count(systems, (s) => !!s.kind && s.kindSource !== 'bim' && s.source !== 'edit'),
      edit: count(systems, (s) => !!s.kind && s.source === 'edit'),
      note: 'PredefinedType·약어(BIM) → 계통 이름(사전)',
    }),
    row({
      key: 'F11',
      feature: '설비 소속 물리존',
      unit: '기기',
      of: devices.length,
      bim: count(devices, (e) => !!e.spaceId && e.spaceSource === 'bim'),
      calc: count(devices, (e) => !!e.spaceId && e.spaceSource !== 'bim'),
      dict: 0,
      edit: 0,
      note: '방이 없는 설비는 층을 위치로 적는다',
    }),
    row({
      key: 'F12',
      feature: '공조존',
      unit: '물리존',
      of: spaces.length,
      bim: 0,
      calc: count(spaces, (s) => zoned.has(s.id)),
      dict: 0,
      edit: 0,
      outside: 'IDF',
    }),
    row({ key: 'F13', feature: '관제점', unit: '기기', of: devices.length, bim: 0, calc: 0, dict: 0, edit: 0, outside: 'BAS' }),
    row({ key: 'F14', feature: '커스텀존', unit: '—', of: 0, bim: 0, calc: 0, dict: 0, edit: 0, outside: '운영자' }),
    row({
      key: 'F15',
      feature: '로봇 통과(방-문-방)',
      unit: '문',
      of: doors.length,
      bim: count(doors, (d) => (d.connects?.length ?? 0) >= 2 && d.connectsSource === 'bim'),
      calc: count(doors, (d) => (d.connects?.length ?? 0) >= 2 && d.connectsSource !== 'bim'),
      dict: 0,
      edit: 0,
      note: '방 둘을 잇는 문. 문·창 자리를 읽어야 좌표로 짚는다',
    }),
    row({
      key: 'F16',
      feature: '흐름 방향',
      unit: '연결망의 기기',
      of: network,
      bim: byPort,
      calc: 0,
      dict: byRule,
      edit: byEdit,
      note: '사전 몫은 규칙 방향. 사람이 계통 단위로 확정해야 brick:feeds 로 나간다',
    }),
  ]
}
