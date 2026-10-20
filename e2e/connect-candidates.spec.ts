import { existsSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { pickEquipment, enterEdit, openDrawer } from './edit-part'

// 연결 누락의 연결 후보(OE-PIP-08). [연결 후보 확인] 이 대상·거리·계통·매체를 보이고, 사람이 고른 후보를 잇는다. 이은 연결은 직접
// 이음(manual)에 방향이 없고, 되돌리기 한 번으로 돌아간다. 해제 보정한 BIM 연결은 누락이 아니라 의도한 해제로 말한다.
const DUPLEX_HVAC = 'data/NBU_Duplex/NBU_Duplex-Apt_Eng-HVAC.ifc'
const RULE = '공기·물이 흐르는 기기가 연결망에 붙어 있다'
test.setTimeout(240_000)

test('연결 후보를 확인하고 이으면 위반이 줄고 출처는 수동 연결이며, 되돌리기·다시 하기가 된다 [OE-PIP-08#2,4~,5]', async ({ page }) => {
  test.skip(!existsSync(DUPLEX_HVAC), `${DUPLEX_HVAC} 이 없다(npm run fetch:sample)`)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('input[type=file]').first().setInputFiles(DUPLEX_HVAC)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 120_000 })

  // 완전성 검사는 기준 · 검증 패널에 있다. 검사 줄 · 후보를 누르면 3D 에 보이려고 패널이 닫혀서, 패널 안을 누르기 전마다 다시 연다.
  const checks = page.locator('.checks')
  const row = checks.locator('tbody tr', { hasText: RULE })
  await openDrawer(page)
  await expect(row).toContainText('30 / 40')
  await row.click()
  await openDrawer(page)
  // 보일러 #530072 는 배관에서 72mm 떨어져 연결로 잡히지 않았다. 다른 계통의 배관은 가까워도 후보가 아니다.
  const boiler = checks.locator('.check-list li', { hasText: '#530072' })
  await expect(boiler).toContainText('가장 가까운 것: Pipe Types #593630 · 배관, 72mm')
  await expect(boiler).toContainText('가까워도 후보에서 뺀 것: 다른 계통')
  await boiler.getByRole('button', { name: '연결 후보 확인' }).click()
  await openDrawer(page)
  const list = boiler.getByTestId('fix-candidates')
  await expect(list.locator('li').first()).toContainText('Pipe Types #593630 · 72mm')
  await expect(list.locator('li').first()).toContainText('· 물')
  await expect(list).toContainText('연결하면 출처는 수동 연결, 방향은 정하지 않은 채입니다')

  await list.getByTestId('fix-connect').first().click()
  await expect(page.getByRole('button', { name: '편집 종료' })).toBeVisible()
  await expect(row).toContainText('31 / 40')
  await expect(page.locator('.report')).toContainText('#593630: 연결했습니다')

  // 고른 설비 패널에서 그 연결은 수동 연결이고 사람이 정한 방향이 없다.
  await pickEquipment(page, '530072', false)
  const joined = page.locator('.picked .neighbors:not(.released) tr', { hasText: '#593630' })
  await expect(joined).toContainText('수동 연결')
  await expect(joined).not.toContainText('직접 정한 방향')

  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('Control+z')
  await expect(row).toContainText('30 / 40')
  await page.keyboard.press('Control+Shift+z')
  await expect(row).toContainText('31 / 40')
  expect(errors).toEqual([])
})

test('해제 보정한 BIM 연결로 끊긴 설비는 누락이 아니라 의도한 해제로 말하고, 그 상대를 후보로 권하지 않는다 [OE-PIP-08#3]', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('input[type=file]').first().setInputFiles('src/lib/ifc/fixtures/mep.ifc')
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  await enterEdit(page)
  await pickEquipment(page, 'AT-101-02')
  const duct = page.locator('.picked .neighbors:not(.released) tr', { hasText: 'DUCT-01' })
  await duct.getByTestId('release-connection').click()
  await duct.getByTestId('release-reason').fill('현장에서 철거')
  await duct.getByTestId('release-submit').click()

  const checks = page.locator('.checks')
  await openDrawer(page)
  await checks.locator('tbody tr', { hasText: RULE }).click()
  await openDrawer(page)
  const item = checks.locator('.check-list li', { hasText: 'AT-101-02' })
  await expect(item).toContainText('해제 보정한 BIM 연결 1개가 있습니다(의도한 해제라 되살리지 않습니다)')
  await expect(item.getByRole('button', { name: '연결 후보 확인' })).toHaveCount(0)
  expect(errors).toEqual([])
})
