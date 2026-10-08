import { existsSync } from 'node:fs'
import { expect, test } from '@playwright/test'

// OE-BIM-07 좌표 없는 분전반 부품(2026-10-03 사용자 결정). ifc4Mep 00층의 퓨즈는 그 층에 하나뿐인 분전반(MB01) 자리에 놓이고, 그 좌표의
// 출처 칩은 BIM 이 아니라 계산이다. 01층 퓨즈는 분전반이 둘이라 좌표가 없다.
const MEP = 'data/ifc4Mep_IFC4.ifc'

test('ifc4Mep: 분전반 자리에 놓은 퓨즈의 좌표 출처는 계산이다', async ({ page }) => {
  test.skip(!existsSync(MEP), `${MEP} 이 없다(npm run fetch:sample)`)
  test.setTimeout(120_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(MEP)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 90_000 })
  await page.getByRole('button', { name: '편집', exact: true }).click()
  await page.locator('input[type=search]').fill('F1')
  const rows = page.locator('.equipment tbody tr').filter({ has: page.getByRole('button', { name: 'F1', exact: true }) })
  await expect(rows).toHaveCount(2)
  // 둘 중 좌표가 있는 하나(00층)만 칩이 있고, 계산이다.
  const posSrc = 'td.num + td:not(.num) .src'
  await expect(rows.locator(posSrc)).toHaveCount(1)
  await expect(rows.locator(`${posSrc}.calc`)).toHaveCount(1)
  if (process.env.SHOT) await page.locator('table.equipment').screenshot({ path: process.env.SHOT })
  // 분전반 MB01 자체는 BIM 좌표다(대조군).
  await page.locator('input[type=search]').fill('MB01')
  await expect(page.locator('.equipment tbody tr').filter({ has: page.getByRole('button', { name: 'MB01', exact: true }) }).locator('td.num + td:not(.num) .src.bim')).toHaveCount(1)
  expect(errors).toEqual([])
})
