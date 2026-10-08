import { expect, test } from '@playwright/test'

// 계통 종류(OE-PIP-03). 범례에서 고른 계통의 종류 칸에 소화·냉매·증기·응축수·지열수가 있고, 고르면 리포트에 Brick 계통 클래스 쪽으로 남는다.
test('계통 종류 칸에서 소화·냉매를 고를 수 있고, 냉매는 규칙 방향을 세우지 않는다', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles('src/lib/ifc/fixtures/mep.ifc')
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '편집', exact: true }).click()

  await page.locator('.legend button', { hasText: 'AHU-1 급기 계통' }).click()
  const system = page.locator('.system-picked')
  const kind = system.locator('.system-kind-edit select').first()
  const labels = await kind.locator('option').allTextContents()
  for (const label of ['소화', '냉매', '증기', '응축수 환수', '지열수 공급', '지열수 환수']) expect(labels).toContain(label)

  await kind.selectOption('fire_protection')
  await expect(system.locator('.stats')).toContainText('소화')
  await expect(page.locator('.report')).toContainText('종류 급기 → 소화')

  // 냉매로 바꾸면 규칙이 다루지 않는 매체라 DUCT-01–AT-101-02 의 규칙 방향이 사라진다.
  await kind.selectOption('refrigerant')
  await page.locator('.equipment tbody tr', { hasText: 'DUCT-01' }).getByRole('button', { name: 'DUCT-01', exact: true }).click()
  await expect(page.locator('.picked .neighbors tr', { hasText: 'AT-101-02' }).locator('.rel')).toHaveText('방향 미지정')
  expect(errors).toEqual([])
})
