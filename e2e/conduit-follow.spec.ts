import { existsSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'

// 설비를 옮기면 붙은 배관이 따라온다(PRD #13 "이동(연결 배관 함께)", OE-OBJ-11). 계산은 follow.test.ts 가 보고,
// 여기서는 화면의 끄고 켜기·되돌리기와 3D 형상이 같이 가는지를 본다. 손으로 쓴 mep.ifc 의 덕트는 형상이 없어(일부러
// 비웠다) 늘일 축이 없으므로 실제 BIM(Duplex MEP, gitignore)으로 본다. 없으면 이유를 남기고 건너뛴다.
const DUPLEX = 'data/NBU_Duplex/NBU_Duplex-Apt_Eng-MEP.ifc'
// 라디에이터 하나. 양쪽에 배관 구간이 하나씩 붙어 있다.
const RADIATOR = 'M_Radiator - Hosted:Readiator - 25:Readiator - 25:536919'

const row = (page: Page) => page.locator('.equipment tbody tr', { hasText: RADIATOR }).last()


test('설비를 옮기면 붙은 배관이 따라오고, 끄면 설비만 옮겨지며, 되돌리면 같이 돌아온다 [OE-PIP-12#1,6~]', async ({ page }) => {
  test.skip(!existsSync(DUPLEX), `${DUPLEX} 이 없다(npm run fetch:sample)`)
  test.setTimeout(120_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(DUPLEX)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 90_000 })
  await page.keyboard.press('e')
  await expect(page.locator('.tool-palette')).toBeVisible()

  const opened = await page.evaluate(() => (window as any).__viewer.centers())
  await page.locator('input[type=search]').fill('536919')
  await row(page).getByRole('button', { name: RADIATOR, exact: true }).click()
  await page.keyboard.press('Shift+ArrowRight')
  await expect(page.locator('.edit-bar .last-edit')).toContainText('배관 2개 따라옴')
  if (process.env.SHOT) await page.locator('.viewport').screenshot({ path: process.env.SHOT })

  await page.keyboard.press('Control+z')
  await expect(page.locator('.edit-bar')).toContainText('바뀐 것 0건')

  await page.locator('.tool-palette').getByLabel('배관도 같이').uncheck()
  await page.keyboard.press('Shift+ArrowRight')
  await expect(page.locator('.edit-bar .last-edit')).not.toContainText('따라옴')

  // 따라온 배관이 있는 편집을 저장하지 않고 끝내면(OE-COM-08) 설비·배관 형상이 전부 연 때 자리로 돌아온다.
  await page.keyboard.press('Control+z')
  await page.locator('.tool-palette').getByLabel('배관도 같이').check()
  await page.keyboard.press('Shift+ArrowRight')
  await expect(page.locator('.edit-bar .last-edit')).toContainText('배관 2개 따라옴')
  expect(await page.evaluate(() => (window as any).__viewer.centers())).not.toEqual(opened)
  // 액션바의 편집 종료는 묻고 나서 보기 모드로 돌아가고 팔레트를 거둔다.
  await page.locator('.edit-bar').getByRole('button', { name: '편집 종료' }).click()
  await page.locator('dialog.exit-edit').getByRole('button', { name: '저장 안 함' }).click()
  await expect(page.locator('.tool-palette')).toHaveCount(0)
  expect(await page.evaluate(() => (window as any).__viewer.centers())).toEqual(opened)
  expect(errors).toEqual([])
})
