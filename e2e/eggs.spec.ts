import { existsSync, readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { openDrawer, pickedCard, pickEquipment } from './edit-part'

// 숨은 연출(egg)의 껍데기(editor/eggs.ts, docs/plans/easter-eggs.md). 기본은 꺼짐이고, 켰다 끄면 3D 층·빛·HUD·GPU 메모리와
// 내보내는 것(TTL·GeoJSON·모델)이 켜기 전과 같아야 한다. e2e 에서만 목록에 드는 시험용 egg(probe)로 껍데기를 잰다.
const MEP = 'src/lib/ifc/fixtures/mep.ifc'
const DUPLEX_ARCH = 'data/NBU_Duplex/NBU_Duplex-Apt_Arch.ifc'
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

test('xray — 꺼져 있을 때 Space 는 아무 일도 하지 않고, 켜면 TTL 관계 수·HUD·그래프 선 수가 일치하며 Space 로 여닫는다', async ({ page }) => {
  const errors = await open(page)
  await settle(page)
  const snap0 = await oe(page, 'exportSnapshot')
  // 3D 칸에는 방향 큐브의 canvas 도 있다. 본 3D 만 집는다.
  await page.locator('.viewport canvas[role=img]').hover()
  await page.keyboard.down('Space')
  await page.waitForTimeout(150)
  await page.keyboard.up('Space')
  expect((await eggs(page)).on).toEqual([])
  expect(await viewer(page, 'layers')).toBe(0)
  expect(await oe(page, 'exportSnapshot')).toEqual(snap0)

  expect(await oe(page, 'eggOn', 'xray')).toBe(true)
  const info = (await eggs(page)).inspect.xray
  expect(info.feeds).toBeGreaterThan(0)
  expect(info.graph.feeds).toBe(info.feeds)
  expect(info.graph.hasLocation).toBe(info.hasLocation)
  expect(info.graph.hasPart).toBe(info.hasPart)
  await expect(page.getByTestId('egg-hud-xray')).toContainText(`받는 쪽이 읽는 관계 · feeds ${info.feeds.toLocaleString()}`)
  await expect(page.getByTestId('egg-hud-xray')).toContainText(`덕트·배관(fso:) ${info.unread.toLocaleString()}개는 받는 쪽이 읽지 않아 그리지 않았습니다`)

  await page.keyboard.down('Space')
  await expect.poll(async () => (await eggs(page)).inspect.xray.holding).toBe(true)
  await page.keyboard.up('Space')
  await expect.poll(async () => (await eggs(page)).inspect.xray.holding).toBe(false)
  await expect.poll(async () => (await eggs(page)).inspect.xray.alpha).toBe(0)

  await oe(page, 'eggOff', 'xray')
  await settle(page)
  expect(errors).toEqual([])
})

test('alive — TTL 의 feeds 전부가 계통 종류별 메시로 흐르고, 끄면 다시 0장이 된다', async ({ page }) => {
  const errors = await open(page)
  await settle(page)
  expect(await oe(page, 'eggOn', 'alive')).toBe(true)
  const r0 = await viewer<number>(page, 'renders')
  await page.waitForTimeout(500)
  expect(await viewer<number>(page, 'renders')).toBeGreaterThan(r0 + 5)
  const info = (await eggs(page)).inspect.alive
  expect(info.feeds).toBeGreaterThan(0)
  expect(info.graphFeeds).toBe(info.feeds)
  expect(info.groups).toBeGreaterThan(0)
  expect(info.frames).toBeGreaterThan(5)
  await expect(page.getByTestId('egg-hud-alive')).toContainText(`살아 있는 건물 · 흐르는 feeds ${info.feeds.toLocaleString()}`)
  await expect(page.getByTestId('egg-hud-alive')).toContainText('화면에서만')

  // 편집하면 그 자리에서 다시 짓는다(modelVersion 을 watch 로 받는다). inspect 는 짓지 않으니 여기서 따라온 것이 egg 의 몫이다.
  await page.keyboard.press('e')
  await pickEquipment(page, 'AHU-1')
  await page.keyboard.press('Shift+ArrowRight')
  await expect.poll(async () => (await eggs(page)).inspect.alive.modelVersion).toBeGreaterThan(info.modelVersion)
  await expect.poll(async () => {
    const a = (await eggs(page)).inspect.alive
    return a.builtVersion === a.modelVersion
  }).toBe(true)

  await oe(page, 'eggOff', 'alive')
  await settle(page)
  expect(errors).toEqual([])
})

test('pass — 수용 기준선이 미달에서 통과로 바뀌는 순간 한 번만 틀고, 위반이 남은 층은 밝히지 않으며 끝난 뒤 0장이 된다', async ({ page }) => {
  const errors = await open(page)
  await settle(page)
  expect(await oe(page, 'eggOn', 'pass')).toBe(true)
  expect((await eggs(page)).inspect.pass.triggered).toBe(false)

  await openDrawer(page)
  await page.getByTestId('grade-banner').getByRole('button', { name: '등급 판정 보기' }).click()
  const table = page.getByTestId('grade-table')
  for (const g of [1, 2]) {
    await table.getByLabel(`등급 ${g} 통과선(%)`).fill('80')
    await table.getByLabel(`등급 ${g} 통과선(%)`).press('Tab')
  }

  await expect.poll(async () => (await eggs(page)).inspect.pass.triggered).toBe(true)
  const info = (await eggs(page)).inspect.pass
  // mep.ifc 의 1F 에는 위반이 남아 있으므로 거짓 축하로 층판을 밝히지 않는다.
  expect(info.zeroStoreys).toEqual([])
  await expect(page.getByTestId('egg-hud-pass')).toContainText('화면에서만')

  await settle(page)
  await oe(page, 'eggOff', 'pass')
  expect(errors).toEqual([])
})

test('sun — 대지 좌표가 없는 파일은 서울 기준으로 그리고, 시각 막대를 옮기면 해 고도·그림자가 바뀌며 가만히 있으면 0장이다', async ({ page }) => {
  const errors = await open(page)
  await settle(page)
  expect(await oe(page, 'eggOn', 'sun')).toBe(true)
  await settle(page)

  const info0 = (await eggs(page)).inspect.sun
  expect(info0.hasSiteCoords).toBe(false)
  expect(info0.shadowAutoUpdate).toBe(false)
  expect(info0.shadowUpdates).toBe(1)
  await expect(page.getByTestId('egg-hud-sun')).toContainText('이 파일에는 대지 좌표가 없어 서울 기준으로 그렸습니다')
  await expect(page.getByTestId('egg-hud-sun')).toContainText('화면에서만')

  // 시각 막대를 오전 9시(540분)로 옮기면 고도·방위가 바뀌고 그림자 맵이 한 번만 다시 그려진다.
  // fill 이 input 을 이미 한 번 보낸다. 한 번 더 보내면 그 사이에 한 장이 그려졌는지에 따라 2 도 3 도 된다.
  const timeSlider = page.getByTestId('egg-sun-time')
  await timeSlider.fill('540')
  await settle(page)

  const info1 = (await eggs(page)).inspect.sun
  expect(info1.minutesOfDay).toBe(540)
  expect(info1.azimuthDeg).not.toBe(info0.azimuthDeg)
  expect(info1.shadowUpdates).toBe(2)

  // 시각 막대는 아래 도구 막대(BottomViewDock)에 깔리지 않는다. 깔리면 끌 수 없다.
  const slider = (await timeSlider.boundingBox())!
  const dock = (await page.locator('.bottom-view-dock').boundingBox())!
  expect(slider.y + slider.height).toBeLessThanOrEqual(dock.y)

  // 가만히 있을 때는 0장이다.
  const r0 = await viewer<number>(page, 'renders')
  await page.waitForTimeout(500)
  expect(await viewer<number>(page, 'renders')).toBe(r0)

  await oe(page, 'eggOff', 'sun')
  await settle(page)
  expect(errors).toEqual([])
})

test('HUD 는 왼쪽 아래 한 기둥에 쌓여 egg 를 여럿 켜도 서로·도구 막대와 겹치지 않는다', async ({ page }) => {
  const errors = await open(page)
  await settle(page)
  expect(await oe(page, 'eggOn', 'alive')).toBe(true)
  expect(await oe(page, 'eggOn', 'xray')).toBe(true)
  const a = (await page.getByTestId('egg-hud-alive').boundingBox())!
  const x = (await page.getByTestId('egg-hud-xray').boundingBox())!
  const dock = (await page.locator('.bottom-view-dock').boundingBox())!
  const apart = (p: typeof a, q: typeof a) => p.y + p.height <= q.y || q.y + q.height <= p.y || p.x + p.width <= q.x || q.x + q.width <= p.x
  expect(apart(a, x)).toBe(true)
  expect(apart(a, dock)).toBe(true)
  expect(apart(x, dock)).toBe(true)
  await oe(page, 'eggOff', 'xray')
  await oe(page, 'eggOff', 'alive')
  expect(errors).toEqual([])
})

test('refine — 0.25초 멈추면 8장을 모으고 0장이 되며, 시점을 움직이면 다시 모은다', async ({ page }) => {
  const errors = await open(page)
  await settle(page)
  expect(await oe(page, 'eggOn', 'refine')).toBe(true)
  await expect.poll(async () => (await eggs(page)).inspect.refine.completed).toBe(1)
  const info = (await eggs(page)).inspect.refine
  expect(info.samplesDrawn).toBe(8)
  expect(info.sampling).toBe(false)
  await settle(page)
  const r0 = await viewer<number>(page, 'renders')
  await page.waitForTimeout(500)
  expect(await viewer<number>(page, 'renders')).toBe(r0)

  // 휠로 한 칸 당기면 시점이 바뀐다. 멈춘 뒤 다시 한 벌을 모은다.
  await page.locator('.viewport canvas[role=img]').hover()
  await page.mouse.wheel(0, -120)
  await expect.poll(async () => (await eggs(page)).inspect.refine.completed).toBeGreaterThanOrEqual(2)
  await settle(page)
  await oe(page, 'eggOff', 'refine')
  expect(errors).toEqual([])
})

test('shadow — 켤 때 한 번 찍고 가만히 있으면 0장이며, 편집하면 0.5초 모아 다시 찍고 테마를 바꿔도 다시 찍지 않는다', async ({ page }) => {
  const errors = await open(page)
  await settle(page)
  expect(await oe(page, 'eggOn', 'shadow')).toBe(true)
  await expect.poll(async () => (await eggs(page)).inspect.shadow.captures).toBe(1)
  expect((await eggs(page)).inspect.shadow.visible).toBe(true)
  await settle(page)
  const r0 = await viewer<number>(page, 'renders')
  await page.waitForTimeout(500)
  expect(await viewer<number>(page, 'renders')).toBe(r0)

  await page.locator('.appbar button.theme').click()
  await settle(page)
  expect((await eggs(page)).inspect.shadow.captures).toBe(1)

  await page.keyboard.press('e')
  await pickEquipment(page, 'AHU-1')
  await page.keyboard.press('Shift+ArrowRight')
  await expect.poll(async () => (await eggs(page)).inspect.shadow.captures).toBe(2)
  await settle(page)
  await oe(page, 'eggOff', 'shadow')
  expect(errors).toEqual([])
})

test('rise — 켜면 층이 내려앉고 끝나면 0장이며, 새 파일을 열면 다시 튼다', async ({ page }) => {
  const errors = await open(page)
  await settle(page)
  expect(await oe(page, 'eggOn', 'rise')).toBe(true)
  await expect.poll(async () => (await eggs(page)).inspect.rise.running).toBe(false)
  const info = (await eggs(page)).inspect.rise
  expect(info.runs).toBe(1)
  // 장 수는 기계 사정이다(e2e 는 CPU 로 그려서 병렬로 돌면 0.42초에 두세 장). 돌았다는 것만 본다.
  expect(info.frames).toBeGreaterThan(0)
  expect(info.patched).toBeGreaterThan(0)
  await settle(page)
  const r0 = await viewer<number>(page, 'renders')
  await page.waitForTimeout(500)
  expect(await viewer<number>(page, 'renders')).toBe(r0)

  // 같은 탭에서 다른 파일을 연다. 모델 객체가 바뀌니 한 번 더 튼다.
  await page.locator('input[type=file]').first().setInputFiles('src/lib/ifc/fixtures/two-rooms.ifc')
  await expect(page.locator('.appbar h2')).toHaveText('two-rooms.ifc', { timeout: 30_000 })
  await expect.poll(async () => (await eggs(page)).inspect.rise?.runs).toBe(2)
  await oe(page, 'eggOff', 'rise')
  await settle(page)
  expect(errors).toEqual([])
})

test('wipe — 테마 단추에서 원이 퍼지며 테마가 바뀌고, 끄면 붙인 규칙이 사라진다', async ({ page }) => {
  const errors = await open(page)
  await settle(page)
  const theme = () => page.evaluate(() => document.documentElement.getAttribute('data-theme'))
  const before = await theme()
  expect(await oe(page, 'eggOn', 'wipe')).toBe(true)
  await expect(page.getByTestId('egg-wipe-style')).toHaveCount(1)
  await page.locator('.appbar button.theme').click()
  await expect.poll(theme).not.toBe(before)
  await expect.poll(async () => (await eggs(page)).inspect.wipe.running).toBe(false)
  expect((await eggs(page)).inspect.wipe.transitions).toBe(1)
  // 전환 콜백은 화면 갱신(rAF)이 멈춘 동안 돈다. 3D 한 장을 기다리면 늘 시간 초과(0.3초)로 끝났다 — 작업 한 칸만 기다린다.
  expect((await eggs(page)).inspect.wipe.lastWaitMs).toBeLessThan(150)
  // 한 번 더 누르면 돌아온다.
  await page.locator('.appbar button.theme').click()
  await expect.poll(theme).toBe(before)
  await expect.poll(async () => (await eggs(page)).inspect.wipe.transitions).toBe(2)
  await expect.poll(async () => (await eggs(page)).inspect.wipe.running).toBe(false)
  await oe(page, 'eggOff', 'wipe')
  await expect(page.getByTestId('egg-wipe-style')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('blueprint — 켜면 바탕·모서리 선·면·격자를 청사진으로 칠하고, 테마를 바꿔도 청사진이며 끄면 재질이 처음 값으로 돌아온다', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  // 벽 형상이 있어야 모서리 선이 있다. 픽스처에는 없어서 Duplex 건축으로 연다(data/ 는 받아야 있다 — 없으면 건너뛴다).
  test.skip(!existsSync(DUPLEX_ARCH), `${DUPLEX_ARCH} 이 없다. npm run fetch:sample 로 받는다`)
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(DUPLEX_ARCH)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 90_000 })
  await settle(page)
  const before = await viewer(page, 'memory')
  expect(await oe(page, 'eggOn', 'blueprint')).toBe(true)
  await expect.poll(async () => (await eggs(page)).inspect.blueprint.surfaces).toBeGreaterThan(0)
  const info = (await eggs(page)).inspect.blueprint
  expect(info.lines).toBeGreaterThan(0)
  expect(info.grids).toBe(1)
  expect(info.background).toBe(true)
  await settle(page)
  const r0 = await viewer<number>(page, 'renders')
  await page.waitForTimeout(500)
  expect(await viewer<number>(page, 'renders')).toBe(r0)
  // 테마를 바꾸면 뷰어가 모서리·격자를 되칠한다. 그 뒤 다시 입힌다.
  await page.locator('.appbar button.theme').click()
  await expect.poll(async () => (await eggs(page)).inspect.blueprint.lines).toBeGreaterThan(0)
  await page.locator('.appbar button.theme').click()
  await oe(page, 'eggOff', 'blueprint')
  await settle(page)
  expect(await viewer(page, 'memory')).toEqual(before)
  expect(errors).toEqual([])
})

test.describe('움직임을 끈 사람', () => {
  test.use({ contextOptions: { reducedMotion: 'reduce' } })
  test('rise 는 틀지 않고 wipe 는 전환 없이 테마만 바꾼다', async ({ page }) => {
    const errors = await open(page)
    await settle(page)
    expect(await oe(page, 'eggOn', 'rise')).toBe(true)
    expect(await oe(page, 'eggOn', 'wipe')).toBe(true)
    await settle(page)
    expect((await eggs(page)).inspect.rise.runs).toBe(0)
    const theme = () => page.evaluate(() => document.documentElement.getAttribute('data-theme'))
    const before = await theme()
    await page.locator('.appbar button.theme').click()
    await expect.poll(theme).not.toBe(before)
    expect((await eggs(page)).inspect.wipe.transitions).toBe(0)
    await page.locator('.appbar button.theme').click()
    await expect.poll(theme).toBe(before)
    expect(errors).toEqual([])
  })

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
