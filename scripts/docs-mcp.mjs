#!/usr/bin/env node
// 이 repo 의 문서(PRD·티켓·ADR·intent.md)를 읽기만 하는 MCP 서버(stdio). 55 의 문서 챗봇이 gemini 에 붙인다(ADR-0001).
//
//   node scripts/docs-mcp.mjs              repo 루트는 이 파일의 한 칸 위
//   DOCS_ROOT=/path node scripts/docs-mcp.mjs
//
// MCP 는 줄 단위 JSON-RPC 2.0 이라 SDK 없이 쓴다 — 55 는 npm 레지스트리에 닿지 않는다.
// **문서를 고치는 도구는 없다.** 읽을 수 있는 것도 색인에 든 md 뿐이다(경로를 받아도 색인 밖이면 없는 것으로 친다).
// 로그는 stderr 로만 낸다. stdout 은 프로토콜이다.
import { createInterface } from 'node:readline'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { KINDS, findDoc, freshIndex, links, map, read, search } from './docs-index.mjs'

const ROOT = resolve(process.env.DOCS_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), '..'))
const VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05']

const INSTRUCTIONS = `ontology-editor(BIM → DT 공간 온톨로지 PoC) repo 의 문서를 읽는 도구다. 고치는 도구는 없다.
- 처음이면 docs_map 으로 무엇이 있는지 본다.
- 질문은 docs_search 로 찾고, 걸린 절을 docs_read(path, section) 로 읽어 근거를 확인한 뒤 답한다. 검색 snippet 만으로 답하지 않는다.
- OE-XXX-nn(티켓), ADR-nnnn, D10·Q3(PRD 결정·오픈 이슈)는 docs_ticket·docs_links 로 정의와 언급처를 같이 본다.
- 문서 종류: adr(왜 그렇게 만들었나), ticket(기능 요구·수용 기준·검증), prd(PRD_011 본문·열린 결정 questions.md·용어집), intent(바꾸면 안 되는 설계 의도), doc(작업 규칙 CLAUDE.md 등).`

let index = null
const idx = () => (index = freshIndex(ROOT, index))

const TOOLS = [
  {
    name: 'docs_map',
    description: '문서 지도. 종류별 개수, ADR 목록(번호·제목·상태), 에픽별 티켓 수·상태, PRD_011 목차, 그 밖의 문서. 처음 한 번 부른다.',
    inputSchema: { type: 'object', properties: {} },
    run: () => map(idx()),
  },
  {
    name: 'docs_search',
    description: '문서를 절 단위로 찾는다(한국어 부분일치 + OE-BIM-12·D10·loadBearing 같은 식별자). 결과의 path·section 을 docs_read 로 읽는다.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '찾을 말. 질문 문장 그대로도 된다' },
        kind: { type: 'string', enum: KINDS, description: '종류로 좁힌다(없으면 전부)' },
        limit: { type: 'number', description: '결과 수(기본 8, 최대 20)' },
      },
      required: ['query'],
    },
    run: a => search(idx(), String(a.query || ''), { kind: a.kind, limit: Math.min(20, Math.max(1, Number(a.limit) || 8)) }),
  },
  {
    name: 'docs_read',
    description: '문서를 읽는다. path 는 docs_search 결과의 path 나 OE-BIM-12·ADR-0001 같은 id. section 을 주면 제목에 그 말이 든 절과 그 하위 절만 읽는다. 항상 목차(outline)를 같이 준다.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        section: { type: 'string', description: '절 제목의 일부(예: "수용 기준", "1.7")' },
        max_chars: { type: 'number', description: '최대 글자 수(기본 6000, 최대 20000)' },
      },
      required: ['path'],
    },
    run: a => read(idx(), a.path, a.section, Math.min(20000, Math.max(500, Number(a.max_chars) || 6000))) ?? { error: `${a.path} 는 색인에 없다. docs_search 로 찾는다` },
  },
  {
    name: 'docs_ticket',
    description: '티켓(OE-XXX-nn)이나 ADR(ADR-nnnn) 하나를 통째로: frontmatter(상태·의존·막힘), 본문, 그리고 다른 문서에서 이것을 언급한 곳.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    run: a => {
      const i = idx()
      const doc = findDoc(i, a.id)
      if (!doc) return { error: `${a.id} 가 없다. docs_search 로 찾는다` }
      return { ...read(i, doc.path, undefined, 12000), mentioned_in: links(i, doc.id, 40) }
    },
  },
  {
    name: 'docs_links',
    description: 'OE-BIM-12 · ADR-0001 · D10 · Q3 같은 식별자가 어느 문서의 어느 절, 몇째 줄에서 언급되나(frontmatter 의 depends·blocked_by·tickets·prd 포함).',
    inputSchema: { type: 'object', properties: { ref: { type: 'string' } }, required: ['ref'] },
    run: a => ({ ref: a.ref, mentions: links(idx(), a.ref) }),
  },
]

// ---------------------------------------------------------------- JSON-RPC

const send = msg => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...msg })}\n`)
const log = (...a) => process.stderr.write(`[docs-mcp] ${a.join(' ')}\n`)

function handle(req) {
  const { id, method, params } = req
  if (method === 'initialize') {
    const want = params?.protocolVersion
    return {
      protocolVersion: VERSIONS.includes(want) ? want : VERSIONS[0],
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'ontology-editor-docs', version: '0.1.0' },
      instructions: INSTRUCTIONS,
    }
  }
  if (method === 'ping') return {}
  if (method === 'tools/list') return { tools: TOOLS.map(({ run, ...t }) => t) }
  if (method === 'tools/call') {
    const tool = TOOLS.find(t => t.name === params?.name)
    if (!tool) throw Object.assign(new Error(`모르는 도구: ${params?.name}`), { code: -32602 })
    const started = Date.now()
    try {
      const out = tool.run(params.arguments || {})
      log(tool.name, JSON.stringify(params.arguments || {}), `${Date.now() - started}ms`)
      return { content: [{ type: 'text', text: JSON.stringify(out, null, 1) }], isError: Boolean(out?.error) }
    } catch (e) {
      log(tool.name, 'error', e.stack || e)
      return { content: [{ type: 'text', text: `도구 오류: ${e.message}` }], isError: true }
    }
  }
  if (id === undefined) return undefined // 알림(notifications/*)엔 답하지 않는다
  throw Object.assign(new Error(`모르는 메서드: ${method}`), { code: -32601 })
}

createInterface({ input: process.stdin, terminal: false }).on('line', line => {
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
log(`root ${ROOT}`)
