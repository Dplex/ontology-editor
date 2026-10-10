// 티켓 md 의 수용 기준 앞에 지금 순서 그대로 `**AC1**` … 을 붙인다(ADR-0048, docs/dev/prd-format-proposal.md 제안 1).
// 번호가 지금 순서와 같으니 시험의 `[OE-ML-09#4]` 태그는 그대로 맞는다(ac-tags.test.ts 가 모든 티켓으로 본다).
//
// PRD 는 PM 이 고친다 — PM 이 제안 1 의 "한 번에" 를 고를 때 PM 이 돌리는 도구다. 개발은 --write 를 돌리지 않는다.
//
//   node scripts/prd-ac-label.mjs            바뀔 티켓 수만 센다(쓰지 않음)
//   node scripts/prd-ac-label.mjs --write    docs/prd/features 의 티켓 md 를 고친다
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const LABELED = /^-\s+\*{0,2}AC\d+/
const notCriterion = l => l === '—' || /결정 후 적는다\.?$/.test(l)

/** 수용 기준 절에 AC 번호를 붙인 md. 이미 붙었거나 기준이 없으면 그대로. 글머리표가 없는 문단 줄은 글머리표로 바꾼다. */
export function labelCriteria(md) {
  const text = md.replace(/\r\n/g, '\n')
  const at = text.indexOf('\n## 수용 기준\n')
  if (at < 0) return md
  const start = at + '\n## 수용 기준\n'.length
  const next = text.indexOf('\n## ', start)
  const end = next < 0 ? text.length : next
  const lines = text.slice(start, end).split('\n')
  const bullets = lines.some(l => l.trim().startsWith('- '))
  if (lines.some(l => LABELED.test(l.trim()))) return md
  let n = 0
  const out = lines.map(l => {
    const t = l.trim()
    if (!t || (bullets && !t.startsWith('- '))) return l
    const body = bullets ? t.slice(2).trim() : t
    if (notCriterion(body)) return l
    return `- **AC${++n}** ${body}`
  })
  if (!n) return md
  const res = text.slice(0, start) + out.join('\n') + text.slice(end)
  return md.includes('\r\n') ? res.replace(/\n/g, '\r\n') : res
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (isMain) {
  const root = resolve(fileURLToPath(new URL('..', import.meta.url)), 'docs/prd/features')
  const write = process.argv.includes('--write')
  let changed = 0
  for (const epic of readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory())) {
    for (const f of readdirSync(join(root, epic.name)).filter(f => /^OE-.*\.md$/.test(f))) {
      const p = join(root, epic.name, f)
      const md = readFileSync(p, 'utf8')
      const next = labelCriteria(md)
      if (next === md) continue
      changed++
      if (write) writeFileSync(p, next)
    }
  }
  console.log(`${write ? '고친' : '고칠'} 티켓 ${changed}개`)
}
