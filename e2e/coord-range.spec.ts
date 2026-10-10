import { expect, test } from '@playwright/test'

// 건물 범위 밖 좌표(OE-EQP-06). 좌표 칸에 건물에서 30m 넘게 떨어진 값을 치면 막지는 않고(밖에 두는 설비가 있다) 오타일 수 있다고 알린다.
// mep.ifc 의 사무실은 x 0~10 · y 0~8 이다.
test('건물 범위 밖 좌표를 넣으면 경고가 보이고, 범위 안이면 경고가 없다 [OE-EQP-06#2]', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles('src/lib/ifc/fixtures/mep.ifc')
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '편집', exact: true }).click()
  const x = page.locator('.equipment tbody tr', { hasText: 'AHU-1' }).last().locator('.coord').first()
  // 범위 안(사무실 안)은 알리지 않는다.
  await x.fill('6')
  await x.press('Enter')
  await expect(page.locator('.edit-bar')).toContainText('바뀐 것')
  await expect(page.locator('.edit-notice', { hasText: '벗어난 자리' })).toHaveCount(0)
  // x 3226(32.26 을 잘못 친 것)은 건물에서 3km 넘게 벗어난다.
  await x.fill('3226')
  await x.press('Enter')
  await expect(page.locator('.edit-notice').first()).toContainText('건물 범위에서 평면으로 3,216m 벗어난 자리입니다')
  await expect(x).toHaveValue('3226')
  expect(errors).toEqual([])
})

test('판정 설치면이 허용 설치면과 다른 설비가 검토 화면 목록에 나온다 — 바닥 전용 공조기를 천장 높이에 두면 [OE-EQP-03#3]', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles('src/lib/ifc/fixtures/mep.ifc')
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('.surface-mismatch')).toHaveCount(0)
  await page.getByRole('button', { name: '편집', exact: true }).click()
  // 천장고를 넣어 천장 판정이 서게 한다(모르면 천장 판정은 미정이다).
  await page.getByRole('button', { name: /천장고 입력/ }).first().click()
  await page.locator('.ceiling-input').fill('2.7')
  await page.locator('.ceiling-input').press('Enter')
  const z = page.locator('.equipment tbody tr', { hasText: 'AHU-1' }).last().locator('.coord').nth(2)
  await z.fill('2.6')
  await z.press('Enter')
  await expect(page.locator('.surface-mismatch')).toContainText('AHU-1')
  expect(errors).toEqual([])
})
