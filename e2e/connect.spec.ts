import { expect, test } from '@playwright/test'

// 연결 잇기·끊기. 형상 추정이 빠뜨린 것을 잇고 잘못 이은 것을 끊는다. 포트(BIM)가 말한 연결은 끊지 못한다.
test('고른 설비에서 잇기를 누르고 상대를 고르면 잇고, 되돌리기와 끊기가 된다', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('input[type=file]').first().setInputFiles('src/lib/ifc/fixtures/mep.ifc')
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '편집', exact: true }).click()
  const pickRow = (name: string) => page.locator('.equipment tbody tr', { hasText: name }).getByRole('button', { name, exact: true })

  await pickRow('AHU-1').click()
  const rows = page.locator('.picked .neighbors tr')
  // 포트 연결에는 끊기가 없다.
  await expect(rows.filter({ hasText: 'DUCT-01' }).getByRole('button', { name: '끊기' })).toHaveCount(0)

  await page.locator('.picked').getByRole('button', { name: '잇기', exact: true }).click()
  await expect(page.locator('.picked')).toContainText('이을 상대를')
  // 표에서 고르면 그것이 상대다(고른 설비는 그대로다).
  await pickRow('LIGHT-101-01').click()
  await expect(page.locator('.picked h3')).toHaveText('AHU-1')
  const joined = rows.filter({ hasText: 'LIGHT-101-01' })
  await expect(joined).toContainText('직접 이음')
  await expect(page.locator('.edit-bar')).toContainText('바뀐 것 1건')
  await expect(page.locator('.report')).toContainText('연결을 이었습니다')

  // 되돌리면 빠지고, 다시 하면 돌아온다.
  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('Control+z')
  await expect(joined).toHaveCount(0)
  await page.keyboard.press('Control+Shift+z')
  await expect(joined).toHaveCount(1)

  // 끊는다.
  await joined.getByRole('button', { name: '끊기' }).click()
  await expect(joined).toHaveCount(0)
  await expect(page.locator('.edit-bar')).toContainText('바뀐 것 0건')

  // Esc 로 잇기를 취소한다.
  await page.locator('.picked').getByRole('button', { name: '잇기', exact: true }).click()
  await page.keyboard.press('Escape')
  await expect(page.locator('.picked')).not.toContainText('이을 상대를')
  expect(errors).toEqual([])
})
