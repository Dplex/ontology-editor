import { existsSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { pickEquipment, enterEdit, openMultiView, toEquipment } from './edit-part'

// 편집 리플레이는 건물 전체 3D 에서 연다. 편집 화면에서 보기 필터(층·클래스)·분해도·다중층 뷰를 켜 둔 채 P 를 누르면 그 상태로 열려서, 오프닝에
// 건물 일부만 솟았다. 리플레이 동안은 그 상태를 보지 않고(값은 그대로 둔다), 닫으면 켜 둔 그대로 돌아오는지 뷰어가 실제로 그린 것(__viewer.shown)으로 잰다.
const MEP = 'src/lib/ifc/fixtures/mep.ifc'
const DUPLEX = 'data/NBU_Duplex/NBU_Duplex-Apt_Eng-MEP.ifc'
const RADIATOR = 'M_Radiator - Hosted:Readiator - 25:Readiator - 25:536919'
test.use({ contextOptions: { reducedMotion: 'no-preference' } })

type Shown = { hidden: number; storeys: string[] | null; exploded: number }
const shown = (page: Page) => page.evaluate(() => (window as any).__viewer.shown() as Shown)
const phase = (page: Page) => page.locator('.replay-hud').getAttribute('data-phase')

/** P 로 열고, 오프닝 동안 뷰어가 그린 것을 돌려준다. */
async function openReplay(page: Page): Promise<Shown> {
  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('p')
  await expect(page.locator('.replay-hud')).toBeVisible()
  expect(await phase(page)).toBe('opening')
  return shown(page)
}
async function closeReplay(page: Page) {
  // Esc 는 닫을지 묻고 Enter 로 닫는다.
  await page.keyboard.press('Escape')
  await page.keyboard.press('Enter')
  await expect(page.locator('.replay-hud')).toHaveCount(0)
}

test('보기 필터로 클래스를 숨기고 분해도를 띄운 채 열어도 건물 전체에서 시작하고, 닫으면 숨김·분해도가 그대로 돌아온다', async ({ page }) => {
  test.setTimeout(120_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(MEP)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  await page.keyboard.press('e')
  await pickEquipment(page, 'AHU-1')
  await page.keyboard.press('Shift+ArrowRight')
  await page.waitForTimeout(1800)

  await page.getByRole('button', { name: '보기 필터' }).click()
  await page.getByRole('button', { name: '덕트·배관 빼기' }).click()
  await page.getByRole('button', { name: 'Brick 클래스별 분해도' }).click()
  await page.getByRole('button', { name: '닫기' }).first().click()
  const before = await shown(page)
  expect(before.hidden).toBeGreaterThan(0)
  expect(before.exploded).toBeGreaterThan(0)

  expect(await openReplay(page)).toMatchObject({ hidden: 0, storeys: null, exploded: 0 })
  await closeReplay(page)
  await expect.poll(() => shown(page)).toEqual(before)
  expect(errors).toEqual([])
})

test('Duplex: 보기 필터로 한 층만 보거나 다중층 뷰여도 오프닝은 모든 층이고, 닫으면 보던 층으로 돌아온다', async ({ page }) => {
  test.skip(!existsSync(DUPLEX), 'Duplex 가 없다(npm run fetch:sample)')
  test.setTimeout(180_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(DUPLEX)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 90_000 })
  const storeyBox = page.getByRole('combobox', { name: '보일 층' })
  await storeyBox.selectOption({ label: 'Level 1' })
  await enterEdit(page)
  await toEquipment(page)
  await pickEquipment(page, RADIATOR)
  await page.locator('.canvas-wrap > canvas').scrollIntoViewIfNeeded()
  await page.keyboard.press('Shift+ArrowRight')
  await page.waitForTimeout(1500)

  // 모든 층 + 보기 필터 층 칸에서 Level 1 만
  await storeyBox.selectOption({ label: '모든 층' })
  await page.getByRole('button', { name: '보기 필터' }).click()
  await page.getByRole('checkbox', { name: 'Level 2' }).uncheck()
  await page.getByRole('checkbox', { name: 'Roof' }).uncheck()
  await page.getByRole('button', { name: '닫기' }).first().click()
  const filtered = await shown(page)
  expect(filtered.storeys).toHaveLength(1)
  expect((await openReplay(page)).storeys).toBeNull()
  await closeReplay(page)
  await expect.poll(() => shown(page)).toEqual(filtered)

  // 다중층 뷰(Level 1~2)
  await page.getByRole('button', { name: '보기 필터' }).click()
  await page.getByRole('button', { name: '모두 보이기' }).click()
  await storeyBox.selectOption({ label: 'Level 1' })
  await openMultiView(page)
  await expect.poll(async () => (await shown(page)).storeys?.length).toBe(2)
  const multi = await shown(page)
  expect((await openReplay(page)).storeys).toBeNull()
  await closeReplay(page)
  await expect.poll(() => shown(page)).toEqual(multi)
  expect(errors).toEqual([])
})
