import { existsSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { enterEdit } from './edit-part'

// 3D 오른쪽 위 방향 큐브와 비행 모드(nav-cube.ts · viewer.ts 의 setFly). 시점은 __viewer.camera() 의 눈·대상으로 잰다.
const DUPLEX = 'data/NBU_Duplex/NBU_Duplex-Apt_Eng-MEP.ifc'
const viewer = <T,>(page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(([f, a]) => (window as any).__viewer[f as string](...(a as unknown[])), [fn, args] as const) as Promise<T>
type Cam = { position: number[]; target: number[] }
const cam = (page: Page) => viewer<Cam>(page, 'camera')
/** 대상에서 눈 쪽 단위 방향. */
const dirOf = (c: Cam) => {
  const d = c.position.map((v, i) => v - c.target[i])
  const n = Math.hypot(...d)
  return d.map((v) => v / n)
}
const settled = async (page: Page) => {
  let last = ''
  await expect
    .poll(async () => {
      const now = JSON.stringify(await cam(page))
      const same = now === last
      last = now
      return same
    })
    .toBe(true)
}

test('Duplex: 방향 큐브의 윗면을 누르면 위에서 보고, 끌면 돌며, G 비행 모드에서 WASD·Q/E 로 옮기고 드래그로 둘러보고, E·W 는 단축키로 안 가며, Esc 로 나온다', async ({ page }) => {
  test.skip(!existsSync(DUPLEX), `${DUPLEX} 이 없다(npm run fetch:sample)`)
  test.setTimeout(120_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.setViewportSize({ width: 1500, height: 900 })
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(DUPLEX)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 90_000 })
  await enterEdit(page)
  const cube = page.getByTestId('nav-cube').locator('canvas')
  await expect(cube).toBeVisible()
  await settled(page)

  // 처음 시점(비스듬히 위)에서는 큐브 윗면이 큐브 위쪽에 보인다. 누르면 바로 위에서 본다.
  const box = (await cube.boundingBox())!
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.28)
  await settled(page)
  expect(dirOf(await cam(page))[1]).toBeGreaterThan(0.99)

  // 큐브를 옆으로 끌면 대상 둘레로 돈다 — 대상은 그대로, 눈의 방향이 바뀐다. 위에서 보던 것을 비스듬히로 먼저 돌린다.
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 10, box.y + box.height / 2 - 20, { steps: 4 })
  await page.mouse.move(box.x + box.width / 2 + 50, box.y + box.height / 2 - 20, { steps: 6 })
  await page.mouse.up()
  const turned = await cam(page)
  expect(dirOf(turned)[1]).toBeLessThan(0.99)

  // 비행 모드. 배지가 뜨고, W 를 누르고 있으면 보는 쪽으로 눈과 대상이 같이 간다.
  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('g')
  await expect(page.getByTestId('fly-badge')).toBeVisible()
  expect(await viewer(page, 'flying')).not.toBeNull()
  const before = await cam(page)
  await page.keyboard.down('w')
  await page.waitForTimeout(400)
  await page.keyboard.up('w')
  const after = await cam(page)
  const forward = before.target.map((v, i) => v - before.position[i])
  const moved = after.position.map((v, i) => v - before.position[i])
  expect(moved.reduce((s, v, i) => s + v * forward[i], 0)).toBeGreaterThan(0)
  expect(after.target.map((v, i) => +(v - before.target[i]).toFixed(3))).toEqual(moved.map((v) => +v.toFixed(3)))
  // E 는 올라가기다 — 보기 모드로 바뀌지 않는다. W(벽)·D(방향 미리보기)도 단축키로 가지 않는다.
  await page.keyboard.down('e')
  await page.waitForTimeout(300)
  await page.keyboard.up('e')
  expect((await cam(page)).position[1]).toBeGreaterThan(after.position[1])
  await expect(page.locator('.edit-bar')).toBeVisible()

  // 드래그는 제자리에서 둘러보기 — 눈은 그대로, 대상만 돈다.
  const look0 = await cam(page)
  const c = (await page.locator('.canvas-wrap > canvas').first().boundingBox())!
  await page.mouse.move(c.x + c.width / 2, c.y + c.height / 2)
  await page.mouse.down()
  await page.mouse.move(c.x + c.width / 2 + 120, c.y + c.height / 2, { steps: 6 })
  await page.mouse.up()
  const look1 = await cam(page)
  expect(look1.position.map((v) => +v.toFixed(6))).toEqual(look0.position.map((v) => +v.toFixed(6)))
  expect(look1.target).not.toEqual(look0.target)

  // Esc 로 나온다. 그 뒤 E 는 다시 보기 ↔ 편집이다.
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('fly-badge')).toHaveCount(0)
  expect(await viewer(page, 'flying')).toBeNull()
  await page.screenshot({ path: test.info().outputPath('nav-cube.png') })
  await page.keyboard.press('e')
  await expect(page.locator('.edit-bar')).toHaveCount(0)
  expect(errors).toEqual([])
})

