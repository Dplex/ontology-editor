// 판본 짝짓기(PRD #6, 요구사항 R13).
//
// 같은 건물을 다시 내보낸 BIM 에서 같은 물리존·설비를 알아본다. 편집 파일을 새 판본에 얹을 때와 두 판본을 견줄 때
// 둘 다 이것을 쓴다.
//
// **GUID 만 믿으면 안 된다.** Duplex MEP 를 같은 Revit MEP 2011 로 한 달 반 뒤 다시 낸 판본(MEP-2)은 같은 요소
// (이름 끝의 Revit 요소 ID) 344개 중 217개, 번호와 이름이 같은 방 18개 전부의 GUID 가 바뀌었다. 그래서 GUID →
// Revit 요소 ID → 이름 → 위치 순으로 짝을 짓는다. **한 열쇠에 둘 이상이 걸리면 그 열쇠로는 짓지 않는다** — 틀린
// 짝은 편집을 엉뚱한 방·설비에 얹고, 그건 못 찾은 것보다 나쁘다(못 찾은 것은 센다).

import { centroid } from './mapping'
import { storeyScaleMismatch, type ScaleMismatch } from './unit-check'
import type { Model } from './model'
import type { Baseline } from './edit'

export type MatchKey = 'guid' | 'revitId' | 'name' | 'position'
export const FALLBACK_KEYS = ['revitId', 'name', 'position'] as const satisfies readonly MatchKey[]

export const MATCH_KEY_LABEL: Record<MatchKey, string> = {
  guid: 'GUID',
  revitId: 'Revit 요소 ID',
  name: '이름',
  position: '위치',
}

/** 문장 안에서 "무엇으로 찾았나" 를 말할 때. 조사가 받침에 따라 달라서 따로 둔다. */
export const MATCH_KEY_BY: Record<MatchKey, string> = {
  guid: 'GUID로',
  revitId: 'Revit 요소 ID로',
  name: '이름으로',
  position: '위치로',
}

/**
 * GUID 가 바뀌어도 남기를 바라는 것. 모델 안에서 하나뿐인 값만 담는다(둘 이상이면 짝짓기에 쓸 수 없다).
 * 편집 파일에도 이대로 적힌다.
 */
export type Fingerprint = {
  kind: 'storey' | 'space' | 'equipment' | 'system' | 'wall' | 'opening'
  /** Revit 이 이름 끝에 붙이는 요소 ID(`패밀리:유형:621849`). Revit 안에서 요소가 살아 있는 동안 바뀌지 않는다. */
  revitId?: string
  /** 층·계통은 이름, 물리존은 층|번호|이름, 설비는 클래스|이름, 벽은 층|이름, 문·창은 층|문·창|이름. */
  name?: string
  /** 위치로 짝지을 무리. 물리존·벽은 층 이름, 설비는 IFC 클래스, 문·창은 층|문·창. 무리가 다르면 가까워도 짝이 아니다. */
  group?: string
  /** 물리존·벽은 외곽선 중심(z 0), 설비·문·창은 좌표. */
  at?: [number, number, number]
}

/**
 * 위치로 같은 것이라 보는 거리(미터). 물리존 중심은 경계를 조금 고쳐도 움직이니 설비보다 넉넉하다. 벽은 물리존과 같이
 * 외곽선 중심이고, 문·창은 설비처럼 한 점이라 설비와 같다.
 */
export const POSITION_TOLERANCE = { space: 0.25, equipment: 0.05, wall: 0.25, opening: 0.05 } as const
const POSITIONED = ['space', 'equipment', 'wall', 'opening'] as const

export function revitElementId(name: string): string | null {
  const m = /:(\d{3,})$/.exec(name)
  return m ? m[1] : null
}

/**
 * 모델의 지문. baseline 을 주면 이름·외곽선·좌표를 **연 때의 값**으로 잰다 — 새 판본의 BIM 에는 사람이 고치기
 * 전의 값이 들어 있으므로, 고친 이름으로는 찾을 수 없다.
 */
