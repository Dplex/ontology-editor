import { existsSync } from 'node:fs'
import { expect, test } from '@playwright/test'

import { pickEquipment } from './edit-part'

// OE-OBJ-08 설치면. 고른 설비의 설치면을 출처(사전)와 함께 보인다. 실제 BIM(Duplex MEP, gitignore)으로 본다. 없으면 이유를 남기고 건너뛴다.
// 설비 목록을 설치면으로 거르던 칸은 3D 아래 설비 표와 같이 빠졌다(#715).
const DUPLEX = 'data/NBU_Duplex/NBU_Duplex-Apt_Eng-MEP.ifc'

test('고른 설비의 설치면을 보인다', async ({ page }) => {
  test.skip(!existsSync(DUPLEX), `${DUPLEX} 이 없다(npm run fetch:sample)`)
  test.setTimeout(120_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(DUPLEX)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 90_000 })
  await pickEquipment(page, 'Pendant Light', false)
  await expect(page.locator('.picked .mount')).toContainText('천장')
  expect(errors).toEqual([])
})
