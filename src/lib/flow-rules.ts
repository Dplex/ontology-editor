// 포트가 방향을 말하지 않은 연결에 **규칙으로** 흐름 방향을 준다.
//
// 규칙은 두 가지 사실을 합친다.
//   1. 계통 종류가 매체와 방향을 말한다. 급기는 원천(공조기·FCU)에서 말단으로 나가고, 환기·배기는
//      말단에서 원천으로 들어온다. 순환수 공급은 열원에서 나가고 환수는 열원으로 들어온다.
//   2. 설비 종류가 원천을 말한다. 공기 계통에서는 공조기·FCU·전열교환기·팬이, 물 계통에서는
//      히트펌프·보일러·냉동기(없으면 펌프)가 원천이다(kinds.ts 의 flow).
// 원천에서 덕트·배관을 따라 거리를 재고, 가까운 쪽에서 먼 쪽으로(들어오는 계통이면 반대로) 방향을 준다.
// 선행 연구가 말한 "역할로부터 경로 탐색으로 방향을 유도한다"(docs/research.md ②)와 같은 방법이다.
//
// **결과는 `Connection.inferred` 에만 둔다.** `directed`·`from`·`to` 는 BIM 포트가 말한 방향이고,
// 여기서 정한 방향은 추정이다. 섞으면 온톨로지를 읽는 쪽이 둘을 구별할 수 없다. 사람이 에디터에서
// 계통 단위로 확인하면(`confirmSystemFlow`) 그때 `brick:feeds` 로 나간다.
//
// **포트가 방향을 말한 연결은 채점에 쓴다.** 같은 규칙으로 그 연결의 방향을 정해 보고 BIM 과 대
// 보면, 규칙이 이 파일에서 얼마나 맞는지가 숫자로 나온다(`agree`/`disagree`).

import { equipmentKind, systemKind, systemKindOf, type Medium, type SystemKindInfo } from './kinds'

type Sense = SystemKindInfo['sense']
import { isConduit, type Connection, type Model } from './model'

export type RuleReport = {
  /** 종류를 알아 규칙을 돌린 계통 수. */
  systems: number
  /** 원천을 못 찾아 방향을 정하지 못한 계통 수. */
  noSource: number
  /** 규칙으로 방향을 새로 준 연결 수. */
  oriented: number
  /** 계통 종류와 덕트·배관 유형 이름이 방향을 다르게 말해서 정하지 않은 연결 수. */
  conflicts: number
  /** 포트가 말한 방향과 규칙이 같은 연결 / 다른 연결. 규칙의 채점표다. */
  agree: number
  disagree: number
  /**
   * 계통별로 같은 것을 센 표. 화면이 "확정" 전에 이 계통에서 규칙이 포트와 얼마나 맞았는지를 보여 준다.
   * 원천을 못 찾은 계통은 들어 있지 않다.
   */
  bySystem: Record<string, { oriented: number; agree: number; disagree: number }>
}

/**
 * 모델의 연결에 규칙 방향을 채운다. 모델을 그 자리에서 고친다.
 *
 * 확정된(`confirmed`) 방향은 건드리지 않는다. 사람이 확인한 것을 파일을 합치거나 다시 돌린다고
 * 바꾸면 확인한 의미가 없다. 확정 안 된 것은 지우고 새로 정한다.
 */
