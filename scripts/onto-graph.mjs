// 우리가 낸 온톨로지(TTL)를 그래프로 읽고 묻는다. 온톨로지 질의 챗봇의 MCP 도구(scripts/onto-mcp.mjs)와 질문 시험대
// (scripts/onto-bench.mjs)가 쓴다(ADR-0050). 의존성 없는 node 다 — 55 는 npm 레지스트리에 닿지 않고 TS 를 바로 못 돌린다.
//
// 보기가 둘이다.
//   full     — 우리 TTL 전부(src/lib/export/ttl.ts 가 쓴 그대로). Turtle 을 문법대로 읽는다.
//   receiver — 받는 쪽 DT 파서가 읽는 만큼(`ex:X a brick:클래스` 블록의 클래스·이름·hasPoint·feeds·hasLocation·hasPart).
//              src/lib/export/read-ttl.ts 의 규칙을 옮겨 적었다. 둘이 어긋나면 onto-graph.test.ts 가 실패한다.
// 같은 질의를 두 보기에 돌리면 "우리 TTL 에는 답이 있는데 받는 쪽에서는 사라지는" 질문이 드러난다.
//
// 이름: 주어·목적어는 접두사를 붙인 꼴(`ex:0MEP$Equip$AHU1$0000`, `brick:Office`)이고 지역 이름의 이스케이프(`\$`)는 푼다.
// 리터럴은 값 그대로(문자열·수·참거짓)이고 triple 의 lit 이 true 다.

const RDF_TYPE = 'a'
const LABEL = 'rdfs:label'

// ---------------------------------------------------------------- Turtle(full)

/** 지역 이름·문자열의 역슬래시 이스케이프를 푼다(read-ttl.ts 의 unescapeTurtle 과 같다). */
export function unescapeTurtle(s) {
  if (!s.includes('\\')) return s
  let out = ''
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== '\\' || i + 1 === s.length) {
      out += s[i]
      continue
    }
    const c = s[++i]
    out += c === 'n' ? '\n' : c === 't' ? '\t' : c === 'r' ? '\r' : c
  }
  return out
}

