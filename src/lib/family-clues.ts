// 종류를 모르는 패밀리마다 사람이 고를 단서(편집 화면 "종류를 모르는 패밀리" 칸). 이름이 암호 같아도(`M_Exhaust Unit…:47-84 LPS`,
// 성수의 `P12`·`CH1`) 어느 계통에 있고, 무엇에 붙어 있고, 어디(천장·바닥·방)에 놓였는지를 보면 대부분 짐작한다 — 급기 계통
// 끝에서 덕트 하나에 붙어 천장에 있으면 디퓨저다. 모두 BIM 이 말한 계통·연결·좌표를 모은 것이다.
//
// 같은 단서를 글로 바꾼 것(`clueText`)이 Laya 종류 후보(laya.ts, ADR-0057)의 입력이고, 학습 재료(scripts/laya)도 이 함수로 뽑는다.
// 화면·학습·질문이 한 함수를 써야 학습한 글과 묻는 글이 어긋나지 않는다.
import { familyKeyOf, familyNameOf } from './edit'
import { equipmentKind, ifcClassLabel, systemKind } from './kinds'
import { isConduit, type Equipment, type Model } from './model'

export type FamilyClue = {
  key: string
  /** 화면에 보이는 패밀리 이름. 패밀리 이름이 없으면 설비 이름, 그것도 없으면 IFC 클래스. */
  label: string
  ifcClass: string
  count: number
  system: string
  neighbors: string
  place: string
}

/** 설비 하나가 무엇인지. 종류가 있으면 종류, 없으면 IFC 클래스의 우리말(덕트·배관 포함). */
export function whatOf(e: Equipment | undefined | null): string | null {
  if (!e) return null
  return equipmentKind(e.kind)?.label ?? ifcClassLabel(e.declaredType) ?? ifcClassLabel(e.ifcClass) ?? null
}

/**
 * 패밀리 열쇠 → 단서. `keys` 를 주면 그 패밀리만 잰다(화면은 보이는 줄만). `unknownOnly` 면 종류를 모르는 설비만 센다 —
 * 화면이 그렇게 센다. 학습 재료는 종류를 아는 패밀리도 같은 모양으로 뽑아야 해서 끈다.
 */
export function familyClues(model: Model, opts: { keys?: ReadonlySet<string>; unknownOnly?: boolean } = {}): Map<string, FamilyClue> {
  const { keys, unknownOnly = true } = opts
  const byId = new Map(model.storeys.flatMap((s) => s.equipment).map((e) => [e.id, e]))
  const systems = new Map(model.systems.map((s) => [s.id, s]))
  const spaces = new Map(model.storeys.flatMap((s) => s.spaces).map((sp) => [sp.id, sp]))
  const adjacent = new Map<string, string[]>()
  for (const c of model.connections) {
    adjacent.set(c.from, [...(adjacent.get(c.from) ?? []), c.to])
    adjacent.set(c.to, [...(adjacent.get(c.to) ?? []), c.from])
  }
  const tally = () => new Map<string, number>()
  const add = (map: Map<string, number>, k: string) => map.set(k, (map.get(k) ?? 0) + 1)
  const top = (map: Map<string, number>, n: number) =>
    [...map].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, c]) => `${k} ${c}`).join(' · ')
  type Acc = { label: string; ifcClass: string; count: number; systems: Map<string, number>; neighbors: Map<string, number>; rooms: Map<string, number>; heights: number[] }
  const acc = new Map<string, Acc>()
  for (const storey of model.storeys) {
    for (const e of storey.equipment) {
      if (isConduit(e.role) || (unknownOnly && equipmentKind(e.kind))) continue
      const key = familyKeyOf(e)
      if (keys && !keys.has(key)) continue
      const a = acc.get(key) ?? { label: familyNameOf(e) ?? (e.name || e.ifcClass), ifcClass: e.ifcClass, count: 0, systems: tally(), neighbors: tally(), rooms: tally(), heights: [] }
      a.count++
      const sy = e.systemId ? systems.get(e.systemId) : null
      if (sy) add(a.systems, systemKind(sy.kind)?.label ?? sy.name ?? '이름 없는 계통')
      for (const other of adjacent.get(e.id) ?? []) add(a.neighbors, whatOf(byId.get(other)) ?? '종류 모름')
      const sp = e.spaceId ? spaces.get(e.spaceId) : null
      if (sp) add(a.rooms, sp.longName || sp.name)
      if (e.position) a.heights.push(e.position[2] - storey.elevation)
      acc.set(key, a)
    }
  }
  const out = new Map<string, FamilyClue>()
  for (const [key, a] of acc) {
    const h = [...a.heights].sort((x, y) => x - y)
    const median = h.length ? h[Math.floor(h.length / 2)] : null
    out.set(key, {
      key,
      label: a.label,
      ifcClass: a.ifcClass,
      count: a.count,
      system: a.systems.size ? top(a.systems, 2) : '계통 없음',
      neighbors: a.neighbors.size ? top(a.neighbors, 3) : '연결 없음',
      place: [median !== null ? `바닥에서 ${median.toFixed(1)}m` : '', top(a.rooms, 2)].filter(Boolean).join(' · ') || '위치 모름',
    })
  }
  return out
}

/** 이름을 가린 단서 글에 들어가는 자리. 학습에서 이름이 아무것도 말하지 않는 패밀리를 흉내 낼 때 쓴다. */
export const HIDDEN_NAME = '(이름 없음)'

/** 단서를 Laya 가 읽는 글로. 줄 순서와 낱말을 바꾸면 학습한 체크포인트와 어긋난다 — 바꾸면 다시 학습한다. */
export function clueText(c: FamilyClue, hideName = false): string {
  return [
    `패밀리 이름: ${hideName ? HIDDEN_NAME : c.label}`,
    `IFC 클래스: ${c.ifcClass}`,
    `계통: ${c.system}`,
    `이웃: ${c.neighbors}`,
    `위치: ${c.place}`,
  ].join('\n')
}