export function inferFlowByRules(model: Model): RuleReport {
  const report: RuleReport = { systems: 0, noSource: 0, oriented: 0, conflicts: 0, agree: 0, disagree: 0, bySystem: {} }
  const equipment = new Map(model.storeys.flatMap((s) => s.equipment).map((e) => [e.id, e]))
  const kindOf = (id: string) => equipmentKind(equipment.get(id)?.kind)

  const confirmed = new Set<string>()
  for (const c of model.connections) {
    if (c.inferred?.confirmed) confirmed.add(c.inferred.systemId)
    else if (c.inferred) delete c.inferred
  }

  const adjacent = new Map<string, { other: string; c: Connection }[]>()
  const link = (a: string, b: string, c: Connection) => {
    const list = adjacent.get(a)
    if (list) list.push({ other: b, c })
    else adjacent.set(a, [{ other: b, c }])
  }
  for (const c of model.connections) {
    link(c.from, c.to, c)
    link(c.to, c.from, c)
  }

  // --- 매체별로 원천에서의 거리를 건물 전체에서 한 번 잰다 --------------------------------
  //
  // 계통 안에서만 원천을 찾으면 안 된다. Revit 은 급기 계통을 가지마다 따로 만들어서(성수: 급기
  // 계통 753개) 대부분의 가지 계통에는 원천이 없고, 원천은 다른 계통의 덕트를 몇 단계 지나야 나온다.
  //
  // 거리를 재며 **지나가지 않는 것**이 둘이다. 말단(디퓨저·그릴)은 흐름의 끝이라 넘어가면 옆 가지로
  // 새고, 그 매체를 받기만 하는 기기(물 계통에서의 FCU·공조기)를 넘어가면 공급관에서 환수관으로
  // 건너가 거리가 뒤섞인다.
  //
  // `branch` 는 원천에서 첫 발을 디딘 이웃이다. 원천을 사이에 두고 갈라진 가지를 구별한다.
  type Field = { dist: Map<string, number>; branch: Map<string, string> }
  const fields = new Map<Medium, Field>()
  for (const medium of ['air', 'water'] as const) {
    const flowOf = (id: string) => kindOf(id)?.flow[medium]
    const passable = (id: string) => equipment.get(id)?.role !== 'terminal' && flowOf(id) !== 'sink'
    const dist = new Map<string, number>()
    const branch = new Map<string, string>()

    const spread = (seeds: string[]) => {
      const queue = seeds.filter((id) => !dist.has(id))
      for (const id of queue) dist.set(id, 0)
      for (let i = 0; i < queue.length; i++) {
        const at = queue[i]
        if (dist.get(at)! > 0 && !passable(at)) continue
        for (const { other } of adjacent.get(at) ?? []) {
          if (dist.has(other)) continue
          dist.set(other, dist.get(at)! + 1)
          branch.set(other, dist.get(at) === 0 ? other : branch.get(at)!)
          queue.push(other)
        }
      }
    }
    // 원천은 열원·공조기(conversion)를 먼저 쓰고, 거기서 안 닿는 곳에서만 펌프·팬(moving)을 쓴다.
    // 펌프를 열원과 같이 원천으로 두면 열원 → 펌프 사이 배관의 절반이 가까운 쪽(펌프)에서 나가는
    // 것으로 뒤집힌다.
    const sources = [...equipment.keys()].filter((id) => flowOf(id) === 'source')
    spread(sources.filter((id) => equipment.get(id)?.role !== 'moving'))
    spread(sources.filter((id) => equipment.get(id)?.role === 'moving'))
    fields.set(medium, { dist, branch })
  }

  // **바깥 루버로 이어진 가지는 계통 종류가 아니라 루버 종류가 방향을 정한다.** 외기(OA) 루버 쪽
  // 가지는 바깥 공기가 원천으로 들어오고, 배기(EA) 루버 쪽 가지는 원천에서 밖으로 나간다. 원천을
  // 사이에 두고 실내 쪽과 바깥 쪽의 방향이 달라서, 계통 종류 하나로 모든 가지를 같은 쪽으로 돌리면
  // 한쪽이 뒤집힌다(성수 배기 계통에서 규칙이 포트와 14%만 맞았던 이유다). 그렇다고 바깥 가지를
  // 무조건 뒤집으면 FCU 처럼 환기와 외기를 함께 빨아들이는 기기에서 환기 덕트가 거꾸로 나간다.
  // OA 인지 EA 인지 이름으로 모르는 루버는 가지 방향을 정하지 않고 계통 종류를 따른다.
  const louverSense = (id: string): Sense | null => {
    const e = equipment.get(id)
    const text = `${e?.name ?? ''} ${e?.objectType ?? ''}`
    const intake = /[_\s-]OA\b|외기|intake|fresh\s*air|outside\s*air/i.test(text)
    const exhaust = /[_\s-]EA\b|배기|exhaust|relief/i.test(text)
    return intake === exhaust ? null : intake ? 'in' : 'out'
  }
  // **덕트·배관의 유형 이름과 계통이 방향을 다르게 말하면 그 연결은 정하지 않는다.** Revit 은 유형
  // 이름에 용도를 적는 일이 많은데(`SA_급기`, `RA_순환공기`, `FCS_냉공급_순환수 공급`), 계통 배정과
  // 어긋나기도 한다. 성수에서 `RA(핑크)_탭_순환공기` 덕트가 "기계 급기" 계통에 들어가 있어서, 계통을
  // 믿으면 FCU 로 들어오는 환기 덕트가 FCU 에서 나가는 것으로 뒤집혔다. 그렇다고 유형 이름을 따르게
  // 하면 포트와의 일치율이 오히려 떨어졌다(급기 83.8→83.6%, 환기 90.7→89.2%). 어느 쪽이 맞는지
  // 모르므로 고르지 않고 `conflicts` 로 세어 둔다. 모순된 데이터에 방향을 찍으면 온톨로지가 거짓이 된다.
  const hintOf = (id: string) => {
    const e = equipment.get(id)
    return e && isConduit(e.role) ? systemKindOf(e.name, e.objectType ?? '') : null
  }

  const outdoorBranches = new Map<Medium, Map<string, Sense | null>>()
  for (const [medium, f] of fields) {
    const byBranch = new Map<string, Sense | null>()
    for (const [id, b] of f.branch) {
      if (kindOf(id)?.kind !== 'outdoor_louver') continue
      const sense = louverSense(id)
      // 한 가지에 OA 와 EA 가 섞이면(드물다) 정하지 않는다.
      byBranch.set(b, byBranch.has(b) && byBranch.get(b) !== sense ? null : sense)
    }
    outdoorBranches.set(medium, byBranch)
  }

  for (const system of model.systems) {
    const info = systemKind(system.kind)
    if (!info || confirmed.has(system.id)) continue
    report.systems++

    const { dist, branch } = fields.get(info.medium)!
    const outdoor = outdoorBranches.get(info.medium)!
    const members = new Set(system.memberIds)
    if (!system.memberIds.some((id) => dist.has(id))) {
      report.noSource++
      continue
    }

    const tally = (report.bySystem[system.id] = { oriented: 0, agree: 0, disagree: 0 })
    const done = new Set<Connection>()
    for (const id of system.memberIds) {
      for (const { other, c } of adjacent.get(id) ?? []) {
        if (done.has(c)) continue
        done.add(c)
        // 계통 안의 연결과, 계통에서 원천으로 바로 이어지는 연결만 이 계통이 정한다.
        if (!members.has(other) && dist.get(other) !== 0) continue
        const da = dist.get(c.from)
        const db = dist.get(c.to)
        // 거리가 같으면(고리의 가운데, 원천끼리) 어느 쪽으로도 정할 근거가 없다.
        if (da === undefined || db === undefined || da === db) continue
        let [from, to] = da < db ? [c.from, c.to] : [c.to, c.from]
        const hint = hintOf(to) ?? hintOf(from)
        if (hint && hint.medium === info.medium && hint.sense !== info.sense && !outdoor.get(branch.get(to) ?? '')) {
          report.conflicts++
          continue
        }
        const sense = outdoor.get(branch.get(to) ?? '') ?? info.sense
        if (sense === 'in') [from, to] = [to, from]

        if (c.directed) {
          if (c.from === from && c.to === to) {
            report.agree++
            tally.agree++
          } else {
            report.disagree++
            tally.disagree++
          }
          continue
        }
        // 두 계통이 같은 연결을 공유하면(구성원이 겹치면) 먼저 정한 쪽을 둔다.
        if (c.inferred) continue
        c.inferred = { from, to, systemId: system.id, confirmed: false }
        report.oriented++
        tally.oriented++
      }
    }
  }
  return report
}

