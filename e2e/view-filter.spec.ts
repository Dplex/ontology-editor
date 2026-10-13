import { existsSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'

// 3D 보기 필터 · 우클릭 메뉴 · 분해도(ui-notes 보기 필터). 화면 상태만 — 바뀐 것 0건이 그대로인지도 본다.
// Duplex MEP: Level 1·2·Roof, 기기 141대 · 덕트·배관 785개.
const DUPLEX = 'data/NBU_Duplex/NBU_Duplex-Apt_Eng-MEP.ifc'
const RADIATOR = 'M_Radiator - Hosted:Readiator - 25:Readiator - 25:536919'
const viewer = <T,>(page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(([f, a]) => (window as any).__viewer[f as string](...(a as unknown[])), [fn, args] as const) as Promise<T>
type Shown = { hidden: number; parts: number; storeys: string[] | null; labels: number; exploded: number }
const shown = (page: Page) => viewer<Shown>(page, 'shown')

test('Duplex: 보기 필터로 덕트·배관을 빼면 상자 선택이 기기만 고르고, 우클릭으로 격리·숨기기·모두 보이기, 층 여러 개 골라 보기, Brick 클래스별 분해도가 되며, 편집은 0건이다', async ({ page }, info) => {
  test.skip(!existsSync(DUPLEX), `${DUPLEX} 이 없다(npm run fetch:sample)`)
  test.setTimeout(180_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.setViewportSize({ width: 1500, height: 900 })
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(DUPLEX)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 90_000 })
  await page.getByRole('button', { name: '편집', exact: true }).click()
  await page.getByRole('combobox', { name: '보일 층' }).selectOption({ label: '모든 층' })
  const canvas = page.locator('.viewport canvas').first()
  const c = (await canvas.boundingBox())!

  // 패널: 클래스는 기기 먼저, 덕트·배관은 뒤. 덕트·배관을 빼면 그만큼 숨는다.
  await page.getByTestId('filter-toggle').click()
  const panel = page.getByTestId('filter-panel')
  await expect(panel).toContainText('fso:Segment')
  const conduits = (await panel.locator('label.conduit .muted').allTextContents()).reduce((s, t) => s + Number(t.replace(/,/g, '')), 0)
  expect(conduits).toBe(785)
  await panel.getByRole('button', { name: '덕트·배관 빼기' }).click()
  await expect(page.getByTestId('filter-summary')).toContainText('설비 141대 보임')
  expect((await shown(page)).hidden).toBe(785)
  await page.screenshot({ path: info.outputPath('1-filter.png') })

  // 상자 선택(Ctrl+끌기)은 보이는 것만 — 기기만 고른다.
  await page.getByRole('button', { name: '닫기' }).first().click()
  await expect(page.getByTestId('filter-chip')).toBeVisible()
  await page.keyboard.down('Control')
  await page.mouse.move(c.x + 20, c.y + 60)
  await page.mouse.down()
  await page.mouse.move(c.x + c.width - 20, c.y + c.height - 20, { steps: 8 })
  await page.mouse.up()
  await page.keyboard.up('Control')
  const picked = Number(((await page.locator('.picked h3').first().textContent()) ?? '').match(/설비 (\d+)대 고름/)?.[1] ?? 0)
  expect(picked).toBeGreaterThan(5)
  expect(picked).toBeLessThanOrEqual(141)
  await page.keyboard.press('Escape')

  // 우클릭: 라디에이터를 골라 시점을 맞춘 뒤 가운데를 우클릭 → 이것만 보기.
  await page.locator('input[type=search]').fill('536919')
  await page.locator('.equipment tbody tr', { hasText: RADIATOR }).last().getByRole('button', { name: RADIATOR, exact: true }).click()
  await page.locator('body').press('f')
  await page.waitForTimeout(700)
  // 라디에이터 형상 중심(IFC mm) 473, −13829, 159.
  const centers = await viewer<Record<string, number[]>>(page, 'centers')
  const radiator = Object.keys(centers).find((id) => Math.hypot(centers[id][0] - 473, centers[id][1] + 13829, centers[id][2] - 159) < 30)!
  const at = await viewer<{ x: number; y: number }>(page, 'part', radiator)
  await page.mouse.click(at.x, at.y, { button: 'right' })
  const menu = page.getByTestId('ctx-menu')
  await expect(menu).toContainText('이것만 보기')
  await expect(menu).toContainText('GlobalId 복사')
  await page.screenshot({ path: info.outputPath('2-ctx.png') })
  await menu.getByRole('menuitem', { name: '이것만 보기' }).click()
  await expect.poll(async () => (await shown(page)).hidden).toBe((await shown(page)).parts - 1)
  // 빈 곳 우클릭 → 모두 보이기. 오른쪽 드래그는 메뉴가 아니라 회전이다.
  await page.mouse.click(c.x + c.width * 0.35, c.y + c.height * 0.45, { button: 'right' })
  await expect(menu).toContainText('카메라 초기화')
  await menu.getByRole('menuitem', { name: '모두 보이기' }).click()
  await expect.poll(async () => (await shown(page)).hidden).toBe(0)
  await expect(page.getByTestId('filter-chip')).toHaveCount(0)
  const cam0 = await viewer<{ position: number[] }>(page, 'camera')
  await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2)
  await page.mouse.down({ button: 'right' })
  await page.mouse.move(c.x + c.width / 2 + 80, c.y + c.height / 2, { steps: 6 })
  await page.mouse.up({ button: 'right' })
  await expect(menu).toHaveCount(0)
  expect((await viewer<{ position: number[] }>(page, 'camera')).position).not.toEqual(cam0.position)

  // 층 여러 개 골라 보기(모든 층일 때). Level 2 를 빼면 Level 1·Roof 만.
  await page.getByTestId('filter-toggle').click()
  await panel.locator('label', { hasText: 'Level 2' }).locator('input').uncheck()
  await expect.poll(async () => (await shown(page)).storeys?.length).toBe(2)

  // 분해도: 기기 클래스마다 한 켜, 라벨. 접으면 제자리.
  await panel.getByTestId('explode-toggle').click()
  await expect.poll(async () => (await shown(page)).labels).toBeGreaterThan(1)
  await page.waitForTimeout(800)
  await page.screenshot({ path: info.outputPath('3-explode.png') })
  await panel.getByTestId('explode-toggle').click()
  await expect.poll(async () => (await shown(page)).exploded).toBe(0)

  // 화면 상태만이다 — 편집은 0건.
  await expect(page.locator('.edit-bar')).toContainText('바뀐 것 0건')
  expect(errors).toEqual([])
})
