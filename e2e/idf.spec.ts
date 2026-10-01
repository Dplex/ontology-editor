import { expect, test } from '@playwright/test'

// IDF(공조존)를 덧붙이거나 혼자 연다. 픽스처는 mep.ifc 와 같은 자리에 공조존 둘을 둔 손으로 쓴 IDF 다.
const MEP = 'src/lib/ifc/fixtures/mep.ifc'
const IDF = 'src/lib/idf/fixtures/two-zones.idf'

test('IFC 에 IDF 를 덧붙이면 공조존이 얹히고, 방을 누르면 그 방의 공조존을 말한다', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(MEP)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })

  await page.locator('.appbar .append input[type=file]').setInputFiles(IDF)
  await expect(page.locator('.appbar h2')).toContainText('two-zones.idf')
  const tile = page.locator('.tiles li', { hasText: '공조존' })
  await expect(tile.locator('b')).toHaveText('2')
  await expect(tile).toContainText('존에 든 방 1/1')
  await expect(page.getByRole('button', { name: '공조존', exact: true })).toHaveAttribute('aria-pressed', 'true')

  // 표: 사무실 존은 VAV-101 이 담당하고 원천은 BIM 의 AHU-1 이다(IDF 의 "AHU 1").
  const fold = page.locator('.fold', { hasText: '공조존 (IDF)' })
  const office = fold.locator('tr', { hasText: '1F:OFFICE' })
  await expect(office).toContainText('사무실')
  await expect(office).toContainText('VAV-101')
  await expect(office).toContainText('AHU-1(BIM)')

  // 방을 누르면 그 방의 공조존이 패널에 뜬다(편집 모드에서 바닥 누르기).
  await page.getByRole('button', { name: '편집', exact: true }).click()
  await page.locator('.viewport canvas').scrollIntoViewIfNeeded()
  await page.waitForTimeout(200)
  const floor = await page.evaluate(() => (window as any).__viewer.point([9.6, 7.6, 0.1]))
  await page.mouse.click(floor.x, floor.y)
  await expect(page.locator('.space-picked .facts')).toContainText(/공조존\s*1F:OFFICE/)
  expect(errors).toEqual([])
})

test('IDF 만 열면 바닥 높이마다 층을 세우고 공조존을 보인다', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(IDF)
  await expect(page.locator('.appbar h2')).toContainText('two-zones.idf')
  await expect(page.locator('.tiles li', { hasText: '공조존' }).locator('b')).toHaveText('2')
  await expect(page.locator('.tiles li', { hasText: '층' }).first().locator('b')).toHaveText('1')
  expect(errors).toEqual([])
})
