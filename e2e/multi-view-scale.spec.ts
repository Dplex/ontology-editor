import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { enterEdit, leaveMultiView, openFileMenu, openMultiPopover, openMultiView } from './edit-part'

// 다중층 뷰의 보기 범위·축척은 그리는 것만 바꾼다(OE-ML-18 AC4). 편집기에는 층 간격을 따로 바꾸는 보기 설정이 없고 다중층 뷰는 실제 높이로
// 그린다 — 바꿀 수 있는 것은 보기 범위(시작·끝 층)와 확대·축소다. 그 뒤에도 저장 좌표·연결(TTL)·편집 수가 그대로인지 본다.
// two-rooms.ifc + mep.ifc 를 합치면 층이 둘(1F·2F)이다.
const MEP = 'src/lib/ifc/fixtures/mep.ifc'
const ROOMS = 'src/lib/ifc/fixtures/two-rooms.ifc'

// 화면 모델의 엔티티마다 3D 가운데. 예전 설비 표의 좌표 칸 대신 쓴다(#715 에서 표가 빠졌다).
const coords = (page: Page) =>
  page.evaluate(() => {
    const w = window as any
    const ids = [...(w.__oe.screen().ttl as string).matchAll(/^ex:(\S+) a /gm)].map((m) => m[1].replace(/\\(.)/g, '$1'))
    return ids.map((id) => JSON.stringify(w.__viewer.center(id))).filter((c) => c !== 'null')
  })
async function ttl(page: Page): Promise<string> {
  await openFileMenu(page)
  const [dl] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '의미 내보내기 (Brick TTL)' }).click()])
  return readFileSync((await dl.path())!, 'utf-8').replace(/^# .*생성.*$/gm, '')
}

test('다중층 뷰에서 보기 범위를 바꾸고 확대·축소해도 저장 좌표·연결·편집 수가 그대로다 [OE-ML-18#4]', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles([MEP, ROOMS])
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  await page.getByRole('combobox', { name: '보일 층' }).selectOption({ label: '1F' })
  await enterEdit(page)
  const before = { coords: await coords(page), ttl: await ttl(page) }
  expect(before.coords.length).toBeGreaterThan(0)

  await openMultiView(page)
  await expect(page.getByTestId('multi-banner')).toContainText('1F ~ 2F')
  // 범위를 한 층으로 좁혔다 넓힌다.
  await openMultiView(page, { from: '1F', to: '1F' })
  await expect(page.getByTestId('multi-banner')).toContainText('(1개 층)')
  const pop = await openMultiPopover(page)
  await pop.getByRole('button', { name: '전체' }).click()
  await pop.getByRole('button', { name: '다중층 보기' }).click()
  await expect(page.getByTestId('multi-banner')).toContainText('(2개 층)')
  // 확대·축소(축척).
  const canvas = page.locator('.canvas-wrap > canvas')
  await canvas.scrollIntoViewIfNeeded()
  const box = (await canvas.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  for (const dy of [-400, -400, 600, 300]) await page.mouse.wheel(0, dy)
  await leaveMultiView(page)

  await expect(page.getByTestId('changes-link')).toContainText('바뀐 것 0건')
  expect(await coords(page)).toEqual(before.coords)
  expect(await ttl(page)).toBe(before.ttl)
  expect(errors).toEqual([])
})
