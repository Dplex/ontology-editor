// 줄 단위 JSON-RPC 2.0 위의 MCP 서버(stdio). SDK 없이 쓴다 — 55 는 npm 레지스트리에 닿지 않는다.
// docs-mcp.mjs·issue-mcp.mjs 가 도구 목록만 바꿔 쓴다. 로그는 stderr 로만 낸다. stdout 은 프로토콜이다.
import { createInterface } from 'node:readline'

const VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05']

export function serveMcp({ name, instructions, tools, tag = name }) {
  const TOOLS = tools

  const send = msg => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...msg })}\n`)
  const log = (...a) => process.stderr.write(`[${tag}] ${a.join(' ')}\n`)

  function handle(req) {
    const { id, method, params } = req
    if (method === 'initialize') {
      const want = params?.protocolVersion
      return {
        protocolVersion: VERSIONS.includes(want) ? want : VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name, version: '0.1.0' },
        instructions,
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
  return { log }
}
