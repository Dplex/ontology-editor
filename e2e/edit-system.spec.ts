import { expect, test, type Page } from '@playwright/test'

// 계통 편집(E8). 고른 설비 패널에서 계통 한 자리를 바꾸고, 범례에서 고른 계통의 종류·유체를 고친다. 리포트에 줄이
// 오르고 Ctrl+Z 로 한 단계씩 돌아온다.
const MEP = 'src/lib/ifc/fixtures/mep.ifc'

async function open(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(MEP)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '편집', exact: true }).click()
  return errors
}

async function undo(page: Page) {
  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('Control+z')
}

test('설비를 계통에서 빼고, 계통 종류·유체를 고치고, 되돌린다', async ({ page }) => {
  const errors = await open(page)
  const row = page.locator('.equipment tbody tr', { hasText: 'DUCT-01' })
  await row.getByRole('button', { name: 'DUCT-01', exact: true }).click()
  const picked = page.locator('.picked')
  await expect(picked.locator('.stats')).toContainText('AHU-1 급기 계통')
  await picked.locator('.system-edit select').selectOption('')
  await expect(picked.locator('.stats')).toContainText('(계통 없음)')
  await expect(page.locator('.report')).toContainText('DUCT-01: 계통 AHU-1 급기 계통 → (계통 없음)')

  // 범례에서 계통을 고르면 종류를 고칠 수 있다. 순환수면 유체 상자가 나온다.
  await page.locator('.legend button', { hasText: 'AHU-1 급기 계통' }).click()
  const system = page.locator('.system-picked')
  await expect(system).toContainText('급기')
  await system.locator('.system-kind-edit select').first().selectOption('hydronic_supply')
  await system.locator('.system-kind-edit select').nth(1).selectOption('chilled')
  await expect(system.locator('.stats')).toContainText('순환수 공급 · 냉수')
  await expect(page.locator('.report')).toContainText('종류 급기 → 순환수 공급 · 냉수')

  await undo(page)
  await expect(page.locator('.report')).toContainText('종류 급기 → 순환수 공급')
  await expect(page.locator('.report')).not.toContainText('냉수')
  await undo(page)
  await expect(page.locator('.report')).not.toContainText('종류 급기')
  await undo(page)
  await expect(page.locator('.report')).toHaveCount(0)
  expect(errors).toEqual([])
})