export function fingerprints(model: Model, baseline?: Baseline): Map<string, Fingerprint> {
  const out = new Map<string, Fingerprint>()
  for (const storey of model.storeys) {
    out.set(storey.id, { kind: 'storey', name: storey.name })
    for (const space of storey.spaces) {
      const longName = baseline?.names.get(space.id) ?? space.longName
      const ring = baseline?.footprints.get(space.id) ?? space.footprint
      const c = centroid(ring)
      out.set(space.id, {
        kind: 'space',
        name: `${storey.name}|${space.name}|${longName}`,
        group: storey.name,
        ...(c ? { at: [c[0], c[1], 0] as [number, number, number] } : {}),
      })
    }
    for (const e of storey.equipment) {
      const was = baseline?.equipment.get(e.id)
      const position = was ? was.position : e.position
      // 이름도 연 때의 것이다. 사람이 태그를 고쳤어도 새 판본의 BIM 에는 옛 이름이 있다.
      const name = was?.name ?? e.name
      const revitId = revitElementId(name)
      out.set(e.id, {
        kind: 'equipment',
        ...(revitId ? { revitId } : {}),
        ...(name ? { name: `${e.ifcClass}|${name}` } : {}),
        group: e.ifcClass,
        ...(position ? { at: [position[0], position[1], position[2]] as [number, number, number] } : {}),
      })
    }
    // 벽·문·창(E4). 편집 파일이 옮기고 지운 벽·문·창을 GUID 가 바뀐 판본에서도 찾는다. 모양·자리는 연 때의 것이다.
    for (const w of storey.walls) {
      const was = baseline?.walls?.get(w.id)
      const name = was?.name ?? w.name
      const ring = (was ? was.footprint : w.footprint)?.[0]
      const c = ring ? centroid(ring) : null
      const revitId = revitElementId(name)
      out.set(w.id, {
        kind: 'wall',
        ...(revitId ? { revitId } : {}),
        ...(name ? { name: `${storey.name}|${name}` } : {}),
        group: storey.name,
        ...(c ? { at: [c[0], c[1], 0] as [number, number, number] } : {}),
      })
    }
    for (const o of storey.openings) {
      const was = baseline?.openings?.get(o.id)
      const name = was?.name ?? o.name
      const p = was ? was.position : o.position
      const revitId = revitElementId(name)
      out.set(o.id, {
        kind: 'opening',
        ...(revitId ? { revitId } : {}),
        ...(name ? { name: `${storey.name}|${o.kind}|${name}` } : {}),
        group: `${storey.name}|${o.kind}`,
        ...(p ? { at: [p[0], p[1], p[2]] as [number, number, number] } : {}),
      })
    }
  }
  // 계통 이름은 고칠 수 있다(OE-PIP-09). 다음 판본은 BIM 이름을 들고 오니 연 때 이름으로 찾는다.
  for (const system of model.systems) {
    const name = baseline?.systems?.get(system.id)?.name ?? system.name
    out.set(system.id, { kind: 'system', ...(name ? { name } : {}) })
  }

  // 하나뿐인 값만 남긴다.
  for (const key of ['revitId', 'name'] as const) {
    const seen = new Map<string, number>()
    for (const fp of out.values()) {
      const v = fp[key]
      if (v !== undefined) seen.set(`${fp.kind}|${v}`, (seen.get(`${fp.kind}|${v}`) ?? 0) + 1)
    }
    for (const fp of out.values()) {
      const v = fp[key]
      if (v !== undefined && seen.get(`${fp.kind}|${v}`)! > 1) delete fp[key]
    }
  }
  return out
}

export type Matching = {
  /** 앞 판본 id → 뒤 판본 id 와 무엇으로 짝지었나. */
  pairs: Map<string, { id: string; by: MatchKey }>
  /** 뒤 판본에만 있는 id. */
  added: string[]
  /** 앞 판본에만 있는 id. */
  removed: string[]
}

/**
 * 두 지문 묶음을 짝짓는다. 열쇠마다 **양쪽에서 하나뿐일 때만** 짓는다. 위치는 거리 안에 서로가 하나뿐일 때만 짓는다.
 * 앞 판본 쪽 지문에 kind 가 없으면(옛 편집 파일) GUID 로만 찾는다.
 */
