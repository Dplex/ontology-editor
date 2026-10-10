import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { coverage, danglingTags, parseCriteria, readTags, readTickets } from '../../scripts/ac-coverage'
// @ts-expect-error — 의존성 없는 node 모듈(.mjs)이라 타입이 없다
import { labelCriteria } from '../../scripts/prd-ac-label.mjs'

// 수용 기준 태그(`[OE-ML-07#1]`, scripts/ac-coverage.ts)가 실제 티켓의 실제 기준을 가리키는가. 기준 번호는 티켓 md 에서 세므로, PM 이 기준을
// 지우거나 줄이면 여기서 걸린다 — 그때 태그를 새 번호로 옮긴다. 보고서는 `npm run ac:coverage` 가 쓴다.
const ROOT = fileURLToPath(new URL('../../', import.meta.url))

describe('수용 기준 읽기', () => {
  it('글머리표가 있으면 글머리표 하나가 기준 하나다. 묶음 사이 빈 줄은 건너뛴다', () => {
    const body = '## 요구사항\n\n본문\n\n## 수용 기준\n\n- 하나\n- 둘\n\n- 셋\n\n## 검증 (이 repo)\n\n- 아님\n'
    expect(parseCriteria(body).map((c) => [c.index, c.text])).toEqual([[1, '하나'], [2, '둘'], [3, '셋']])
  })

  it('글머리표가 없으면 문단 줄 하나가 기준 하나이고, 위임과 아직 안 적은 기준을 가른다', () => {
    expect(parseCriteria('## 수용 기준\n\n층 편집 화면에서 핸들이 비활성이다.\n\n## 검증\n')).toEqual([{ index: 1, text: '층 편집 화면에서 핸들이 비활성이다.', delegatedTo: null }])
    expect(parseCriteria('## 수용 기준\n\nOE-EQP-05 의 수용 기준을 따른다.\n\n## 검증\n')[0].delegatedTo).toBe('OE-EQP-05')
    expect(parseCriteria('## 수용 기준\n\n- OE-ZON-01 과 같다.\n\n## 검증\n')[0].delegatedTo).toBe('OE-ZON-01')
    expect(parseCriteria('## 수용 기준\n\nD-gbXML 결정 후 적는다.\n\n## 검증\n')).toEqual([])
    expect(parseCriteria('## 수용 기준\n\n- 하나\n—\n\n## 검증\n')).toHaveLength(1)
  })
})

describe('AC 번호(ADR-0048)', () => {
  it('한 티켓에서 AC 번호를 쓰면 모든 기준에 쓰고 겹치지 않는다 — 섞이면 번호 없는 기준이 순서로 세여 다른 기준과 겹친다', () => {
    const LABEL = /^-\s+\*{0,2}AC\d+/
    for (const t of readTickets(ROOT)) {
      const section = (readFileSync(ROOT + t.file, 'utf8').replace(/\r\n/g, '\n').split('\n## 수용 기준\n')[1] ?? '').split(/\n## /)[0]
      const bullets = section.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('- '))
      if (!bullets.some((l) => LABEL.test(l))) continue
      expect(bullets.filter((l) => !LABEL.test(l)), `${t.id}: AC 번호가 없는 기준`).toEqual([])
      expect(new Set(t.criteria.map((c) => c.index)).size, `${t.id}: AC 번호가 겹친다`).toBe(t.criteria.length)
    }
  })

  it('지금 순서대로 AC 번호를 붙여도(scripts/prd-ac-label.mjs) 모든 티켓의 기준 번호·문장이 그대로다 — 태그가 안 밀린다', () => {
    let labeled = 0
    for (const t of readTickets(ROOT)) {
      const md = readFileSync(ROOT + t.file, 'utf8')
      const next = labelCriteria(md)
      if (next !== md) labeled++
      expect(parseCriteria(next).map((c) => [c.index, c.text, c.delegatedTo]), t.id).toEqual(t.criteria.map((c) => [c.index, c.text, c.delegatedTo]))
      expect(labelCriteria(next), `${t.id}: 두 번 돌려도 같다`).toBe(next)
    }
    expect(labeled).toBeGreaterThan(200)
  })
})

describe('이 repo 의 태그', () => {
  const tickets = readTickets(ROOT)
  const tags = readTags(ROOT)

  it('모든 태그가 있는 티켓의 있는 기준을 가리킨다(위임한 기준이 아니다)', () => {
    expect(tickets.length).toBeGreaterThan(200)
    expect(danglingTags(tickets, tags).map((g) => `${g.file}:${g.line} [${g.ticket}#${g.index}] ${g.why}`)).toEqual([])
  })

  it('태그는 그 시험에 붙는다 — 제목의 태그도, 시험 안 주석의 태그도', () => {
    const own = tags.filter((g) => g.file === 'src/lib/vertical-edit.test.ts')
    expect(own.length).toBeGreaterThan(0)
    expect(own.every((g) => g.test.length > 0)).toBe(true)
    const rows = coverage(tickets, tags).find((t) => t.id === 'OE-ML-09')!
    expect(rows.tagged).toBeGreaterThan(0)
  })
})
