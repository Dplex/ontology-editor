import { expect, test } from '@playwright/test'

// 유체 흐름이 아닌 연결(OE-PIP-18). 조명은 흐름 없는 기기라 공조기에 이어도 공급 관계가 아니다. 지우지 않고 검토 대상으로 보인다.
test('흐름 없는 기기에 이은 연결은 지우지 않고 "검토" 로 보이며 완전성 검사에 오르고, 종류를 "모름" 으로 바꾸면 검토에서 빠진다 [OE-PIP-18#3] [OE-PIP-18#4~]', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('input[type=file]').first().setInputFiles('src/lib/ifc/fixtures/mep.ifc')
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '편집', exact: true }).click()
  const pickRow = (name: string) => page.locator('.equipment tbody tr', { hasText: name }).getByRole('button', { name, exact: true })

  await pickRow('AHU-1').click()
  const rows = page.locator('.picked .neighbors tr')
  // 포트 연결(덕트)은 검토 대상이 아니다.
  await expect(rows.filter({ hasText: 'DUCT-01' }).getByTestId('flow-review')).toHaveCount(0)
  await page.locator('.picked').getByRole('button', { name: '연결하기', exact: true }).click()
  await pickRow('LIGHT-101-01').click()
  const joined = rows.filter({ hasText: 'LIGHT-101-01' })
  await expect(joined).toContainText('수동 연결')
  await expect(joined.getByTestId('flow-review')).toHaveText('검토 — 흐름 아님, feeds 제외')
  await expect(joined.getByTestId('flow-review')).toHaveAttribute('title', 'LIGHT-101-01: 흐름 없는 기기')

  const check = page.locator('.checks tbody tr', { hasText: 'BIM 포트·사람이 이은 연결은 유체가 흐르는' })
  const head = page.locator('.checks .fold-head')
  if ((await head.getAttribute('aria-expanded')) !== 'true') await head.click()
  await expect(check.locator('.num').last()).toHaveText('1')

  // 조명의 종류를 "모름" 으로 고치면 흐름 없는 기기가 아니라 검토에서 빠진다. 연결은 그대로다.
  await pickRow('LIGHT-101-01').click()
  await page.locator('.kind-edit select').selectOption('')
  await pickRow('AHU-1').click()
  await expect(joined).toContainText('수동 연결')
  await expect(joined.getByTestId('flow-review')).toHaveCount(0)
  // 위반이 없으면 0 이다.
  await expect(check.locator('.num').last()).toHaveText('0')
  expect(errors).toEqual([])
})
