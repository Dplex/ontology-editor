import { expect, test } from '@playwright/test'
import { pickEquipment, enterEdit } from './edit-part'

// BIM 배관의 Flow Type(OE-PIP-14). mep.ifc 의 DUCT-01 은 "AHU-1 급기 계통" 덕트라 계산하면 SA 다. 편집에서 구간마다 고칠 수 있다.
test('BIM 덕트를 고르면 계통으로 계산한 Flow Type 이 출처와 함께 보이고, 편집에서 고르면 바뀌며 Ctrl+Z 로 돌아온다 [OE-PIP-14#1~]', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('input[type=file]').first().setInputFiles('src/lib/ifc/fixtures/mep.ifc')
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  const pick = () => pickEquipment(page, 'DUCT-01')
  await pick()
  const row = page.getByTestId('flow-type-row')
  await expect(row).toContainText('SA 급기')
  await expect(row.locator('.src')).toHaveText('계산')
  // 기기에는 Flow Type 줄이 없다.
  await pickEquipment(page, 'AHU-1')
  await expect(row).toHaveCount(0)

  await enterEdit(page)
  await pick()
  const select = row.getByLabel('구간 Flow Type')
  await expect(select.locator('option').first()).toHaveText('계산: SA 급기')
  await select.selectOption('RA')
  await expect(page.locator('.key-note')).toContainText('DUCT-01의 Flow Type 을 RA(리턴(還氣))로 정했습니다')
  // 칩 이름은 #611 에서 "편집" 이 "사람" 으로 바뀐다.
  await expect(row.locator('.src')).toHaveText(/^(사람|편집)$/)
  if (process.env.SHOT_FLOWTYPE) await row.locator('xpath=..').screenshot({ path: process.env.SHOT_FLOWTYPE })
  // 매체가 다른 값(냉수 공급)은 덕트에 정하지 않는다.
  await select.selectOption('CHWS')
  await expect(page.locator('.key-note')).toContainText('덕트에는 CHWS(공기가 아닌 매체)를 정하지 않습니다')
  await expect(select).toHaveValue('RA')

  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('Control+z')
  await expect(select).toHaveValue('')
  await expect(row.locator('.src')).toHaveText('계산')
  expect(errors).toEqual([])
})
