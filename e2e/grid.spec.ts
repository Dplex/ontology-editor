import { expect, test, type Page } from '@playwright/test'

// 그리드 정렬(OE-UI-07). 그리기 막대에서 켜면 3D·평면도에 선이 보이고, 찍은 점이 교점으로 간다. mep.ifc 1F 사무실(10×8), 디퓨저 AT-101-01(3,4).
const MEP = 'src/lib/ifc/fixtures/mep.ifc'
const viewer = <T,>(page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(([f, a]) => (window as any).__viewer[f as string](...(a as unknown[])), [fn, args] as const) as Promise<T>
async function clickFloor(page: Page, x: number, y: number) {
  const at = await viewer<{ x: number; y: number }>(page, 'point', [x, y, 0])
  await page.mouse.click(at.x, at.y)
}

test('그리드를 켜면 선이 보이고 찍은 점이 교점으로 가서, 조금 빗나가게 찍어도 4×4 물리존이 된다. 간격을 바꾸면 선이 다시 그려진다 [OE-UI-07#1]', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(MEP)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '편집', exact: true }).click()
  await page.locator('.viewport canvas').scrollIntoViewIfNeeded()
  await page.getByRole('button', { name: '물리존 그리기' }).click()
  const bar = page.locator('.draw-bar')
  expect(await viewer<number>(page, 'grid')).toBe(0)
  await bar.getByLabel('그리드 간격(m)').fill('1')
  await bar.getByLabel('그리드 간격(m)').press('Tab')
  await bar.getByLabel('그리드 정렬').check()
  // 사무실(0~10 × 0~8)에 2m 를 더한 범위, 1m 간격: x 15개 + y 13개.
  await expect.poll(() => viewer<number>(page, 'grid')).toBe(28)
  // 간격을 바꾸면 다시 그린다(0.5m: 29 + 25).
  await bar.getByLabel('그리드 간격(m)').fill('0.5')
  await bar.getByLabel('그리드 간격(m)').press('Tab')
  await expect.poll(() => viewer<number>(page, 'grid')).toBe(54)
  await bar.getByLabel('그리드 간격(m)').fill('1')
  await bar.getByLabel('그리드 간격(m)').press('Tab')
  // 0.2~0.3m 빗나가게 찍어도 (2,2)·(6,2)·(6,6)·(2,6) 으로 간다.
  for (const [x, y] of [[2.2, 1.8], [5.8, 2.3], [6.3, 5.8], [1.7, 6.2]]) await clickFloor(page, x, y)
  await expect(bar).toContainText('4개')
  await page.keyboard.press('Enter')
  const room = page.locator('.space-picked')
  await expect(room).toContainText('새 물리존 1')
  await expect(room).toContainText('16.0')
  await expect(room).toContainText('AT-101-01')
  if (process.env.SHOT) await page.locator('.viewport').screenshot({ path: process.env.SHOT })
  // 평면도에도 같은 선.
  await page.getByRole('group', { name: '보기' }).getByRole('button', { name: '평면도' }).click()
  await expect(page.getByTestId('plan-grid').locator('line')).toHaveCount(28)
  expect(errors).toEqual([])
})