/** Turtle 을 낱말로. 우리 writer 가 쓰는 부분(접두사 이름·문자열·수·참거짓·a·; , .)만 안다. */
function tokens(text) {
  const out = []
  const n = text.length
  let i = 0
  while (i < n) {
    const c = text[i]
    if (c === ' ' || c === '\t' || c === '\r' || c === '\n') { i++; continue }
    if (c === '#') { while (i < n && text[i] !== '\n') i++; continue }
    if (c === ';' || c === ',') { out.push({ t: c }); i++; continue }
    if (c === '"') {
      let j = i + 1
      let s = ''
      while (j < n && text[j] !== '"') {
        if (text[j] === '\\' && j + 1 < n) { s += text[j] + text[j + 1]; j += 2 } else s += text[j++]
      }
      i = j + 1
      // 언어 태그·자료형은 버린다(우리 writer 는 쓰지 않는다)
      if (text[i] === '@') while (i < n && /[\w-@]/.test(text[i])) i++
      else if (text.startsWith('^^', i)) { i += 2; while (i < n && !/[\s;,]/.test(text[i]) && !(text[i] === '.' && /[\s]/.test(text[i + 1] ?? ' '))) i++ }
      out.push({ t: 'lit', v: unescapeTurtle(s) })
      continue
    }
    if (c === '.') { out.push({ t: '.' }); i++; continue }
    if (c === '@' || (c === 'P' && text.startsWith('PREFIX', i))) {
      // @prefix p: <iri> .
      const end = text.indexOf('\n', i)
      const line = text.slice(i, end < 0 ? n : end)
      const m = /^@?prefix\s+([\w-]*):\s*<([^>]*)>/i.exec(line)
      if (m) out.push({ t: 'prefix', p: m[1], iri: m[2] })
      i = end < 0 ? n : end
      continue
    }
    // 수: 마침표 뒤에 숫자가 이어지면 소수점이다
    const num = /^[+-]?(?:\d+\.\d+|\d+|\.\d+)(?:[eE][+-]?\d+)?/.exec(text.slice(i, i + 40))
    if (num && !/[\w:]/.test(text[i + num[0].length] ?? ' ')) {
      out.push({ t: 'lit', v: Number(num[0]) })
      i += num[0].length
      continue
    }
    // 접두사 이름 · a · true/false. 지역 이름은 \X 이스케이프를 품고, 이스케이프 없는 ; , . 공백에서 끝난다.
    let j = i
    let raw = ''
    while (j < n) {
      const d = text[j]
      if (d === '\\' && j + 1 < n) { raw += d + text[j + 1]; j += 2; continue }
      if (/[\s;,"]/.test(d)) break
      if (d === '.' && (j + 1 >= n || /[\s]/.test(text[j + 1]))) break
      raw += d
      j++
    }
    i = j
    if (raw === 'a') out.push({ t: 'a' })
    else if (raw === 'true' || raw === 'false') out.push({ t: 'lit', v: raw === 'true' })
    else if (raw) {
      const k = raw.indexOf(':')
      out.push({ t: 'name', v: k < 0 ? raw : `${raw.slice(0, k + 1)}${unescapeTurtle(raw.slice(k + 1))}` })
    } else i++ // 모르는 글자는 건너뛴다
  }
  return out
}

/** 우리 TTL 전부를 triple 로. { triples: [{ s, p, o, lit }], prefixes } */
export function parseTurtle(text) {
  const triples = []
  const prefixes = {}
  const ts = tokens(text)
  let k = 0
  const term = (tok) => (tok.t === 'a' ? RDF_TYPE : tok.v)
  while (k < ts.length) {
    const tok = ts[k]
    if (tok.t === 'prefix') { prefixes[tok.p] = tok.iri; k++; continue }
    if (tok.t !== 'name') { k++; continue }
    const s = tok.v
    k++
    // 술어-목적어 목록: p o (, o)* (; p o (, o)*)* .
    while (k < ts.length && ts[k].t !== '.') {
      const pt = ts[k++]
      if (pt.t !== 'name' && pt.t !== 'a') continue
      const p = term(pt)
      for (;;) {
        const ot = ts[k++]
        if (!ot) break
        if (ot.t === 'name') triples.push({ s, p, o: ot.v, lit: false })
        else if (ot.t === 'lit') triples.push({ s, p, o: ot.v, lit: true })
        if (ts[k]?.t === ',') { k++; continue }
        break
      }
      if (ts[k]?.t === ';') k++
    }
    k++ // .
  }
  return { triples, prefixes }
}

// ---------------------------------------------------------------- 받는 쪽(receiver)

const SUBJECT = /^ex:(\S+)\s+a\s+(brick|ex):(\w+)/
const ANY_SUBJECT = /^ex:(\S+)\s+a\s+(\w+:\w+)/
const LABEL_RE = /rdfs:label\s+"((?:[^"\\]|\\.)*)"/
const REF = /ex:([^\s,;.]+)/g
const RECEIVER_PREDICATES = ['hasPoint', 'feeds', 'hasLocation', 'hasPart']

function objects(block, predicate) {
  const want = `brick:${predicate}`
  const out = []
  for (const raw of block.split(';')) {
    const clause = raw.trim()
    if (!clause.startsWith(want)) continue
    const rest = clause.slice(want.length)
    if (rest !== '' && !/^\s/.test(rest)) continue
    for (const m of rest.matchAll(REF)) out.push(unescapeTurtle(m[1].replace(/,$/, '')))
  }
  return out
}

/** 받는 쪽 DT 파서가 읽는 만큼(read-ttl.ts readOntologyTTL 과 같은 규칙). { entities, unread } */
export function readReceiver(text) {
  const entities = []
  const unread = []
  let block = ''
  const flush = () => {
    const s = block.trim()
    block = ''
    if (!s) return
    const m = SUBJECT.exec(s)
    if (!m) {
      const any = ANY_SUBJECT.exec(s)
      if (any) unread.push({ key: unescapeTurtle(any[1]), cls: any[2] })
      return
    }
    const label = LABEL_RE.exec(s)
    entities.push({
      key: unescapeTurtle(m[1]),
      ns: m[2],
      cls: m[3],
      label: label ? unescapeTurtle(label[1]) : '',
      points: objects(s, 'hasPoint'),
      feeds: objects(s, 'feeds'),
      locations: objects(s, 'hasLocation'),
      parts: objects(s, 'hasPart'),
    })
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (line === '' || line.startsWith('@prefix') || line.startsWith('#')) continue
    block += `${line}\n`
    if (line.endsWith('.') && !line.endsWith(',')) flush()
  }
  flush()
  return { entities, unread }
}

