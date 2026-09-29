// 종류를 모르는 패밀리에 종류 후보를 제안한다. **정하지 않는다** — 사람이 고를 때 위에 몇 개를 먼저 보일 뿐이다.
//
// 근거는 둘이다(선행 연구는 정본 부록 E).
//
// 1. **이름의 낱말.** 패밀리 이름의 낱말이 종류의 낱말(화면 이름, IFC 이름, 이름 사전의 낱말, `hint`)과 닮았는가.
//    이름 사전은 정해진 식에 맞아야 종류를 붙이지만, 여기서는 철자가 조금 달라도(글자 세 개 묶음이 겹치면) 후보로 올린다.
//    Forth & Borrmann 2024 가 객체 이름의 의미 유사도로 종류를 고른 것을 규칙 하나로 줄인 것이다. 이름 사전이 일부러
//    읽지 않는 종류(콘센트·스프링클러·급탕기 …)도 여기서는 후보가 된다.
// 2. **같은 건물에서 닮은 패밀리.** 이름이 암호 같아도 어느 계통에 있고, 무엇과 이어져 있고, 바닥에서 얼마나 떠 있는지를
//    보면 종류를 아는 패밀리 중 닮은 것이 있다 — 급기 계통 끝에서 덕트 하나에 붙어 천장에 달린 것은 그 건물의 디퓨저와
//    닮았다. 방 종류를 이름보다 형상·인접 관계로 가를 때 규칙보다 학습이 맞았다는 결과(Bloch & Sacks 2018, Wang·Sacks
//    2022)를 가장 단순하게 옮겼다 — 특징을 세어 닮은 정도(코사인)로 가장 닮은 패밀리의 종류를 앞에 둔다. 그 건물에 이미
//    있는 종류만 권할 수 있다는 한계가 있어서 1과 같이 쓴다.
//
// 외부 모델도 네트워크도 쓰지 않는다(55 는 바깥에 닿지 않는다). 2 가 얼마나 맞는지는 종류를 아는 패밀리를 하나씩 가리고
// 맞혀 보는 것으로 잰다(`evaluateSuggestions`, check:sample). 1 은 종류를 아는 패밀리가 이미 이름으로 정해진 것이라
// 같은 방법으로는 잴 수 없다.

import { familyKeyOf } from './edit'
import { EQUIPMENT_KINDS, equipmentKind, ifcClassLabel, systemKind } from './kinds'
import { isConduit, type Equipment, type Model } from './model'

export type KindSuggestion = {
  kind: string
  /** 닮은 정도(0~1). */
  score: number
  /** 왜 이 종류를 권하는가. 이름의 낱말이면 `name`, 닮은 패밀리면 `like`. */
  why: { name: string } | { like: string }
}

type Vector = Map<string, number>

// --- 이름의 낱말 ----------------------------------------------------------------------

/** 낱말로 쪼갠다. 낙타 표기(`WaterHeater`)도 가르고, 두 글자 이하 영문(`M`, `mm`)과 숫자는 버린다. */
function words(text: string): string[] {
  return text
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z가-힣]+/)
    .map((w) => w.toLowerCase())
    .filter((w) => (/[가-힣]/.test(w) ? w.length >= 2 : w.length >= 3))
}

const trigrams = (w: string) => {
  const s = new Set<string>()
  for (let i = 0; i + 3 <= w.length; i++) s.add(w.slice(i, i + 3))
  return s
}

/** 두 낱말이 같은 낱말인가. 짧으면 같아야 하고, 길면 글자 세 개 묶음이 60% 넘게 겹치면 된다(철자·복수형 차이). */
function sameWord(a: string, b: string): boolean {
  if (a === b) return true
  if (a.length < 5 || b.length < 5) return false
  const x = trigrams(a)
  const y = trigrams(b)
  let both = 0
  for (const t of x) if (y.has(t)) both++
  return both / (x.size + y.size - both) > 0.6
}

/** 여러 종류에 두루 걸려 아무것도 가르지 못하는 낱말. `unit` 은 실내기·실외기·공조기 어디에나 있다. */
const GENERIC = new Set(['unit', 'type', 'terminal', 'equipment', 'system', 'hosted', 'standard', 'default', 'generic'])

