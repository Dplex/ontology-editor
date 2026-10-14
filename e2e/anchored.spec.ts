import { existsSync } from 'node:fs'
import { expect, test } from '@playwright/test'

// 배치점 보정(OE-BIM-12). Duplex HVAC(Revit → IFC2x3)는 배관 구간 231개의 배치점이 층 원점에 찍혀 형상 중심을 좌표로 쓴다.
// 그 구간을 고르면 패널에 보정한 좌표(계산)와 BIM 원본 배치점, 떨어진 거리·기준(0.5m)이 같이 보인다.
const HVAC = 'data/NBU_Duplex/NBU_Duplex-Apt_Eng-HVAC.ifc'

test('Duplex HVAC: 보정한 배관 구간을 고르면 형상 중심(계산)과 BIM 원본 배치점, 떨어진 거리·기준이 보인다 [OE-BIM-12#1]', async ({ page }) => {
  test.skip(!existsSync(HVAC), `${HVAC} 이 없다(npm run fetch:sample)`)
  test.setTimeout(120_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(HVAC)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 90_000 })
  // 임포트 경고에 보정한 대수가 있다.
  await expect(page.locator('#warnings')).toContainText(/설비 \d+대는 배치점이 형상에서 0.5m 넘게 떨어져/)
  await page.locator('input[type=search]').fill('582940')
  const list = page.getByRole('button', { name: /^▸?\s*설비 목록/ })
  if ((await list.getAttribute('aria-expanded')) === 'false') await list.click()
  const name = 'Pipe Types:Waste:582940'
  await page.locator('.equipment tbody tr', { hasText: name }).last().getByRole('button', { name, exact: true }).click()
  const anchored = page.getByTestId('anchored')
  await expect(anchored).toBeVisible()
  await expect(anchored.locator('.src.calc')).toHaveText('계산')
  await expect(anchored.locator('.src.bim')).toHaveText('BIM')
  await expect(anchored).toContainText(/BIM 배치점 \([-\d.]+, [-\d.]+, [-\d.]+\) BIM이 형상에서 [\d.]+m 떨어져\(기준 0.5m 초과\)/)
  expect(errors).toEqual([])
})
