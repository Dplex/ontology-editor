import { expect, test } from '@playwright/test'

// 수동 배관 그리기(OE-PIP-11). 고른 설비 패널에서 끝 대상·Flow Type·계통을 고르고 곧게 잇거나 꺾임점을 찍는다.
// mep.ifc: AHU-1(1,1,3.2), AT-101-02(7,4,2.7).
const MEP = 'src/lib/ifc/fixtures/mep.ifc'

test('공조기에서 디퓨저까지 배관을 곧게 잇고 되돌리며, 꺾임점을 찍어 구간 둘과 이음쇠 하나로 그린다', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(MEP)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '편집', exact: true }).click()
  const row = page.locator('.equipment tbody tr', { hasText: 'AHU-1' })
  await row.getByRole('button', { name: 'AHU-1', exact: true }).click()

  const panel = page.getByTestId('pipe-draw')
  await expect(panel.getByRole('button', { name: '곧게 연결하기' })).toBeDisabled()
  await panel.getByLabel('배관 끝 대상').selectOption({ label: 'AT-101-02 · 6.7m' })
  await panel.getByLabel('배관 Flow Type').selectOption('SA')
  await panel.getByRole('button', { name: '곧게 연결하기' }).click()
  await expect(page.locator('.key-note')).toContainText('SA 배관을 그렸습니다: 구간 1개 · 이음쇠 0개 · 6.73m')
  const drawn = page.locator('.equipment tbody tr', { hasText: 'SA 덕트 1' })
  await expect(drawn).toHaveCount(1)

  // 시작 공조기를 옮기면 그린 배관이 BIM 배관처럼 늘어나 따라온다(OE-PIP-12). 형상이 없는 BIM 덕트(DUCT-01)는 따라오지 못하니 1개가 그린 배관이다.
  // 디퓨저는 천장 설비라 바닥·벽 모드에서 옮기지 않는다.
  const dx = row.locator('.coord').first()
  await dx.fill('2')
  await dx.press('Enter')
  await expect(page.locator('.edit-bar')).toContainText('AHU-1 옮김 (배관 1개 따라옴)')

  // 옮긴 것과 그린 것을 차례로 되돌린다. 그린 배관은 한 번에 빠진다.
  await page.locator('.edit-bar').click({ position: { x: 2, y: 2 } })
  await page.keyboard.press('Control+z')
  await expect(dx).toHaveValue('1')
  await page.keyboard.press('Control+z')
  await expect(drawn).toHaveCount(0)

  // 꺾임점 하나: (7,1) 을 찍고 Enter.
  await row.getByRole('button', { name: 'AHU-1', exact: true }).click()
  await panel.getByLabel('배관 끝 대상').selectOption({ label: 'AT-101-02 · 6.7m' })
  await panel.getByRole('button', { name: '꺾임점 찍기' }).click()
  await page.locator('.viewport canvas').scrollIntoViewIfNeeded()
  await expect(page.locator('.key-note')).toContainText('배관이 꺾일 자리를 바닥에 찍습니다(높이 3.20m)')
  const at = await page.evaluate(() => (window as any).__viewer.point([7, 1, 3.2]))
  await page.mouse.click(at.x, at.y)
  await page.keyboard.press('Enter')
  await expect(page.locator('.key-note')).toContainText('SA 배관을 그렸습니다: 구간 2개 · 이음쇠 1개')
  await expect(page.locator('.equipment tbody tr', { hasText: /SA (덕트|이음) / })).toHaveCount(3)
  expect(errors).toEqual([])
})

test('범례의 Flow Type 만 고를 수 있고, 좌표 없는 설비와는 잇지 않는다', async ({ page }) => {
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(MEP)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '편집', exact: true }).click()
  await page.locator('.equipment tbody tr', { hasText: 'AHU-1' }).getByRole('button', { name: 'AHU-1', exact: true }).click()
  const panel = page.getByTestId('pipe-draw')
  // 범례 19개(glossary "Flow Type").
  await expect(panel.getByLabel('배관 Flow Type').locator('option')).toHaveCount(19)
  // 좌표 없는 센서(TEMP-101-01)는 끝 목록에 없다.
  await expect(panel.getByLabel('배관 끝 대상').locator('option', { hasText: 'TEMP-101-01' })).toHaveCount(0)
})