/** 받는 쪽이 읽는 것을 triple 로. 클래스는 받는 쪽이 brick: 과 ex: 를 같게 보지만 적힌 접두사로 둔다. */
export function receiverTriples(text) {
  const triples = []
  const { entities } = readReceiver(text)
  for (const e of entities) {
    const s = `ex:${e.key}`
    triples.push({ s, p: RDF_TYPE, o: `${e.ns}:${e.cls}`, lit: false })
    if (e.label) triples.push({ s, p: LABEL, o: e.label, lit: true })
    for (const [p, list] of [['hasPoint', e.points], ['feeds', e.feeds], ['hasLocation', e.locations], ['hasPart', e.parts]]) {
      for (const o of list) triples.push({ s, p: `brick:${p}`, o: `ex:${o}`, lit: false })
    }
  }
  return triples
}

// ---------------------------------------------------------------- 그래프

/** triple 목록에 찾아보기 표를 붙인다. */
export function buildGraph(triples) {
  const byS = new Map()
  const byO = new Map()
  const byP = new Map()
  const push = (m, k, t) => { const l = m.get(k); if (l) l.push(t); else m.set(k, [t]) }
  for (const t of triples) {
    push(byS, t.s, t)
    push(byP, t.p, t)
    if (!t.lit) push(byO, t.o, t)
  }
  const labels = new Map()
  const classes = new Map()
  for (const t of byP.get(LABEL) ?? []) if (!labels.has(t.s)) labels.set(t.s, String(t.o))
  for (const t of byP.get(RDF_TYPE) ?? []) if (!classes.has(t.s)) classes.set(t.s, t.o)
  return { triples, byS, byO, byP, labels, classes }
}

/** 두 보기를 한 번에. text 는 TTL 원문. */
export function loadOntology(text) {
  const full = buildGraph(parseTurtle(text).triples)
  const receiver = buildGraph(receiverTriples(text))
  return { full, receiver }
}

/** "AHU-1", "ex:0MEP$...", "0MEP$..." 를 그래프의 주어로. 없으면 null. */
export function resolveId(g, ref) {
  const r = String(ref ?? '').trim()
  if (!r) return null
  if (g.byS.has(r) || g.byO.has(r)) return r
  if (g.byS.has(`ex:${r}`) || g.byO.has(`ex:${r}`)) return `ex:${r}`
  // 이름이 하나뿐이면 그것
  const hits = [...g.labels].filter(([, l]) => l === r)
  return hits.length === 1 ? hits[0][0] : null
}

/** 결과에 붙이는 짧은 꼴: { id, label, class }. 리터럴은 값 그대로. */
export function brief(g, id) {
  if (typeof id !== 'string' || !id.includes(':')) return id
  const out = { id }
  const label = g.labels.get(id)
  if (label) out.label = label
  const cls = g.classes.get(id)
  if (cls) out.class = cls
  return out
}

// ---------------------------------------------------------------- 묻기

const MAX_ROWS = 500

/**
 * triple 패턴 질의(SPARQL 의 기본 그래프 패턴만). patterns: [[s, p, o], …] — `?x` 는 변수, `a` 는 rdf:type,
 * `"글"`·수는 리터럴. filters: [{ var, contains | equals | gt | lt | in }]. 결과 rows 는 select(없으면 모든 변수)의 값.
 * 답을 바로 검증할 수 있게 질의 자체를 결과에 같이 돌려준다(쿼리 공개).
 */