export function matchFingerprints(prev: ReadonlyMap<string, Partial<Fingerprint>>, next: ReadonlyMap<string, Fingerprint>): Matching {
  const pairs: Matching['pairs'] = new Map()
  const taken = new Set<string>()
  for (const id of prev.keys()) {
    if (next.has(id)) {
      pairs.set(id, { id, by: 'guid' })
      taken.add(id)
    }
  }
  // 둘 다 Revit 요소 ID 가 있는데 다르면 다른 요소다. 같은 자리에 새로 놓은 것이나 이름을 물려받은 것을 짝짓지 않는다.
  const differ = (a: Partial<Fingerprint>, b: Partial<Fingerprint>) => !!a.revitId && !!b.revitId && a.revitId !== b.revitId
  const openPrev = () => [...prev].filter(([id, fp]) => !pairs.has(id) && fp.kind)
  const openNext = () => [...next].filter(([id]) => !taken.has(id))

  for (const key of ['revitId', 'name'] as const) {
    const index = <T extends Partial<Fingerprint>>(rows: [string, T][]) => {
      const m = new Map<string, string | null>()
      for (const [id, fp] of rows) {
        const v = fp[key]
        if (v === undefined) continue
        const k = `${fp.kind}|${v}`
        m.set(k, m.has(k) ? null : id)
      }
      return m
    }
    const a = index(openPrev())
    const b = index(openNext())
    for (const [k, id] of a) {
      const other = b.get(k)
      if (id && other && !differ(prev.get(id)!, next.get(other)!)) {
        pairs.set(id, { id: other, by: key })
        taken.add(other)
      }
    }
  }

  // 위치: 무리가 같고 거리 안에 서로가 하나뿐인 짝. 칸으로 나눠 가까운 것만 본다(설비가 만 개를 넘는다).
  for (const kind of POSITIONED) {
    const tol = POSITION_TOLERANCE[kind]
    const cell = (p: readonly number[]) => [Math.floor(p[0] / tol), Math.floor(p[1] / tol), Math.floor(p[2] / tol)]
    const grid = new Map<string, [string, Fingerprint][]>()
    for (const row of openNext()) {
      const fp = row[1]
      if (fp.kind !== kind || !fp.at) continue
      const k = cell(fp.at).join(',')
      grid.set(k, [...(grid.get(k) ?? []), row])
    }
    const near = (fp: Partial<Fingerprint>, rows: Iterable<[string, Partial<Fingerprint>]>) => {
      const out: string[] = []
      for (const [id, other] of rows) {
        if (other.kind !== kind || other.group !== fp.group || !other.at || !fp.at || differ(fp, other)) continue
        if (Math.hypot(other.at[0] - fp.at[0], other.at[1] - fp.at[1], other.at[2] - fp.at[2]) <= tol) out.push(id)
      }
      return out
    }
    const around = (p: readonly number[]) => {
      const [x, y, z] = cell(p)
      const rows: [string, Fingerprint][] = []
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) rows.push(...(grid.get(`${x + dx},${y + dy},${z + dz}`) ?? []))
      return rows
    }
    const prevOpen = openPrev().filter(([, fp]) => fp.kind === kind && fp.at)
    const found: [string, string][] = []
    for (const [id, fp] of prevOpen) {
      const hits = near(fp, around(fp.at!).filter(([nid]) => !taken.has(nid)))
      if (hits.length !== 1) continue
      const back = near(next.get(hits[0])!, prevOpen)
      if (back.length === 1 && back[0] === id) found.push([id, hits[0]])
    }
    for (const [a, b] of found) {
      pairs.set(a, { id: b, by: 'position' })
      taken.add(b)
    }
  }

  return {
    pairs,
    added: [...next.keys()].filter((id) => !taken.has(id)),
    removed: [...prev.keys()].filter((id) => !pairs.has(id)),
  }
}

export type VersionDiff = {
  /** 이름이 같은 층의 높이가 단위 배수로 다르다(OE-BIM-11). 비는 지금 판본 / 이전 판본. 한 판본의 길이 단위 선언이 실제 값과 다르다. */
  storeyScale: ScaleMismatch | null
  spaces: KindDiff & {
    renamed: { id: string; from: string; to: string }[]
    /** 넓이가 1% 넘게 바뀐 물리존. */
    reshaped: { id: string; name: string; from: number; to: number }[]
  }
  equipment: KindDiff & {
    /** 좌표가 5cm 넘게 옮겨진 설비(뒤 판본 id). */
    moved: { id: string; name: string; distance: number }[]
    /** 소속 물리존이 바뀐 설비. 앞 판본의 소속을 짝지은 물리존으로 옮겨 견준다. */
    relocated: { id: string; name: string; from: string | null; to: string | null }[]
  }
}

type KindDiff = {
  prevCount: number
  nextCount: number
  /** 무엇으로 짝지었나. guid 가 아닌 것이 "GUID 가 바뀐 같은 것" 이다. */
  by: Record<MatchKey, number>
  /**
   * GUID 가 바뀐 같은 것 하나하나(R13 판정 근거, OE-BIM-19). 지금 판본의 id·이름, 이전 판본의 GUID, 무엇으로 찾았나. 숫자(by)만으로는
   * 어느 요소의 DT id 가 바뀌는지 고객사에 보여 줄 수 없다.
   */
  rekeyed: { id: string; name: string; prevId: string; by: Exclude<MatchKey, 'guid'> }[]
  added: { id: string; name: string }[]
  removed: { id: string; name: string }[]
}