/** 종류마다의 낱말. 이름 사전의 식에서 글자만 꺼내고(`air\s*handl` → air, handl), 화면 이름·IFC 이름·hint 를 더한다. */
const VOCABULARY = new Map(
  EQUIPMENT_KINDS.map((k) => {
    // 식에서 `\b`·`\s*` 같은 기호, `[AO]` 같은 글자 묶음, `(?<!…)` 같은 앞뒤 조건을 지우고 글자만 남긴다.
    const regex = k.test.source.replace(/\\[bsdwS]\*?|\[[^\]]*\]|\(\?[<!=]+[^)]*\)|[?*+]/g, ' ')
    const ifc = (k.ifc ?? []).join(' ').replace(/\./g, ' ')
    return [k.kind, new Set(words(`${k.label} ${regex} ${ifc} ${k.hint ?? ''}`).filter((w) => !GENERIC.has(w)))] as const
  }),
)

function nameHits(label: string): KindSuggestion[] {
  const own = words(label).filter((w) => !GENERIC.has(w))
  if (!own.length) return []
  const out: KindSuggestion[] = []
  for (const [kind, vocab] of VOCABULARY) {
    const hit = own.filter((w) => [...vocab].some((v) => sameWord(w, v)))
    if (hit.length) out.push({ kind, score: hit.length / own.length, why: { name: hit.join(' ') } })
  }
  return out.sort((a, b) => b.score - a.score)
}

// --- 닮은 패밀리 ------------------------------------------------------------------------

/** 설비 하나가 무엇인지(이웃 특징용). 종류가 있으면 종류, 없으면 IFC 클래스의 우리말. */
const whatOf = (e: Equipment | undefined) =>
  e ? (equipmentKind(e.kind)?.label ?? ifcClassLabel(e.declaredType) ?? ifcClassLabel(e.ifcClass) ?? '모름') : '모름'

/** 바닥에서의 높이를 셋으로 가른다. 바닥 기기(펌프·보일러), 벽 기기, 천장 기기(디퓨저·FCU)가 갈린다. */
const band = (h: number) => (h < 0.5 ? 'floor' : h < 2 ? 'wall' : 'ceiling')

type Family = { key: string; label: string; kind: string | null; vector: Vector }

/** 패밀리마다 특징. 도관(덕트·배관)은 종류를 붙이지 않으므로 뺀다. */
function families(model: Model): Family[] {
  const byId = new Map(model.storeys.flatMap((s) => s.equipment).map((e) => [e.id, e]))
  const systems = new Map(model.systems.map((s) => [s.id, s]))
  const adjacent = new Map<string, Set<string>>()
  for (const c of model.connections) {
    adjacent.set(c.from, (adjacent.get(c.from) ?? new Set()).add(c.to))
    adjacent.set(c.to, (adjacent.get(c.to) ?? new Set()).add(c.from))
  }
  const acc = new Map<string, { label: string; kinds: Map<string, number>; unknown: number; counts: Vector; members: number }>()
  const add = (v: Vector, k: string, w = 1) => v.set(k, (v.get(k) ?? 0) + w)
  for (const storey of model.storeys) {
    for (const e of storey.equipment) {
      if (isConduit(e.role)) continue
      const key = familyKeyOf(e)
      const a = acc.get(key) ?? { label: key.startsWith('family:') ? key.replace(/^family:[^|]*\|/, '') : e.name, kinds: new Map(), unknown: 0, counts: new Map(), members: 0 }
      a.members++
      if (equipmentKind(e.kind)) add(a.kinds, e.kind!)
      else a.unknown++
      const v = a.counts
      add(v, `class:${(e.declaredType ?? e.ifcClass).split('.')[0]}`)
      if (e.role) add(v, `role:${e.role}`)
      const system = e.systemId ? systems.get(e.systemId) : null
      add(v, `system:${system ? (systemKind(system.kind)?.kind ?? 'unknown') : 'none'}`)
      const around = adjacent.get(e.id) ?? new Set<string>()
      add(v, `degree:${Math.min(around.size, 3)}`)
      for (const n of around) add(v, `next:${whatOf(byId.get(n))}`, 1 / around.size)
      if (e.position) add(v, `height:${band(e.position[2] - storey.elevation)}`)
      acc.set(key, a)
    }
  }
  return [...acc].map(([key, a]) => {
    // 특징마다 대수로 나눠 비율로 둔다(큰 패밀리가 이기지 않게). 그리고 길이 1로 맞춘다.
    const v: Vector = new Map([...a.counts].map(([k, n]) => [k, n / a.members]))
    const norm = Math.sqrt([...v.values()].reduce((s, x) => s + x * x, 0)) || 1
    for (const [k, x] of v) v.set(k, x / norm)
    // 종류를 아는 패밀리: 대수가 가장 많은 종류. 종류를 모르는 대수가 있으면 모르는 패밀리로 본다(화면 목록과 같은 기준).
    const kind = a.unknown === 0 && a.kinds.size ? [...a.kinds].sort((x, y) => y[1] - x[1])[0][0] : null
    return { key, label: a.label, kind, vector: v }
  })
}

