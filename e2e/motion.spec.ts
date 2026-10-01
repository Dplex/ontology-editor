import { expect, test } from '@playwright/test'

// 3D 아래 칸의 움직임(lib/motion.ts, Roll, Meter). 다른 e2e 는 값을 재려고 움직임을 끄고(playwright.config.ts) 돌므로
// 여기서만 켠다. 원칙은 "바뀐 것만 움직인다" 다 — 연 직후에는 숫자가 0 에서 올라오고 막대가 차오르며, 그 뒤에는
// 편집으로 바뀐 줄만 번쩍인다.
test.use({ contextOptions: { reducedMotion: 'no-preference' } })
const MEP = 'src/lib/ifc/fixtures/mep.ifc'

test('숫자는 굴러 올라오고 막대는 차오르며, 편집으로 바뀐 줄만 번쩍인다', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(MEP)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })

  // 요약 타일: 화면에 들어오면 0 에서 실제 값까지 굴러간다.
  const tile = page.locator('.tiles li', { hasText: '연결' }).locator('b')
  await tile.scrollIntoViewIfNeeded()
  await expect.poll(async () => Number((await tile.innerText()).replace(/,/g, ''))).toBeGreaterThan(0)

  // 완전성 검사의 통과 막대가 0 에서 차오른다.
  const bar = page.locator('.checks .meter i').first()
  await bar.scrollIntoViewIfNeeded()
  await expect.poll(async () => bar.evaluate((el) => el.getBoundingClientRect().width)).toBeGreaterThan(0)

  // 계통을 확정하면 그 줄만 번쩍이고 "확정함" 이 떠오른다. 다른 줄은 가만히 있다.
  await page.keyboard.press('e')
  await page.getByRole('button', { name: /규칙 방향 확정 \(계통별\)/ }).click()
  const fold = page.locator('.rule-systems')
  const row = fold.locator('tbody tr', { hasText: 'AHU-1 급기 계통' })
  await expect(fold.locator('.meter i').first()).toBeVisible()
  await row.getByRole('button', { name: '확정' }).click()
  await expect(row).toHaveClass(/flash/)
  await expect(row.locator('.confirmed')).toBeVisible()
  await expect(fold.locator('tbody tr.flash')).toHaveCount(1)
  expect(errors).toEqual([])
})
