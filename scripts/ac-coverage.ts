// 수용 기준 ↔ 시험 짝(docs/dev/testing.md "수용 기준 태그").
//
// 시험 제목이나 그 시험 안의 주석에 `[OE-ML-07#1]` 처럼 "티켓 id#수용 기준 번호" 를 단다. 번호는 티켓 md 의 "## 수용 기준" 절에서 1 부터
// 센다 — 글머리표가 있으면 글머리표 하나가 기준 하나, 없으면 빈 줄이 아닌 문단 줄 하나가 기준 하나다. 여러 기준이면 `[OE-ML-07#1,4]`, 여러
// 티켓이면 괄호를 여럿 단다. 기준의 일부만 재면(계단은 되고 ES·샤프트는 아직) 번호 뒤에 `~` 를 단다: `[OE-ML-07#2~]` — 보고서가 "일부"
// 로 센다. "OE-EQP-05 의 수용 기준을 따른다" 는 위임이라 그 줄에는 태그를 달지 않는다(따르는 티켓 쪽에서 센다).
//
// 태그는 "이 시험이 이 기준을 잰다" 는 사람의 주장이다. 기계가 맞는지 보는 것은 가리키는 티켓·번호가 있는가뿐이다(src/lib/ac-tags.test.ts).
// 보고서(`npm run ac:coverage` → docs/dev/ac-coverage.md)는 기준마다 어느 시험이 재는지, 어느 기준에 시험이 없는지를 적는다.
//
// PRD 는 PM 이 고친다. 기준 문장이 바뀌거나 순서가 바뀌면 번호가 어긋날 수 있다 — 보고서에 기준 문장을 같이 적어 사람이 볼 수 있게 한다.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

export type Criterion = { index: number; text: string; delegatedTo: string | null }
export type Ticket = { id: string; file: string; epic: string; title: string; release: string; status: string; criteria: Criterion[] }
export type Tag = { ticket: string; index: number; partial: boolean; file: string; line: number; test: string }

const lf = (s: string) => s.replace(/\r\n/g, '\n')

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}

/** 다른 티켓의 기준을 그대로 쓰는 줄. "OE-EQP-05 의 수용 기준을 따른다", "OE-ZON-01 과 같다"(OE-MAN-05) 두 말투가 있다. */
const DELEGATE = /^(OE-[A-Z0-9]+-\d+)\s*(?:의 수용 기준을 따른다|[과와] 같다)/

/** 수용 기준 절을 기준 목록으로. 글머리표가 있으면 글머리표, 없으면 문단 줄. "—"·"… 결정 후 적는다" 처럼 기준이 아닌 줄은 뺀다. */
export function parseCriteria(body: string): Criterion[] {
  const section = (lf('\n' + body).split('\n## 수용 기준\n')[1] ?? '').split(/\n## /)[0]
  const lines = section.split('\n').map((l) => l.trim()).filter(Boolean)
  const bullets = lines.filter((l) => l.startsWith('- '))
  const items = (bullets.length ? bullets.map((l) => l.slice(2).trim()) : lines).filter((l) => l !== '—' && !/결정 후 적는다\.?$/.test(l))
  return items.map((text, i) => ({ index: i + 1, text, delegatedTo: DELEGATE.exec(text)?.[1] ?? null }))
}

export function readTickets(root: string): Ticket[] {
  const out: Ticket[] = []
  for (const file of walk(join(root, 'docs/prd/features'))) {
    if (!/[\\/]OE-[A-Z0-9]+-\d+\.md$/.test(file)) continue
    const text = lf(readFileSync(file, 'utf8'))
    const fm = (k: string) => {
      const m = new RegExp(`^${k}: (.*)$`, 'm').exec(text)
      return m ? (JSON.parse(m[1]) as string) : ''
    }
    out.push({
      id: fm('id'),
      file: relative(root, file).replace(/\\/g, '/'),
      epic: fm('epic'),
      title: fm('title'),
      release: fm('release'),
      status: fm('status'),
      criteria: parseCriteria(text),
    })
  }
  return out.sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true }))
}

