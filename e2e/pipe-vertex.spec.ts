import { existsSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'

// 배관 꼭짓점 옮기기(OE-PIP-10). 꺾임 이음쇠(엘보)를 옮기면 양쪽 구간의 엘보 쪽 끝이 따라 늘어나고, 연결 대상과 방향은 그대로다.
// 설비에 바로 붙은 이음쇠는 배관 끝점이라 옮기지 않는다.
const DUPLEX_HVAC = 'data/NBU_Duplex/NBU_Duplex-Apt_Eng-HVAC.ifc'

async function pick(page: Page, tag: string) {
  await page.locator('.edit-filter input[type=search]').first().fill(tag)
  const row = page.locator('.equipment tbody tr').filter({ hasText: tag }).first()
  await row.getByRole('button').first().click()
  return row
}

test('실제 BIM: 엘보를 옮기면 양쪽 덕트·배관이 늘어나 따라오고, 설비에 붙은 이음쇠는 끝점이라 막는다', async ({ page }) => {
  test.skip(!existsSync(DUPLEX_HVAC), `${DUPLEX_HVAC} 이 없다(npm run fetch:sample)`)
  test.setTimeout(120_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(DUPLEX_HVAC)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 90_000 })
  await page.getByRole('button', { name: '편집', exact: true }).click()
  const list = page.getByRole('button', { name: /설비 위치와 소속/ })
  if ((await list.getAttribute('aria-expanded')) === 'false') await list.click()

  // 엘보 #582938 은 두 구간 사이의 꺾임점이다.
  const elbow = await pick(page, '582938')
  await expect(page.getByTestId('follow-preview')).toContainText('옮기면 이음쇠 0개가 같이 가고 덕트·배관 2개가 늘어납니다.')
  const x = elbow.locator('.coord').first()
  const before = Number(await x.inputValue())
  await x.fill((before + 0.3).toFixed(2))
  await x.blur()
  await expect(page.locator('.edit-bar')).toContainText('옮김 (배관 2개 따라옴)')
  await expect(page.locator('.edit-notice')).toHaveCount(0)
  await expect(x).toHaveValue((before + 0.3).toFixed(2))
  // 되돌리면 엘보가 제자리로 온다(늘인 배관도 같이, 단위 테스트 follow.test.ts).
  await page.locator('.edit-bar').click({ position: { x: 2, y: 2 } })
  await page.keyboard.press('Control+z')
  await expect(x).toHaveValue(before.toFixed(2))

  // 수전에 바로 붙은 이음쇠 #643346 은 배관 끝점이다. 좌표를 고쳐도 그대로다.
  const end = await pick(page, '643346')
  await expect(page.getByTestId('follow-preview')).toHaveCount(0)
  const ex = end.locator('.coord').first()
  const was = await ex.inputValue()
  await ex.fill((Number(was) + 0.3).toFixed(2))
  await ex.blur()
  await expect(page.locator('.edit-notice')).toContainText('M_Transition - Generic #643346은 Lavatory Faucet #643784에 바로 붙은 배관 끝점입니다.')
  await expect(ex).toHaveValue(was)
  expect(errors).toEqual([])
})
