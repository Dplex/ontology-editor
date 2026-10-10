// 이 repo 의 문서(PRD·티켓·ADR·intent.md)를 섹션 단위로 색인하고 찾는다. docs-mcp.mjs 가 쓰는 순수 로직이다.
//
// 의존성이 없다 — 55 는 npm 레지스트리에 닿지 않고 node 가 22.14 라 TS 를 바로 못 돌린다(ADR-0001).
// 검색은 wiki-mcp(AI-Agent-Wiki-Template/tools/wiki-mcp)를 따른다:
//   - 한국어는 문자 2-gram. 조사가 붙어도("내력벽을") 앞쪽 bigram 이 겹쳐 잡힌다
//   - ASCII 식별자는 통 토큰. OE-BIM-12·D10·loadBearing 이 가장 정밀한 신호라 쪼개지 않는다
//   - 제목·절 제목에 든 말은 BM25 와 따로 가산한다. 모든 걸 조금씩 다루는 긴 절(PRD_011 목차)이 이기지 않게
//   - 임베딩은 쓰지 않는다. 수백 개 문서는 매번 전체를 훑어도 수십 ms 다
// 색인은 파일 mtime 이 바뀌면 통째로 다시 만든다.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

/** 색인에 넣는 곳. 경로는 repo 루트 기준. */
const SOURCES = [
  { dir: 'docs/adr', kind: 'adr', deep: false },
  { dir: 'docs/prd/features', kind: 'ticket', deep: true },
  { dir: 'docs/prd', kind: 'prd', deep: false },
  { dir: 'docs/dev', kind: 'doc', deep: false },
  { dir: 'docs', kind: 'doc', deep: false },
]
const SINGLE = [
  { path: 'intent.md', kind: 'intent' },
  { path: 'CLAUDE.md', kind: 'doc' },
]

export const KINDS = ['adr', 'ticket', 'prd', 'intent', 'doc']

const toPosix = p => p.split(sep).join('/')

function listFiles(root) {
  const out = []
  const walk = (dir, kind, deep) => {
    let names
    try { names = readdirSync(join(root, dir), { withFileTypes: true }) } catch { return }
    for (const d of names) {
      const rel = `${dir}/${d.name}`
      if (d.isDirectory()) { if (deep) walk(rel, kind, deep); continue }
      if (!d.name.endsWith('.md')) continue
      // docs/adr/README.md 는 틀 설명이라 ADR 이 아니다
      out.push({ path: rel, kind: kind === 'adr' && !/^\d{4}-/.test(d.name) ? 'doc' : kind })
    }
  }
  for (const s of SOURCES) walk(s.dir, s.kind, s.deep)
  for (const s of SINGLE) {
    try { statSync(join(root, s.path)); out.push(s) } catch { /* 없으면 건너뛴다 */ }
  }
  return out
}

// ---------------------------------------------------------------- 파싱

/** `key: value` 와 `key: ["a", "b"]` 만 읽는 frontmatter. 티켓·ADR 이 쓰는 모양이 그것뿐이다. */
export function parseFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text)
  if (!m) return { meta: {}, body: text, offset: 0 }
  const meta = {}
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z_][\w-]*):\s*(.*?)\s*(?:#.*)?$/.exec(line)
    if (!kv) continue
    let v = kv[2]
    if (v.startsWith('[')) {
      v = v.replace(/^\[|\]$/g, '').split(',').map(s => s.trim().replace(/^"|"$/g, '')).filter(Boolean)
    } else {
      v = v.replace(/^"|"$/g, '')
    }
    meta[kv[1]] = v
  }
  return { meta, body: text.slice(m[0].length), offset: m[0].split('\n').length - 1 }
}