export function query(g, { patterns, filters = [], select, distinct = true, limit = 50, count = false } = {}) {
  if (!Array.isArray(patterns) || !patterns.length) return { error: 'patterns 가 비었다. 예: [["?d","brick:hasLocation","?r"],["?r","rdfs:label","\\"사무실\\""]]' }
  const pats = patterns.map((p) => (Array.isArray(p) && p.length === 3 ? p.map(parseTerm) : null))
  if (pats.some((p) => !p)) return { error: '패턴은 [주어, 술어, 목적어] 세 칸이다' }
  const vars = [...new Set(pats.flat().filter((t) => t.var).map((t) => t.var))]
  const want = (select?.length ? select : vars).map((v) => String(v).replace(/^\?/, ''))
  const unknown = want.filter((v) => !vars.includes(v))
  if (unknown.length) return { error: `select 의 변수가 패턴에 없다: ${unknown.join(', ')}` }

  // 묶인 칸이 많은 패턴부터(첫 패턴이 전체를 훑지 않게)
  const order = []
  const left = pats.slice()
  const bound = new Set()
  while (left.length) {
    let best = 0
    let bestScore = -1
    left.forEach((p, i) => {
      const score = p.reduce((s, t) => s + (t.var ? (bound.has(t.var) ? 2 : 0) : 3), 0)
      if (score > bestScore) { best = i; bestScore = score }
    })
    const p = left.splice(best, 1)[0]
    for (const t of p) if (t.var) bound.add(t.var)
    order.push(p)
  }

  let rows = [{}]
  for (const [s, p, o] of order) {
    const next = []
    for (const b of rows) {
      const sv = value(s, b)
      const pv = value(p, b)
      const ov = value(o, b)
      const cand = sv !== undefined ? g.byS.get(sv) : ov !== undefined && !o.lit && typeof ov === 'string' && ov.includes(':') ? g.byO.get(ov) : pv !== undefined ? g.byP.get(pv) : g.triples
      for (const t of cand ?? []) {
        if (sv !== undefined && t.s !== sv) continue
        if (pv !== undefined && t.p !== pv) continue
        if (ov !== undefined && !sameValue(t.o, ov)) continue
        const nb = { ...b }
        if (!bindVar(nb, s, t.s) || !bindVar(nb, p, t.p) || !bindVar(nb, o, t.o)) continue
        next.push(nb)
      }
      if (next.length > 200_000) return { error: '중간 결과가 20만 줄을 넘었다. 패턴을 좁힌다(이름·클래스로 묶는다)' }
    }
    rows = next
    if (!rows.length) break
  }
  for (const f of filters ?? []) rows = rows.filter((b) => passes(b[String(f.var).replace(/^\?/, '')], f))

  let out = rows.map((b) => want.map((v) => b[v]))
  if (distinct) {
    const seen = new Set()
    out = out.filter((r) => { const k = JSON.stringify(r); if (seen.has(k)) return false; seen.add(k); return true })
  }
  const total = out.length
  if (count) return { vars: want, count: total }
  const lim = Math.min(MAX_ROWS, Math.max(1, Number(limit) || 50))
  const shown = out.slice(0, lim)
  // 행에 나온 주어의 이름·클래스를 한 번씩
  const names = {}
  for (const r of shown) for (const v of r) if (typeof v === 'string' && v.includes(':') && !names[v] && (g.labels.has(v) || g.classes.has(v))) {
    const b = brief(g, v)
    names[v] = [b.label, b.class].filter(Boolean).join(' · ')
  }
  return { vars: want, rows: shown, total, truncated: total > shown.length, names }
}

function parseTerm(raw) {
  if (typeof raw === 'number' || typeof raw === 'boolean') return { v: raw, lit: true }
  const s = String(raw).trim()
  if (s.startsWith('?')) return { var: s.slice(1) }
  if (s === 'a' || s === 'rdf:type') return { v: RDF_TYPE }
  if (/^".*"$/s.test(s)) return { v: s.slice(1, -1), lit: true }
  if (/^[+-]?\d+(\.\d+)?$/.test(s)) return { v: Number(s), lit: true }
  if (s === 'true' || s === 'false') return { v: s === 'true', lit: true }
  return { v: s.includes(':') ? s : `ex:${s}` }
}
function value(t, b) { return t.var ? b[t.var] : t.v }
function sameValue(a, b) { return a === b || (typeof a === 'number' && typeof b === 'string' && String(a) === b) }
function bindVar(b, t, v) {
  if (!t.var) return true
  if (t.var in b) return sameValue(b[t.var], v)
  b[t.var] = v
  return true
}
function passes(v, f) {
  if (f.contains != null) return String(v ?? '').toLowerCase().includes(String(f.contains).toLowerCase())
  if (f.equals != null) return String(v) === String(f.equals)
  if (f.in != null) return (Array.isArray(f.in) ? f.in : [f.in]).map(String).includes(String(v))
  if (f.gt != null) return Number(v) > Number(f.gt)
  if (f.lt != null) return Number(v) < Number(f.lt)
  return true
}