// 비행 중 층 이동(fly-storey.ts). two-rooms.ifc 는 1F 가 0m, 2F 가 3m 라 눈높이가 1.6m · 4.6m 다.
test('비행 중 Q Q·E E 로 아래층·위층 눈높이로 옮기고 보일 층이 따라오며, 맨 아래에서는 멈추고, 모든 층이면 보일 층은 그대로다', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles('src/lib/ifc/fixtures/two-rooms.ifc')
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  const storey = page.getByRole('combobox', { name: '보일 층' })
  await storey.selectOption({ label: '1F' })
  await settled(page)
  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('g')
  await expect(page.getByTestId('fly-badge')).toBeVisible()
  const eye = async () => (await cam(page)).position[1]
  const twice = async (key: string) => {
    await page.keyboard.press(key)
    await page.keyboard.press(key)
    await settled(page)
  }
  const start = await cam(page)
  expect(start.position[1]).toBeGreaterThan(4.6)

  // 건물 위에서 Q Q 는 맨 위층(2F) 눈높이로. 가로 자리·보는 방향은 그대로다.
  await twice('q')
  expect(await eye()).toBeCloseTo(4.6, 3)
  const at2 = await cam(page)
  expect([at2.position[0], at2.position[2]].map((v) => +v.toFixed(3))).toEqual([start.position[0], start.position[2]].map((v) => +v.toFixed(3)))
  expect(at2.target[1] - at2.position[1]).toBeCloseTo(start.target[1] - start.position[1], 3)
  await expect(storey.locator('option:checked')).toHaveText('2F')

  await twice('q')
  expect(await eye()).toBeCloseTo(1.6, 3)
  await expect(storey.locator('option:checked')).toHaveText('1F')
  // 맨 아래층에서는 더 가지 않는다. 첫 누름은 여느 Q 처럼 누르는 동안 내려가서, 프레임이 길면(바쁜 PC) 몇 cm 내려간다.
  await twice('q')
  expect(await eye()).toBeCloseTo(1.6, 1)
  await expect(page.locator('.key-note')).toContainText('맨 아래층입니다')

  // 한 번 누름은 층 이동이 아니라 지금처럼 오르내리기다(누르고 있는 만큼만).
  await page.keyboard.down('e')
  await page.waitForTimeout(150)
  await page.keyboard.up('e')
  const nudged = await eye()
  expect(nudged).toBeGreaterThan(1.6)
  expect(nudged).toBeLessThan(4.6 - 0.3)

  // 모든 층을 보고 있으면 E E 로 올라가도 보일 층은 그대로다.
  await page.keyboard.press('Escape')
  await storey.selectOption({ label: '모든 층' })
  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('g')
  await settled(page)
  await twice('q')
  await twice('q')
  expect(await eye()).toBeCloseTo(1.6, 3)
  await twice('e')
  expect(await eye()).toBeCloseTo(4.6, 3)
  await expect(storey.locator('option:checked')).toHaveText('모든 층')
  expect(errors).toEqual([])
})
