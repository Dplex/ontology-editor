import { expect, test } from '@playwright/test'

// 외벽 전용 설비는 소속 판정에서 빠진다(OE-MAP-01 1단계 · OE-EQP-15). 사무실 안의 설비라도 종류를 외부 루버로 바꾸면 소속이 "외벽" 이 되고,
// 소속 지정 칸이 막히며, 되돌리면 사무실로 돌아온다.
test('설비를 외부 루버로 바꾸면 소속이 외벽이 되고 지정이 막히며, Ctrl+Z 로 사무실 소속이 돌아온다', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles('src/lib/ifc/fixtures/mep.ifc')
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '편집', exact: true }).click()
  const row = page.locator('.equipment tbody tr', { hasText: 'AHU-1' })
  await row.getByRole('button', { name: 'AHU-1', exact: true }).click()
  await expect(row).toContainText('사무실')
  await page.locator('.kind-edit select').selectOption('outdoor_louver')
  await expect(row).toContainText('외벽 (층까지만)')
  await expect(page.locator('section.picked')).toContainText('외벽 전용 설비라 소속은 "외벽" 입니다')
  await page.locator('.edit-bar').click({ position: { x: 2, y: 2 } })
  await page.keyboard.press('Control+z')
  await expect(row).toContainText('사무실')
  expect(errors).toEqual([])
})