const cosine = (a: Vector, b: Vector) => {
  let s = 0
  const [small, large] = a.size < b.size ? [a, b] : [b, a]
  for (const [k, x] of small) s += x * (large.get(k) ?? 0)
  return s
}

/** 닮은 패밀리의 종류를 닮은 순으로. 종류마다 가장 닮은 패밀리 하나로 센다. */
function lookalikes(target: Family, known: readonly Family[]): KindSuggestion[] {
  const best = new Map<string, KindSuggestion>()
  for (const f of known) {
    if (f.key === target.key || !f.kind) continue
    const score = cosine(target.vector, f.vector)
    const was = best.get(f.kind)
    if (!was || score > was.score) best.set(f.kind, { kind: f.kind, score, why: { like: f.label } })
  }
  return [...best.values()].sort((a, b) => b.score - a.score)
}

/** 닮은 패밀리로 권할 때의 하한. 이보다 덜 닮으면 권하지 않는다(아무것이나 셋을 채우지 않는다). */
const MIN_LIKENESS = 0.5

/**
 * 종류를 모르는 패밀리 열쇠 → 후보. 이름의 낱말이 맞은 종류가 먼저이고, 남은 자리를 닮은 패밀리의 종류로 채운다.
 * 같은 종류는 한 번만 나온다.
 */
export function suggestKinds(model: Model, limit = 3): Map<string, KindSuggestion[]> {
  const all = families(model)
  const known = all.filter((f) => f.kind)
  const out = new Map<string, KindSuggestion[]>()
  for (const f of all) {
    if (f.kind) continue
    const picked: KindSuggestion[] = []
    for (const s of [...nameHits(f.label), ...lookalikes(f, known).filter((s) => s.score >= MIN_LIKENESS)]) {
      if (picked.length >= limit) break
      if (!picked.some((p) => p.kind === s.kind)) picked.push(s)
    }
    out.set(f.key, picked)
  }
  return out
}

/**
 * 닮은 패밀리로 권하는 것이 얼마나 맞는가. 종류를 아는 Revit 패밀리를 하나씩 가리고 나머지로 맞혀 본다. `top1` 은 첫
 * 후보가, `top3` 는 세 후보 안에 맞는 종류가 든 패밀리의 수다. Revit 패밀리 이름이 없는 설비(`#id`, 설비 하나가 한
 * 묶음)는 뺀다 — 모양이 같은 형제가 곁에 있어 맞히기가 너무 쉽다.
 */
export function evaluateSuggestions(model: Model): { families: number; top1: number; top3: number } {
  const known = families(model).filter((f) => f.kind)
  const scored = known.filter((f) => f.key.startsWith('family:'))
  let top1 = 0
  let top3 = 0
  for (const f of scored) {
    const kinds = lookalikes(f, known).slice(0, 3).map((s) => s.kind)
    if (kinds[0] === f.kind) top1++
    if (kinds.includes(f.kind!)) top3++
  }
  return { families: scored.length, top1, top3 }
}
