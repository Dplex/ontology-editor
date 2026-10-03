import { existsSync } from 'node:fs'
import { expect, test } from '@playwright/test'

// OE-BIM-13 덧붙임(2026-10-03 사용자 결정). 병원 전기의 유압 엘리베이터는 Proxy 라 이름 사전에 없으면 건축 부재로 빠졌다. 이제 설비 목록에
// 엘리베이터로 나온다. 분전반(`Lighting and Appliance Panelboard`)은 이름의 "Lighting" 때문에 조명으로 나가던 것을 바로잡았다.
const ELE = 'data/NBU_MedicalClinic/NBU_MedicalClinic_Eng-ELE.ifc'

test('병원 전기: 유압 엘리베이터는 설비 목록에 엘리베이터로, Panelboard 는 조명이 아니라 분전반으로 나온다', async ({ page }) => {
  test.skip(!existsSync(ELE), `${ELE} 이 없다(npm run fetch:sample)`)
  test.setTimeout(120_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(ELE)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 90_000 })
  const rows = page.locator('table.equipment tbody tr')
  const kind = 'td:nth-child(2)'
  await page.locator('input[type=search]').fill('Elevator')
  await expect(rows).toHaveCount(1)
  await expect(rows.locator(kind)).toContainText('엘리베이터')
  if (process.env.SHOT) await page.locator('table.equipment').screenshot({ path: process.env.SHOT })
  await page.locator('input[type=search]').fill('Panelboard')
  await expect(rows).not.toHaveCount(0)
  for (const cell of await rows.locator(kind).allTextContents()) {
    expect(cell).toContain('분전반')
    expect(cell).not.toContain('조명')
  }
  expect(errors).toEqual([])
})
