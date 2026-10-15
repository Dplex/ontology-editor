import { test, expect } from '@playwright/test'

// 등급 칩·치수·연결 관계·종류 지정 — OE-BIM-16·21, OE-REQ-04, OE-UI-08, OE-MAP-01~03, OE-EQP-12·14
test('chips: grades 0-4 with numerator/denominator; dims; relations; kind assignment', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  await page.goto('/')
  await page.locator('.floor-card').first().getByRole('button', { name: /→/ }).click()
  const chips = page.getByTestId('grade-chips')
  await expect(chips).toContainText('등급 0')
  await expect(chips).toContainText('등급 3')
  await expect(page.getByTestId('grade-3')).toContainText(/평가 불가|\d+\/\d+/)
  // 치수 표시: 평면에서 방을 고르면 변 길이
  await page.getByRole('button', { name: '평면도', exact: true }).click()
  await page.locator('.object-list button').first().click()
  await expect(page.getByTestId('plan-dims')).toContainText('m')
  await expect(page.getByTestId('space-relations')).toContainText('소속 설비')
  // 종류 지정
  await page.getByRole('button', { name: '설비 편집' }).click()
  await page.getByRole('button', { name: '설비', exact: true }).click()
  await page.locator('.object-list button').first().click()
  await page.getByLabel('설비 종류 지정').selectOption('vav')
  await expect(page.locator('.inspector')).toContainText('출처: 사람')
  expect(errors).toEqual([])
})
