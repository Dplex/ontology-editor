import { expect, test, type Page } from '@playwright/test'

// 벽·문·창 편집(E4)을 실제 마우스로 한다. mep.ifc 에는 벽이 없어서 벽부터 긋는다. 바닥 자리는 e2e 모드에서만 열리는
// window.__viewer.point 로 묻는다(viewer.ts).
const MEP = 'src/lib/ifc/fixtures/mep.ifc'

async function open(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(MEP)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '편집', exact: true }).click()
  await page.locator('.viewport canvas').scrollIntoViewIfNeeded()
  await page.waitForTimeout(200)
  return errors
}

async function clickFloor(page: Page, x: number, y: number, z = 0) {
  const at = (await page.evaluate(([px, py, pz]) => (window as any).__viewer.point([px, py, pz]), [x, y, z])) as { x: number; y: number }
  await page.mouse.click(at.x, at.y)
}

test('벽을 긋고 문을 놓으면 양쪽 방을 잇고, 벽을 지우면 문도 빠지며 Ctrl+Z 로 돌아온다', async ({ page }) => {
  const errors = await open(page)
  // 사무실(0..10) 오른쪽에 창고를 먼저 그린다.
  await page.getByRole('button', { name: '물리존 그리기' }).click()
  for (const [x, y] of [[10.2, 0], [14, 0], [14, 8], [10.2, 8]]) await clickFloor(page, x, y)
  await page.keyboard.press('Enter')
  await expect(page.locator('.space-picked')).toContainText('새 물리존 1')

  await page.getByRole('button', { name: '벽·문·창' }).click()
  await page.getByRole('button', { name: '벽 긋기' }).click()
  await clickFloor(page, 10.1, 0)
  await clickFloor(page, 10.1, 8)
  const panel = page.locator('.element-picked')
  await expect(panel.locator('h3')).toHaveText('새 벽')
  await expect(panel.locator('select')).toHaveValue('null')
  await panel.locator('select').selectOption('true')
  await expect(panel.locator('select')).toHaveValue('true')

  await page.getByRole('button', { name: '문 놓기' }).click()
  await clickFloor(page, 10.1, 4)
  await expect(panel.locator('h3')).toHaveText('새 문')
  await expect(panel).toContainText('사무실')
  await expect(panel).toContainText('새 물리존 1')

  // 문을 창고 벽 끝 너머로 옮기면 창고 쪽 방이 빠진다(창고는 y 0..8).
  const y = panel.locator('.position-edit .coord').nth(1)
  await y.fill('9')
  await y.press('Enter')
  await expect(panel).not.toContainText('새 물리존 1')

  // 벽을 골라 지우면 뚫린 문도 같이 빠진다. 세워 그린 벽(바닥 판 위 1.2m)의 윗면을 누른다.
  await clickFloor(page, 10.1, 2, 1.3)
  await expect(panel.locator('h3')).toHaveText('새 벽')
  await panel.getByRole('button', { name: '벽 지우기' }).click()
  await expect(panel).toHaveCount(0)
  expect(await page.evaluate(() => (window as any).__viewer.elements().length)).toBe(0)

  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('Control+z')
  await expect.poll(() => page.evaluate(() => (window as any).__viewer.elements().length)).toBe(2)
  expect(errors).toEqual([])
})

test('벽에서 먼 자리에는 문을 놓지 않고 이유를 알린다', async ({ page }) => {
  const errors = await open(page)
  await page.getByRole('button', { name: '벽·문·창' }).click()
  await page.getByRole('button', { name: '벽 긋기' }).click()
  await clickFloor(page, 10.1, 0)
  await clickFloor(page, 10.1, 8)
  await page.getByRole('button', { name: '문 놓기' }).click()
  await clickFloor(page, 5, 4)
  await expect(page.locator('.key-note')).toContainText('벽에서')
  expect(errors).toEqual([])
})