/** 이름·id 일부로 찾는다. cls 는 클래스 이름 일부(`Air_Handling`, `Office`). */
export function find(g, text, { cls, limit = 30 } = {}) {
  const q = String(text ?? '').trim().toLowerCase()
  const c = cls ? String(cls).toLowerCase() : null
  const out = []
  let total = 0
  for (const [id, klass] of g.classes) {
    if (c && !klass.toLowerCase().includes(c)) continue
    const label = g.labels.get(id) ?? ''
    if (q && !label.toLowerCase().includes(q) && !id.toLowerCase().includes(q)) continue
    total++
    if (out.length < limit) {
      const where = (g.byS.get(id) ?? []).find((t) => t.p === 'brick:hasLocation')
      out.push({ ...brief(g, id), ...(where ? { in: brief(g, where.o) } : {}) })
    }
  }
  return { total, results: out, truncated: total > out.length }
}

/** 한 주어의 모든 관계(나가는 것 · 들어오는 것). 들어오는 것은 술어마다 limit 개까지. */
export function describe(g, ref, { limit = 40, mark } = {}) {
  const id = resolveId(g, ref)
  if (!id) return { error: `${ref} 를 못 찾았다. onto_find 로 이름을 찾는다` }
  const out = {}
  for (const t of g.byS.get(id) ?? []) {
    const v = t.lit ? t.o : brief(g, t.o)
    const val = mark ? { v, receiver: mark(t) } : v
    ;(out[t.p] ??= []).push(val)
  }
  const inbound = {}
  for (const t of g.byO.get(id) ?? []) {
    const e = (inbound[t.p] ??= { count: 0, from: [] })
    e.count++
    if (e.from.length < limit) e.from.push(mark ? { v: brief(g, t.s), receiver: mark(t) } : brief(g, t.s))
  }
  return { ...brief(g, id), out, in: inbound }
}

/** 한 술어를 따라 걷는다(feeds 하류·상류, hasPart 아래). 단계마다 새로 닿은 것. */
export function walk(g, ref, predicate, { direction = 'out', depth = 4, limit = 200 } = {}) {
  const id = resolveId(g, ref)
  if (!id) return { error: `${ref} 를 못 찾았다. onto_find 로 이름을 찾는다` }
  const p = predicate === 'a' ? RDF_TYPE : String(predicate).includes(':') ? predicate : `brick:${predicate}`
  const seen = new Set([id])
  const levels = []
  let frontier = [id]
  let count = 0
  for (let d = 1; d <= Math.min(10, depth) && frontier.length && count < limit; d++) {
    const next = []
    for (const x of frontier) {
      const ts = direction === 'in' ? (g.byO.get(x) ?? []).filter((t) => t.p === p) : (g.byS.get(x) ?? []).filter((t) => t.p === p && !t.lit)
      for (const t of ts) {
        const y = direction === 'in' ? t.s : t.o
        if (seen.has(y)) continue
        seen.add(y)
        next.push(y)
      }
    }
    if (next.length) levels.push({ depth: d, nodes: next.slice(0, limit - count).map((y) => brief(g, y)), count: next.length })
    count += next.length
    frontier = next
  }
  return { from: brief(g, id), predicate: p, direction, levels, total: count }
}

/** 건물 한눈에: 트리플 수, 클래스별 수, 술어별 수, 층. */
export function overview(g) {
  const byClass = new Map()
  for (const c of g.classes.values()) byClass.set(c, (byClass.get(c) ?? 0) + 1)
  const preds = [...g.byP].map(([p, l]) => [p, l.length]).sort((a, b) => b[1] - a[1])
  const floors = [...g.classes].filter(([, c]) => c === 'brick:Floor').map(([id]) => {
    const parts = (g.byS.get(id) ?? []).filter((t) => t.p === 'brick:hasPart').length
    return { ...brief(g, id), spaces: parts }
  })
  const buildings = [...g.classes].filter(([, c]) => c === 'brick:Building').map(([id]) => brief(g, id))
  return {
    triples: g.triples.length,
    subjects: g.byS.size,
    buildings,
    floors,
    classes: Object.fromEntries([...byClass].sort((a, b) => b[1] - a[1]).slice(0, 60)),
    predicates: Object.fromEntries(preds.slice(0, 40)),
  }
}

/** 두 보기의 triple 이 같은가 — full 의 triple 이 받는 쪽에도 있으면 true. */
export function receiverMark(o) {
  const keys = new Set(o.receiver.triples.map((t) => `${t.s}|${t.p}|${t.o}`))
  return (t) => keys.has(`${t.s}|${t.p}|${t.o}`)
}
