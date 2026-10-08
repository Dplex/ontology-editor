import { expect, test } from '@playwright/test'

// 연결 해제 보정(OE-PIP-01·06). BIM 포트 연결은 끊지 않고 해제 보정한다. 원본은 남아 "해제한 연결" 에 비활성으로 보이고, 취소하면
// 원본 방향 그대로 돌아온다. 해제·취소는 사유를 받아 보정 이력에 남는다.
test('포트 연결을 사유와 함께 해제 보정하고, 되돌리기·해제 취소로 원본이 돌아오며 이력이 남는다', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('input[type=file]').first().setInputFiles('src/lib/ifc/fixtures/mep.ifc')
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '편집', exact: true }).click()
  await page.locator('.equipment tbody tr', { hasText: 'AHU-1' }).getByRole('button', { name: 'AHU-1', exact: true }).click()

  const picked = page.locator('.picked')
  const duct = picked.locator('.neighbors:not(.released) tr', { hasText: 'DUCT-01' })
  await expect(duct).toContainText('포트')
  await expect(duct.getByRole('button', { name: '연결 끊기' })).toHaveCount(0)

  // 사유 없이는 해제하지 않는다.
  await duct.getByTestId('release-connection').click()
  await duct.getByTestId('release-submit').click()
  await expect(page.getByText('사유를 적어 주세요. 보정 이력에 남습니다')).toBeVisible()
  await duct.getByTestId('release-reason').fill('현장에서 덕트 철거')
  await duct.getByTestId('release-submit').click()

  const released = picked.getByTestId('released-connections')
  await expect(duct).toHaveCount(0)
  await expect(released).toContainText('DUCT-01')
  await expect(released).toContainText('원본 방향 하류')
  await expect(released).toContainText('현장에서 덕트 철거')
  await expect(page.locator('.edit-bar')).toContainText('바뀐 것 1건')
  await expect(page.locator('.report')).toContainText('연결 해제 보정(사유: 현장에서 덕트 철거)')
  await expect(page.getByTestId('release-log')).toContainText('연결 해제 보정: AHU-1 — DUCT-01 · 현장에서 덕트 철거')

  // 되돌리면 원본이 돌아오고 이력에서도 빠진다. 다시 하면 해제 상태다.
  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('Control+z')
  await expect(duct).toHaveCount(1)
  await expect(released).toHaveCount(0)
  await expect(page.getByTestId('release-log')).toHaveCount(0)
  await page.keyboard.press('Control+Shift+z')
  await expect(duct).toHaveCount(0)
  await expect(released).toContainText('DUCT-01')

  // 같은 두 설비를 손으로 다시 잇지 않는다.
  await picked.getByRole('button', { name: '연결하기', exact: true }).click()
  await page.locator('.equipment tbody tr', { hasText: 'DUCT-01' }).getByRole('button', { name: 'DUCT-01', exact: true }).click()
  await expect(page.getByText('해제 보정한 BIM 연결이 있는 두 설비입니다')).toBeVisible()

  // 해제 취소. 사유를 받고 원본이 돌아온다. 바뀐 것은 0건이지만 이력은 두 줄 남는다.
  await released.getByTestId('release-cancel').click()
  await released.getByTestId('release-reason').fill('철거 계획 철회')
  await released.getByTestId('release-submit').click()
  await expect(duct).toContainText('포트')
  await expect(released).toHaveCount(0)
  await expect(page.locator('.edit-bar')).toContainText('바뀐 것 0건')
  const log = page.getByTestId('release-log').locator('li')
  await expect(log).toHaveCount(2)
  await expect(log.first()).toContainText('해제 보정 취소: AHU-1 — DUCT-01 · 철거 계획 철회')
  expect(errors).toEqual([])
})
