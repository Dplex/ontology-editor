#!/usr/bin/env node
// 반영한 온톨로지(TTL)를 읽기만 하는 MCP 서버(stdio). 55 의 온톨로지 질의 챗봇(/__ask)이 gemini 에 붙인다(ADR-0050).
//
//   node scripts/onto-mcp.mjs
//   ONTO_DATA=/path/data        반영본을 찾는 곳. data/.layouts/<열쇠>/current.json 이 가리키는 vN/ontology.ttl(src/server/layouts.ts)
//   ONTO_FILES="이름=경로;…"    반영본 대신(또는 더해) 볼 TTL 파일. 반영본이 없는 PC·시험에서 쓴다
//
// 고치는 도구는 없다. 읽는 것도 위 두 곳의 TTL 뿐이다. 질의는 triple 패턴(scripts/onto-graph.mjs)이고, 같은 질의를
// 받는 쪽 DT 파서가 읽는 만큼(receiver)에도 돌려 결과 수를 같이 준다 — 우리 TTL 에만 있는 답을 가려낸다.
// MCP 는 줄 단위 JSON-RPC 2.0 이라 SDK 없이 쓴다(docs-mcp.mjs 와 같다). 로그는 stderr 로만 낸다.
import { readFileSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { describe, find, loadOntology, overview, query, receiverMark, walk } from './onto-graph.mjs'
import { sources } from './onto-sources.mjs'

const DATA = resolve(process.env.ONTO_DATA || 'data')
const VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05']

const INSTRUCTIONS = `반영한 건물 온톨로지(Brick TTL)를 읽는 도구다. 고치는 도구는 없다.
- 처음이면 onto_sources 로 어떤 건물·버전이 있는지 보고, onto_overview 로 클래스·술어·층을 본다.
- 이름으로 찾을 때는 onto_find, 한 대상의 관계는 onto_describe, 흐름·계층을 따라갈 때는 onto_walk.
- 세거나 조건으로 거를 때는 onto_query(triple 패턴). 답에 쓴 질의를 그대로 보여 줄 수 있다.
- 결과의 receiver 는 받는 쪽 DT 파서가 읽는 만큼에서의 결과다. 우리 TTL 에만 있는 답이면 그렇게 말한다.`

// ---------------------------------------------------------------- 출처

const listSources = () => sources(DATA, process.env.ONTO_FILES, process.env.ONTO_SCREENS)

const cache = new Map()
/** 출처 하나를 읽은 것(두 보기). 파일이 바뀌면 다시 읽는다. source 를 안 주면 가장 최근에 반영한 것. */
function open(source) {
  const all = listSources()
  if (!all.length) return { error: '볼 온톨로지가 없다. 아직 반영한 레이아웃이 없다(편집 화면에서 [구축하기](처음) 또는 [반영하기]). 반영 전 화면을 물으려면 [온톨로지] 칸의 건물에서 "지금 화면(반영 전)" 을 고른다' }
  // source 를 안 주면 가장 최근 반영본. 화면 기준(반영 전)은 고른 사람만 묻는다 — 다른 사람의 반영 전 화면을 답에 섞지 않는다.
  const published = all.filter((s) => !s.screen)
  // 화면 기준은 토큰(source)으로만 찾는다 — 제목(파일 이름)은 짐작할 수 있어서 남의 반영 전 화면을 읽게 된다.
  const pick = source ? all.find((s) => s.source === source || (!s.screen && s.title === source)) : published.slice().sort((a, b) => String(b.at).localeCompare(String(a.at)))[0]
  if (!source && !pick) return { error: '반영한 온톨로지가 없다(편집 화면에서 [구축하기](처음) 또는 [반영하기])' }
  // 있는 것에 화면 기준은 넣지 않는다 — 넣었더니 gemini 가 없는 건물 대신 다른 탭의 반영 전 화면으로 답했다(2026-10-13, 55 시험대).
  if (!pick) return { error: `${source} 가 없다. 있는 것: ${published.map((s) => s.source).join(', ') || '(반영본 없음)'}` }
  const mtime = statSync(pick.file).mtimeMs
  const had = cache.get(pick.file)
  if (had && had.mtime === mtime) return had
  const o = loadOntology(readFileSync(pick.file, 'utf8'))
  const entry = { ...o, mtime, info: { source: pick.source, title: pick.title, version: pick.version } }
  cache.set(pick.file, entry)
  return entry
}

const view = (o, v) => (v === 'receiver' ? o.receiver : o.full)
const SOURCE = { type: 'string', description: '건물(onto_sources 의 source, 또는 질문의 [건물] 줄이 준 screen-… ). 없으면 가장 최근에 반영한 것' }
const VIEW = { type: 'string', enum: ['full', 'receiver'], description: 'full: 우리 TTL 전부(기본). receiver: 받는 쪽 DT 파서가 읽는 만큼' }

// ---------------------------------------------------------------- 도구

const TOOLS = [
  {
    name: 'onto_sources',
    description: '볼 수 있는 건물 온톨로지(반영한 레이아웃의 현재 버전). source·제목·버전·반영 일시·반영자.',
    inputSchema: { type: 'object', properties: {} },
    // 화면 기준(반영 전)은 목록에 내지 않는다 — 질문마다 창이 고른 것만 그 질문의 [건물] 줄로 받는다.
    run: () => ({ sources: listSources().filter((s) => !s.screen).map(({ file, ...s }) => s) }),
  },
  {
    name: 'onto_overview',
    description: '건물 하나를 한눈에: 트리플·주어 수, 건물·층(층마다 물리존 수), 클래스별 개수, 술어별 개수. 클래스·술어 이름을 여기서 확인한 뒤 질의한다.',
    inputSchema: { type: 'object', properties: { source: SOURCE, view: VIEW } },
    run: (a) => {
      const o = open(a.source)
      if (o.error) return o
      return { ...o.info, view: a.view || 'full', ...overview(view(o, a.view)), receiver: { triples: o.receiver.triples.length, subjects: o.receiver.byS.size } }
    },
  },
  {
    name: 'onto_find',
    description: '이름(rdfs:label)이나 id 일부로 찾는다. cls 는 클래스 이름 일부(예: Air_Handling_Unit, Office, Floor). 결과마다 놓인 곳(hasLocation)을 같이 준다.',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string' }, cls: { type: 'string' }, limit: { type: 'number', description: '기본 30, 최대 200' }, source: SOURCE, view: VIEW },
    },
    run: (a) => {
      const o = open(a.source)
      if (o.error) return o
      return { ...o.info, ...find(view(o, a.view), a.text, { cls: a.cls, limit: Math.min(200, Math.max(1, Number(a.limit) || 30)) }) }
    },
  },
  {
    name: 'onto_describe',
    description: '대상 하나(id 나 정확한 이름)의 모든 관계 — 나가는 것(out: 술어 → 값)과 들어오는 것(in: 술어 → 개수·주어). full 보기에서는 값마다 receiver(받는 쪽에서도 읽히나)를 붙인다.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' }, source: SOURCE, view: VIEW }, required: ['id'] },
    run: (a) => {
      const o = open(a.source)
      if (o.error) return o
      const mark = a.view === 'receiver' ? undefined : (o.mark ??= receiverMark(o))
      return { ...o.info, ...describe(view(o, a.view), a.id, { mark }) }
    },
  },
  {
    name: 'onto_walk',
    description: '한 술어를 따라 단계별로 걷는다. 예: 공조기에서 brick:feeds 를 out 으로 → 하류 설비·담당 방, 설비에서 feeds 를 in 으로 → 상류, 건물에서 brick:hasPart → 층·방.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        predicate: { type: 'string', description: 'brick:feeds · brick:hasPart · brick:hasLocation 등' },
        direction: { type: 'string', enum: ['out', 'in'] },
        depth: { type: 'number', description: '기본 4, 최대 10' },
        source: SOURCE,
        view: VIEW,
      },
      required: ['id', 'predicate'],
    },
    run: (a) => {
      const o = open(a.source)
      if (o.error) return o
      return { ...o.info, ...walk(view(o, a.view), a.id, a.predicate, { direction: a.direction === 'in' ? 'in' : 'out', depth: Number(a.depth) || 4 }) }
    },
  },
  {
    name: 'onto_query',
    description:
      'triple 패턴 질의(SPARQL 의 기본 그래프 패턴). patterns 는 [[주어, 술어, 목적어], …] 이고 ?x 는 변수, a 는 클래스, "글" 은 문자열 리터럴. ' +
      '예) 사무실에 있는 설비: [["?d","brick:hasLocation","?r"],["?r","rdfs:label","\\"사무실\\""]]. ' +
      'filters 는 [{var, contains|equals|in|gt|lt}], count:true 면 수만. 같은 질의를 받는 쪽 보기에도 돌려 receiver.total 을 같이 준다.',
    inputSchema: {
      type: 'object',
      properties: {
        patterns: { type: 'array', items: { type: 'array', items: { type: 'string' } } },
        filters: { type: 'array', items: { type: 'object' } },
        select: { type: 'array', items: { type: 'string' } },
        count: { type: 'boolean' },
        limit: { type: 'number', description: '기본 50, 최대 500' },
        source: SOURCE,
      },
      required: ['patterns'],
    },
    run: (a) => {
      const o = open(a.source)
      if (o.error) return o
      const q = { patterns: a.patterns, filters: a.filters, select: a.select, count: a.count, limit: a.limit }
      const full = query(o.full, q)
      if (full.error) return full
      const recv = query(o.receiver, { ...q, count: true })
      return { ...o.info, query: { patterns: a.patterns, ...(a.filters?.length ? { filters: a.filters } : {}) }, ...full, receiver: recv.error ? { error: recv.error } : { total: recv.count } }
    },
  },
]