/** 한 계통의 규칙 방향을 사람이 확인했다. 확인한 연결 수를 돌려준다. */
export function confirmSystemFlow(model: Model, systemId: string): number {
  let n = 0
  for (const c of model.connections) {
    if (c.inferred && c.inferred.systemId === systemId && !c.inferred.confirmed) {
      c.inferred.confirmed = true
      n++
    }
  }
  return n
}

/**
 * 규칙 방향과 사람이 정한 방향을 방향 있는 연결로 펼친 목록. 원래 연결은 바꾸지 않는다.
 *
 * 사람이 정한 방향(`edited`)이 규칙보다 앞선다. `confirmedOnly` 가 참이면 규칙 방향은 확인한 것만
 * 펼친다(사람이 정한 방향은 늘 펼친다). 내보내기(TTL)가 이쪽을 쓴다. 화면의 상류·하류 추적은
 * 확인 전의 것까지 펼쳐서 "규칙으로는 이렇다" 를 보여 준다.
 */
export function withInferred(connections: readonly Connection[], confirmedOnly = false): Connection[] {
  return connections.map((c) => {
    if (c.directed) return c
    if (c.edited) return { ...c, from: c.edited.from, to: c.edited.to, directed: true }
    if (c.inferred && (!confirmedOnly || c.inferred.confirmed)) {
      return { ...c, from: c.inferred.from, to: c.inferred.to, directed: true }
    }
    return c
  })
}
