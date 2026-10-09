import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// docs/adr/ 는 결정 하나가 파일 하나다(docs/adr/README.md). 55 의 문서 챗봇이 머리 필드와 목록으로 결정을 찾으니, 여기서 막는 것은
// 기계로 가를 수 있는 어긋남이다. 결정끼리 내용이 엇갈리는지는 사람이 읽어야 한다 — 다만 한 ADR 이 다른 ADR 의 결정을 바꿨다고
// 본문에 적으면 양쪽 머리(supersedes · superseded_by)에도 있어야 한다. 머리에 없으면 챗봇이 옛 결정을 그대로 답한다(0016 ↔ 0023).
//
// 1. 번호·id·제목 줄이 파일 이름과 맞고 겹치지 않는다
// 2. README 목록의 제목·상태가 파일 머리와 같다 — 목록은 머리를 베낀 것이다
// 3. tickets 가 실제 티켓이다
// 4. 대체 관계가 양쪽에 다 적혀 있고, 본문에서 "바꿨다·바뀌었다" 로 말한 ADR 은 머리에도 있다

const dir = (rel: string) => fileURLToPath(new URL(rel, import.meta.url))
const ADR = dir('../../docs/adr/')
const FEATURES = dir('../../docs/prd/features/')
const lf = (s: string) => s.replace(/\r\n/g, '\n')

type Adr = { file: string; num: string; fm: Record<string, unknown>; body: string }

function parse(file: string): Adr {
  const text = lf(readFileSync(ADR + file, 'utf8'))
  const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(text)
  if (!m) throw new Error(`${file}: 머리 필드 없음`)
  const fm: Record<string, unknown> = {}
  for (const line of m[1].split('\n')) {
    const kv = /^([a-z_]+): (.*)$/.exec(line)
    if (!kv) throw new Error(`${file}: 머리 필드 줄이 "key: json" 이 아니다: ${line}`)
    fm[kv[1]] = JSON.parse(kv[2])
  }
  return { file, num: file.slice(0, 4), fm, body: m[2] }
}

const adrs = readdirSync(ADR)
  .filter((f) => /^\d{4}-.*\.md$/.test(f))
  .sort()
  .map(parse)
const readme = lf(readFileSync(ADR + 'README.md', 'utf8'))
const tickets = new Set<string>()
for (const epic of readdirSync(FEATURES)) {
  if (!statSync(FEATURES + epic).isDirectory()) continue
  for (const f of readdirSync(FEATURES + epic)) if (/^OE-.*\.md$/.test(f)) tickets.add(f.slice(0, -3))
}
/** "ADR-0004 (별명 한 줄만)" 처럼 일부만 바꾼 것은 괄호로 범위를 적는다. 번호만 본다. */
const refNum = (s: string) => /^ADR-(\d{4})/.exec(s)?.[1] ?? null

describe('ADR 파일', () => {
  it('번호·id·제목 줄이 파일 이름과 맞고 번호가 겹치지 않는다', () => {
    expect(new Set(adrs.map((a) => a.num)).size).toBe(adrs.length)
    for (const a of adrs) {
      expect(a.fm.id, a.file).toBe(`ADR-${a.num}`)
      expect(a.body, a.file).toMatch(new RegExp(`^\\n?# ADR-${a.num} `))
      expect(['제안', '채택', '대체됨', '폐기'], a.file).toContain(a.fm.status)
    }
  })

  it('README 목록의 제목·상태가 파일 머리와 같다', () => {
    for (const a of adrs) {
      const row = readme.split('\n').find((l) => l.startsWith(`| [${a.num}](${a.file})`))
      expect(row, `${a.file} 가 README 목록에 없다`).toBeTruthy()
      const [, title, status] = row!.split(' | ').map((c) => c.trim())
      expect(title, `${a.file} README 제목`).toBe(a.fm.title)
      expect(status.replace(/\s*\|$/, ''), `${a.file} README 상태`).toBe(a.fm.status)
    }
  })

  it('tickets 가 실제 티켓이다', () => {
    for (const a of adrs) for (const t of a.fm.tickets as string[]) expect(tickets.has(t), `${a.file} 의 ${t}`).toBe(true)
  })
})

describe('ADR 사이의 대체 관계', () => {
  const byNum = new Map(adrs.map((a) => [a.num, a]))

  it('supersedes 와 superseded_by 가 양쪽에 다 적혀 있다', () => {
    for (const a of adrs) {
      for (const s of a.fm.supersedes as string[]) {
        const n = refNum(s)
        expect(n && byNum.has(n), `${a.file} 의 supersedes ${s}`).toBe(true)
        expect(refNum(byNum.get(n!)!.fm.superseded_by as string), `${byNum.get(n!)!.file} 의 superseded_by 가 ${a.file} 를 가리켜야 한다`).toBe(a.num)
      }
      const by = a.fm.superseded_by as string
      if (!by) continue
      const n = refNum(by)
      expect(n && byNum.has(n), `${a.file} 의 superseded_by ${by}`).toBe(true)
      expect((byNum.get(n!)!.fm.supersedes as string[]).map(refNum), `${byNum.get(n!)!.file} 의 supersedes 에 ${a.file} 가 있어야 한다`).toContain(a.num)
    }
  })

  it('본문에서 다른 ADR 의 결정을 바꿨다고 적으면 머리에도 그 관계가 있다', () => {
    for (const a of adrs) {
      const linked = new Set([...(a.fm.supersedes as string[]).map(refNum), refNum(a.fm.superseded_by as string)])
      for (const m of a.body.matchAll(/ADR-(\d{4})[^\n]{0,80}(바꿨다|바뀌었다)/g)) {
        if (m[1] === a.num) continue
        expect(linked.has(m[1]), `${a.file} 본문이 ADR-${m[1]} 와의 바꿈을 말한다: "${m[0]}"`).toBe(true)
      }
    }
  })
})