const TAG = /\[(OE-[A-Z0-9]+-\d+)#([\d,~\s]+)\]/g
const TEST_TITLE = /\b(?:it|test)(?:\.skip|\.only|\.skipIf\([^)]*\))?\(\s*(['"`])((?:\\.|(?!\1).)*)\1/

/** 시험 파일의 태그. 태그가 든 줄이 시험 제목이면 그 시험, 아니면 위로 가장 가까운 시험 제목에 붙인다(주석에 단 태그). */
export function readTags(root: string): Tag[] {
  const files = [
    ...walk(join(root, 'src')).filter((f) => f.endsWith('.test.ts')),
    ...walk(join(root, 'e2e')).filter((f) => f.endsWith('.spec.ts')),
    ...walk(join(root, 'e2e-seongsu')).filter((f) => f.endsWith('.spec.ts')),
    ...walk(join(root, 'scripts')).filter((f) => f.endsWith('.test.ts')),
  ]
  const out: Tag[] = []
  for (const file of files) {
    const lines = lf(readFileSync(file, 'utf8')).split('\n')
    let current = ''
    lines.forEach((line, i) => {
      const title = TEST_TITLE.exec(line)
      if (title) current = title[2]
      for (const m of line.matchAll(TAG)) {
        for (const token of m[2].split(',').map((x) => x.trim()).filter(Boolean)) {
          const n = Number(token.replace(/~$/, ''))
          if (!Number.isFinite(n)) continue
          out.push({ ticket: m[1], index: n, partial: token.endsWith('~'), file: relative(root, file).replace(/\\/g, '/'), line: i + 1, test: current })
        }
      }
    })
  }
  return out
}

export type TicketCoverage = Ticket & { rows: { criterion: Criterion; tags: Tag[] }[]; own: number; tagged: number; partial: number }

/** 티켓마다 기준별 태그. `own` 은 위임이 아닌 기준 수, `tagged` 는 그중 다 재는 태그가 있는 수, `partial` 은 일부만 재는 태그뿐인 수. */
export function coverage(tickets: readonly Ticket[], tags: readonly Tag[]): TicketCoverage[] {
  return tickets.map((t) => {
    const rows = t.criteria.map((criterion) => ({ criterion, tags: tags.filter((g) => g.ticket === t.id && g.index === criterion.index) }))
    const own = rows.filter((r) => !r.criterion.delegatedTo)
    const tagged = own.filter((r) => r.tags.some((g) => !g.partial)).length
    const partial = own.filter((r) => r.tags.length && r.tags.every((g) => g.partial)).length
    return { ...t, rows, own: own.length, tagged, partial }
  })
}

/** 가리키는 티켓·기준이 없는 태그. */
export function danglingTags(tickets: readonly Ticket[], tags: readonly Tag[]): (Tag & { why: string })[] {
  const byId = new Map(tickets.map((t) => [t.id, t]))
  const out: (Tag & { why: string })[] = []
  for (const g of tags) {
    const t = byId.get(g.ticket)
    if (!t) out.push({ ...g, why: '없는 티켓' })
    else if (g.index < 1 || g.index > t.criteria.length) out.push({ ...g, why: `수용 기준은 ${t.criteria.length}개다` })
    else if (t.criteria[g.index - 1].delegatedTo) out.push({ ...g, why: `위임(${t.criteria[g.index - 1].delegatedTo})이라 그 티켓에 단다` })
  }
  return out
}

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '—')

/** docs/dev/ac-coverage.md 본문. */
export function renderReport(rows: readonly TicketCoverage[], when: string): string {
  const r1 = rows.filter((r) => r.release === 'R1')
  const epics = [...new Set(r1.map((r) => r.id.split('-')[1]))]
  const out: string[] = [
    '# 수용 기준 ↔ 시험',
    '',
    `${when} · \`npm run ac:coverage\` 가 쓴 파일이다. 손으로 고치지 않는다. 태그 다는 법은 [testing.md](testing.md) "수용 기준 태그".`,
    '',
    '칸은 기준(위임 제외) 수와, 그중 다 재는 시험이 있는 것·일부만 재는 시험뿐인 것이다. 태그는 사람이 "이 시험이 이 기준을 잰다" 고 단',
    '것이라, 태그가 없다는 것은 시험이 없다는 뜻이 아니라 **짝을 아직 적지 않았다**는 뜻일 수 있다.',
    '',
    '## R1 Epic 별',
    '',
    '| Epic | 티켓 | 기준 | 다 잼 | 일부 | 다 잼 비율 |',
    '|---|---|---|---|---|---|',
  ]
  let tot = 0
  let hit = 0
  let half = 0
  for (const e of epics) {
    const list = r1.filter((r) => r.id.split('-')[1] === e)
    const own = list.reduce((n, r) => n + r.own, 0)
    const tagged = list.reduce((n, r) => n + r.tagged, 0)
    const partial = list.reduce((n, r) => n + r.partial, 0)
    tot += own
    hit += tagged
    half += partial
    out.push(`| ${e} | ${list.length} | ${own} | ${tagged} | ${partial} | ${pct(tagged, own)} |`)
  }
  out.push(`| **합계** | ${r1.length} | ${tot} | ${hit} | ${half} | ${pct(hit, tot)} |`, '')
  out.push('## 태그가 있는 티켓', '', '태그가 하나라도 있는 티켓만 기준마다 적는다. ✓ 다 재는 시험이 있음 · ◐ 일부만 재는 시험뿐 · ✗ 없음 · → 다른 티켓에 위임.', '')
  for (const r of rows.filter((x) => x.rows.some((y) => y.tags.length))) {
    out.push(`### ${r.id} ${r.title.replace(/\s*\(#[^)]*\)$/, '')} — 다 잼 ${r.tagged} · 일부 ${r.partial} / ${r.own}`, '')
    for (const { criterion, tags } of r.rows) {
      const mark = criterion.delegatedTo ? '→' : tags.some((g) => !g.partial) ? '✓' : tags.length ? '◐' : '✗'
      out.push(`- ${mark} **#${criterion.index}** ${criterion.text}`)
      const seen = new Set<string>()
      for (const g of tags) {
        const key = `${g.file}:${g.test}:${g.partial}`
        if (seen.has(key)) continue
        seen.add(key)
        const title = g.test.replace(/\s*\[OE-[^\]]+\]/g, '')
        out.push(`  - \`${g.file}\` ${title ? `"${title}"` : `(${g.line}줄)`}${g.partial ? ' (일부)' : ''}`)
      }
    }
    out.push('')
  }
  return out.join('\n')
}
