import { expect, test, type Page } from '@playwright/test'

// 인터랙션 원칙(OE-OBJ-15). 시점은 지도식이다 — 빈 곳 왼쪽 드래그는 바닥면을 따라 화면 이동, 오른쪽 드래그와 Shift+왼쪽 드래그(보기·
// 편집 모드 같다)는 회전·기울이기다. 편집 모드의 여러 개 고르기 상자는 Ctrl+드래그다(OE-UI-09, DT 2.0 과 같은 키, #56). 이동이면 카메라와 바라보는 점의 차가 그대로이고, 회전이면 그 방향이 바뀐다. 끄는 중 창이 포커스를 잃으면
// 끌기를 버린다. 3D 에 조작 안내가 보인다.
const MEP = 'src/lib/ifc/fixtures/mep.ifc'

type Cam = { position: number[]; target: number[] }
const cam = (page: Page) => page.evaluate(() => (window as any).__viewer.camera()) as Promise<Cam>
const offset = (c: Cam) => c.position.map((v, i) => v - c.target[i])
const unit = (v: number[]) => {
  const n = Math.hypot(...v)
  return v.map((x) => x / n)
}
const sameDirection = (a: Cam, b: Cam) => unit(offset(a)).every((x, i) => Math.abs(x - unit(offset(b))[i]) < 1e-3)

async function drag(page: Page, from: { x: number; y: number }, dx: number, opts: { button?: 'left' | 'right'; shift?: boolean } = {}) {
  if (opts.shift) await page.keyboard.down('Shift')
  await page.mouse.move(from.x, from.y)
  await page.mouse.down({ button: opts.button ?? 'left' })
  await page.mouse.move(from.x + dx, from.y + 10, { steps: 8 })
  await page.mouse.up({ button: opts.button ?? 'left' })
  if (opts.shift) await page.keyboard.up('Shift')
  await page.waitForTimeout(600) // 관성(damping)이 멎을 때까지
}

test('빈 곳 왼쪽 드래그는 화면 이동, 오른쪽·Shift+왼쪽 드래그는 편집 모드에서도 회전이고, 조작 안내가 보인다', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(MEP)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('.view-controls-hint')).toContainText('드래그: 이동')
  await page.locator('.viewport canvas').scrollIntoViewIfNeeded()
  await page.waitForTimeout(800)
  const box = (await page.locator('.viewport canvas').first().boundingBox())!
  const empty = { x: box.x + box.width * 0.75, y: box.y + box.height * 0.2 }

  const a = await cam(page)
  await drag(page, empty, 80)
  const b = await cam(page)
  expect(b.target).not.toEqual(a.target)
  expect(sameDirection(a, b)).toBe(true)

  await drag(page, empty, 80, { button: 'right' })
  const c = await cam(page)
  expect(sameDirection(b, c)).toBe(false)

  await drag(page, empty, -80, { shift: true })
  const d = await cam(page)
  expect(sameDirection(c, d)).toBe(false)

  // 편집 모드에서도 Shift+왼쪽 드래그는 회전이다. 고르기 상자를 그리지 않는다.
  await page.getByRole('button', { name: '편집', exact: true }).click()
  await page.waitForTimeout(400)
  const boxes: boolean[] = []
  await page.exposeFunction('__sawBox', (v: boolean) => boxes.push(v))
  await page.evaluate(() => {
    const seen = () => (window as any).__sawBox(!!document.querySelector('.box-select'))
    document.querySelector('.viewport canvas')!.addEventListener('pointermove', seen)
  })
  await drag(page, empty, 80, { shift: true })
  const e = await cam(page)
  expect(sameDirection(d, e)).toBe(false)
  expect(boxes.length).toBeGreaterThan(0)
  expect(boxes.every((v) => !v)).toBe(true)
  expect(errors).toEqual([])
})

test('편집 모드에서 고른 설비를 끄는 중 창이 포커스를 잃으면 원래 자리로 돌아간다', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(MEP)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '편집', exact: true }).click()
  await expect(page.locator('.view-controls-hint')).toContainText('Ctrl+드래그: 여러 개 고르기')
  await page.locator('.equipment tbody tr', { hasText: 'AHU-1' }).last().getByRole('button', { name: 'AHU-1', exact: true }).click()
  await page.locator('.viewport canvas').scrollIntoViewIfNeeded()
  await page.waitForTimeout(600)
  const id = '0MEP$Equip$AHU1$0000'
  const before = (await page.evaluate((x) => (window as any).__viewer.center(x), id)) as number[]
  const at = (await page.evaluate((x) => (window as any).__viewer.part(x), id)) as { x: number; y: number }
  await page.mouse.move(at.x, at.y)
  await page.mouse.down()
  await page.mouse.move(at.x + 60, at.y, { steps: 8 })
  await page.evaluate(() => window.dispatchEvent(new Event('blur')))
  await page.mouse.up()
  await page.waitForTimeout(400)
  const after = (await page.evaluate((x) => (window as any).__viewer.center(x), id)) as number[]
  expect(after.map((v) => Math.round(v * 1000))).toEqual(before.map((v) => Math.round(v * 1000)))
  await expect(page.locator('.edit-bar')).toContainText('바뀐 것 0건')
  expect(errors).toEqual([])
})
