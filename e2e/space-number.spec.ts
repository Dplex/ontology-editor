import { expect, test } from '@playwright/test'

// 물리존 방번호(OE-OBJ-02). 방번호(IfcSpace Name)는 한 층 안에서 겹치지 않고, 공간명은 겹쳐도 된다. 고른 물리존 패널에서 고치며
// 되돌리기·연 때와 견주기에 든다. two-rooms.ifc 의 1F 에 회의실(101)과 복도(102)가 있다.
const FIXTURE = 'src/lib/ifc/fixtures/two-rooms.ifc'

test('같은 층에 있는 방번호로는 바꾸지 않고 원래 번호로 돌아가며, 겹치지 않는 번호는 바뀌고 Ctrl+Z 로 돌아온다', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(FIXTURE)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '편집', exact: true }).click()
  await page.getByRole('combobox', { name: '보일 층' }).selectOption({ label: '1F만' })
  await page.locator('.viewport canvas').scrollIntoViewIfNeeded()
  await page.waitForTimeout(400)

  // 회의실 바닥을 눌러 고른다
  const at = (await page.evaluate(() => (window as any).__viewer.point([4, 2.5, 0.1]))) as { x: number; y: number }
  await page.mouse.click(at.x, at.y)
  const panel = page.locator('.space-picked')
  await expect(panel).toContainText('회의실')
  const number = panel.getByTestId('space-number')
  await expect(number).toHaveValue('101')

  // 복도의 번호(102)로는 바꾸지 않는다
  await number.fill('102')
  await number.press('Enter')
  await expect(page.locator('.edit-notice').first()).toContainText('방번호 102가 이미 있습니다')
  await expect(number).toHaveValue('101')
  await expect(page.locator('.edit-bar')).toContainText('바뀐 것 0건')
  await page.screenshot({ path: 'test-results/space-number.png' })

  // 공간명은 겹쳐도 된다 — 회의실 공간명을 복도로
  const name = panel.locator('.space-name input')
  await name.fill('복도')
  await name.press('Enter')
  await expect(panel.locator('h3')).toHaveText('복도')

  // 겹치지 않는 번호는 바뀐다
  await number.fill('101A')
  await number.press('Enter')
  await expect(number).toHaveValue('101A')
  await expect(page.locator('.report')).toContainText('물리존 방번호 101 → 101A')

  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('Control+z')
  await expect(page.locator('.report')).not.toContainText('방번호')
  expect(errors).toEqual([])
})
