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

test('실제 BIM: 엘보를 옮기면 양쪽 덕트·배관이 늘어나 따라오고, 설비에 붙은 이음쇠는 끝점이라 막는다 [OE-PIP-10#2~]', async ({ page }) => {
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

test('실제 BIM: 배관 구간을 고르면 지우기 전에 연결망이 몇 갈래로 나뉘는지 보이고, 지운 뒤 되돌릴 수 있다 (OE-PIP-10) [OE-PIP-10#6]', async ({ page }) => {
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

  // 배수관 #582940 은 위생기구 14대가 이어진 쪽과 배관 1개만 남는 쪽을 가른다.
  await pick(page, '582940')
  const impact = page.getByTestId('removal-impact')
  await expect(impact).toContainText('지우면 연결망이 2갈래로 나뉩니다:')
  await expect(impact).toContainText('외 11대 쪽(기기 14대) / 기기 없는 배관 1개. 다른 분기의 연결은 그대로입니다.')
  await page.locator('.danger-zone').getByRole('button', { name: '설비 지우기' }).click()
  await expect(page.locator('.equipment tbody tr').filter({ hasText: '582940' })).toHaveCount(0)
  await page.locator('.edit-bar').click({ position: { x: 2, y: 2 } })
  await page.keyboard.press('Control+z')
  await expect(page.locator('.equipment tbody tr').filter({ hasText: '582940' })).toHaveCount(1)
  expect(errors).toEqual([])
})

test('실제 BIM: 배관 구간 끝의 연결 대상을 바꾸면 옛 BIM 포트 연결은 해제 보정으로 남고, 한 번에 되돌린다 (OE-PIP-10) [OE-PIP-10#3,7~]', async ({ page }) => {
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

  // 배수관 #582951 은 샤워 #582917 에 BIM 포트로 붙어 있다. 0.7m 옆의 샤워 #582914 로 바꾼다.
  await pick(page, '582951')
  const box = page.getByTestId('retarget')
  await box.getByLabel('바꿀 끝').selectOption({ label: 'M_Shower Stall - Rectangular #582917 (BIM 포트)' })
  await box.getByLabel('새 대상').selectOption({ label: 'M_Shower Stall - Rectangular #582914 · 0.7m' })
  await expect(page.getByTestId('retarget-preview')).toContainText('기존: M_Shower Stall - Rectangular #582917 → 변경: M_Shower Stall - Rectangular #582914.')
  await expect(page.getByTestId('retarget-preview')).toContainText('BIM 포트 연결이라 지우지 않고 해제 보정으로 남깁니다')
  await box.getByRole('button', { name: '바꾸기' }).click()
  await expect(page.locator('.edit-bar')).toContainText('끝 대상 M_Shower Stall - Rectangular #582917 → M_Shower Stall - Rectangular #582914')
  await expect(page.locator('.picked-sub', { hasText: '해제한 연결' })).toContainText('1')
  // 바꾼 뒤 바꿀 끝 목록에는 새 대상이 있다.
  await expect(box.getByLabel('바꿀 끝').locator('option', { hasText: '#582914' })).toHaveCount(1)

  await page.locator('.edit-bar').click({ position: { x: 2, y: 2 } })
  await page.keyboard.press('Control+z')
  await expect(page.locator('.picked-sub', { hasText: '해제한 연결' })).toHaveCount(0)
  await expect(box.getByLabel('바꿀 끝').locator('option', { hasText: '#582917 (BIM 포트)' })).toHaveCount(1)
  expect(errors).toEqual([])
})