// ---------------------------------------------------------------- JSON-RPC

const send = (msg) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...msg })}\n`)
const log = (...a) => process.stderr.write(`[onto-mcp] ${a.join(' ')}\n`)

function handle(req) {
  const { id, method, params } = req
  if (method === 'initialize') {
    const want = params?.protocolVersion
    return {
      protocolVersion: VERSIONS.includes(want) ? want : VERSIONS[0],
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'ontology-editor-onto', version: '0.1.0' },
      instructions: INSTRUCTIONS,
    }
  }
  if (method === 'ping') return {}
  if (method === 'tools/list') return { tools: TOOLS.map(({ run, ...t }) => t) }
  if (method === 'tools/call') {
    const tool = TOOLS.find((t) => t.name === params?.name)
    if (!tool) throw Object.assign(new Error(`모르는 도구: ${params?.name}`), { code: -32602 })
    const started = Date.now()
    try {
      const out = tool.run(params.arguments || {})
      log(tool.name, JSON.stringify(params.arguments || {}), `${Date.now() - started}ms`)
      return { content: [{ type: 'text', text: JSON.stringify(out) }], isError: Boolean(out?.error) }
    } catch (e) {
      log(tool.name, 'error', e.stack || e)
      return { content: [{ type: 'text', text: `도구 오류: ${e.message}` }], isError: true }
    }
  }
  if (id === undefined) return undefined
  throw Object.assign(new Error(`모르는 메서드: ${method}`), { code: -32601 })
}

createInterface({ input: process.stdin, terminal: false }).on('line', (line) => {
  if (!line.trim()) return
  let req
  try { req = JSON.parse(line) } catch { return send({ id: null, error: { code: -32700, message: 'JSON 이 아니다' } }) }
  try {
    const result = handle(req)
    if (req.id !== undefined && result !== undefined) send({ id: req.id, result })
  } catch (e) {
    if (req.id !== undefined) send({ id: req.id, error: { code: e.code || -32603, message: e.message } })
  }
})
log(`data ${DATA}`)
