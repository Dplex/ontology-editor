import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { it } from 'vitest'
import { coverage, readTags, readTickets, renderReport } from './ac-coverage'

// `npm run ac:coverage` 가 돌린다(vitest.ac.config.ts). 기본 `npm test` 에는 넣지 않는다 — 파일을 쓰기 때문이다.
const ROOT = fileURLToPath(new URL('../', import.meta.url))

it('수용 기준 ↔ 시험 보고서를 docs/dev/ac-coverage.md 에 쓴다', () => {
  const rows = coverage(readTickets(ROOT), readTags(ROOT))
  const when = new Date().toISOString().slice(0, 10)
  writeFileSync(ROOT + 'docs/dev/ac-coverage.md', renderReport(rows, when) + '\n')
})
