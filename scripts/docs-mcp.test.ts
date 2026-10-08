// 문서 챗봇의 MCP 서버(ADR-0001). 입력은 이 repo 의 실제 문서다 — 문서가 바뀌면 검색 1위가 움직일 수 있으니,
// 여기서 박아 두는 것은 "그 질문이면 그 문서가 위에 와야 한다" 가 분명한 것만이다.
import { spawn } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
// @ts-expect-error — 의존성 없는 node 모듈(.mjs)이라 타입이 없다
import { buildIndex, links, map, queryTokens, read, search, tokenize } from './docs-index.mjs'

const ROOT = resolve(__dirname, '..')
const idx = buildIndex(ROOT)
const top = (q: string, kind?: string): string[] => search(idx, q, { kind, limit: 5 }).results.map((r: { path: string }) => r.path)

describe('토큰', () => {
  it('한국어는 2-gram, 식별자는 통으로 — 조사가 붙어도 겹친다', () => {
    expect(tokenize('내력벽을')).toEqual(['내력', '력벽', '벽을'])
    expect(tokenize('OE-BIM-12 loadBearing')).toEqual(['oe-bim-12', 'oe-bim', 'loadbearing'])
    expect(tokenize('0.5m')).toEqual([]) // 한 글자 ASCII 는 잡음
  })
  it('질문의 의문사·어미는 뺀다', () => {
    expect(queryTokens('배치점 보정은 왜 필요해?')).not.toContain('왜')
    expect(queryTokens('내력벽은 어떻게 돼')).toEqual(['내력', '력벽', '돼'])
  })
})

describe('색인', () => {
  it('PRD·티켓·ADR·intent 가 다 들어 있다', () => {
    const m = map(idx)
    expect(m.count.ticket).toBeGreaterThan(200)
    expect(m.count.prd).toBeGreaterThanOrEqual(3)
    expect(m.count.intent).toBe(1)
    expect(m.adrs[0]).toMatchObject({ id: 'ADR-0001', status: '채택' })
    expect(m.prd_outline.some((h: string) => h.startsWith('4. 결정 사항'))).toBe(true)
  })
})

describe('검색', () => {
  it('티켓 id 로 물으면 그 티켓이 1위', () => {
    expect(top('OE-BIM-12')[0]).toBe('docs/prd/features/E05-BIM/OE-BIM-12.md')
  })
  it('D10 은 결정표의 정의 행이 1위 — 언급만 하는 곳보다 위', () => {
    const r = search(idx, 'D10 개발 주체', { limit: 3 }).results[0]
    expect(r.path).toBe('docs/prd/questions.md')
    expect(r.snippet).toMatch(/^\| D10 \|/)
  })
  it('한국어 질문 — 내력벽 모름', () => {
    expect(top('내력벽 정보가 없으면 편집 어떻게 돼?').slice(0, 2)).toContain('docs/prd/features/E02-OBJ/OE-OBJ-06.md')
  })
  it('kind 로 좁힌다', () => {
    expect(top('읽기 전용', 'adr').every(p => p.startsWith('docs/adr/'))).toBe(true)
  })
})

describe('읽기는 색인 안에서만', () => {
  it('색인 밖 경로는 없는 것', () => {
    expect(read(idx, '../package.json')).toBeNull()
    expect(read(idx, 'package.json')).toBeNull()
    expect(read(idx, 'src/main.ts')).toBeNull()
    expect(read(idx, 'docs/prd/../../package.json')).toBeNull()
  })
  it('id 로도 읽고, section 으로 좁힌다', () => {
    const r = read(idx, 'oe-bim-12', '수용 기준')
    expect(r.path).toBe('docs/prd/features/E05-BIM/OE-BIM-12.md')
    expect(r.text.startsWith('## 수용 기준')).toBe(true)
    expect(r.text).not.toContain('## 요구사항')
  })
  it('없는 절이면 목차를 주고 고르게 한다', () => {
    const r = read(idx, 'OE-BIM-12', '없는 절 이름')
    expect(r.error).toBeTruthy()
    expect(r.outline.length).toBeGreaterThan(2)
  })
})

describe('링크', () => {
  it('frontmatter 의 blocked_by 도 언급으로 센다', () => {
    // 어느 결정이 막고 있는지는 기획이 바꾼다(2026-10-06 D10 이 전부 빠졌다). 지금 티켓에 걸린 것 하나로 본다.
    const blocker = readdirSync(resolve(ROOT, 'docs/prd/features'), { recursive: true, encoding: 'utf8' })
      .filter(f => f.endsWith('.md'))
      .map(f => /^blocked_by: \["([^"]+)"/m.exec(readFileSync(resolve(ROOT, 'docs/prd/features', f), 'utf8'))?.[1])
      .find(Boolean)
    expect(blocker).toBeTruthy()
    const l = links(idx, blocker)
    expect(l.some((x: { where: string }) => x.where.startsWith('frontmatter'))).toBe(true)
  })
  it('OE-BIM-1 은 OE-BIM-12 를 언급으로 치지 않는다', () => {
    expect(links(idx, 'OE-BIM-1').every((x: { text: string }) => !/OE-BIM-1\d/.test(x.text) || /OE-BIM-1(?!\d)/.test(x.text))).toBe(true)
  })
})

describe('MCP 프로토콜 (stdio)', () => {
  it('initialize → tools/list → tools/call 왕복, 쓰는 도구는 없다', async () => {
    const p = spawn(process.execPath, [resolve(ROOT, 'scripts/docs-mcp.mjs')], { stdio: ['pipe', 'pipe', 'ignore'] })
    const replies: Record<number, any> = {}
    let buf = ''
    p.stdout.on('data', d => {
      buf += d
      let nl
      while ((nl = buf.indexOf('\n')) >= 0) {
        const msg = JSON.parse(buf.slice(0, nl))
        buf = buf.slice(nl + 1)
        replies[msg.id] = msg
      }
    })
    const send = (m: object) => p.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...m })}\n`)
    send({ id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } } })
    send({ method: 'notifications/initialized' })
    send({ id: 2, method: 'tools/list' })
    send({ id: 3, method: 'tools/call', params: { name: 'docs_search', arguments: { query: 'OE-BIM-12' } } })
    send({ id: 4, method: 'tools/call', params: { name: 'docs_read', arguments: { path: '../package.json' } } })
    send({ id: 5, method: 'nope' })
    for (let i = 0; i < 100 && Object.keys(replies).length < 5; i++) await new Promise(r => setTimeout(r, 50))
    p.kill()

    expect(replies[1].result.protocolVersion).toBe('2025-06-18')
    const names = replies[2].result.tools.map((t: { name: string }) => t.name)
    expect(names).toEqual(['docs_map', 'docs_search', 'docs_read', 'docs_ticket', 'docs_links'])
    const found = JSON.parse(replies[3].result.content[0].text)
    expect(found.results[0].id).toBe('OE-BIM-12')
    expect(replies[4].result.isError).toBe(true)
    expect(replies[5].error.code).toBe(-32601)
  }, 15000)
})
