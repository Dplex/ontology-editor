import { expect, test, type Page } from '@playwright/test'

// 독의 [Explode](종류별 색)의 다른 기준 — Brick 클래스·소속을 어디서 알았나(view-filter.ts 의 classTintBy). 화면 상태다.
const viewer = <T,>(page: Page, fn: string) => page.evaluate((f) => (window as any).__viewer[f](), fn) as Promise<T>

test('mep.ifc: 색 기준을 종류 출처·소속 출처로 바꾸면 범례가 출처별로 바뀌고, 합이 칠한 기기 수이며, 종류 모름은 종류 기준과 같다', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles('src/lib/ifc/fixtures/mep.ifc')
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  await page.getByTestId('class-tint-toggle').click()
  const key = page.getByTestId('class-key')
  const by = page.getByTestId('tint-by')
  await expect(by.getByRole('button', { name: '종류', exact: true })).toHaveAttribute('aria-pressed', 'true')
  const rows = key.locator('li button')
  const sum = async () => (await rows.locator('b').allInnerTexts()).map(Number).reduce((a, b) => a + b, 0)
  const unknown = async () => Number((await rows.filter({ hasText: '종류 모름' }).locator('b').allInnerTexts())[0] ?? 0)
  const total = await sum()
  const unknownByClass = await unknown()
  expect(total).toBeGreaterThan(0)

  await by.getByRole('button', { name: '종류 출처' }).click()
  await expect(key.locator('.class-key-head')).toContainText('Brick 클래스를 어디서 알았나')
  await expect(rows.first()).toContainText(/BIM|사전|사람|종류 모름/)
  expect(await sum()).toBe(total)
  expect(await unknown()).toBe(unknownByClass)
  await expect.poll(() => viewer<number>(page, 'tinted')).toBe(total)
  // 몫이 붙는다.
  await expect(rows.first().locator('small')).toHaveText(/\d+%/)

  await by.getByRole('button', { name: '소속 출처' }).click()
  await expect(key.locator('.class-key-head')).toContainText('소속을 어디서 알았나')
  expect(await sum()).toBe(total)
  // 줄을 누르면 그 출처만 색으로 남는다. 기준을 바꾸면 누른 줄은 풀린다.
  const first = Number(await rows.first().locator('b').innerText())
  await rows.first().click()
  await expect.poll(() => viewer<number>(page, 'tinted')).toBe(first)
  await by.getByRole('button', { name: '종류', exact: true }).click()
  await expect.poll(() => viewer<number>(page, 'tinted')).toBe(total)
  await expect(page.locator('.edit-bar')).toHaveCount(0)
  expect(errors).toEqual([])
})
