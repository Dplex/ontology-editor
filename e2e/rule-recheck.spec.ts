import { expect, test } from '@playwright/test'

// 규칙 재계산(OE-PIP-07). 확정한 규칙 방향도 편집 뒤 다시 잰다. 근거가 바뀌면 재검토로 두고 내보내지 않으며, 다시 확정하면 새 판단을
// 따른다. 일치율에 견줄 연결이 없으면 0% 가 아니라 비교 불가다.
test('확정한 계통의 원천이 사라지면 재검토로 보이고, 다시 확정·되돌리기가 된다', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('input[type=file]').first().setInputFiles('src/lib/ifc/fixtures/mep.ifc')
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '편집', exact: true }).click()
  const pick = (name: string) => page.locator('.equipment tbody tr', { hasText: name }).getByRole('button', { name, exact: true }).click()

  await pick('DUCT-01')
  const terminal = page.locator('.picked .neighbors tr', { hasText: 'AT-101-02' })
  const rule = page.locator('.picked .rule-system')
  await expect(rule).toContainText('일치 2 · 불일치 0 · 추정 불가 0')
  await rule.getByTestId('rule-confirm').click()
  await expect(terminal.locator('.rel')).toHaveText('하류(확정)')
  await expect(rule).toContainText('확정했습니다')

  // 공조기 종류를 모름으로 — 원천이 없어진다.
  await pick('AHU-1')
  await page.locator('.kind-edit select').selectOption('')
  await pick('DUCT-01')
  await expect(terminal.locator('.rel')).toHaveText('하류(재검토)')
  await expect(terminal).toContainText('규칙 방향(확정 · 재검토, 내보내지 않음)')
  await expect(rule.getByTestId('rule-recheck')).toContainText('재검토 중이라 brick:feeds 로 내보내지 않습니다')
  await expect(rule).toContainText('일치율은 비교 불가입니다(추정 불가 2)')
  await expect(rule.getByTestId('rule-confirm')).toHaveText('이 계통 방향 다시 확정')

  // 다시 확정 — 새로 정할 수 없으니 확정을 거둔다.
  await rule.getByTestId('rule-confirm').click()
  await expect(terminal.locator('.rel')).toHaveText('방향 미지정')

  // 되돌리면 재검토로, 한 번 더 되돌리면(종류) 확정으로 돌아온다.
  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('Control+z')
  await expect(terminal.locator('.rel')).toHaveText('하류(재검토)')
  await page.keyboard.press('Control+z')
  await expect(terminal.locator('.rel')).toHaveText('하류(확정)')
  expect(errors).toEqual([])
})
