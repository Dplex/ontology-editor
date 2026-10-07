import { existsSync } from 'node:fs'
import { expect, test } from '@playwright/test'

// 설치면 편집 필터(OE-EQP-05). 설비 목록을 판정 설치면(z 판정, 플레넘은 천장)으로 거르고, "미정" 으로 판정하지 못한 설비만 본다.
// 미정 설비는 패널에서 설치면을 정한다(편집, 되돌리기에 쌓인다). Duplex MEP(gitignore, 벽 없음 · 반자 2.6m)로 본다.
const DUPLEX = 'data/NBU_Duplex/NBU_Duplex-Apt_Eng-MEP.ifc'

test('설치면 필터는 판정 기준이고, 미정 설비에 설치면을 정하면 그 면 목록으로 옮겨 가며 되돌리면 돌아온다', async ({ page }) => {
  test.skip(!existsSync(DUPLEX), `${DUPLEX} 이 없다(npm run fetch:sample)`)
  test.setTimeout(120_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(DUPLEX)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 90_000 })
  await page.getByRole('button', { name: '편집', exact: true }).click()
  await page.locator('select.storey-view').selectOption({ label: '모든 층' })
  const filter = page.getByLabel('설치면으로 거르기')
  const list = page.getByRole('button', { name: /설비 위치와 소속/ })
  if ((await list.getAttribute('aria-expanded')) === 'false') await list.click()
  const rows = page.locator('.equipment tbody tr')

  // 천장: 사전이 조명으로 잡은 스위치(1.22m)는 판정이 천장이 아니라 빠진다(전에는 종류로 걸러 들어 있었다)
  await filter.selectOption('ceiling')
  await expect(rows.filter({ hasText: 'Pendant Light' }).first()).toBeVisible()
  await expect(rows.filter({ hasText: 'Lighting Switches' })).toHaveCount(0)

  // 미정: 벽이 없는 파일이라 콘센트를 판정하지 못한다
  await filter.selectOption('none')
  const receptacles = rows.filter({ hasText: 'Receptacle' })
  const before = await receptacles.count()
  expect(before).toBeGreaterThan(0)
  await receptacles.first().getByRole('button').first().click()
  const mount = page.locator('.picked div.mount')
  await expect(mount).toContainText('판정 미정')
  // 콘센트의 허용 설치면은 벽뿐이라 고를 것도 벽뿐이다
  const pick = page.getByLabel('설치면 정하기')
  await expect(pick.locator('option')).toHaveText(['설치면 정하기…', '벽'])
  await pick.selectOption('wall')
  await expect(mount).toContainText('판정 벽')
  await expect(mount.locator('.src.edit')).toBeVisible()
  await expect(receptacles).toHaveCount(before - 1)
  await page.locator('.picked').first().screenshot({ path: 'test-results/surface-set.png' })

  await filter.selectOption('wall')
  await expect(rows.filter({ hasText: 'Receptacle' })).toHaveCount(1)

  // 되돌리면 미정으로 돌아온다
  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('Control+z')
  await expect(rows.filter({ hasText: 'Receptacle' })).toHaveCount(0)
  await filter.selectOption('none')
  await expect(receptacles).toHaveCount(before)
  expect(errors).toEqual([])
})
