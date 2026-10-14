import { expect, test, type Page } from '@playwright/test'

// 엘리베이터 정차 층(OE-ML-10)과 로봇 통과(OE-ML-04). two-rooms.ifc + mep.ifc 를 합치면 층이 둘(1F·2F)이다.
// 다중층 뷰에서 엘리베이터를 만들면 두 층 모두 정차로 시작하고, 2F 를 무정차로 바꾸면 그 층의 로봇 통과가 불가가 된다.
const MEP = 'src/lib/ifc/fixtures/mep.ifc'
const ROOMS = 'src/lib/ifc/fixtures/two-rooms.ifc'

const viewer = <T,>(page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(([f, a]) => (window as any).__viewer[f as string](...(a as unknown[])), [fn, args] as const) as Promise<T>

test('다중층 뷰에서 만든 엘리베이터는 전 층 정차로 시작하고, 층마다 무정차로 바꾸면 그 층의 로봇 통과가 불가가 되며, 되돌리면 돌아온다 [OE-ML-10#1~] [OE-ML-04#1~]', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles([MEP, ROOMS])
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '편집', exact: true }).click()
  await page.getByRole('combobox', { name: '보일 층' }).selectOption({ label: '1F만' })
  await page.getByRole('button', { name: '다중층 뷰에서 편집' }).click()
  await expect(page.getByTestId('multi-banner')).toContainText('1F ~ 2F')
  await page.locator('.canvas-wrap > canvas').scrollIntoViewIfNeeded()

  await page.getByTestId('multi-banner').getByRole('button', { name: '수직 관통 오브젝트 만들기' }).click()
  const form = page.getByTestId('vertical-create')
  await form.getByLabel('만들 종류').selectOption({ label: '엘리베이터' })
  await form.getByLabel('만들 이름').fill('EL-1')
  const plan = page.getByTestId('vertical-create-plan')
  await plan.getByRole('button', { name: '형상 그리기' }).click()
  for (const [x, y] of [[12, 1], [14, 1], [14, 3], [12, 3]]) {
    const at = await viewer<{ x: number; y: number }>(page, 'point', [x, y, 0])
    await page.mouse.click(at.x, at.y)
  }
  await page.keyboard.press('Enter')
  await expect(plan).toContainText('다 채웠습니다')
  await form.getByRole('button', { name: '만들기', exact: true }).click()

  const panel = page.getByTestId('vertical-picked')
  await expect(panel.locator('h3')).toHaveText('EL-1')
  const stops = panel.getByTestId('elevator-stops')
  await expect(stops.getByLabel('1F 정차')).toHaveValue('stop')
  await expect(stops.getByLabel('2F 정차')).toHaveValue('stop')
  await expect(panel.getByTestId('vertical-passable')).toContainText('통과 가능')

  // 2F 를 무정차로. 2F 조각을 고르면 그 층은 통과 불가다.
  await stops.getByLabel('2F 정차').selectOption('skip')
  await expect(page.locator('.edit-bar .last-edit')).toContainText('엘리베이터 2F 무정차')
  await panel.getByTestId('vertical-storeys').getByRole('button', { name: '2F' }).click()
  await expect(panel.getByTestId('vertical-passable')).toContainText('2F: 통과 불가 — 서지 않는 층입니다')

  // 되돌리면 정차로 돌아온다.
  await page.locator('.edit-bar .undo').click()
  await expect(stops.getByLabel('2F 정차')).toHaveValue('stop')
  await expect(panel.getByTestId('vertical-passable')).toContainText('2F: 통과 가능')
  expect(errors).toEqual([])
})

test('다중층 뷰에서 만든 에스컬레이터는 방향이 미확인으로 시작하고, 상행을 고르면 운행 시작·종료 지점이 보이며 로봇 통과는 불가 그대로다 [OE-ML-11#1~,4]', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles([MEP, ROOMS])
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '편집', exact: true }).click()
  await page.getByRole('combobox', { name: '보일 층' }).selectOption({ label: '1F만' })
  await page.getByRole('button', { name: '다중층 뷰에서 편집' }).click()
  await page.locator('.canvas-wrap > canvas').scrollIntoViewIfNeeded()
  await page.getByTestId('multi-banner').getByRole('button', { name: '수직 관통 오브젝트 만들기' }).click()
  const form = page.getByTestId('vertical-create')
  await form.getByLabel('만들 종류').selectOption({ label: '에스컬레이터' })
  await form.getByLabel('만들 이름').fill('ES-1')
  // 1F 형상 → 1F 진입 지점 → 2F(3m) 종료 지점을 차례로 채운다.
  await page.getByTestId('vertical-create-start').click()
  for (const [x, y] of [[12, 1], [13, 1], [13, 4], [12, 4]]) {
    const at = await viewer<{ x: number; y: number }>(page, 'point', [x, y, 0])
    await page.mouse.click(at.x, at.y)
  }
  await page.keyboard.press('Enter')
  const entry = await viewer<{ x: number; y: number }>(page, 'point', [12.5, 1.2, 0])
  await page.mouse.click(entry.x, entry.y)
  const exit = await viewer<{ x: number; y: number }>(page, 'point', [12.5, 3.8, 3])
  await page.mouse.click(exit.x, exit.y)
  await expect(page.getByTestId('vertical-create-plan')).toContainText('다 채웠습니다')
  await form.getByRole('button', { name: '만들기', exact: true }).click()

  const panel = page.getByTestId('vertical-picked')
  await expect(panel.locator('h3')).toHaveText('ES-1')
  const direction = panel.getByTestId('escalator-direction')
  await expect(direction.getByLabel('운행 방향')).toHaveValue('unknown')
  await direction.getByLabel('운행 방향').selectOption('up')
  await expect(page.locator('.edit-bar .last-edit')).toContainText('에스컬레이터 상행')
  // 상행: 1F(0m) 진입 → 2F(3m) 종료.
  await expect(direction).toContainText(/12\.50, 1\.20, 0\.00 → 12\.50, 3\.80, 3\.00/)
  await expect(panel.getByTestId('vertical-passable')).toContainText('통과 불가')
  await page.locator('.edit-bar .undo').click()
  await expect(direction.getByLabel('운행 방향')).toHaveValue('unknown')
  expect(errors).toEqual([])
})
