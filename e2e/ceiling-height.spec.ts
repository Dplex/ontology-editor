import { existsSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'

// 반자 높이 h_c 와 설치면 판정(OE-EQP-03). 층별 요약에 층마다 반자 높이와 출처가 보이고, 모르면 0 이나 층고로 채우지 않고
// "모름 · 입력" 이다. 정한 값은 출처 "편집" 이고 저장 안 한 편집으로 센다. 고른 설비 패널에 허용 설치면(사전)과 z 로 판정한
// 설치면(계산)이 같이 보인다.
const FIXTURE = 'src/lib/ifc/fixtures/mep.ifc'
const DUPLEX = 'data/NBU_Duplex/NBU_Duplex-Apt_Eng-MEP.ifc'

const row = (page: Page, floor: string) => page.locator('.storeys tbody tr', { hasText: floor })
const cell = (page: Page, floor: string) => row(page, floor).locator('td.storey-ceiling')

async function open(page: Page, file: string) {
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(file)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 90_000 })
  const head = page.getByRole('button', { name: /층별 요약/ })
  if ((await head.getAttribute('aria-expanded')) === 'false') await head.click()
}

test('천장고를 모르는 층은 "모름" 이고, 입력하면 출처 편집으로 그 값이 된다', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await open(page, FIXTURE)
  await expect(cell(page, '1F')).toContainText('모름')

  await cell(page, '1F').getByRole('button', { name: '1F 천장고 입력' }).click()
  const input = page.getByLabel('1F 천장고(m)')
  // 0.3m 이하는 받지 않는다
  await input.fill('0.2')
  await input.press('Enter')
  await expect(page.locator('.key-note')).toContainText('0.3m 보다 높아야')

  await input.fill('2.7')
  await input.press('Enter')
  await expect(cell(page, '1F')).toContainText('2.70 m')
  await expect(cell(page, '1F').locator('.src')).toHaveText('편집')

  await cell(page, '1F').getByRole('button', { name: '지우기' }).click()
  await expect(cell(page, '1F')).toContainText('모름')
  expect(errors).toEqual([])
})

test('BIM 이 말한 천장고와 고른 설비의 판정 설치면을 보인다 (Duplex MEP)', async ({ page }) => {
  test.skip(!existsSync(DUPLEX), `${DUPLEX} 이 없다(npm run fetch:sample)`)
  test.setTimeout(120_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await open(page, DUPLEX)
  // Revit 방 높이(Unbounded Height) 2.6m
  await expect(cell(page, 'Level 1')).toContainText('2.60 m')
  await expect(cell(page, 'Level 1').locator('.src')).toHaveText('BIM')
  await expect(page.locator('.surface-summary')).toContainText('설치면 판정')

  await page.getByLabel('설치면으로 거르기').selectOption('ceiling')
  await page.getByRole('button', { name: /설비 목록/ }).click()
  const rows = page.locator('.equipment tbody tr')
  await rows.filter({ hasText: 'Pendant Light' }).first().getByRole('button').first().click()
  const mount = page.locator('.picked .mount')
  await expect(mount).toContainText('허용 천장')
  await expect(mount).toContainText(/판정 (천장|미정)/)
  await page.screenshot({ path: 'test-results/ceiling-height-duplex.png', fullPage: false })
  expect(errors).toEqual([])
})
