import { describe, expect, it } from 'vitest'
import { ratioLabel, storeyScaleMismatch, typicalStoreyHeight } from './unit-check'

const levels = (...xs: [string, number][]) => xs.map(([name, elevation]) => ({ name, elevation }))

// Duplex 건축(m) 의 층 높이. 같은 건물의 COBie(Design) 판본은 단위를 밀리미터로 선언하고 미터 값을 적어 1/1000 로 들어온다.
const ARCH = levels(['Level 1', 0], ['Level 2', 3.1], ['Roof', 6.0])

describe('storeyScaleMismatch', () => {
  it('같은 단위면 null 이다', () => {
    expect(storeyScaleMismatch(ARCH, ARCH)).toBeNull()
    // float 로 적힌 값(3.0999999)도 같은 것으로 본다.
    expect(storeyScaleMismatch(ARCH, levels(['Level 2', 3.0999999]))).toBeNull()
  })

  it('미터 값을 밀리미터로 선언한 판본은 1/1000 로 잡는다', () => {
    const cobie = levels(['Level 1', 0], ['Level 2', 0.0030999999], ['Roof', 0.006])
    const m = storeyScaleMismatch(ARCH, cobie)!
    expect(m.ratio).toBe(1 / 1000)
    expect(m.what).toBe('밀리미터 ↔ 미터')
    // 1층(0)은 비를 잴 수 없어 빠진다.
    expect(m.storeys.map(([n]) => n)).toEqual(['Level 2', 'Roof'])
    // 층간 높이가 3.1mm 인 쪽(둘째)이 틀렸다. 순서를 바꾸면 첫째다.
    expect(m.suspect).toBe('second')
    expect(storeyScaleMismatch(cobie, ARCH)!.suspect).toBe('first')
    // 방향이 반대면 역수다 — 선언이 없어 밀리미터 값이 미터로 들어온 경우.
    expect(storeyScaleMismatch(ARCH, levels(['Level 2', 3100], ['Roof', 6000]))!.ratio).toBe(1000)
  })

  it('피트·인치·센티미터 배수도 잡는다', () => {
    expect(storeyScaleMismatch(ARCH, levels(['Level 2', 3.1 / 0.3048]))!.what).toBe('피트 ↔ 미터')
    expect(storeyScaleMismatch(ARCH, levels(['Level 2', 3.1 / 0.0254]))!.what).toBe('인치 ↔ 미터')
    expect(storeyScaleMismatch(ARCH, levels(['Level 2', 310]))!.what).toBe('센티미터 ↔ 미터')
    expect(storeyScaleMismatch(levels(['L2', 10]), levels(['L2', 120]))!.what).toBe('인치 ↔ 피트')
  })

  it('한 층만 다르면 단위가 아니라 기준점 차이라 null 이다', () => {
    // Level 2 만 1000배. Roof 는 그대로 — 모든 짝이 같은 배수가 아니다.
    expect(storeyScaleMismatch(ARCH, levels(['Level 2', 3100], ['Roof', 6.0]))).toBeNull()
    // 둘 다 바뀌었지만 배수가 서로 다르다.
    expect(storeyScaleMismatch(ARCH, levels(['Level 2', 3100], ['Roof', 600]))).toBeNull()
    // 배수에서 2% 넘게 벗어나면 우연이 아니라고 볼 수 없다(기준점 +0.6m 같은 것).
    expect(storeyScaleMismatch(ARCH, levels(['Level 2', 3.1 * 1000 * 1.03]))).toBeNull()
  })

  it('0 근처 층과 이름이 없는 짝은 견주지 않는다', () => {
    // 지상 1층끼리만 짝지어지면 잴 것이 없다.
    expect(storeyScaleMismatch(ARCH, levels(['Level 1', 0]))).toBeNull()
    // 둘 다 0.5m 아래면 12배여도 견주지 않는다. 한쪽이 크면(3.1mm ↔ 3.1m) 견준다 — 줄어든 쪽을 놓치지 않으려고.
    expect(storeyScaleMismatch(levels(['B', 0.01]), levels(['B', 0.12]))).toBeNull()
    expect(storeyScaleMismatch(levels(['B', 0.1]), levels(['B', 100]))!.ratio).toBe(1000)
    // 한쪽만 0 이면 비가 무한이다.
    expect(storeyScaleMismatch(levels(['L2', 3]), levels(['L2', 0]))).toBeNull()
    // 이름이 하나도 맞지 않는다.
    expect(storeyScaleMismatch(ARCH, levels(['2F', 3100]))).toBeNull()
    // 이름 앞뒤 공백은 같은 층이다.
    expect(storeyScaleMismatch(ARCH, levels([' Level 2 ', 3100]))!.ratio).toBe(1000)
  })

  it('지하층(음수)도 같은 배수면 잡고, 부호가 다르면 잡지 않는다', () => {
    const base = levels(['B1', -3.5], ['Level 2', 3.1])
    expect(storeyScaleMismatch(base, levels(['B1', -3500], ['Level 2', 3100]))!.ratio).toBe(1000)
    expect(storeyScaleMismatch(base, levels(['B1', 3500]))).toBeNull()
  })
})

describe('어느 쪽이 틀렸나 (층간 높이)', () => {
  it('위아래 층 높이 차의 중앙값을 잰다', () => {
    expect(typicalStoreyHeight(levels(['T/FDN', -1.25], ['Level 1', 0], ['Level 2', 3.1], ['Roof', 6]))).toBeCloseTo(2.9, 9)
    expect(typicalStoreyHeight(levels(['1F', 0]))).toBeNull()
    // 같은 높이의 층(메자닌 이름만 다른 것)은 하나로 본다.
    expect(typicalStoreyHeight(levels(['1F', 0], ['1F-M', 0], ['2F', 4]))).toBe(4)
  })

  it('한쪽만 2~12m 면 다른 쪽을 짚고, 둘 다 말이 되거나 층이 하나면 짚지 않는다', () => {
    expect(storeyScaleMismatch(levels(['1F', 0], ['2F', 3]), levels(['1F', 0], ['2F', 3000]))!.suspect).toBe('second')
    // 피트 ↔ 미터: 3m 와 9.84m 둘 다 층간 높이로 말이 된다.
    expect(storeyScaleMismatch(levels(['1F', 0], ['2F', 3]), levels(['1F', 0], ['2F', 3 / 0.3048]))!.suspect).toBeNull()
    // 층이 하나뿐인 파일은 층간 높이가 없다.
    expect(storeyScaleMismatch(levels(['2F', 3]), levels(['2F', 3000]))!.suspect).toBeNull()
  })
})

describe('ratioLabel', () => {
  it('배수를 사람이 읽게 쓴다', () => {
    expect(ratioLabel(1000)).toBe('1000배')
    expect(ratioLabel(1 / 1000)).toBe('1/1000')
    expect(ratioLabel(1 / 0.3048)).toBe('3.28배')
    expect(ratioLabel(0.3048)).toBe('1/3.28')
  })
})
