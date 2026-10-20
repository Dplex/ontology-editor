import { expect, test } from '@playwright/test'
import { enterEdit, openDrawer, pickSpace, toSpace } from './edit-part'

// 물리존 경계 수정(OE-SPC-03)과 기준 · 검증 패널의 규칙 경고(OE-P3-01). 꼭짓점이 셋 남은 물리존에서 Delete 를 누르면 지우지 않고 알린다.
// mep.ifc 의 사무실은 (0,0)(10,0)(10,8)(0,8) 이다. 표에서 꼭짓점 좌표를 자기교차로 고치던 시험은 물리존 표가 빠져서(#715) 지웠다.
const MEP = 'src/lib/ifc/fixtures/mep.ifc'

test('꼭짓점이 셋이면 Delete 가 지우지 않고 알린다 [OE-SPC-03#3]', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(MEP)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  await enterEdit(page)
  await toSpace(page)
  await pickSpace(page, '사무실')
  const panel = page.locator('.space-picked')
  await expect(panel).toContainText('80.0')
  const handles = () => page.evaluate(() => (window as any).__viewer.handles().length as number)
  await page.keyboard.press(']')
  await page.keyboard.press('Delete')
  await expect.poll(handles).toBe(3)
  await expect(panel).toContainText('40.0')
  await page.keyboard.press('Delete')
  await expect(page.locator('.key-note')).toContainText('꼭짓점이 셋이라 더 지울 수 없습니다')
  expect(await handles()).toBe(3)
  await page.locator('.appbar h2').click()
  await page.keyboard.press('Control+z')
  await expect.poll(handles).toBe(4)

  expect(errors).toEqual([])
})

test('편집 중 기준 · 검증 패널에 규칙별 경고 수와 목록이 보이고, 항목을 누르면 그 물리존을 고르며, 위반을 고치면 목록에서 바로 빠진다 [OE-P3-01#2,3]', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(MEP)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  await enterEdit(page)
  await toSpace(page)
  await pickSpace(page, '사무실')
  await page.locator('.canvas-wrap > canvas').scrollIntoViewIfNeeded()
  await page.waitForTimeout(200)

  // 사무실(10×8, 설비 4대)을 x=9 에서 나누면 1×8=8㎡ 조각(사무실-02)이 생기고 그 조각에는 설비가 없어 W-02 에 걸린다.
  const panel = page.locator('.space-picked')
  await panel.getByRole('button', { name: '나누기' }).click()
  const p0 = (await page.evaluate(() => (window as any).__viewer.point([9, -1, 0]))) as { x: number; y: number }
  await page.mouse.click(p0.x, p0.y)
  const p1 = (await page.evaluate(() => (window as any).__viewer.point([9, 9, 0]))) as { x: number; y: number }
  await page.mouse.click(p1.x, p1.y)
  await expect(page.locator('.key-note')).toContainText('둘로 나눴습니다')
  await pickSpace(page, '사무실')
  await expect(panel.locator('h3')).toContainText('사무실')

  await openDrawer(page)
  const rulesFold = page.getByTestId('drawer-rule-warnings')
  const head = rulesFold.locator('.fold-head')
  if ((await head.getAttribute('aria-expanded')) !== 'true') await head.click()
  await expect(rulesFold.locator('li[data-rule="W-02"]')).toContainText('설비가 하나도 없는 물리존: 1개')
  await rulesFold.getByLabel('W-01 최소 면적(㎡)').fill('10')
  await rulesFold.getByLabel('W-01 최소 면적(㎡)').press('Tab')
  await expect(rulesFold.locator('li[data-rule="W-01"]')).toContainText('물리존 면적이 10㎡ 미만: 1개')

  // 항목을 누르면 그 물리존(사무실-02, 8.0㎡)이 골라진다.
  await rulesFold.locator('li[data-rule="W-01"]').getByRole('button').first().click()
  await expect(panel).toContainText('8.0')

  // 합쳐서 위반을 고치면 목록에서 바로 빠진다(OE-P3-01#3).
  await panel.locator('select[aria-label="합칠 물리존"]').selectOption({ index: 1 })
  await expect(panel).toContainText('80.0')
  await openDrawer(page)
  if ((await head.getAttribute('aria-expanded')) !== 'true') await head.click()
  await expect(rulesFold.locator('li[data-rule="W-01"]')).toHaveCount(0)
  await expect(rulesFold.locator('li[data-rule="W-02"]')).toHaveCount(0)
  await expect(rulesFold).toContainText('규칙을 어긴 물리존이 없습니다.')

  expect(errors).toEqual([])
})
