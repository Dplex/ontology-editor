import { existsSync } from 'node:fs'
import { expect, test } from '@playwright/test'

// OE-OBJ-08 설치면. 설비 목록을 설치면으로 거르고, 고른 설비의 설치면을 출처(사전)와 함께 보인다. 거르는 줄은 설비·방이
// 50개를 넘는 파일에만 나와서 실제 BIM(Duplex MEP, gitignore)으로 본다. 없으면 이유를 남기고 건너뛴다.
const DUPLEX = 'data/NBU_Duplex/NBU_Duplex-Apt_Eng-MEP.ifc'

test('설비 목록을 설치면으로 거르고, 고른 설비의 설치면을 보인다', async ({ page }) => {
  test.skip(!existsSync(DUPLEX), `${DUPLEX} 이 없다(npm run fetch:sample)`)
  test.setTimeout(120_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(DUPLEX)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 90_000 })
  const rows = page.locator('.equipment tbody tr')
  const filter = page.getByLabel('설치면으로 거르기')

  await filter.selectOption('ceiling')
  await page.getByRole('button', { name: /설비 목록/ }).click()
  await expect(rows.filter({ hasText: 'Pendant Light' }).first()).toBeVisible()
  await expect(rows.filter({ hasText: 'Receptacle' })).toHaveCount(0)
  await expect(rows.filter({ hasText: 'Pipe' })).toHaveCount(0)

  // 기준이 판정 설치면이다(OE-EQP-05). 이 파일은 벽이 없어 콘센트를 벽으로 판정하지 못하고 미정에 든다.
  await filter.selectOption('none')
  await expect(rows.filter({ hasText: 'Receptacle' }).first()).toBeVisible()
  await expect(rows.filter({ hasText: 'Pipe' })).toHaveCount(0)

  await filter.selectOption('ceiling')
  await rows.filter({ hasText: 'Pendant Light' }).first().getByRole('button').first().click()
  await expect(page.locator('.picked .mount')).toContainText('천장')
  expect(errors).toEqual([])
})