const emptyBy = (): Record<MatchKey, number> => ({ guid: 0, revitId: 0, name: 0, position: 0 })

/** 앞 판본(prev)과 지금 모델(next)을 견준다. 추가·옮김은 지금 모델의 id 로 적어 화면이 골라 보일 수 있게 한다. */
export function compareVersions(prev: Model, next: Model): VersionDiff {
  const m = matchFingerprints(fingerprints(prev), fingerprints(next))
  const spacesOf = (model: Model) => new Map(model.storeys.flatMap((s) => s.spaces.map((sp) => [sp.id, { sp, storey: s.name }] as const)))
  const equipmentOf = (model: Model) => new Map(model.storeys.flatMap((s) => s.equipment.map((e) => [e.id, e] as const)))
  const ps = spacesOf(prev)
  const ns = spacesOf(next)
  const pe = equipmentOf(prev)
  const ne = equipmentOf(next)
  const spaceLabel = (x: { sp: { name: string; longName: string }; storey: string }) =>
    `${x.storey} ${x.sp.longName || x.sp.name}${x.sp.longName && x.sp.name ? ` (${x.sp.name})` : ''}`
  const spaceName = (id: string | null, map: typeof ns) => (id && map.get(id) ? spaceLabel(map.get(id)!) : null)

  const diff: VersionDiff = {
    storeyScale: storeyScaleMismatch(prev.storeys, next.storeys),
    spaces: { prevCount: ps.size, nextCount: ns.size, by: emptyBy(), rekeyed: [], added: [], removed: [], renamed: [], reshaped: [] },
    equipment: { prevCount: pe.size, nextCount: ne.size, by: emptyBy(), rekeyed: [], added: [], removed: [], moved: [], relocated: [] },
  }
  for (const [id, x] of ps) {
    const pair = m.pairs.get(id)
    if (!pair) {
      diff.spaces.removed.push({ id, name: spaceLabel(x) })
      continue
    }
    diff.spaces.by[pair.by]++
    const y = ns.get(pair.id)!
    if (pair.by !== 'guid') diff.spaces.rekeyed.push({ id: pair.id, name: spaceLabel(y), prevId: id, by: pair.by })
    if (x.sp.longName !== y.sp.longName) diff.spaces.renamed.push({ id: pair.id, from: x.sp.longName, to: y.sp.longName })
    if (Math.abs(x.sp.areaM2 - y.sp.areaM2) > Math.max(x.sp.areaM2, y.sp.areaM2) * 0.01)
      diff.spaces.reshaped.push({ id: pair.id, name: spaceLabel(y), from: x.sp.areaM2, to: y.sp.areaM2 })
  }
  for (const id of m.added) if (ns.has(id)) diff.spaces.added.push({ id, name: spaceLabel(ns.get(id)!) })

  for (const [id, x] of pe) {
    const pair = m.pairs.get(id)
    if (!pair) {
      diff.equipment.removed.push({ id, name: x.name || x.ifcClass })
      continue
    }
    diff.equipment.by[pair.by]++
    const y = ne.get(pair.id)!
    if (pair.by !== 'guid') diff.equipment.rekeyed.push({ id: pair.id, name: y.name || y.ifcClass, prevId: id, by: pair.by })
    if (x.position && y.position) {
      const d = Math.hypot(x.position[0] - y.position[0], x.position[1] - y.position[1], x.position[2] - y.position[2])
      if (d > POSITION_TOLERANCE.equipment) diff.equipment.moved.push({ id: pair.id, name: y.name || y.ifcClass, distance: d })
    }
    const was = x.spaceId ? (m.pairs.get(x.spaceId)?.id ?? `gone:${x.spaceId}`) : null
    if (was !== y.spaceId) {
      diff.equipment.relocated.push({
        id: pair.id,
        name: y.name || y.ifcClass,
        from: x.spaceId ? spaceName(x.spaceId, ps) : null,
        to: spaceName(y.spaceId, ns),
      })
    }
  }
  for (const id of m.added) if (ne.has(id)) diff.equipment.added.push({ id, name: ne.get(id)!.name || ne.get(id)!.ifcClass })
  diff.equipment.moved.sort((a, b) => b.distance - a.distance)
  return diff
}
