import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// docs/prd/ 는 PRD_011 의 정본이고 티켓 하나가 파일 하나다(docs/prd/README.md). 여기서 막는 것은 네 가지다.
//
// 1. 색인이 티켓과 어긋나는 것 — Epic README 와 PRD_011.md 3장은 티켓 머리 필드를 베낀 파생 정보다.
// 2. 유령 참조 — 의존 열이 가리키는 티켓·결정·요구사항이 없는 것. 원문에서 #25 를 가리키는데 행이 없던 일이 있다.
// 3. 어휘가 범례 밖으로 새는 것 — 상태·주체·릴리즈는 보드 이슈 라벨과 같은 말을 써야 집계가 된다.
// 4. 판본 표시가 다시 들어오는 것 — `[v1.4]` 는 git 이력이 대신한다.

const dir = (rel: string) => fileURLToPath(new URL(rel, import.meta.url))
const PRD = dir('../../docs/prd/')
// Windows 의 autocrlf 가 작업 사본을 CRLF 로 바꿔 두므로 줄바꿈을 LF 로 맞춰 읽는다.
const lf = (s: string) => s.replace(/\r\n/g, '\n')
const read = (rel: string) => lf(readFileSync(PRD + rel, 'utf8'))

type Ticket = { file: string; folder: string; fm: Record<string, unknown>; body: string }

/** 머리 필드는 값이 전부 JSON 이라 파서 없이 읽는다(README "티켓 파일의 틀"). */
function frontmatter(text: string): { fm: Record<string, unknown>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(text)
  if (!m) throw new Error('머리 필드 없음')
  const fm: Record<string, unknown> = {}
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([a-z_]+): (.*)$/.exec(line)
    if (!kv) throw new Error(`머리 필드 줄이 "key: json" 이 아니다: ${line}`)
    fm[kv[1]] = JSON.parse(kv[2])
  }
  return { fm, body: m[2] }
}

function tickets(): Ticket[] {
  const out: Ticket[] = []
  for (const folder of readdirSync(PRD + 'features')) {
    if (!statSync(PRD + 'features/' + folder).isDirectory()) continue
    for (const file of readdirSync(PRD + 'features/' + folder)) {
      if (!/^OE-.*\.md$/.test(file)) continue
      const { fm, body } = frontmatter(read(`features/${folder}/${file}`))
      out.push({ file, folder, fm, body })
    }
  }
  return out
}

/** `OE-SPC-06~10` · `OE-WF-15/16` 같은 축약을 ID 목록으로 편다. */
function expandIds(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(/OE-[A-Z0-9]+-\d+(?:~\d+|(?:\/\d+)+)?/g)) {
    const [, head, first, rest] = /^(OE-[A-Z0-9]+)-(\d+)(.*)$/.exec(m[0])!
    out.push(`${head}-${first}`)
    if (rest.startsWith('~')) for (let i = +first + 1; i <= +rest.slice(1); i++) out.push(`${head}-${String(i).padStart(2, '0')}`)
    else for (const n of rest.split('/').filter(Boolean)) out.push(`${head}-${n.padStart(2, '0')}`)
  }
  return out
}

const all = tickets()
const ids = new Set(all.map((t) => t.fm.id as string))
const prefixes = new Set(all.map((t) => (t.fm.id as string).split('-')[1]))
const prd = read('PRD_011.md')
const questions = read('questions.md')
const canon = lf(readFileSync(dir('../../docs/bim-to-dt-ontology.md'), 'utf8'))

const firstCells = (text: string, re: RegExp) => new Set([...text.matchAll(re)].map((m) => m[1]))
const rIds = new Set([...firstCells(canon, /^\| (R\d+) \|/gm), ...firstCells(prd, /^\| (R\d+) \|/gm)])
const kIds = firstCells(prd, /^\| (K\d+) \|/gm)
const sIds = firstCells(prd, /^\| (S\d+) \|/gm)
const issueIds = firstCells(questions, /^\| ((?:D|Q|U|P)[-A-Za-z0-9]*) \|/gm)
const CHAPTERS = new Set(['1.8', '부록 A', '부록 B', '부록 C'])

const STATUS = ['prd-done', 'prd-review']
const OWNER = ['ontology-editor', 'srcn', 'tbd']
const RELEASE = ['R1', 'R2']
const PRIORITY = ['P1', 'P2', 'P3']

