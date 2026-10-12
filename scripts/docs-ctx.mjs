// 티켓·ADR·번호 하나로 개발에 드는 맥락을 한 번에 찍는다(ADR-0048). 문서 챗봇의 docs_ticket 과 같은 내용을 터미널에.
//
//   npm run ctx -- OE-ML-09            요구사항 · 기준별 시험 · depends 의 정의 줄 · ADR · 코드 · 거꾸로 가리키는 티켓
//   npm run ctx -- ADR-0047 R11 D10    ADR 본문과 티켓 제목 · 번호의 정의 줄과 쓰는 곳
//   npm run ctx -- OE-ML-09 --json     같은 것을 JSON 으로
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildIndex, context } from './docs-index.mjs'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const args = process.argv.slice(2)
const json = args.includes('--json')
const refs = args.filter(a => !a.startsWith('--'))
if (!refs.length) {
  console.error('쓰는 법: npm run ctx -- <OE-XXX-nn | ADR-nnnn | R11 | D10 …> [--json]')
  process.exit(2)
}

const idx = buildIndex(root)
const one = r => (r.row ? `- ${r.id} — \`${r.path}:${r.line}\` ${r.where.split(' > ').pop()}\n  ${r.header}\n  ${r.row}`
  : r.error ? `- ${r.id} — ${r.error}` : `- ${r.id} ${r.title}${r.status ? ` [${r.status}]` : ''} — \`${r.path}\``)
const list = (title, rows, f = one) => (rows?.length ? [`## ${title}`, ...rows.map(f), ''] : [])

function ticket(c) {
  return [
    `# ${c.id} ${c.title}  [${c.status} · ${c.release} · ${c.priority}${c.prd ? ` · PRD ${c.prd}` : ''}]`,
    `\`${c.path}\``, '',
    '## 요구사항', c.requirement || '—', '',
    '## 수용 기준 ↔ 시험 (태그 `[ID#n]`, ~ 는 일부)',
    ...c.criteria.flatMap(k => [
      `${k.index}. ${k.text}`,
      ...(k.delegatedTo ? [`   → ${k.delegatedTo} 에서 잰다`] : k.tests.length
        ? k.tests.map(t => `   - \`${t.file}:${t.line}\`${t.partial ? ' (일부)' : ''} ${t.test}`) : ['   - (시험 없음)']),
    ]), '',
    ...list('depends', c.depends),
    ...list('blocked_by', c.blocked_by),
    ...list('ADR (tickets·criteria 에 이 티켓)', c.adrs),
    ...list('코드 (시험 제외, 이 ID 를 적은 횟수)', c.code, x => `- \`${x.file}\` ${x.count}`),
    ...list('이 티켓을 depends 로 가리키는 티켓', c.depended_by),
    ...(c.frozen_since_1007 ? ['## 검증·메모 (2026-10-07 이후 고치지 않는 절 — 위 시험 목록이 지금 것)',
      ...[c.frozen_since_1007.verify, c.frozen_since_1007.memo].filter(Boolean), ''] : []),
  ]
}

function adr(c) {
  return [
    `# ${c.id} ${c.title}  [${c.status} · ${c.date}]`, `\`${c.path}\``, '',
    ...list('tickets', c.tickets),
    ...(c.criteria.length ? [`criteria: ${c.criteria.join(' · ')}`, ''] : []),
    ...(c.code_files.length || c.test_files.length ? [`code: ${c.code_files.join(' · ') || '—'}`, `tests: ${c.test_files.join(' · ') || '—'}`, ''] : []),
    ...list('관련 ADR', c.related),
    c.text, '',
    ...list('코드에서 이 ADR 을 적은 곳', c.code, x => `- \`${x.file}\` ${x.count}`),
  ]
}

function ref(c) {
  return [`# ${c.id}`, '', ...c.defs.map(d => one({ ...d, id: d.ref })), '', ...list('쓰는 티켓·ADR', c.used_by)]
}

let failed = false
const out = []
for (const r of refs) {
  const c = context(idx, r)
  if (!c) { console.error(`${r}: 티켓·ADR 이 아니고 정의된 표 줄도 없다`); failed = true; continue }
  out.push(json ? c : (c.kind === 'ticket' ? ticket(c) : c.kind === 'adr' ? adr(c) : ref(c)).join('\n'))
}
console.log(json ? JSON.stringify(out.length === 1 ? out[0] : out, null, 1) : out.join('\n\n---\n\n'))
process.exit(failed ? 1 : 0)
