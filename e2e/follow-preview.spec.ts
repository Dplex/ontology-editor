import { existsSync } from 'node:fs'
import { expect, test } from '@playwright/test'

// 설비를 옮기면 따라오는 배관(OE-PIP-12). [배관도 같이] 를 켜면 고른 설비 패널이 무엇이 따라오는지 미리 보이고, 따라오지 못하는
// 배관(형상·좌표가 없는 것)과 일부러 두는 분기 이음쇠는 사유를 보인다. 임의 좌표를 만들지 않는다.
const DUPLEX_HVAC = 'data/NBU_Duplex/NBU_Duplex-Apt_Eng-HVAC.ifc'

test('형상이 없는 덕트에 붙은 설비는 "끝점 자동 추종 불가" 를 옮기기 전부터 패널에 보이고, 옮겨도 덕트 좌표를 만들지 않는다 [OE-PIP-12#4]', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('input[type=file]').first().setInputFiles('src/lib/ifc/fixtures/mep.ifc')
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '편집', exact: true }).click()
  const row = page.locator('.equipment tbody tr', { hasText: 'AHU-1' })
  await row.getByRole('button', { name: 'AHU-1', exact: true }).click()

  // mep.ifc 의 덕트는 형상이 없어 축을 모른다. 따라올 것이 없으니 "옮기면 …" 문장은 없고 사유만 보인다.
  const preview = page.getByTestId('follow-preview')
  await expect(preview).toContainText('끝점 자동 추종 불가 1개: DUCT-01(형상이 없음)')
  await expect(preview).not.toContainText('옮기면 이음쇠')

  // 표의 좌표 칸으로 옮긴다. 덕트 좌표는 그대로다.
  const duct = page.locator('.equipment tbody tr', { hasText: 'DUCT-01' })
  const ductX = await duct.locator('.coord').first().inputValue()
  await row.locator('.coord').first().fill('3')
  await row.locator('.coord').first().blur()
  // 옮긴 뒤에도 패널에 그대로 보이고, 덕트 좌표는 그대로다(임의 좌표를 만들지 않는다).
  await expect(row.locator('.coord').first()).toHaveValue('3')
  await expect(preview).toContainText('끝점 자동 추종 불가 1개: DUCT-01(형상이 없음)')
  await expect(duct.locator('.coord').first()).toHaveValue(ductX)

  // [배관도 같이] 를 끄면 미리보기가 없다.
  await page.getByLabel('배관도 같이').uncheck()
  await expect(preview).toHaveCount(0)
  expect(errors).toEqual([])
})

test('실제 BIM: 배관이 붙은 설비를 고르면 따라올 덕트·배관 수가 보이고, 분기 이음쇠·추종 불가가 없으면 경고가 없다 [OE-PIP-12#2]', async ({ page }) => {
  test.skip(!existsSync(DUPLEX_HVAC), `${DUPLEX_HVAC} 이 없다(npm run fetch:sample)`)
  test.setTimeout(120_000)
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(DUPLEX_HVAC)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 90_000 })
  await page.getByRole('button', { name: '편집', exact: true }).click()
  const list = page.getByRole('button', { name: /설비 위치와 소속/ })
  if ((await list.getAttribute('aria-expanded')) === 'false') await list.click()
  await page.locator('.edit-filter input[type=search]').first().fill('582915')
  const closet = page.locator('.equipment tbody tr').filter({ hasText: '582915' })
  await closet.first().getByRole('button').first().click()
  // 대변기 하나에 배관 두 개(급수·배수)가 붙어 있다. 둘 다 설비 쪽 끝만 늘어난다.
  const preview = page.getByTestId('follow-preview')
  await expect(preview).toContainText('옮기면 이음쇠 0개가 같이 가고 덕트·배관 2개가 늘어납니다.')
  await expect(preview.locator('.follow-left')).toHaveCount(0)
})
