import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'

// 다중층 뷰의 보기 범위·축척은 그리는 것만 바꾼다(OE-ML-18 AC4). 편집기에는 층 간격을 따로 바꾸는 보기 설정이 없고 다중층 뷰는 실제 높이로
// 그린다 — 바꿀 수 있는 것은 보기 범위(시작·끝 층)와 확대·축소다. 그 뒤에도 저장 좌표·연결(TTL)·편집 수가 그대로인지 본다.
// two-rooms.ifc + mep.ifc 를 합치면 층이 둘(1F·2F)이다.
const MEP = 'src/lib/ifc/fixtures/mep.ifc'
const ROOMS = 'src/lib/ifc/fixtures/two-rooms.ifc'

const coords = (page: Page) => page.locator('.equipment tbody tr .coord').evaluateAll((xs) => xs.map((x) => (x as HTMLInputElement).value))
async function ttl(page: Page): Promise<string> {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '의미 내보내기 (Brick TTL)' }).click()])
  return readFileSync((await dl.path())!, 'utf-8').replace(/^# .*생성.*$/gm, '')
}

test('다중층 뷰에서 보기 범위를 바꾸고 확대·축소해도 저장 좌표·연결·편집 수가 그대로다 [OE-ML-18#4]', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles([MEP, ROOMS])
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  await page.getByRole('combobox', { name: '보일 층' }).selectOption({ label: '1F만' })
  await page.getByRole('button', { name: '편집', exact: true }).click()
  const before = { coords: await coords(page), ttl: await ttl(page) }
  expect(before.coords.length).toBeGreaterThan(0)

  await page.getByRole('button', { name: '다중층 뷰에서 편집' }).click()
  await expect(page.getByTestId('multi-banner')).toContainText('1F ~ 2F')
  // 범위를 한 층으로 좁혔다 넓힌다.
  await page.getByLabel('다중층 끝 층').selectOption({ label: '1F' })
  await expect(page.getByTestId('multi-banner')).toContainText('(1개 층)')
  await page.getByRole('group', { name: '다중층 보기 범위' }).getByRole('button', { name: '전체' }).click()
  await expect(page.getByTestId('multi-banner')).toContainText('(2개 층)')
  // 확대·축소(축척).
  const canvas = page.locator('.canvas-wrap > canvas')
  await canvas.scrollIntoViewIfNeeded()
  const box = (await canvas.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  for (const dy of [-400, -400, 600, 300]) await page.mouse.wheel(0, dy)
  await page.getByRole('group', { name: '다중층 보기 범위' }).getByRole('button', { name: '층 편집으로' }).click()

  await expect(page.locator('.edit-bar')).toContainText('바뀐 것 0건')
  expect(await coords(page)).toEqual(before.coords)
  expect(await ttl(page)).toBe(before.ttl)
  expect(errors).toEqual([])
})