describe('티켓 파일', () => {
  it('id 가 파일 이름이고 중복이 없으며 Epic 폴더와 맞는다', () => {
    expect(ids.size).toBe(all.length)
    for (const t of all) {
      const id = t.fm.id as string
      expect(t.file).toBe(`${id}.md`)
      const [epic, prefix] = t.folder.split('-')
      expect(t.fm.epic).toBe(epic)
      expect(id.split('-')[1]).toBe(prefix)
    }
  })

  it('머리 필드가 다 있고 값이 범례 안이다', () => {
    for (const t of all) {
      const { fm } = t
      for (const key of ['id', 'epic', 'epic_title', 'title', 'prd', 'release', 'priority', 'owner', 'status', 'blocked_by', 'depends'])
        expect(fm, `${t.file} 에 ${key} 없음`).toHaveProperty(key)
      expect(STATUS, `${t.file} status`).toContain(fm.status)
      expect(OWNER, `${t.file} owner`).toContain(fm.owner)
      expect(RELEASE, `${t.file} release`).toContain(fm.release)
      expect(PRIORITY, `${t.file} priority`).toContain(fm.priority)
      expect(Array.isArray(fm.blocked_by) && Array.isArray(fm.depends), `${t.file} 목록 필드`).toBe(true)
    }
  })

  it('본문에 네 절이 있다', () => {
    for (const t of all)
      for (const h of ['## 요구사항', '## 수용 기준', '## 검증 (이 repo)', '## 메모']) expect(t.body, `${t.file} ${h}`).toContain(`\n${h}\n`)
  })

  it('판본 표시가 남아 있지 않다', () => {
    for (const t of all) expect(t.body + JSON.stringify(t.fm), t.file).not.toMatch(/\[v1\.\d/)
  })
})

describe('참조', () => {
  it('depends · blocked_by 가 가리키는 것이 존재한다', () => {
    for (const t of all) {
      for (const ref of [...(t.fm.depends as string[]), ...(t.fm.blocked_by as string[])]) {
        const ok =
          ids.has(ref) ||
          (/^OE-[A-Z0-9]+$/.test(ref) && prefixes.has(ref.slice(3))) ||
          rIds.has(ref) ||
          kIds.has(ref) ||
          sIds.has(ref) ||
          issueIds.has(ref) ||
          CHAPTERS.has(ref)
        expect(ok, `${t.file} → ${ref}`).toBe(true)
      }
    }
  })

  it('blocked 는 questions.md 의 번호를 가리킨다', () => {
    for (const t of all)
      for (const ref of t.fm.blocked_by as string[]) expect(issueIds.has(ref), `${t.file} blocked_by ${ref}`).toBe(true)
  })

  it('questions.md 의 영향 티켓이 실제 파일이다', () => {
    const rows = questions.split('\n').filter((l) => /^\| (D|Q|U|P)[-A-Za-z0-9]* \|/.test(l))
    expect(rows.length).toBeGreaterThan(20)
    for (const row of rows) {
      const cells = row.split('|').map((c) => c.trim())
      const impact = cells[7]
      for (const id of expandIds(impact)) expect(ids.has(id), `${cells[1]} → ${id}`).toBe(true)
      for (const m of impact.matchAll(/\bOE-([A-Z0-9]+)\b(?!-)/g)) expect(prefixes.has(m[1]), `${cells[1]} → OE-${m[1]}`).toBe(true)
    }
  })
})

describe('색인', () => {
  it('Epic README 의 행이 폴더의 티켓과 같다', () => {
    for (const folder of new Set(all.map((t) => t.folder))) {
      const readme = read(`features/${folder}/README.md`)
      const rows = new Map(
        [...readme.matchAll(/^\| \[(OE-[A-Z0-9]+-\d+)\]\(\1\.md\) \| (.*?) \| (.*?) \| (.*?) \| (.*?) \|$/gm)].map((m) => [m[1], m.slice(2)]),
      )
      const mine = all.filter((t) => t.folder === folder)
      expect([...rows.keys()].sort(), folder).toEqual(mine.map((t) => t.fm.id as string).sort())
      for (const t of mine) {
        const [title, rel, pri, status] = rows.get(t.fm.id as string)!
        expect([title, rel, pri, status], `${folder}/README.md ${t.fm.id}`).toEqual([t.fm.title, t.fm.release, t.fm.priority, t.fm.status])
      }
      expect(readme, `${folder}/README.md 제목`).toContain(`# ${folder.split('-')[0]} ${mine[0].fm.epic_title}`)
    }
  })

  it('PRD_011.md 3장의 Epic 별 티켓 목록이 폴더의 티켓과 같다', () => {
    for (const folder of new Set(all.map((t) => t.folder))) {
      const rows = new Map(
        [...prd.matchAll(/^\| \[(OE-[A-Z0-9]+-\d+)\]\(features\/([A-Z0-9-]+)\/\1\.md\) \| (.*?) \| (.*?) \| (.*?) \| (.*?) \|$/gm)]
          .filter((m) => m[2] === folder)
          .map((m) => [m[1], m.slice(3)]),
      )
      const mine = all.filter((t) => t.folder === folder)
      expect([...rows.keys()].sort(), folder).toEqual(mine.map((t) => t.fm.id as string).sort())
      for (const t of mine) {
        const [title, rel, pri, status] = rows.get(t.fm.id as string)!
        expect([title, rel, pri, status], `PRD_011.md ${t.fm.id}`).toEqual([t.fm.title, t.fm.release, t.fm.priority, t.fm.status])
      }
    }
  })

  it('PRD_011.md 3장의 Epic 색인이 폴더·기능 수와 같다', () => {
    const rows = [...prd.matchAll(/^\| (E\d\d) \| (.*?) \| (.*?) \| (\d+) \| \[features\/(E\d\d-[A-Z0-9]+)\/\]\(features\/\5\/README\.md\) \|$/gm)]
    const folders = new Set(all.map((t) => t.folder))
    expect(rows.map((m) => m[5]).sort()).toEqual([...folders].sort())
    for (const [, epic, title, , count, folder] of rows) {
      const mine = all.filter((t) => t.folder === folder)
      expect(mine.length, `${epic} 기능 수`).toBe(+count)
      expect(mine[0].fm.epic_title, `${epic} 이름`).toBe(title)
    }
    const total = /^총 (\d+)건\.$/m.exec(prd)
    expect(total && +total[1]).toBe(all.length)
  })
})

// OE-REQ-01 "부록 A 와 정본 4장 일치". 부록 A 는 R0~R24 를 베끼지 않고 정본 4장(docs/bim-to-dt-ontology.md)을 가리키며, 정본에 아직
// 없는 **제안**(R25 등)만 표로 둔다(부록 A 머리말). 두 곳에 두었다가 같은 R 이 한쪽은 필수, 다른 쪽은 권장이 된 일이 있어서다.
// 여기서 그 약속을 잰다 — PRD 는 읽기만 한다.
describe('부록 A 와 정본 4장 (OE-REQ-01)', () => {
  const appendix = prd.slice(prd.indexOf('## 부록 A.'), prd.indexOf('## 부록 B.'))
  const section = (from: string, to: string) => canon.slice(canon.indexOf(from), canon.indexOf(to))
  const must = [...section('### 4.1 필수', '### 4.2 권장').matchAll(/^\| (R\d+) \|/gm)].map((m) => m[1])
  const should = [...section('### 4.2 권장', '### 4.3').matchAll(/^\| (R\d+) \|/gm)].map((m) => m[1])

  it('정본 4장이 R0~R24 를 필수 11 · 권장 14 로 한 번씩 담는다 — 제목·용어집의 개수와 같다', () => {
    expect(must).toHaveLength(11)
    expect(should).toHaveLength(14)
    const byNumber = (a: string, b: string) => +a.slice(1) - +b.slice(1)
    expect([...must, ...should].sort(byNumber)).toEqual(Array.from({ length: 25 }, (_, i) => `R${i}`))
    expect(canon).toContain('### 4.1 필수 (11개)')
    expect(canon).toContain('### 4.2 권장 (14개)')
    expect(read('glossary.md')).toMatch(/요구사항 R0~R24\*\* \| [^|]*필수 11 · 권장 14/)
  })

  it('부록 A 는 정본을 가리키고, 표에는 정본에 없는 제안만 둔다', () => {
    // 링크가 실제 파일을 가리킨다(docs/prd/ 기준 상대 경로).
    const links = [...appendix.matchAll(/\]\((\.\.\/[^)]+)\)/g)].map((m) => m[1])
    expect(links).toEqual(expect.arrayContaining(['../bim-to-dt-ontology.md', '../requirements.ids']))
    for (const l of links) expect(() => statSync(PRD + l), l).not.toThrow()
    // 표의 R 은 정본 4장에 없다. 채택되면 정본·IDS·보고서로 옮기고 여기서 뺀다.
    const proposed = [...appendix.matchAll(/^\| (R\d+) \|/gm)].map((m) => m[1])
    for (const r of proposed) expect([r, must.includes(r) || should.includes(r)]).toEqual([r, false])
    expect(proposed.every((r) => +r.slice(1) > 24)).toBe(true)
  })
})
