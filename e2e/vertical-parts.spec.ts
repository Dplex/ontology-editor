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
  expect(await page.evaluate(() => (window as any).__viewer.verticalMarks())).toEqual({ entry: 0, exit: 3, rise: 0 })
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
