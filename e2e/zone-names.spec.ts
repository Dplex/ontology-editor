import { expect, test, type Page } from '@playwright/test'

// 커스텀존 이름·별명의 고유성(OE-SPC-06)과 나누기·합치기의 이름(OE-SPC-08). 다른 존이 쓰는 이름·별명으로 고치면 막고 쓰는 존을
// 알리며 칸이 원래 값으로 돌아간다. 나누면 좁은 조각이 "이름-02" 이고, 합치면 넓은 쪽이 남아 고른 존이 그쪽으로 바뀐다.
// mep.ifc 의 사무실은 0..10 × 0..8 이다.
const MEP = 'src/lib/ifc/fixtures/mep.ifc'

async function clickFloor(page: Page, x: number, y: number) {
  const at = (await page.evaluate(([px, py]) => (window as any).__viewer.point([px, py, 0]), [x, y])) as { x: number; y: number }
  await page.mouse.click(at.x, at.y)
}
async function drawZone(page: Page, pts: [number, number][]) {
  await page.getByRole('button', { name: '커스텀존 그리기' }).click()
  for (const [x, y] of pts) await clickFloor(page, x, y)
  await page.keyboard.press('Enter')
}

test('다른 존이 쓰는 이름·별명은 막고 칸을 되돌리며, 나누면 -02, 합치면 넓은 쪽이 남는다', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(MEP)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '편집', exact: true }).click()
  await page.locator('.viewport canvas').scrollIntoViewIfNeeded()
  await page.waitForTimeout(200)
  await clickFloor(page, 6, 4)
  await page.keyboard.press('f')
  await page.waitForTimeout(800)
  await page.keyboard.press('Escape')

  const panel = page.locator('.custom-zone-picked')
  const name = panel.getByTestId('zone-name')
  const aliases = panel.getByTestId('zone-aliases-input')
  await drawZone(page, [[0.5, 0.5], [3, 0.5], [3, 7.5], [0.5, 7.5]])
  await name.fill('임원석')
  await name.press('Enter')
  await aliases.fill('경영진석')
  await aliases.press('Enter')
  await expect(panel.locator('h3')).toHaveText('임원석')

  await drawZone(page, [[3.5, 0.5], [9.5, 0.5], [9.5, 7.5], [3.5, 7.5]])
  await expect(panel.locator('h3')).toHaveText('커스텀존 2')
  await name.fill('경영진석')
  await name.press('Enter')
  await expect(page.locator('.key-note')).toContainText('커스텀존 임원석의 별명')
  await expect(name).toHaveValue('커스텀존 2')
  await aliases.fill('임원석')
  await aliases.press('Enter')
  await expect(page.locator('.key-note')).toContainText('커스텀존 임원석의 이름')
  await expect(aliases).toHaveValue('')
  await name.fill('사무석')
  await name.press('Enter')
  await expect(panel.locator('h3')).toHaveText('사무석')

  // 사무석(3.5..9.5)을 x=8 에서 나누면 좁은 조각(8..9.5)이 사무석-02 다.
  await panel.getByRole('button', { name: '나누기' }).click()
  await clickFloor(page, 8, -1)
  await clickFloor(page, 8, 9)
  await expect(page.locator('.key-note')).toContainText('좁은 쪽이 새 커스텀존 사무석-02입니다')

  // 임원석(좁다)을 골라 사무석과 합치면 넓은 사무석이 남고 임원석·경영진석은 별명이 된다.
  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('Escape')
  await page.locator('.overview').getByRole('button', { name: '임원석' }).click()
  await expect(panel.locator('h3')).toHaveText('임원석')
  await panel.locator('select[aria-label="합칠 커스텀존"]').selectOption({ label: '사무석' })
  await expect(panel.locator('h3')).toHaveText('사무석')
  await expect(aliases).toHaveValue('임원석, 경영진석')
  expect(errors).toEqual([])
})
