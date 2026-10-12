import { existsSync } from 'node:fs'
import { expect, test } from '@playwright/test'

// 연결 누락의 연결 후보(OE-PIP-08). [연결 후보 확인] 이 대상·거리·계통·매체를 보이고, 사람이 고른 후보를 잇는다. 이은 연결은 직접
// 이음(manual)에 방향이 없고, 되돌리기 한 번으로 돌아간다. 해제 보정한 BIM 연결은 누락이 아니라 의도한 해제로 말한다.
const DUPLEX_HVAC = 'data/NBU_Duplex/NBU_Duplex-Apt_Eng-HVAC.ifc'
const RULE = '공기·물이 흐르는 기기가 연결망에 붙어 있다'
test.setTimeout(240_000)

test('연결 후보를 확인하고 이으면 위반이 줄고 출처는 직접 이음이며, 되돌리기·다시 하기가 된다', async ({ page }) => {
  test.skip(!existsSync(DUPLEX_HVAC), `${DUPLEX_HVAC} 이 없다(npm run fetch:sample)`)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('input[type=file]').first().setInputFiles(DUPLEX_HVAC)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 120_000 })

  const checks = page.locator('.checks')
  const row = checks.locator('tbody tr', { hasText: RULE })
  await expect(row).toContainText('30 / 40')
  await row.click()
  // 보일러 #530072 는 배관에서 72mm 떨어져 연결로 잡히지 않았다. 다른 계통의 배관은 가까워도 후보가 아니다.
  const boiler = checks.locator('.check-list li', { hasText: '#530072' })
  await expect(boiler).toContainText('가장 가까운 것: Pipe Types #593630 · 배관, 72mm')
  await expect(boiler).toContainText('가까워도 후보에서 뺀 것: 다른 계통')
  await boiler.getByRole('button', { name: '연결 후보 확인' }).click()
  const list = boiler.getByTestId('fix-candidates')
  await expect(list.locator('li').first()).toContainText('Pipe Types #593630 · 72mm')
  await expect(list.locator('li').first()).toContainText('· 물')
  await expect(list).toContainText('연결하면 출처는 직접 이음, 방향은 정하지 않은 채입니다')

  await list.getByTestId('fix-connect').first().click()
  await expect(page.getByRole('button', { name: '편집', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(row).toContainText('31 / 40')
  await expect(page.locator('.report')).toContainText('#593630: 연결했습니다')

  // 고른 설비 패널에서 그 연결은 직접 이음이고 사람이 정한 방향이 없다.
  await page.getByPlaceholder(/물리존·설비 이름/).fill('530072')
  const list2 = page.getByRole('button', { name: /설비 위치와 소속/ })
  if ((await list2.getAttribute('aria-expanded')) === 'false') await list2.click()
  await page.locator('.equipment tbody tr', { hasText: '530072' }).first().getByRole('button').first().click()
  const joined = page.locator('.picked .neighbors:not(.released) tr', { hasText: '#593630' })
  await expect(joined).toContainText('직접 이음')
  await expect(joined).not.toContainText('직접 정한 방향')

  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('Control+z')
  await expect(row).toContainText('30 / 40')
  await page.keyboard.press('Control+Shift+z')
  await expect(row).toContainText('31 / 40')
  expect(errors).toEqual([])
})

test('해제 보정한 BIM 연결로 끊긴 설비는 누락이 아니라 의도한 해제로 말하고, 그 상대를 후보로 권하지 않는다', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('input[type=file]').first().setInputFiles('src/lib/ifc/fixtures/mep.ifc')
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '편집', exact: true }).click()
  await page.locator('.equipment tbody tr', { hasText: 'AT-101-02' }).getByRole('button', { name: 'AT-101-02', exact: true }).click()
  const duct = page.locator('.picked .neighbors:not(.released) tr', { hasText: 'DUCT-01' })
  await duct.getByTestId('release-connection').click()
  await duct.getByTestId('release-reason').fill('현장에서 철거')
  await duct.getByTestId('release-submit').click()

  const checks = page.locator('.checks')
  await checks.locator('tbody tr', { hasText: RULE }).click()
  const item = checks.locator('.check-list li', { hasText: 'AT-101-02' })
  await expect(item).toContainText('해제 보정한 BIM 연결 1개가 있습니다(의도한 해제라 되살리지 않습니다)')
  await expect(item.getByRole('button', { name: '연결 후보 확인' })).toHaveCount(0)
  expect(errors).toEqual([])
})
