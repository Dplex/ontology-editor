#!/usr/bin/env node
// 시험용 가짜 gemini(`gemini --acp` 흉내). scripts/onto-chat.test.ts 가 DOCS_CHAT_GEMINI 로 넘긴다.
// 진짜처럼 작업 폴더의 .gemini/settings.json 에서 MCP 서버를 띄우고, 질문의 첫 낱말로 그 서버의 *_find 도구를 한 번 불러
// 결과를 답으로 돌려준다. 받은 실행 인자·질문 원문도 답에 적어 시험이 정책·맥락이 넘어왔는지 본다.
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createInterface } from 'node:readline'

if (process.argv.includes('--version')) {
  console.log('0.0.0-fake')
  process.exit(0)
}
const send = (m) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...m })}\n`)

function mcpCall(name, args) {
  const settings = JSON.parse(readFileSync(join(process.cwd(), '.gemini/settings.json'), 'utf8'))
  const [server, cfg] = Object.entries(settings.mcpServers)[0]
  const child = spawn(cfg.command, cfg.args, { env: { ...process.env, ...cfg.env }, stdio: ['pipe', 'pipe', 'ignore'] })
  return new Promise((resolve) => {
    const rl = createInterface({ input: child.stdout })
    rl.on('line', (line) => {
      const m = JSON.parse(line)
      if (m.id === 2) {
        child.kill()
        resolve({ server, result: m.result })
      }
    })
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } })}\n`)
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } })}\n`)
  })
}

createInterface({ input: process.stdin }).on('line', async (line) => {
  const m = JSON.parse(line)
  if (m.method === 'initialize') return send({ id: m.id, result: { protocolVersion: 1 } })
  if (m.method === 'session/new') return send({ id: m.id, result: { sessionId: 's1' } })
  if (m.method === 'session/prompt') {
    const text = m.params.prompt[0].text
    const question = text.split('[지금 질문]\n')[1] ?? ''
    const word = question.split(/\s/)[0]
    const source = /source="([^"]+)"/.exec(text)?.[1]
    const tool = 'onto_find'
    send({ method: 'session/update', params: { sessionId: 's1', update: { sessionUpdate: 'tool_call', title: `mcp_onto_${tool}(text: ${word})` } } })
    const { server, result } = await mcpCall(tool, { text: word, ...(source ? { source } : {}) })
    const found = JSON.parse(result.content[0].text)
    const answer = `server=${server} args=${process.argv.slice(2).join(' ')}\nsource=${source ?? ''}\n` + (found.results ?? []).map((r) => `${r.label} (\`${r.id}\`) @ ${r.in?.label ?? '?'}`).join('\n')
    send({ method: 'session/update', params: { sessionId: 's1', update: { sessionUpdate: 'agent_message_chunk', content: { text: answer } } } })
    return send({ id: m.id, result: { stopReason: 'end_turn' } })
  }
  if (m.id != null) send({ id: m.id, result: {} })
})
