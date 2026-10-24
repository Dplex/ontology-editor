import { ref } from 'vue'
import { describe, expect, it } from 'vitest'
import type { Model } from '../lib/model'
import { buildPassSweep, enable, resetPassSession } from './pass'
import type { EggContext } from './types'

function sampleModel(): Model {
  return {
    schema: 'IFC4',
    siteName: 'Site',
    buildingId: 'B1',
    buildingName: 'Building',
    storeys: [
      {
        id: 'S1',
        name: '1F',
        elevation: 0,
        spaces: [
          {
            id: 'SP1',
            name: '101',
            longName: '회의실',
            footprint: [
              [0, 0],
              [4, 0],
              [4, 4],
              [0, 4],
              [0, 0],
            ],
            areaM2: 16,
            boundedBy: [],
          },
        ],
        walls: [],
        openings: [],
        equipment: [],
      },
      {
        id: 'S2',
        name: '2F',
        elevation: 3.5,
        spaces: [
          {
            id: 'SP2',
            name: '201',
            longName: '사무실',
            footprint: [
              [0, 0],
              [4, 0],
              [4, 4],
              [0, 4],
              [0, 0],
            ],
            areaM2: 16,
            boundedBy: [],
          },
        ],
        walls: [],
        openings: [],
        equipment: [],
      },
    ],
    systems: [],
    connections: [],
    warnings: [],
  }
}

describe('pass — 기준선 통과', () => {
  it('층별 위반이 0 인 층만 밝아지는 판을 만들고 위반이 남은 층은 빼며, 한 세션에 한 번만 발동한다', () => {
    resetPassSession()
    const m = sampleModel()
    const sweep = buildPassSweep(
      m,
      new Map([
        ['S1', 0],
        ['S2', 2],
      ]),
    )
    expect(sweep.zeroStoreyIds).toEqual(['S1'])
    sweep.dispose()

    const violations = ref(2)
    const accepted = ref<boolean | null>(false)
    const storeyViolations = ref<ReadonlyMap<string, number>>(
      new Map([
        ['S1', 0],
        ['S2', 2],
      ]),
    )
    const hud = {
      style: { cssText: '', display: '' },
      textContent: '',
    } as unknown as HTMLElement

    const ctx: EggContext = {
      model: () => m,
      modelVersion: () => 1,
      addLayer: () => () => {},
      lights: () => () => {},
      wide: () => {},
      still: () => true,
      dark: () => false,
      hud,
      overlay: hud,
      camera: { pose: () => ({ position: [0, 0, 0], target: [0, 0, 0] }), look() {}, orbit() {} },
      signals: {
        violations,
        storeyViolations,
        accepted,
        flying: ref(false),
        replaying: ref(false),
        storeyId: ref(null),
      },
    }

    const handle = enable(ctx)
    expect((handle.inspect?.() as any).triggered).toBe(false)

    // 수용 기준선이 미달(false)에서 통과(true)로 바뀌되 2F 에 위반이 남은 순간: S1 만 밝아진다.
    accepted.value = true
    const info1 = handle.inspect?.() as any
    expect(info1.triggered).toBe(true)
    expect(info1.zeroStoreys).toEqual(['S1'])
    expect(info1.litStoreys).toEqual(['S1'])
    expect(info1.hud).toContain('화면에서만')

    // 되돌렸다가 다시 통과해도 한 파일·한 세션에는 다시 틀지 않는다.
    accepted.value = false
    violations.value = 0
    accepted.value = true
    const info2 = handle.inspect?.() as any
    expect(info2.zeroStoreys).toEqual(['S1'])

    handle.off()
  })
})
