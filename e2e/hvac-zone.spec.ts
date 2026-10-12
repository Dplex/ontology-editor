import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

// 수동 공조존(OE-ZON-01·02). 편집 화면의 "공조존" 에서 담당 물리존을 골라 만들거나 경계를 그려 만들고, 담당 설비를 고르면 TTL 에서 그 설비가
// 공조존을 feeds 한다(계통도의 서비스 영역). mep.ifc 의 1F 사무실은 (0..10 × 0..8)이다.
const MEP = 'src/lib/ifc/fixtures/mep.ifc'

async function ttlOf(page: Page, out: string): Promise<string> {
  const [d] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '의미 내보내기 (Brick TTL)' }).click()])
  await d.saveAs(out)
  return readFileSync(out, 'utf8')
}

test('담당 물리존을 골라 공조존을 만들고 담당 설비를 고르면 TTL 에 HVAC_Zone 과 feeds 가 나가며, 경계를 그려 나눠 만들 수 있다', async ({ page }, info) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.addInitScript(() => {
    delete (window as any).showDirectoryPicker
  })
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(MEP)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '편집', exact: true }).click()

  const fold = page.getByTestId('hvac-zones')
  const head = fold.locator('.fold-head')
  if ((await head.getAttribute('aria-expanded')) !== 'true') await head.click()
  await expect(fold).toContainText('이 층에 만든 공조존이 없습니다')
  // ZON-01 담당 물리존을 골라 만든다.
  await fold.getByLabel('사무실').check()
  await fold.getByRole('button', { name: '고른 물리존으로 만들기' }).click()
  const zone = fold.locator('.zone-list li[data-zone]')
  await expect(zone).toHaveCount(1)
  await expect(zone).toContainText('담당 물리존 사무실')
  await fold.getByLabel('공조존 1 담당 설비 더하기').selectOption({ label: 'AHU-1 · 공조기' })
  await expect(zone).toContainText('AHU-1 ×')
  await expect(page.locator('.report')).toContainText('공조존 공조존 1을 만들었습니다')

  const ttl = await ttlOf(page, info.outputPath('zone.ttl'))
  const zoneId = await zone.getAttribute('data-zone')
  expect(ttl).toContain('a brick:HVAC_Zone')
  expect(ttl).toMatch(/rdfs:label "AHU-1"[\s\S]*?brick:feeds [^;]*/)
  expect(ttl.split('\n\n').find((b) => b.includes('rdfs:label "AHU-1"'))).toContain(zoneId!.replace(/\$/g, '\\$'))

  // ZON-02 경계를 그려 사무실을 나눈다. 두 존이 모두 사무실을 담당한다.
  for (const half of [[[0.2, 0.2], [5, 0.2], [5, 7.8], [0.2, 7.8]], [[5, 0.2], [9.8, 0.2], [9.8, 7.8], [5, 7.8]]] as const) {
    await fold.getByRole('button', { name: '경계를 그려 만들기' }).click()
    await page.locator('.viewport canvas').scrollIntoViewIfNeeded()
    for (const [x, y] of half) {
      const at = await page.evaluate(([px, py]) => (window as any).__viewer.point([px, py, 0]), [x, y])
      await page.mouse.click(at.x, at.y)
    }
    await page.keyboard.press('Enter')
  }
  await expect(zone).toHaveCount(3)
  await expect(zone.nth(1)).toContainText(/담당 물리존 사무실 \d+%/)
  await expect(zone.nth(2)).toContainText(/담당 물리존 사무실 \d+%/)

  // 지우고 Ctrl+Z 로 되돌린다.
  await zone.nth(2).getByRole('button', { name: '지우기' }).click()
  await expect(zone).toHaveCount(2)
  await page.locator('.edit-bar').click({ position: { x: 2, y: 2 } })
  await page.keyboard.press('Control+z')
  await expect(zone).toHaveCount(3)
  expect(errors).toEqual([])
})

test('공조존 검증이 공백·중복·설비 미지정을 보이고, 담당 물리존을 빼고 더하면 바로 다시 잰다 (OE-ZON-05 · OE-ZON-04)', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(MEP)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '편집', exact: true }).click()
  const fold = page.getByTestId('hvac-zones')
  const checks = fold.getByTestId('zone-checks')
  await expect(checks).toContainText('공조존이 아직 없는 층은 Z-01 을 세지 않습니다: 1F')

  await fold.getByLabel('사무실').check()
  await fold.getByRole('button', { name: '고른 물리존으로 만들기' }).click()
  await expect(checks.locator('li', { hasText: 'Z-04' })).toContainText('1개 — 공조존 1')
  await expect(checks.locator('li', { hasText: 'Z-01' })).toContainText('없음')
  // 경계를 그려 사무실 일부를 덮으면 공조존 1 과 같은 영역을 담당한다(Z-02).
  await fold.getByRole('button', { name: '경계를 그려 만들기' }).click()
  await page.locator('.viewport canvas').scrollIntoViewIfNeeded()
  for (const [x, y] of [[1, 1], [4, 1], [4, 4], [1, 4]]) {
    const at = await page.evaluate(([px, py]) => (window as any).__viewer.point([px, py, 0]), [x, y])
    await page.mouse.click(at.x, at.y)
  }
  await page.keyboard.press('Enter')
  await expect(checks.locator('li', { hasText: 'Z-02' })).toContainText('공조존 1 · 공조존 2')
  await fold.getByLabel('공조존 1 담당 설비 더하기').selectOption({ label: 'AHU-1 · 공조기' })
  await expect(checks.locator('li', { hasText: 'Z-04' })).toContainText('1개 — 공조존 2')
  await expect(checks.locator('li', { hasText: 'Z-05' })).toContainText('1개 — 공조존 2')

  // 공조존 1 에서 사무실을 빼려 하면 하나는 남겨야 해서 막는다.
  const first = fold.locator('.zone-list li[data-zone]').first()
  await first.getByRole('button', { name: '사무실 ×' }).click()
  await expect(page.locator('.key-note')).toContainText('담당 물리존을 하나 이상 남기세요')
  expect(errors).toEqual([])
})
