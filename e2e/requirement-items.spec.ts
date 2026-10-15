import { expect, test, type Page } from '@playwright/test'

// 요구사항 칸의 숫자에서 표준 자리가 아닌 것을 펴 보고 3D 에서 짚는다(editor/requirement-items.ts).
const MEP = 'src/lib/ifc/fixtures/mep.ifc'
const ROOMS = 'src/lib/ifc/fixtures/two-rooms.ifc'
const shown = (page: Page) => page.evaluate(() => (window as any).__viewer.shown())

async function open(page: Page, file: string) {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('input[type=file]').first().setInputFiles(file)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  await page.locator('.requirements > .fold-head').click()
  return errors
}

test('설비 요구는 숫자 아래에서 펴면 이름이 보이고, 3D 에서 그 설비만 남긴다', async ({ page }) => {
  const errors = await open(page, MEP)
  // R11 설비 위치: 좌표 없는 센서 하나.
  await page.getByTestId('req-items-R11').click()
  const box = page.getByTestId('req-items')
  await expect(box).toContainText('R11 설비 위치')
  await expect(box).toContainText('없음 1')
  await expect(box.locator('li')).toHaveText([/TEMP-101-01.*좌표 없음/])
  // 좌표가 없으면 3D 에 남길 것이 없다고 알린다.
  await box.getByTestId('req-isolate').click()
  await expect(page.locator('.key-note')).toContainText('3D 에 놓인 설비가 없습니다')
  expect((await shown(page)).hidden).toBe(0)

  // R21 용량: 용량 없는 토출구 하나. 펴면 다른 줄은 접힌다.
  await page.getByTestId('req-items-R21').click()
  await expect(page.getByTestId('req-items')).toHaveCount(1)
  await expect(page.getByTestId('req-items')).toContainText('R21 용량')
  await page.getByTestId('req-isolate').click()
  // 픽스처의 설비 여섯(기기 다섯 + 덕트 하나) 중 토출구 하나만 남는다.
  await expect.poll(async () => (await shown(page)).hidden).toBe(5)
  await expect(page.locator('.key-note')).toContainText('표준 자리가 아닌 설비 1대만 남겼습니다')
  expect(errors).toEqual([])
})

test('이름을 누르면 그것을 고른다 — 설비는 설비 패널, 물리존은 물리존 패널', async ({ page }) => {
  const errors = await open(page, MEP)
  await page.getByTestId('req-items-R21').click()
  const name = await page.getByTestId('req-items').locator('li .link').first().innerText()
  await page.getByTestId('req-items').locator('li .link').first().click()
  await expect(page.locator('.picked h3').first()).toContainText(name.replace(/…$/, ''))
  expect(errors).toEqual([])
})

test('물리존 요구는 물리존 목록이고, 외곽선 없는 방은 그렇다고 적는다', async ({ page }) => {
  const errors = await open(page, ROOMS)
  await page.getByTestId('req-items-R2').click()
  const box = page.getByTestId('req-items')
  await expect(box).toContainText('표준 자리가 아닌 물리존')
  await expect(box.locator('li')).toHaveCount(1)
  await expect(box.locator('li')).toContainText('외곽선 없음')
  await box.locator('li .link').click()
  await expect(page.locator('.picked').first()).toBeVisible()
  // 접기.
  await page.getByTestId('req-items-R2').click()
  await expect(page.getByTestId('req-items')).toHaveCount(0)
  expect(errors).toEqual([])
})
