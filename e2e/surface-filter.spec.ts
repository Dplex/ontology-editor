import { existsSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { enterEdit, pickEquipment } from './edit-part'

// 설치면 편집(OE-EQP-05). 판정 설치면(z 판정, 플레넘은 천장)을 못 정한 "미정" 설비는 패널에서 설치면을 정한다(편집, 되돌리기에 쌓인다).
// 설비 목록을 설치면으로 거르던 칸은 3D 아래 설비 표와 같이 빠졌다(#715). Duplex MEP(gitignore, 벽 없음 · 반자 2.6m)로 본다.
const DUPLEX = 'data/NBU_Duplex/NBU_Duplex-Apt_Eng-MEP.ifc'

test('미정 설비에 설치면을 정하면 판정이 그 면이 되고 출처가 편집이며, 되돌리면 미정으로 돌아온다 [OE-EQP-05#2]', async ({ page }) => {
  test.skip(!existsSync(DUPLEX), `${DUPLEX} 이 없다(npm run fetch:sample)`)
  test.setTimeout(120_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(DUPLEX)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 90_000 })
  await enterEdit(page)
  await page.locator('select.storey-view').selectOption({ label: '모든 층' })

  // 벽이 없는 파일이라 콘센트를 판정하지 못한다
  await pickEquipment(page, 'Receptacle', false)
  const mount = page.locator('.picked div.mount')
  await expect(mount).toContainText('판정 미정')
  // 콘센트의 허용 설치면은 벽뿐이라 고를 것도 벽뿐이다
  const pick = page.getByLabel('설치면 정하기')
  await expect(pick.locator('option')).toHaveText(['설치면 정하기…', '벽'])
  await pick.selectOption('wall')
  await expect(mount).toContainText('판정 벽')
  await expect(mount.locator('.src.edit')).toBeVisible()
  await page.locator('.picked').first().screenshot({ path: 'test-results/surface-set.png' })

  // 되돌리면 미정으로 돌아온다
  await page.locator('.appbar h2').click()
  await page.keyboard.press('Control+z')
  await expect(mount).toContainText('판정 미정')
  expect(errors).toEqual([])
})
