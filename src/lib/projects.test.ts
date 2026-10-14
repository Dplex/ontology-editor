// 프로젝트 목록·층 선택 화면의 표시 규칙(OE-UI-03).
import { describe, expect, it } from 'vitest'
import { buildingsOf, lastActivity, siteTotals, summaryOf, type ProjectRow } from './projects'

const row = (over: Partial<ProjectRow> = {}): ProjectRow => ({
  id: 'p1',
  key: '@p1|a.ifc',
  name: '본관',
  site: 'SR 캠퍼스',
  paths: ['a.ifc'],
  createdAt: '2026-10-13T01:00:00Z',
  createdBy: '편집자',
  built: null,
  drafts: [],
  summary: {
    buildings: [
      { name: 'A동', storeys: [{ key: 'a2', name: '2F', elevation: 4 }, { key: 'ab1', name: 'B1F', elevation: -4 }, { key: 'a1', name: '1F', elevation: 0 }] },
      { name: 'B동', storeys: [{ key: 'b1', name: '1F', elevation: 0 }, { key: 'bb5', name: 'B5F', elevation: -20 }] },
    ],
  },
  ...over,
})

describe('프로젝트 목록·층 선택 표시 (OE-UI-03)', () => {
  it('층은 건물별로 묶고 건물 안에서 지하층부터 낮은 층 순서다. 범위는 가장 낮은 층~가장 높은 층이다 [OE-UI-03#2]', () => {
    const [a, b] = buildingsOf(row())
    expect(a.storeys.map((s) => s.name)).toEqual(['B1F', '1F', '2F'])
    expect(a.range).toBe('B1F~2F')
    expect(b.range).toBe('B5F~1F')
  })

  it('두 건물에 같은 이름의 층이 있어도 건물 이름과 함께 보여 갈린다 [OE-UI-03#3]', () => {
    const labels = buildingsOf(row()).flatMap((b) => b.storeys.map((s) => s.label))
    expect(labels).toContain('A동 1F')
    expect(labels).toContain('B동 1F')
    expect(new Set(labels).size).toBe(labels.length)
  })

  it('사이트 합계와 건물별로 임시 저장한 층 수를 센다. 층 구성을 모르면 합계가 없다 [OE-UI-03#1~]', () => {
    const p = row({ drafts: [{ floor: 'a1', by: '편집자', savedAt: '2026-10-13T02:00:00Z' }, { floor: 'b1', by: '관리자', savedAt: '2026-10-13T03:00:00Z' }, { floor: '*', by: '편집자', savedAt: '2026-10-13T02:00:00Z' }] })
    expect(siteTotals(p)).toEqual({ buildings: 2, storeys: 5, drafted: 2 })
    expect(buildingsOf(p).map((b) => b.drafted)).toEqual([1, 1])
    expect(buildingsOf(p)[0].storeys.find((s) => s.key === 'a1')?.drafted).toBe(true)
    expect(siteTotals(row({ summary: undefined }))).toBeNull()
  })

  it('마지막 활동은 임시 저장과 구축 중 늦은 쪽이다', () => {
    expect(lastActivity(row())).toMatchObject({ what: '만듦', by: '편집자' })
    const drafted = row({ drafts: [{ floor: 'a1', by: '관리자', savedAt: '2026-10-13T03:00:00Z' }] })
    expect(lastActivity(drafted)).toMatchObject({ what: '임시 저장', by: '관리자' })
    expect(lastActivity({ ...drafted, built: { version: 1, at: '2026-10-13T04:00:00Z', by: '편집자' } })).toMatchObject({ what: '구축', by: '편집자' })
    expect(lastActivity({ ...drafted, built: { version: 2, at: '2026-10-13T02:00:00Z', by: '편집자' } })).toMatchObject({ what: '임시 저장' })
  })

  it('연 모델에서 층 구성을 센다', () => {
    expect(summaryOf({ buildingName: '', storeys: [{ id: 's1', name: '1F', elevation: 0 }] })).toEqual({ buildings: [{ name: '(건물 이름 없음)', storeys: [{ key: 's1', name: '1F', elevation: 0 }] }] })
  })
})
