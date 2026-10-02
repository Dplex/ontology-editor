import { expect, test, type Page } from '@playwright/test'

// 외벽 판정(OE-EXT-01)을 화면에서 본다. mep.ifc 에는 벽이 없어서 벽을 긋는다 — 그은 벽은 IsExternal 이 없으니
// 건물 바깥에 닿는지로 계산되고, 패널에 [계산] 출처가 붙는다. 바닥 자리는 e2e 모드의 window.__viewer.point 로 묻는다.
const MEP = 'src/lib/ifc/fixtures/mep.ifc'

async function clickFloor(page: Page, x: number, y: number, z = 0) {
  const at = (await page.evaluate(([px, py, pz]) => (window as any).__viewer.point([px, py, pz]), [x, y, z])) as { x: number; y: number }
  await page.mouse.click(at.x, at.y)
}

test('그은 벽은 방 사이면 내벽, 건물 밖이면 외벽으로 계산되고 출처가 [계산] 이다', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(MEP)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '편집', exact: true }).click()
  await page.locator('.viewport canvas').scrollIntoViewIfNeeded()
  await page.waitForTimeout(200)

  // 사무실(0..10) 오른쪽에 창고를 그려 두 방 사이에 벽을 세울 자리를 만든다.
  await page.getByRole('button', { name: '물리존 그리기' }).click()
  for (const [x, y] of [[10.2, 0], [14, 0], [14, 8], [10.2, 8]]) await clickFloor(page, x, y)
  await page.keyboard.press('Enter')
  await expect(page.locator('.space-picked')).toContainText('새 물리존 1')

  await page.getByRole('button', { name: '벽·문·창' }).click()
  const panel = page.locator('.element-picked')

  // 두 방 사이 — 양쪽이 다 방이라 바깥에 닿지 않는다.
  await page.getByRole('button', { name: '벽 긋기' }).click()
  await clickFloor(page, 10.1, 0.5)
  await clickFloor(page, 10.1, 7.5)
  await expect(panel.locator('h3')).toHaveText('새 벽')
  await expect(panel.getByTestId('wall-external')).toHaveText('내벽')
  await expect(panel.locator('.src.calc')).toBeVisible()

  // 건물 밖에 홀로 선 담 — 양쪽이 다 바깥이다.
  await page.getByRole('button', { name: '벽 긋기' }).click()
  await clickFloor(page, 20, 0)
  await clickFloor(page, 20, 6)
  await expect(panel.locator('h3')).toHaveText('새 벽')
  await expect(panel.getByTestId('wall-external')).toHaveText('외벽')
  await expect(panel.locator('.src.calc')).toBeVisible()
  expect(errors).toEqual([])
})
