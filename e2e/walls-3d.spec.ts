import { existsSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { toSpace } from './edit-part'

// 보기 모드 3D 의 벽(#599). 벽은 기본으로 켜져 있고 비내력벽(칸막이)도 그린다 — 예전에는 내력벽·모름만 그려서 칸막이가 많은 층은
// 방이 뚫려 보였다. Duplex 건축은 벽 57개 중 내력 7개·비내력 50개다. 삼각형은 node 로 재면 1,472개(내력만이면 84개)이고 브라우저의
// web-ifc 는 조금 다르게 쪼개서(1,488) 정확한 수 대신 하한을 본다. dental 은 node 로 19,872개다.
const DUPLEX = 'data/NBU_Duplex/NBU_Duplex-Apt_Arch.ifc'
const DENTAL = 'data/dental_clinic.ifc'

type Walls = { visible: boolean; triangles: number; rebuilt: string[] } | null
const walls = (page: Page) => page.evaluate(() => (window as unknown as { __viewer: { walls: () => Walls } }).__viewer.walls())

async function open(page: Page, path: string, name: string) {
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(path)
  await expect(page.locator('.appbar h2')).toHaveText(name, { timeout: 90_000 })
}

test('Duplex 건축: 3D 벽은 처음부터 켜져 있고 비내력벽까지 그리며, 끄면 다음에 열 때도 꺼져 있다', async ({ page }) => {
  test.skip(!existsSync(DUPLEX), `${DUPLEX} 이 없다(npm run fetch:sample)`)
  test.setTimeout(120_000)
  await open(page, DUPLEX, 'NBU_Duplex-Apt_Arch.ifc')
  const toggle = page.locator('.walls-toggle')
  await expect(toggle).toContainText('Walls')
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.wall-key')).toContainText('내력벽 7')
  await expect(page.locator('.wall-key')).toContainText('비내력벽 50')
  // 편집하지 않은 벽은 전부 IFC 형상 그대로다(다시 세운 벽이 없다).
  expect(await walls(page)).toMatchObject({ visible: true, rebuilt: [] })
  expect((await walls(page))!.triangles).toBeGreaterThan(1000)
  if (process.env.SHOT) await page.locator('.viewport').screenshot({ path: process.env.SHOT })

  await toggle.click()
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  await expect(page.locator('.wall-key')).toHaveCount(0)
  expect((await walls(page))?.visible).toBe(false)

  // 끈 것은 남는다. 다시 열어도 꺼져 있고, W 로 다시 켠다.
  await open(page, DUPLEX, 'NBU_Duplex-Apt_Arch.ifc')
  await expect(toggle).toHaveAttribute('aria-pressed', 'false')
  expect((await walls(page))?.visible).toBe(false)
  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('w')
  await expect(toggle).toHaveAttribute('aria-pressed', 'true')
  expect((await walls(page))?.visible).toBe(true)
})

test('dental: 벽이 전부 비내력이어도 [벽] 이 나오고 3D 에 그린다', async ({ page }) => {
  test.skip(!existsSync(DENTAL), `${DENTAL} 이 없다(npm run fetch:sample)`)
  test.setTimeout(120_000)
  await open(page, DENTAL, 'dental_clinic.ifc')
  await expect(page.locator('.walls-toggle')).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.wall-key')).toContainText('비내력벽 1080')
  expect(await walls(page)).toMatchObject({ visible: true, rebuilt: [] })
  expect((await walls(page))!.triangles).toBeGreaterThan(15_000)
})

test('Duplex 건축: 편집에서 옮긴 벽은 보기 모드 3D 에서 옛 IFC 자리가 아니라 옮긴 자리에 다시 세운다', async ({ page }) => {
  test.skip(!existsSync(DUPLEX), `${DUPLEX} 이 없다(npm run fetch:sample)`)
  test.setTimeout(120_000)
  await open(page, DUPLEX, 'NBU_Duplex-Apt_Arch.ifc')
  const view = page.getByRole('group', { name: '보기' })
  await page.getByRole('combobox', { name: '보일 층' }).selectOption({ label: 'Level 1만' })
  await page.getByRole('button', { name: '편집', exact: true }).click()
  await toSpace(page)
  await page.getByRole('button', { name: '벽·문·창' }).click()
  // 평면도에서 비내력벽 하나를 골라 방향키로 옮긴다. 외벽이면 층 편집에서 옮기지 않으므로(OE-EXT-02) 내벽으로 푼다.
  await view.getByRole('button', { name: '평면도' }).click()
  const wall = page.getByRole('img', { name: 'Level 1 평면도' }).locator('.walls polygon:not(.bearing)').nth(3)
  const wallId = (await wall.getAttribute('data-wall'))!
  await wall.click({ force: true })
  await expect(page.locator('.element-picked')).toBeVisible()
  const external = page.locator('.element-picked').getByTestId('wall-external-select')
  if ((await external.inputValue()) === 'true') await external.selectOption('false')
  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('.edit-bar')).toContainText('바뀐 것')

  await view.getByRole('button', { name: '3D' }).click()
  await page.getByRole('button', { name: '보기', exact: true }).click()
  await page.locator('dialog[open]').getByRole('button', { name: '임시 저장' }).click()
  await expect(page.locator('.edit-bar')).toHaveCount(0)
  await expect.poll(async () => (await walls(page))?.rebuilt).toEqual([wallId])
  expect((await walls(page))?.visible).toBe(true)
})
