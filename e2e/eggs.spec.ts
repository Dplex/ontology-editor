import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { pickedCard, pickEquipment } from './edit-part'

// 숨은 연출(egg)의 껍데기(editor/eggs.ts, docs/plans/easter-eggs.md). 기본은 꺼짐이고, 켰다 끄면 3D 층·빛·HUD·GPU 메모리와
// 내보내는 것(TTL·GeoJSON·모델)이 켜기 전과 같아야 한다. e2e 에서만 목록에 드는 시험용 egg(probe)로 껍데기를 잰다.
const MEP = 'src/lib/ifc/fixtures/mep.ifc'
test.use({ contextOptions: { reducedMotion: 'no-preference' } })

const oe = <T,>(page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(([f, a]) => (window as any).__oe[f as string](...(a as unknown[])), [fn, args] as const) as Promise<T>
const viewer = <T,>(page: Page, fn: string) => page.evaluate((f) => (window as any).__viewer[f](), fn) as Promise<T>
type Eggs = { list: { key: string; id: string; title: string; on: boolean }[]; on: string[]; inspect: Record<string, any> }
const eggs = (page: Page) => oe<Eggs>(page, 'eggs')

async function open(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(MEP)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  return errors
}

/** 3D 가 가만히 있을 때까지(그린 장수가 0.4초 사이 그대로). */
async function settle(page: Page) {
  let last = -1
  await expect
    .poll(
      async () => {
        const n = await viewer<number>(page, 'renders')
        const same = n === last
        last = n
        return same
      },
      { intervals: [400], timeout: 20_000 },
    )
    .toBe(true)
}

const hub = (page: Page) => page.getByTestId('egg-hub')
const blur = (page: Page) => page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())

test('기본은 꺼짐 — 파일을 열어도 egg 의 층·HUD·판이 없고 가만히 있으면 0장이며, 글자 칸의 ~ 는 글자다', async ({ page }) => {
  const errors = await open(page)
  await settle(page)
  expect((await eggs(page)).on).toEqual([])
  expect(await viewer(page, 'layers')).toBe(0)
  await expect(page.locator('.egg-hud, [data-testid^="egg-"]')).toHaveCount(0)

  // 이름 찾기 칸(/)에서 친 ~ 는 판을 열지 않고 칸에 들어간다.
  await page.keyboard.press('/')
  const field = page.locator('input:focus')
  await expect(field).toHaveCount(1)
  await page.keyboard.type('~')
  await expect(field).toHaveValue(/~$/)
  await expect(hub(page)).toHaveCount(0)
  expect(errors).toEqual([])
})

test('~ 판 — 숫자로 켜고 끄며, 판이 떠 있을 때의 Esc 는 판만 닫고 고른 설비는 그대로다', async ({ page }) => {
  const errors = await open(page)
  await pickEquipment(page, 'AHU-1')
  await expect(pickedCard(page)).toBeVisible()
  await blur(page)

  await page.keyboard.press('Shift+Backquote')
  await expect(hub(page)).toBeVisible()
  const { list } = await eggs(page)
  const n = list.findIndex((e) => e.id === 'probe') + 1
  expect(n).toBeGreaterThan(0)
  const button = hub(page).locator('button[data-egg="probe"]')
  await expect(button).toHaveAttribute('aria-pressed', 'false')
  await page.keyboard.press(`Digit${n}`)
  await expect(button).toHaveAttribute('aria-pressed', 'true')
  expect((await eggs(page)).on).toEqual(['probe'])
  expect(await viewer(page, 'layers')).toBe(1)
  await expect(page.getByTestId('egg-hud-probe')).toContainText('완전성 검사 위반')

  // 판의 Esc 는 판만 닫는다. 켠 egg 와 고른 설비는 그대로다.
  await page.keyboard.press('Escape')
  await expect(hub(page)).toHaveCount(0)
  await expect(pickedCard(page)).toBeVisible()
  expect((await eggs(page)).on).toEqual(['probe'])
  // 판이 없을 때의 Esc 는 여느 때처럼 선택 해제다.
  await page.keyboard.press('Escape')
  await expect(pickedCard(page)).toHaveCount(0)

  // 판의 단추를 눌러도 끈다. 끄면 층·HUD 가 없다.
  await page.keyboard.press('Shift+Backquote')
  await button.click()
  await expect(button).toHaveAttribute('aria-pressed', 'false')
  expect(await viewer(page, 'layers')).toBe(0)
  await expect(page.getByTestId('egg-hud-probe')).toHaveCount(0)
  await page.keyboard.press('Shift+Backquote')
  await expect(hub(page)).toHaveCount(0)
  expect(errors).toEqual([])
})

