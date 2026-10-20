import { expect, test } from '@playwright/test'
import { pickEquipment } from './edit-part'

// 연결의 근거(OE-BIM-09). 포트에서 읽은 연결은 방향을 말했는지(방향 명시 · 양방향/미지정)로 나눠 보이고, 형상 추정은 미확정 후보로 따로 센다.
test('검토 화면의 연결 수가 BIM 포트(방향 명시 · 양방향/미지정)로 나뉘고, 이웃 표가 연결마다 그 근거를 적는다 [OE-BIM-09#2]', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('input[type=file]').first().setInputFiles('src/lib/ifc/fixtures/mep.ifc')
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  // mep.ifc 의 연결 셋은 모두 포트다. AHU-1→DUCT-01·DUCT-01→AT-101-01 은 방향이 있고, DUCT-01–AT-101-02 는 SOURCEANDSINK 다.
  await expect(page.getByTestId('connection-classes')).toContainText('포트 3(방향 명시 2 · 양방향/미지정 1)')

  await pickEquipment(page, 'DUCT-01')
  const rows = page.locator('.picked .neighbors:not(.released) tr')
  await expect(rows.filter({ hasText: 'AHU-1' }).getByTestId('neighbor-source')).toHaveText(/BIM 포트 · 방향 명시/)
  await expect(rows.filter({ hasText: 'AT-101-02' }).getByTestId('neighbor-source')).toHaveText(/BIM 포트 · 양방향\/미지정/)
  expect(errors).toEqual([])
})
