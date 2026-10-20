import { expect, test } from '@playwright/test'
import { enterEdit, openDrawer } from './edit-part'

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
  await expect(page.getByRole('checkbox', { name: /공조존\(IDF\)/ })).toBeChecked()

  // 표: 사무실 존은 VAV-101 이 담당하고 원천은 BIM 의 AHU-1 이다(IDF 의 "AHU 1").
  const fold = page.locator('.fold', { hasText: '공조존 (IDF)' })
  const office = fold.locator('tr', { hasText: '1F:OFFICE' })
  await expect(office).toContainText('사무실')
  await expect(office).toContainText('VAV-101')
  await expect(office).toContainText('AHU-1(BIM)')

  // 방을 누르면 그 방의 공조존이 패널에 뜬다(편집 모드에서 바닥 누르기).
  await enterEdit(page)
  await page.locator('.canvas-wrap > canvas').scrollIntoViewIfNeeded()
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

test('존↔물리존 매칭은 확인해야 나가는 초안이고, 존 단위로 확인하고 풀 수 있다 (OE-ZON-07)', async ({ page }, info) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(MEP)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  await page.locator('.appbar .append input[type=file]').setInputFiles(IDF)
  await expect(page.locator('.appbar h2')).toContainText('two-zones.idf')

  await openDrawer(page)
  const fold = page.locator('.fold', { hasText: '공조존 (IDF)' })
  const summary = fold.getByTestId('zone-confirm')
  const office = fold.locator('tr', { hasText: '1F:OFFICE' })
  await expect(summary).toContainText('0 / 1쌍 확인')
  const match = fold.getByTestId('zone-match-Z_1F_OFFICE')
  await expect(match).toHaveText('확인 0/1')

  // 존 한 줄을 확인하면 그 줄이 확인함으로 바뀌고 요약이 오른다. 줄을 눌러 존을 고르는 동작과는 섞이지 않는다.
  await match.click()
  await expect(match).toHaveText('✓ 확인함 1/1')
  await expect(summary).toContainText('1 / 1쌍 확인')
  await expect(office).not.toHaveClass(/chosen/)
  await fold.scrollIntoViewIfNeeded()
  await info.attach('zone-confirm', { body: await fold.screenshot(), contentType: 'image/png' })

  await match.click()
  await expect(summary).toContainText('0 / 1쌍 확인')
  await fold.getByTestId('zone-confirm-all').click()
  await expect(summary).toContainText('1 / 1쌍 확인')
  expect(errors).toEqual([])
})