test('목록의 egg 를 하나씩 켰다 끄면 내보내는 것·3D 층·빛·HUD·GPU 메모리가 켜기 전과 같고, 다시 0장이 된다', async ({ page }) => {
  test.setTimeout(120_000)
  const errors = await open(page)
  await settle(page)
  const before = {
    snapshot: await oe(page, 'exportSnapshot'),
    memory: await viewer(page, 'memory'),
    lights: await viewer(page, 'lights'),
  }
  const { list } = await eggs(page)
  expect(list.length).toBeGreaterThan(0)
  for (const { id } of list) {
    expect(await oe(page, 'eggOn', id), id).toBe(true)
    await page.waitForTimeout(500)
    await oe(page, 'eggOff', id)
    await settle(page)
    expect(await viewer(page, 'layers'), id).toBe(0)
    expect(await viewer(page, 'lights'), id).toEqual(before.lights)
    expect(await viewer(page, 'memory'), id).toEqual(before.memory)
    await expect(page.locator('[data-testid^="egg-hud-"]'), id).toHaveCount(0)
    expect(await oe(page, 'exportSnapshot'), id).toEqual(before.snapshot)
  }
  expect(errors).toEqual([])
})

test('probe — 켜 둔 동안만 매 프레임 그리고 빛을 바꾸며, 끄면 처음 빛으로 돌아와 다시 0장이 된다', async ({ page }) => {
  const errors = await open(page)
  await settle(page)
  const lights = await viewer<{ hemi: number; sun: number }>(page, 'lights')
  expect(await oe(page, 'eggOn', 'probe')).toBe(true)
  const r0 = await viewer<number>(page, 'renders')
  await page.waitForTimeout(600)
  expect(await viewer<number>(page, 'renders')).toBeGreaterThan(r0 + 10)
  expect((await eggs(page)).inspect.probe.frames).toBeGreaterThan(10)
  expect(await viewer(page, 'lights')).toEqual({ ...lights, hemi: 0.5 })
  await oe(page, 'eggOff', 'probe')
  expect(await viewer(page, 'lights')).toEqual(lights)
  await settle(page)
  expect(errors).toEqual([])
})

test.describe('움직임을 끈 사람', () => {
  test.use({ contextOptions: { reducedMotion: 'reduce' } })
  test('probe 를 켜도 얹을 때 한 장만 그리고 0장이다', async ({ page }) => {
    const errors = await open(page)
    await settle(page)
    expect(await oe(page, 'eggOn', 'probe')).toBe(true)
    await settle(page)
    const r = await viewer<number>(page, 'renders')
    await page.waitForTimeout(600)
    expect(await viewer<number>(page, 'renders')).toBe(r)
    expect((await eggs(page)).inspect.probe.frames).toBe(0)
    expect(errors).toEqual([])
  })
})

test('주소의 ?egg= 로 열면 3D 가 그려진 뒤 켜져 있다', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  // e2e 서버는 data/ 목록을 붙이지 않아서(testing.md) share-link.spec.ts 처럼 흉내 낸다.
  const body = readFileSync(MEP)
  await page.route('**/__data/**', async (route) => {
    const url = new URL(route.request().url())
    const path = decodeURIComponent(url.pathname.replace(/^\/__data\/?/, ''))
    if (path === '현장/mep.ifc' && !url.search) return route.fulfill({ body, contentType: 'application/octet-stream' })
    return route.fulfill({ status: path ? 404 : 200, json: path ? {} : [] })
  })
  await page.goto(`/?open=${encodeURIComponent('현장/mep.ifc')}&egg=probe,nosuch`)
  await expect(page.locator('.appbar h2')).toHaveText('mep.ifc', { timeout: 30_000 })
  await expect.poll(async () => (await eggs(page)).on).toEqual(['probe'])
  expect(await viewer(page, 'layers')).toBe(1)
  expect(errors).toEqual([])
})

test('리플레이를 열면 켠 egg 가 쉬고, 닫으면 되살아난다', async ({ page }) => {
  test.setTimeout(90_000)
  const errors = await open(page)
  await page.keyboard.press('e')
  await pickEquipment(page, 'AHU-1')
  await page.keyboard.press('Shift+ArrowRight')
  await page.waitForTimeout(600)
  expect(await oe(page, 'eggOn', 'probe')).toBe(true)

  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('p')
  await expect(page.locator('.replay-hud')).toBeVisible()
  expect((await eggs(page)).on).toEqual([])
  expect(await viewer(page, 'layers')).toBe(0)
  // 리플레이 안에서는 ~ 가 판을 열지 않는다.
  await page.keyboard.press('Shift+Backquote')
  await expect(hub(page)).toHaveCount(0)

  await page.keyboard.press('Escape')
  await page.keyboard.press('Enter')
  await expect(page.locator('.replay-hud')).toHaveCount(0)
  await expect.poll(async () => (await eggs(page)).on).toEqual(['probe'])
  expect(await viewer(page, 'layers')).toBe(1)
  expect(errors).toEqual([])
})