/** 제목(#…)으로 나눈다. 코드 블록 안의 # 은 제목이 아니다. 첫 제목 앞의 글은 제목 '' 인 절이 된다. */
export function splitSections(body, lineOffset = 0) {
  const lines = body.split(/\r?\n/)
  const sections = []
  const trail = []
  let cur = { heading: '', level: 0, trail: [], line: lineOffset + 1, lines: [] }
  let fence = false
  lines.forEach((line, i) => {
    if (/^\s*(```|~~~)/.test(line)) fence = !fence
    const h = !fence && /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line)
    if (h) {
      sections.push(cur)
      const level = h[1].length
      while (trail.length && trail[trail.length - 1].level >= level) trail.pop()
      trail.push({ level, heading: h[2] })
      cur = { heading: h[2], level, trail: trail.map(t => t.heading), line: lineOffset + i + 1, lines: [] }
    } else {
      cur.lines.push(line)
    }
  })
  sections.push(cur)
  return sections
    .map(s => ({ heading: s.heading, level: s.level, trail: s.trail, line: s.line, text: s.lines.join('\n').trim() }))
    .filter(s => s.heading || s.text)
}

// ---------------------------------------------------------------- 토큰

const ASCII_ID = /[A-Za-z][A-Za-z0-9_]*(?:[-.][A-Za-z0-9_]+)*/g
const NON_ASCII_RUN = /[^\x00-\x7F\s\p{P}\p{S}]+/gu

/** 문서 쪽 토큰: ASCII 식별자는 통으로(소문자), 그 밖의 글자 덩어리는 2-gram. 한 글자 덩어리는 그대로. */
export function tokenize(text) {
  const out = []
  for (const m of text.matchAll(ASCII_ID)) {
    const t = m[0].replace(/\.+$/, '').toLowerCase()
    if (t.length < 2) continue // "0.5m" 의 m 같은 것
    out.push(t)
    // OE-BIM-12 는 통으로도, 앞머리(oe-bim)로도 잡히게 한다 — "OE-BIM 티켓들" 같은 질문
    const head = /^([a-z]+-[a-z]+)-\d+$/.exec(t)
    if (head) out.push(head[1])
  }
  for (const m of text.matchAll(NON_ASCII_RUN)) {
    const w = m[0]
    if (w.length === 1) { out.push(w); continue }
    for (let i = 0; i < w.length - 1; i++) out.push(w.slice(i, i + 2))
  }
  return out
}

// 질문에 깔려 있지만 문서를 가르지 못하는 말. 그대로 두면 이 말이 많이 든 긴 문서가 이긴다.
const STOP = new Set(['어떻게', '어떤', '어디', '어디에', '어디서', '언제', '왜', '뭐', '뭐야', '무엇', '무슨', '이유', '되는', '되나',
  '되나요', '있나', '있나요', '있어', '알려', '알려줘', '설명', '설명해', '설명해줘', '해줘', '뭔가', '정리', '정리해줘', '대해', '관련',
  '그거', '이거', '저거', '좀', '지금', '근데'])
const ENDINGS = ['에서는', '으로는', '에서', '으로', '에는', '이야', '이란', '이라', '해줘', '나요', '까요', '은', '는', '이', '가', '을',
  '를', '에', '로', '의', '도', '와', '과', '야', '나', '까', '요']

/** 질문 쪽 토큰. 의문사를 빼고 한국어 낱말 끝의 조사·어미를 한 번 떼고 나서 tokenize 한다. */
export function queryTokens(query) {
  const words = query.split(/\s+/).filter(Boolean).map(w => w.replace(/[?!.,~]+$/, ''))
  const kept = []
  for (let w of words) {
    if (STOP.has(w)) continue
    if (/[^\x00-\x7F]/.test(w) && !/[A-Za-z0-9]/.test(w)) {
      for (const e of ENDINGS) {
        if (w.length - e.length >= 2 && w.endsWith(e)) { w = w.slice(0, -e.length); break }
      }
      if (STOP.has(w)) continue
    }
    kept.push(w)
  }
  return [...new Set(tokenize(kept.join(' ')))]
}

// ---------------------------------------------------------------- 색인

/**
 * @typedef {{ path: string, kind: string, id: string, title: string, meta: Record<string, any>,
 *   sections: { heading: string, level: number, trail: string[], line: number, text: string }[] }} Doc
 */

function loadDoc(root, f) {
  const raw = readFileSync(join(root, f.path), 'utf8')
  const { meta, body, offset } = parseFrontmatter(raw)
  const sections = splitSections(body, offset)
  const h1 = sections.find(s => s.level === 1)?.heading
  const title = meta.title || h1 || f.path
  const id = meta.id || (f.kind === 'adr' ? `ADR-${f.path.match(/(\d{4})-/)[1]}` : f.path)
  return { path: f.path, kind: f.kind, id, title, meta, sections }
}

export function buildIndex(root) {
  const files = listFiles(root)
  const docs = files.map(f => loadDoc(root, f))
  const units = []
  for (const doc of docs) {
    const titleTokens = new Set(tokenize(`${doc.id} ${doc.title}`))
    doc.sections.forEach((s, i) => {
      const tokens = tokenize(`${s.heading}\n${s.text}`)
      const tf = new Map()
      for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1)
      units.push({ doc, i, len: tokens.length, tf, headTokens: new Set(tokenize(s.trail.join(' '))), titleTokens })
    })
  }
  const df = new Map()
  for (const u of units) for (const t of u.tf.keys()) df.set(t, (df.get(t) || 0) + 1)
  const avgLen = units.reduce((a, u) => a + u.len, 0) / Math.max(1, units.length)
  return { root, docs, units, df, avgLen, byPath: new Map(docs.map(d => [d.path, d])), byId: new Map(docs.map(d => [d.id.toUpperCase(), d])) }
}

/** 파일 목록·mtime 이 같으면 지난 색인을 그대로 쓴다. */
export function freshIndex(root, prev) {
  const files = listFiles(root)
  const sig = files.map(f => `${f.path}:${statSync(join(root, f.path)).mtimeMs}`).join('|')
  if (prev && prev.sig === sig) return prev
  const idx = buildIndex(root)
  idx.sig = sig
  return idx
}

// ---------------------------------------------------------------- 검색

const K1 = 1.2
const B = 0.75

/** 걸린 줄 하나를 보여 준다. 질의 토큰이 가장 많이 든 줄. */
function snippet(text, qt) {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  let best = lines[0] || ''
  let bestHits = 0
  for (const l of lines) {
    const lt = new Set(tokenize(l))
    const hits = qt.filter(t => lt.has(t)).length
    if (hits > bestHits) { best = l; bestHits = hits }
  }
  return best.length > 220 ? `${best.slice(0, 220)}…` : best
}

function definesId(text, id) {
  const esc = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`^\\s*(?:\\|\\s*|[-*]\\s+)?\\**${esc}\\**\\s*(?:\\||:|\\.|\\s—|\\s-\\s)`, 'im').test(text)
}

/**
 * @param {ReturnType<typeof buildIndex>} idx
 * @param {string} query
 * @param {{ kind?: string, limit?: number }} [opt]
 */
export function search(idx, query, opt = {}) {
  const qt = queryTokens(query)
  if (!qt.length) return { tokens: [], results: [] }
  const N = idx.units.length
  const idf = t => { const n = idx.df.get(t) || 0; return Math.log(1 + (N - n + 0.5) / (n + 0.5)) }
  const ids = qt.filter(t => /^[a-z]+-[a-z]+-\d+$|^(adr-\d{4}|[dq]\d+)$/.test(t))
  const scored = []
  for (const u of idx.units) {
    if (opt.kind && u.doc.kind !== opt.kind) continue
    let s = 0
    for (const t of qt) {
      const f = u.tf.get(t)
      if (!f) continue
      s += idf(t) * (f * (K1 + 1)) / (f + K1 * (1 - B + B * u.len / idx.avgLen))
    }
    // 제목·절 제목 가산 — 길이 정규화와 무관하게
    for (const t of qt) {
      if (u.titleTokens.has(t)) s += 0.6 * idf(t)
      if (u.headTokens.has(t)) s += 0.4 * idf(t)
    }
    // 식별자로 물으면 그 문서 자체가 먼저고, 그다음이 그 식별자를 정의하는 줄(결정표의 "| D10 |" 행, "- D10:" 항목)이 든 절이다.
    // 언급만 하는 절은 많고 정의하는 절은 하나라, 긴 결정표 절이 길이 정규화로 밀리지 않게 한다.
    for (const t of ids) {
      if (u.doc.id.toLowerCase() === t) s += 10
      else if (u.tf.has(t) && definesId(u.doc.sections[u.i].text, t)) s += 6
    }
    if (s > 0) scored.push({ u, s })
  }
  scored.sort((a, b) => b.s - a.s)
  const limit = opt.limit ?? 8
  const perDoc = new Map()
  const results = []
  for (const { u, s } of scored) {
    const n = perDoc.get(u.doc.path) || 0
    if (n >= 2) continue // 한 문서가 결과를 다 먹지 않게
    perDoc.set(u.doc.path, n + 1)
    const sec = u.doc.sections[u.i]
    results.push({
      path: u.doc.path, kind: u.doc.kind, id: u.doc.id, title: u.doc.title,
      section: sec.trail.join(' > ') || '(머리)', line: sec.line, score: Math.round(s * 100) / 100,
      ...(u.doc.meta.status ? { status: u.doc.meta.status } : {}),
      snippet: snippet(`${sec.heading}\n${sec.text}`, qt),
    })
    if (results.length >= limit) break
  }
  return { tokens: qt, results }
}

// ---------------------------------------------------------------- 읽기·링크

/** 경로나 id(OE-BIM-12, ADR-0001)로 문서를 찾는다. 색인 밖의 경로는 없는 것으로 친다 — 아무 파일이나 읽히지 않게. */
export function findDoc(idx, ref) {
  const r = String(ref || '').trim().replace(/^\.?\//, '').replace(/\\/g, '/')
  return idx.byPath.get(r) || idx.byId.get(r.toUpperCase()) || null
}

/**
 * 문서를 읽는다. section 이 있으면 제목에 그 말이 든 절(과 그 아래 절)만, 없으면 전체를 max_chars 까지.
 * 항상 목차(outline)를 같이 줘서 다음에 어느 절을 읽을지 고르게 한다.
 */
export function read(idx, ref, section, maxChars = 6000) {
  const doc = findDoc(idx, ref)
  if (!doc) return null
  const outline = doc.sections.filter(s => s.level).map(s => `${'  '.repeat(s.level - 1)}${s.heading} (L${s.line})`)
  let picked = doc.sections
  if (section) {
    const want = section.toLowerCase()
    // 이름이 딱 맞는 절이 먼저다 — OE-BIM-21 "BIM 수용 기준선 게이트" 의 제목(#)이 "## 수용 기준" 보다 먼저 걸리지 않게
    const exact = doc.sections.findIndex(s => s.heading.toLowerCase() === want)
    const at = exact >= 0 ? exact : doc.sections.findIndex(s => s.heading.toLowerCase().includes(want))
    if (at < 0) return { path: doc.path, id: doc.id, title: doc.title, meta: doc.meta, outline, error: `"${section}" 이 든 절이 없다. outline 에서 고른다` }
    const lv = doc.sections[at].level
    let end = at + 1
    while (end < doc.sections.length && (doc.sections[end].level === 0 || doc.sections[end].level > lv)) end++
    picked = doc.sections.slice(at, end)
  }
  let text = picked.map(s => (s.level ? `${'#'.repeat(s.level)} ${s.heading}\n\n` : '') + s.text).join('\n\n')
  const truncated = text.length > maxChars
  if (truncated) text = `${text.slice(0, maxChars)}\n…(잘림 — section 으로 좁혀 읽는다)`
  return { path: doc.path, kind: doc.kind, id: doc.id, title: doc.title, meta: doc.meta, line: picked[0]?.line, outline, text, truncated }
}

/** OE-BIM-12 · ADR-0001 · D10 · Q3 가 어디서 언급되나. frontmatter(depends·tickets·prd)도 본다. */
export function links(idx, ref, limit = 60) {
  const r = String(ref || '').trim()
  if (!r) return []
  const re = new RegExp(`(?<![A-Za-z0-9-])${r.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![0-9A-Za-z-]|-\\d)`, 'i')
  const out = []
  for (const doc of idx.docs) {
    if (doc.id.toLowerCase() === r.toLowerCase()) continue
    for (const [k, v] of Object.entries(doc.meta)) {
      if ((Array.isArray(v) ? v : [v]).some(x => re.test(String(x)))) {
        out.push({ path: doc.path, id: doc.id, title: doc.title, where: `frontmatter ${k}`, text: `${k}: ${Array.isArray(v) ? v.join(', ') : v}` })
      }
    }
    for (const s of doc.sections) {
      const lines = s.text.split('\n')
      lines.forEach((l, i) => {
        if (!re.test(l)) return
        out.push({ path: doc.path, id: doc.id, title: doc.title, where: s.trail.join(' > ') || '(머리)', line: s.line + 1 + i, text: l.trim().slice(0, 200) })
      })
      if (s.heading && re.test(s.heading)) out.push({ path: doc.path, id: doc.id, title: doc.title, where: s.trail.join(' > '), line: s.line, text: s.heading })
    }
    if (out.length >= limit) break
  }
  // 언급한 문서가 티켓·ADR 이면 상태를 같이 준다 — 언급처마다 docs_ticket 을 다시 부르지 않게
  return out.slice(0, limit).map(x => {
    const m = idx.byPath.get(x.path)?.meta || {}
    return { ...x, ...(m.status ? { status: m.status } : {}), ...(m.blocked_by?.length ? { blocked_by: m.blocked_by } : {}) }
  })
}

/** 처음 한 번 보는 지도: 무엇이 몇 개 있고 ADR·에픽은 무엇인가. */
export function map(idx) {
  const count = {}
  for (const d of idx.docs) count[d.kind] = (count[d.kind] || 0) + 1
  const adrs = idx.docs.filter(d => d.kind === 'adr').sort((a, b) => a.id.localeCompare(b.id))
    .map(d => ({ id: d.id, title: d.title, status: d.meta.status || '', path: d.path }))
  const epics = new Map()
  for (const d of idx.docs.filter(d => d.kind === 'ticket')) {
    const key = d.meta.epic || '?'
    const e = epics.get(key) || { epic: key, title: d.meta.epic_title || '', tickets: 0, status: {} }
    e.tickets++
    const st = d.meta.status || '?'
    e.status[st] = (e.status[st] || 0) + 1
    epics.set(key, e)
  }
  const prd = idx.byPath.get('docs/prd/PRD_011.md')
  return {
    count,
    adrs,
    epics: [...epics.values()].sort((a, b) => a.epic.localeCompare(b.epic)),
    prd_outline: prd ? prd.sections.filter(s => s.level === 2).map(s => s.heading) : [],
    other: idx.docs.filter(d => d.kind !== 'ticket' && d.kind !== 'adr').map(d => ({ path: d.path, kind: d.kind, title: d.title })),
  }
}

// ---------------------------------------------------------------- 정의·맥락
//
// 개발하는 LLM 이 티켓 하나를 따라갈 때 읽는 글을 줄이려고 둔다(ADR-0048). 2026-10-10 에 지난 세션 83개를 쟀더니 가장 많이 연 문서가
// docs/bim-to-dt-ontology.md(113KB)였다 — 티켓 depends 의 R11 같은 번호가 어디 정의됐는지 몰라 grep 113번 · 통째 읽기 17번.
// 번호는 늘 "첫 칸이 그 번호인 표의 줄" 에 정의되니(R·F·E 는 개발 정본, K·S 는 PRD_011, D·Q·U·P 는 questions.md) 그 줄과 표 머리만 준다.

const DEF_FIRST = ['docs/prd/questions.md', 'docs/prd/PRD_011.md', 'docs/bim-to-dt-ontology.md', 'docs/prd/glossary.md']
const cellText = c => c.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*`]/g, '').trim()
const rawLines = (root, path) => readFileSync(join(root, path), 'utf8').replace(/\r\n/g, '\n').split('\n')

/** R11 · K3 · D10 · F9 · E1 이 정의된 표의 줄(첫 칸이 그 번호). 머리 줄을 같이 줘서 칸이 무엇인지 알게 한다. */
export function define(idx, ref, limit = 2) {
  const r = String(ref || '').trim().toUpperCase()
  if (!/^[A-Z]{1,2}\d+$|^D-[A-Z]+$/.test(r)) return []
  const docs = idx.docs.filter(d => d.kind === 'prd' || d.kind === 'doc' || d.kind === 'intent')
    .sort((a, b) => ((DEF_FIRST.indexOf(a.path) + 1) || 99) - ((DEF_FIRST.indexOf(b.path) + 1) || 99))
  const out = []
  for (const doc of docs) {
    if (!doc.sections.some(s => s.text.toUpperCase().includes(r))) continue
    const lines = rawLines(idx.root, doc.path)
    for (let i = 0; i < lines.length && out.length < limit; i++) {
      if (!lines[i].startsWith('|')) continue
      const cells = lines[i].split('|').slice(1, -1)
      if (!cells.length || cellText(cells[0]).toUpperCase() !== r) continue
      let start = i
      while (start > 0 && lines[start - 1].startsWith('|')) start--
      const header = start < i && /^\|[\s:|-]+\|$/.test(lines[start + 1] || '') ? lines[start] : ''
      const sec = [...doc.sections].reverse().find(s => s.line <= i + 1)
      out.push({ ref: r, path: doc.path, line: i + 1, where: sec ? sec.trail.join(' > ') : '', header, row: lines[i] })
    }
    if (out.length >= limit) break
  }
  return out
}

/** 티켓 md 의 "## 이름" 절 본문. */
function section(doc, name) {
  return doc.sections.find(s => s.level === 2 && s.heading === name)?.text ?? ''
}

const AC_LABEL = /^\*{0,2}AC(\d+)\*{0,2}[.:)]?\s+/
/**
 * 수용 기준 절을 기준 목록으로 — scripts/ac-coverage.ts 의 parseCriteria 와 같은 규칙이다(같은지는 docs-mcp.test.ts 가 본다).
 * 글머리표가 `AC3` 으로 시작하면 그 번호, 아니면 순서로 센다.
 */
export function parseCriteria(text) {
  const lines = String(text).split('\n').map(l => l.trim()).filter(Boolean)
  const bullets = lines.filter(l => l.startsWith('- '))
  const items = (bullets.length ? bullets.map(l => l.slice(2).trim()) : lines).filter(l => l !== '—' && !/결정 후 적는다\.?$/.test(l))
  const labeled = items.some(l => AC_LABEL.test(l))
  return items.map((l, i) => {
    const m = labeled ? AC_LABEL.exec(l) : null
    const t = m ? l.slice(m[0].length) : l
    return { index: m ? Number(m[1]) : i + 1, text: t, delegatedTo: /^(OE-[A-Z0-9]+-\d+)\s*(?:의 수용 기준을 따른다|[과와] 같다)/.exec(t)?.[1] ?? null }
  })
}

// 코드 쪽. 55 의 챗봇 디렉터리에 src 가 없으면 빈 목록이다.
const CODE_DIRS = ['src', 'e2e', 'e2e-seongsu', 'scripts']
const TAG = /\[(OE-[A-Z0-9]+-\d+)#([\d,~\s]+)\]/g
const TEST_TITLE = /\b(?:it|test)(?:\.skip|\.only|\.skipIf\([^)]*\))?\(\s*(['"`])((?:\\.|(?!\1).)*)\1/
const isTest = p => /\.(test|spec)\.ts$/.test(p)

function codeFiles(root) {
  const out = []
  const walk = dir => {
    let names
    try { names = readdirSync(join(root, dir), { withFileTypes: true }) } catch { return }
    for (const d of names) {
      const rel = `${dir}/${d.name}`
      if (d.isDirectory()) { if (d.name !== 'node_modules') walk(rel) } else if (/\.(ts|vue|mjs|js)$/.test(d.name)) out.push(rel)
    }
  }
  for (const d of CODE_DIRS) walk(d)
  return out
}

/** 코드 파일과 시험의 수용 기준 태그. 파일 목록·mtime 이 같으면 지난 것을 쓴다. */
let codeCache = null
function code(root) {
  const files = codeFiles(root)
  const sig = files.map(f => `${f}:${statSync(join(root, f)).mtimeMs}`).join('|')
  if (codeCache && codeCache.root === root && codeCache.sig === sig) return codeCache
  const text = new Map(files.map(f => [f, readFileSync(join(root, f), 'utf8').replace(/\r\n/g, '\n')]))
  const tags = []
  for (const [file, t] of text) {
    if (!isTest(file)) continue
    let current = ''
    t.split('\n').forEach((line, i) => {
      const title = TEST_TITLE.exec(line)
      if (title) current = title[2]
      for (const m of line.matchAll(TAG)) {
        for (const tok of m[2].split(',').map(x => x.trim()).filter(Boolean)) {
          const n = Number(tok.replace(/~$/, ''))
          if (Number.isFinite(n)) tags.push({ ticket: m[1], index: n, partial: tok.endsWith('~'), file, line: i + 1, test: current })
        }
      }
    })
  }
  codeCache = { root, sig, text, tags }
  return codeCache
}

/** 그 id 를 적은 코드 파일(시험 제외)과 횟수. */
function codeMentions(root, id) {
  const re = new RegExp(`(?<![A-Za-z0-9-])${id}(?![0-9])`, 'g')
  const out = []
  for (const [file, t] of code(root).text) {
    if (isTest(file) || file.startsWith('scripts/docs-')) continue // 쓰는 법 예시에 든 id 는 빼고
    const n = (t.match(re) || []).length
    if (n) out.push({ file, count: n })
  }
  return out.sort((a, b) => b.count - a.count)
}

const brief = d => ({ id: d.id, title: d.title, ...(d.meta.status ? { status: d.meta.status } : {}), path: d.path })
const metaList = v => (Array.isArray(v) ? v : v ? [v] : [])

/** depends·blocked_by 의 번호 하나: 티켓·ADR 이면 제목·상태, 에픽 머리(OE-ZON)면 에픽, R·K·D 같은 번호면 정의 줄. */
function resolveRef(idx, ref) {
  const d = findDoc(idx, ref)
  if (d) return brief(d)
  const epic = idx.docs.find(x => x.kind === 'ticket' && x.id.startsWith(`${ref}-`))
  if (epic) return { id: ref, title: `${epic.meta.epic} ${epic.meta.epic_title} (에픽 전체)`, path: epic.path.replace(/[^/]+$/, 'README.md') }
  const def = define(idx, ref, 1)[0]
  return def ? { id: ref, path: def.path, line: def.line, where: def.where, header: def.header, row: def.row } : { id: ref, error: '정의를 못 찾음' }
}

/** 이 번호를 머리 필드(depends·blocked_by·tickets·criteria·prd)에 적은 티켓·ADR. */
function usedBy(idx, ref) {
  const r = String(ref).toUpperCase()
  return idx.docs.filter(d => (d.kind === 'ticket' || d.kind === 'adr') && d.id.toUpperCase() !== r &&
    ['depends', 'blocked_by', 'tickets', 'criteria', 'prd'].some(k => metaList(d.meta[k]).some(v =>
      String(v).toUpperCase().split(/[\s#]/).includes(r))))
    .map(brief)
}

/**
 * 티켓·ADR·번호 하나로 개발에 드는 맥락을 한 번에. 티켓이면 요구사항 · 기준별 시험 · depends 의 정의 줄 · 이 티켓을 다룬 ADR ·
 * 코드 · 이 티켓을 depends 로 가리키는 티켓. ADR 이면 본문 · 티켓 제목 · 코드. R·K·D 같은 번호면 정의 줄과 쓰는 티켓·ADR.
 */
export function context(idx, ref) {
  const doc = findDoc(idx, ref)
  const root = idx.root
  if (!doc) {
    const defs = define(idx, ref)
    return defs.length ? { kind: 'ref', id: String(ref).trim().toUpperCase(), defs, used_by: usedBy(idx, ref) } : null
  }
  const m = doc.meta
  if (doc.kind === 'ticket') {
    const tags = code(root).tags.filter(g => g.ticket === doc.id)
    const criteria = parseCriteria(section(doc, '수용 기준')).map(c => ({
      ...c, tests: tags.filter(g => g.index === c.index).map(({ file, line, test, partial }) => ({ file, line, test, partial })),
    }))
    const own = s => { const t = section(doc, s); return t && t !== '—' ? t : undefined }
    return {
      kind: 'ticket', id: doc.id, title: doc.title, path: doc.path,
      status: m.status, release: m.release, priority: m.priority, prd: m.prd,
      requirement: section(doc, '요구사항'),
      criteria,
      depends: metaList(m.depends).map(r => resolveRef(idx, r)),
      blocked_by: metaList(m.blocked_by).map(r => resolveRef(idx, r)),
      adrs: idx.docs.filter(d => d.kind === 'adr' && [...metaList(d.meta.tickets), ...metaList(d.meta.criteria)]
        .some(v => String(v).split('#')[0] === doc.id)).map(brief),
      code: codeMentions(root, doc.id),
      depended_by: idx.docs.filter(d => d.kind === 'ticket' && metaList(d.meta.depends).includes(doc.id)).map(brief),
      // 두 절은 개발이 쓰던 절인데 2026-10-07 부터 개발이 PRD 를 고치지 않아 그 뒤 시험과 맞지 않을 수 있다. 기준별 시험은 criteria 가 지금 것이다
      frozen_since_1007: own('검증 (이 repo)') || own('메모') ? { verify: own('검증 (이 repo)'), memo: own('메모') } : undefined,
    }
  }
  if (doc.kind === 'adr') {
    return {
      kind: 'adr', id: doc.id, title: doc.title, path: doc.path, status: m.status, date: m.date,
      tickets: metaList(m.tickets).map(r => resolveRef(idx, r)),
      criteria: metaList(m.criteria), code_files: metaList(m.code), test_files: metaList(m.tests),
      related: [...metaList(m.supersedes), ...metaList(m.superseded_by), ...metaList(m.related)]
        .map(r => resolveRef(idx, String(r).split(' ')[0])),
      text: doc.sections.filter(s => s.level >= 2).map(s => `## ${s.heading}\n\n${s.text}`).join('\n\n'),
      code: codeMentions(root, doc.id),
    }
  }
  return null
}
