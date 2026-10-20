import { expect, test } from '@playwright/test'
import { coordOf, openDrawer, pickedCard, pickEquipment, enterEdit } from './edit-part'

// 소속 허용 거리(OE-MAP-01 5단계, 사이트 설정). mep.ifc 의 사무실은 x 0~10 이다. 공조기를 x 10.08(경계 8cm 밖)에 두면 기본 5cm 로는
// 소속이 없고, 0.1m 로 늘리면 사무실에 붙는다. 설정은 이 브라우저에 남고 다시 열어도 그 값으로 판정한다.
test('사이트 설정에서 소속 허용 거리를 바꾸면 허용 거리로 붙는 설비의 소속이 바뀌고, 다시 열어도 그 값으로 판정한다 [OE-MAP-01#11,12]', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.evaluate(() => localStorage.removeItem('oe.assignSnap'))
  const open = async () => {
    await page.locator('.drop input[type=file]').setInputFiles('src/lib/ifc/fixtures/mep.ifc')
    await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  }
  await open()
  await enterEdit(page)
  await pickEquipment(page, 'AHU-1')
  const row = pickedCard(page)
  const x = coordOf(page, 0)
  await x.fill('10.08')
  await x.press('Enter')
  await expect(row).toContainText('(소속 없음)')
  // 완전성 검사는 기준 · 검증 패널 안에 있다. 거기서 고치면 패널이 닫히지 않는다(고른 것이 바뀌지 않는다).
  await openDrawer(page)
  const fold = page.getByRole('button', { name: /완전성 검사/ })
  if ((await fold.getAttribute('aria-expanded')) === 'false') await fold.click()
  const snap = page.getByTestId('assign-snap')
  await expect(snap).toHaveValue('0.05')
  await snap.fill('0.1')
  await snap.press('Enter')
  await expect(page.locator('.key-note')).toContainText('소속 허용 거리를 0.1m 로 정했습니다. 설비 1대의 소속이 바뀌었습니다')
  await expect(row).toContainText('사무실')
  // 되돌려 놓는다(이 브라우저 설정).
  await snap.fill('0.05')
  await snap.press('Enter')
  await expect(row).toContainText('(소속 없음)')
  expect(errors).toEqual([])
})
