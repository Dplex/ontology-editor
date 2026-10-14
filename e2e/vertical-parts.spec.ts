import { existsSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'

// 수직 관통 오브젝트(계단)는 층 편집 화면에서 고르고 보기만 한다(OE-ML-05 · OE-OBJ-14). 층마다 그 층의 형상과 진입·종료 지점을 그리고,
// 패널은 관통 층·연관 물리존을 말한다. 끌기·방향키·Delete 는 데이터를 바꾸지 않고 [다중층 뷰에서 편집] 을 안내한다.
// 병원 건축의 계단 3개는 모두 1층에서 2층으로 오른다(OE-ML-02). 1층 조각은 형상 + 진입 지점, 2층 조각은 종료 지점뿐이다.
const CLINIC = 'data/NBU_MedicalClinic/NBU_MedicalClinic_Arch.ifc'
const storeyBox = (page: Page) => page.getByRole('combobox', { name: '보일 층' })
const tab = (page: Page, name: '3D' | '평면도') => page.getByRole('group', { name: '보기' }).getByRole('button', { name }).click()

test('병원 건축: 계단 조각을 평면도·3D 에서 고르면 읽기 전용 패널이 뜨고, 옮기기·지우기는 막히며, 다시 누르면 아래 계단실이 골라진다 [OE-ML-05#1~,2] [OE-OBJ-14#1~,2]', async ({ page }) => {
  test.skip(!existsSync(CLINIC), `${CLINIC} 이 없다(npm run fetch:sample)`)
  test.setTimeout(180_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(CLINIC)
  await expect(page.locator('.appbar h2')).toHaveText('NBU_MedicalClinic_Arch.ifc', { timeout: 120_000 })
  await storeyBox(page).selectOption({ label: 'First Floor만' })
  await tab(page, '평면도')
  const plan = page.getByRole('img', { name: 'First Floor 평면도' })

  // 1층: 계단 3개의 형상과 진입 지점. 종료 지점은 2층에 있다.
  const stairs = plan.locator('.verticals polygon')
  await expect(stairs).toHaveCount(3)
  await expect(plan.locator('.verticals circle.entry')).toHaveCount(3)
  await expect(plan.locator('.verticals circle.exit')).toHaveCount(0)

  // 고르면 패널: 시작 층, 관통 층, 진입 지점, 연관 물리존(계단실).
  const stair = stairs.first()
  const id = (await stair.getAttribute('data-vertical'))!
  await stair.click({ force: true })
  const panel = page.getByTestId('vertical-picked')
  await expect(panel).toBeVisible()
  await expect(panel.locator('h3')).toContainText('Stair')
  await expect(panel.getByTestId('vertical-role')).toContainText('시작 층')
  await expect(panel.getByTestId('vertical-storeys')).toContainText('First Floor → Second Floor')
  await expect(panel.getByTestId('vertical-entry')).toBeVisible()
  await expect(panel.getByTestId('vertical-exit')).toHaveCount(0)
  const related = panel.getByTestId('vertical-spaces').getByRole('button')
  await expect(related).toHaveCount(1)
  const stairwell = (await related.textContent())!.trim()
  await expect(plan.locator('.verticals polygon.chosen')).toHaveAttribute('data-vertical', id)

  // 편집 모드: 안내와 누를 수 없는 [다중층 뷰에서 편집]. Delete·방향키는 데이터를 바꾸지 않는다.
  await page.getByRole('button', { name: '편집', exact: true }).click()
  const lock = panel.locator('.ceiling-lock')
  await expect(lock).toContainText('계단은 수직 관통 오브젝트라 층 편집 화면에서는 옮기거나 지우거나')
  await expect(lock.getByRole('button', { name: '다중층 뷰에서 편집' })).toBeEnabled()
  const ring = await stair.getAttribute('points')
  const entry = await panel.getByTestId('vertical-entry').textContent()
  await page.keyboard.press('Delete')
  await expect(page.locator('.edit-notice')).toContainText('수직 관통 오브젝트라')
  await page.keyboard.press('ArrowRight')
  await expect(stairs).toHaveCount(3)
  expect(await stair.getAttribute('points')).toBe(ring)
  await expect(panel.getByTestId('vertical-entry')).toHaveText(entry!)
  // 되돌릴 것이 생기지 않았다.
  await expect(page.locator('.edit-bar .undo')).toBeDisabled()

  // 같은 계단을 다시 누르면 그 자리의 물리존(계단실)이 골라진다.
  await stair.click({ force: true })
  await expect(panel).toHaveCount(0)
  await expect(page.locator('.space-picked h3')).toHaveText(stairwell)

  // 패널의 관통 층에서 2층을 누르면 2층으로 가서 같은 계단의 끝 층 조각을 고른다. 2층은 종료 지점뿐이다.
  await stair.click({ force: true })
  await panel.getByTestId('vertical-storeys').getByRole('button', { name: 'Second Floor' }).click()
  await expect(storeyBox(page).locator('option:checked')).toHaveText('Second Floor만')
  const plan2 = page.getByRole('img', { name: 'Second Floor 평면도' })
  await expect(plan2.locator('.verticals polygon')).toHaveCount(0)
  await expect(plan2.locator('.verticals circle.exit')).toHaveCount(3)
  await expect(panel.getByTestId('vertical-role')).toContainText('끝 층')
  await expect(panel.getByTestId('vertical-exit')).toBeVisible()
  await expect(panel.getByTestId('vertical-entry')).toHaveCount(0)
  await expect(plan2.locator('.verticals circle.exit.chosen')).toHaveCount(1)
  const top = (await plan2.locator('.verticals circle.exit.chosen').getAttribute('data-vertical'))!
  expect(top.split('@')[0]).toBe(id.split('@')[0])
  await page.keyboard.press('Escape')
  await expect(panel).toHaveCount(0)

  // 3D 에서도 같다: 2층의 종료 지점 3개가 그려지고, 누르면 패널이 뜬다.
  await tab(page, '3D')
  const shown: string[] = await page.evaluate(() => (window as any).__viewer.verticals())
  expect(shown).toHaveLength(3)
  expect(await page.evaluate(() => (window as any).__viewer.verticalMarks())).toMatchObject({ entry: 0, exit: 3, rise: 0 })
  const at = await page.evaluate((key) => (window as any).__viewer.vertical(key), top)
  await page.mouse.click(at.x, at.y)
  await expect(panel.getByTestId('vertical-role')).toContainText('끝 층')
  // 3D 에서 끌어도 그대로다(끌기는 시점만 돌린다).
  const exit = await panel.getByTestId('vertical-exit').textContent()
  await page.mouse.move(at.x, at.y)
  await page.mouse.down()
  await page.mouse.move(at.x + 80, at.y + 20, { steps: 6 })
  await page.mouse.up()
  await expect(panel.getByTestId('vertical-exit')).toHaveText(exit!)
  // 3D 에서도 고른 조각을 다시 누르면 그 아래 물리존이 골라진다(2층 계단실).
  const again = await page.evaluate((key) => (window as any).__viewer.vertical(key), top)
  await page.mouse.click(again.x, again.y)
  await expect(panel).toHaveCount(0)
  await expect(page.locator('.space-picked h3')).toBeVisible()
  expect(errors).toEqual([])
})

test('Duplex: 다중층 뷰에서 만든 샤프트는 층 편집 화면에서 고르면 읽기 전용이고, 끌기·방향키·Delete 가 데이터를 바꾸지 않는다. 만들 때 채울 것과 그리는 형상이 종류마다 다르다 [OE-ML-05#1~] [OE-ML-02#3]', async ({ page }) => {
  const DUPLEX = 'data/NBU_Duplex/NBU_Duplex-Apt_Eng-MEP.ifc'
  test.skip(!existsSync(DUPLEX), `${DUPLEX} 이 없다(npm run fetch:sample)`)
  test.setTimeout(180_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  const point = (p: number[]) => page.evaluate((a) => (window as any).__viewer.point(a), p) as Promise<{ x: number; y: number }>
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(DUPLEX)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 90_000 })
  await storeyBox(page).selectOption({ label: 'Level 1만' })
  await page.getByRole('button', { name: '편집', exact: true }).click()
  await page.getByRole('button', { name: '다중층 뷰에서 편집' }).click()
  await page.getByTestId('multi-banner').getByRole('button', { name: '수직 관통 오브젝트 만들기' }).click()
  const form = page.getByTestId('vertical-create')
  const create = page.getByTestId('vertical-create-plan')
  // 채울 것이 종류마다 다르다(OE-ML-02 AC3): 계단·에스컬레이터는 층별 형상과 진입·종료 지점, 샤프트·엘리베이터는 공통 축 형상 하나다.
  const steps = page.getByTestId('vertical-create-steps').locator('li .step-text')
  for (const label of ['계단', '에스컬레이터']) {
    await form.getByLabel('만들 종류').selectOption({ label })
    await expect(steps).toHaveText(['Level 1 · 형상', 'Level 1 · 진입 지점', 'Level 2 · 종료 지점'])
  }
  for (const label of ['엘리베이터', '샤프트']) {
    await form.getByLabel('만들 종류').selectOption({ label })
    await expect(steps).toHaveText(['Level 1 · 형상'])
  }
  await form.getByLabel('만들 이름').fill('PS-1')
  await create.getByRole('button', { name: '형상 그리기' }).click()
  await page.locator('.canvas-wrap > canvas').scrollIntoViewIfNeeded()
  for (const [x, y] of [[0.0, -15.2], [0.9, -15.2], [0.9, -14.4], [0.0, -14.4]]) {
    const at = await point([x, y, 0])
    await page.mouse.click(at.x, at.y)
  }
  await page.keyboard.press('Enter')
  await expect(create).toContainText('다 채웠습니다')
  await form.getByRole('button', { name: '만들기', exact: true }).click()
  await expect(page.getByTestId('vertical-picked').locator('h3')).toHaveText('PS-1')
  await expect(page.getByTestId('vertical-picked')).toContainText('모든 층이 같은 공통 축이라 한 층만 고치지 않습니다')

  // 층 편집 화면으로 돌아와 평면도에서 샤프트 조각을 고른다.
  await page.getByRole('button', { name: '층 편집으로' }).first().click()
  await expect(page.getByTestId('multi-banner')).toHaveCount(0)
  // 계단·샤프트는 공간 편집 모드에서 다룬다(OE-ML-01).
  await page.getByRole('group', { name: '편집 대상' }).getByRole('button', { name: '공간' }).click()
  await tab(page, '평면도')
  const plan = page.getByRole('img', { name: 'Level 1 평면도' })
  const shaft = plan.locator('.verticals polygon').first()
  await expect(shaft).toBeVisible()
  const ring = await shaft.getAttribute('points')
  // 만든 직후라 PS-1 이 골라져 있다. 고른 조각을 다시 누르면 그 아래 물리존이 골라지므로 먼저 비운다.
  const panel = page.getByTestId('vertical-picked')
  await page.keyboard.press('Escape')
  await expect(panel).toHaveCount(0)
  // 가운데에는 라디에이터(536919) 점이 있어 그것이 골라진다. 모서리를 누른다.
  await shaft.click({ force: true, position: { x: 3, y: 3 } })
  await expect(panel.locator('h3')).toHaveText('PS-1')
  const lock = panel.locator('.ceiling-lock')
  await expect(lock).toContainText('샤프트는 수직 관통 오브젝트라 층 편집 화면에서는 옮기거나 지우거나 형상·구간을 바꾸지 않습니다')
  // 패널에는 지우기·형상 고치기 칸이 없다.
  await expect(panel.getByRole('button', { name: '샤프트 지우기' })).toHaveCount(0)
  await page.keyboard.press('Delete')
  await expect(page.locator('.edit-notice')).toContainText('수직 관통 오브젝트라')
  await page.keyboard.press('ArrowRight')
  // 3D 에서 끌어도 그대로다.
  await tab(page, '3D')
  await page.locator('.canvas-wrap > canvas').scrollIntoViewIfNeeded()
  const from = await point([0.45, -14.8, 0.22])
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + 80, from.y + 30, { steps: 6 })
  await page.mouse.up()
  await tab(page, '평면도')
  await expect(plan.locator('.verticals polygon').first()).toHaveAttribute('points', ring!)
  // 공통 축이라 2층에도 같은 형상이 그려진다(계단은 끝 층에 종료 지점만 있다 — 위 병원 건축 시험).
  await page.keyboard.press('Escape')
  await storeyBox(page).selectOption({ label: 'Level 2만' })
  // 평면도 좌표는 층마다 그림 범위가 달라 원점이 다르다. 첫 꼭짓점에서 잰 모양을 비교한다.
  const shape = (pts: string) => {
    const xy = pts.trim().split(/\s+/).map((p) => p.split(',').map(Number))
    return xy.map(([x, y]) => `${(x - xy[0][0]).toFixed(3)},${(y - xy[0][1]).toFixed(3)}`).join(' ')
  }
  const upper = page.getByRole('img', { name: 'Level 2 평면도' }).locator('.verticals polygon')
  await expect(upper).toHaveCount(1)
  expect(shape((await upper.getAttribute('points'))!)).toBe(shape(ring!))
  // 샤프트를 만든 것 말고는 되돌릴 것이 생기지 않았다.
  await expect(page.locator('.edit-bar .undo')).toHaveAttribute('title', /샤프트|PS-1|만듦/)
  expect(errors).toEqual([])
})
