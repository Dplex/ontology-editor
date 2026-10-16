#!/usr/bin/env node
// 시험용 가짜 gemini(/issue 챗봇). scripts/issue-chat.test.ts 가 DOCS_CHAT_GEMINI 로 넘긴다.
// 작업 폴더의 MCP 서버(issue-mcp.mjs)를 띄워 code_search 를 한 번 부르고, 그 결과를 본문에 넣은 초안 JSON 을 답한다.
// 질문에 "막연" 이 있으면 초안 대신 ask 를, "망가진" 이 있으면 JSON 이 아닌 글을 답한다.
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
    createInterface({ input: child.stdout }).on('line', (line) => {
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
    const chunk = (t) => send({ method: 'session/update', params: { sessionId: 's1', update: { sessionUpdate: 'agent_message_chunk', content: { text: t } } } })
    let answer
    if (question.includes('막연')) answer = '```json\n{"ask": "어느 화면인지 더 적어 주세요.' + (text.includes('[앞선 대화]') ? ' (앞선 대화 받음)' : '') + '"}\n```'
    else if (question.includes('망가진')) answer = '이슈를 쓸 수 없습니다.'
    else {
      send({ method: 'session/update', params: { sessionId: 's1', update: { sessionUpdate: 'tool_call', title: 'mcp_issue_code_search(query: last-edit)' } } })
      const { server, result } = await mcpCall('code_search', { query: 'last-edit' })
      const hit = JSON.parse(result.content[0].text).hits[0]
      const draft = {
        title: '1280 폭에서 마지막 편집 이름이 사라진다 (OE-UI-08)',
        body: `## 요약\nserver=${server} args=${process.argv.slice(2).join(' ')}\n${text.includes('[오늘]') ? '오늘 줄 있음' : ''}\n${/\[지금 화면\][^\n]*층 id 1F/.test(text) ? '화면 줄 있음' : ''}\n\n## 지금 상태\n- \`${hit.path}:${hit.line}\`\n\n## 할 일\n- 고친다`,
        labels: ['bug', 'enhancement', 'needs-pm', 'need-not-check'],
      }
      answer = `초안입니다.\n\`\`\`json\n${JSON.stringify(draft)}\n\`\`\``
    }
    // 두 조각으로 나눠 보낸다 — 서버가 모아서 읽는지 본다
    chunk(answer.slice(0, 10))
    chunk(answer.slice(10))
    return send({ id: m.id, result: { stopReason: 'end_turn' } })
  }
  if (m.id != null) send({ id: m.id, result: {} })
})
