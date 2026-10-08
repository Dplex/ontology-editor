import { expect, test } from '@playwright/test'

// 평면도 배경 이미지(OE-MAN-02). mep.ifc 1F 사무실은 (0..10 × 0..8)이다. plan-grid.png 는 400×200px 격자다.
const MEP = 'src/lib/ifc/fixtures/mep.ifc'
const PLAN = 'e2e/fixtures/plan-grid.png'

test('도면 이미지를 깔면 건물 너비에 맞춰 놓이고, 두 점으로 스케일을, 한 점으로 원점을 맞추며, 걷을 수 있다', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(MEP)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '편집', exact: true }).click()
  const fold = page.getByTestId('bg-plan')
  const head = fold.getByRole('button', { name: /평면도 배경/ })
  if ((await head.getAttribute('aria-expanded')) === 'false') await head.click()
  await fold.getByLabel('평면도 배경 이미지').setInputFiles(PLAN)
  // 400px 를 사무실 너비 10m 에 맞춘다: 1px = 25mm, 왼쪽 위 (0, 8).
  await expect(fold.getByTestId('bg-scale')).toContainText('1px = 25.0mm · 왼쪽 위 (0.00, 8.00)')
  expect(await page.evaluate(() => (window as any).__viewer.background())).toEqual([[0, 8], [10, 8], [10, 3], [0, 3]])

  const floor = async (x: number, y: number) => {
    const at = await page.evaluate(([px, py]) => (window as any).__viewer.point([px, py, 0]), [x, y])
    await page.mouse.click(at.x, at.y)
  }
  // 도면에서 5m 로 보이는 두 점이 실제로는 10m 다.
  await fold.getByRole('button', { name: '스케일 맞추기' }).click()
  await page.locator('.viewport canvas').scrollIntoViewIfNeeded()
  await expect(page.locator('.key-note')).toContainText('두 점을 찍으세요')
  await floor(0, 4)
  await floor(5, 4)
  await fold.getByLabel('실제 거리(m)').fill('10')
  await fold.getByRole('button', { name: '맞추기', exact: true }).click()
  await expect(fold.getByTestId('bg-scale')).toContainText('1px = 50.0mm · 왼쪽 위 (0.00, 12.00)')

  // 찍은 점 (4, 6) 이 실제로는 (0, 0) 이다.
  await fold.getByRole('button', { name: '원점 맞추기' }).click()
  await page.locator('.viewport canvas').scrollIntoViewIfNeeded()
  await expect(page.locator('.key-note')).toContainText('한 점을 찍으세요')
  await floor(4, 6)
  await expect(fold.getByLabel('실제 x')).toBeVisible()
  await fold.getByLabel('실제 x').fill('0')
  await fold.getByLabel('실제 y').fill('0')
  await fold.getByRole('button', { name: '맞추기', exact: true }).click()
  await expect(fold.getByTestId('bg-scale')).toContainText('왼쪽 위 (-4.00, 6.00)')

  // 온톨로지에는 나가지 않는다: 편집 막대의 바뀐 것이 0 이다.
  await expect(page.locator('.edit-bar')).toContainText('바뀐 것 0건')
  await fold.getByRole('button', { name: '걷기' }).click()
  expect(await page.evaluate(() => (window as any).__viewer.background())).toBeNull()
  expect(errors).toEqual([])
})
