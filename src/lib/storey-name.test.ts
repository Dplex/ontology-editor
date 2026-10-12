// 층 이름 고치기. 이름 없는 층(합성 성수의 기초 층)에 이름을 넣으면 등급 0 이 통과해 [구축하기] 가 풀린다.
import { describe, expect, it } from 'vitest'
import { baselineOf, restore, snapshotStoreyName } from './edit'
import { applyEdits, countEdits, exportEdits } from './edit-file'
import { gradeReport } from './grade'
import { splitByStorey } from './storey-drafts'
import type { Model } from './model'
import { resetStoreyName, setStoreyName, storeyNamed } from './storey-name'

const model = (): Model =>
  ({
    schema: 'IFC4', siteName: '', buildingId: 'B', buildingName: '', systems: [], connections: [], warnings: [],
    storeys: [
      { id: 'F0', name: '', elevation: -1, spaces: [], walls: [], openings: [], equipment: [] },
      { id: 'F1', name: '1F', elevation: 0, spaces: [], walls: [], openings: [], equipment: [] },
    ],
  }) as unknown as Model

describe('층 이름 고치기', () => {
  it('이름 없는 층에 이름을 넣으면 등급 0 의 층 이름이 채워지고, BIM 이름(빈 값)은 남는다', () => {
    const m = model()
    expect(gradeReport(m).rows[0].why).toBe('층 이름 1/2(이름 없는 층 1개)')
    expect(setStoreyName(m, 'F0', '  기초 ')).toBe(true)
    expect([m.storeys[0].name, m.storeys[0].bimName, storeyNamed(m.storeys[0])]).toEqual(['기초', '', true])
    expect(gradeReport(m).rows[0].pass).toBe(true)
    // BIM 이름으로 돌리면 고친 층이 아니다.
    expect(resetStoreyName(m, 'F0')).toBe(true)
    expect([m.storeys[0].name, storeyNamed(m.storeys[0])]).toEqual(['', false])
  })

  it('빈 이름·같은 이름의 층은 받지 않고, 같은 이름으로 다시 넣으면 바뀐 것이 없다', () => {
    const m = model()
    expect(setStoreyName(m, 'F0', '  ')).toEqual({ refused: '층 이름을 넣으세요' })
    expect(setStoreyName(m, 'F0', '1F')).toEqual({ refused: '같은 이름의 층(1F)이 이미 있습니다' })
    expect(setStoreyName(m, 'F1', '')).toEqual({ refused: '층 이름을 비울 수 없습니다. BIM 이름으로 돌리려면 [BIM 이름으로] 를 누르세요' })
    expect(setStoreyName(m, 'F1', '1F')).toBe(false)
    // 고쳤다가 BIM 이름을 다시 넣으면 고친 표시가 빠진다.
    expect(setStoreyName(m, 'F1', '지상 1층')).toBe(true)
    expect(setStoreyName(m, 'F1', '1F')).toBe(true)
    expect(storeyNamed(m.storeys[1])).toBe(false)
  })

  it('편집 파일에 남아 다시 열면 얹히고, 그 층의 임시 저장본에 들며, 되돌리기 한 번에 BIM 이름으로 돌아온다', () => {
    const m = model()
    const base = baselineOf(m)
    const before = snapshotStoreyName(m, 'F0')!
    setStoreyName(m, 'F0', '기초')
    const file = exportEdits(m, base, 'synth.ifc')
    expect(file.storeyNames).toEqual([{ storeyId: 'F0', name: '기초' }])
    expect(countEdits(file)).toBe(1)
    expect([...splitByStorey(file, () => null).keys()]).toEqual(['F0'])
    const fresh = model()
    expect(applyEdits(fresh, file).applied).toBe(1)
    expect([fresh.storeys[0].name, fresh.storeys[0].bimName]).toEqual(['기초', ''])
    restore(m, before)
    expect([m.storeys[0].name, storeyNamed(m.storeys[0])]).toEqual(['', false])
    expect(exportEdits(m, base, 'synth.ifc').storeyNames).toBeUndefined()
  })
})
