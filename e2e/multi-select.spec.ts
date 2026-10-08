import { existsSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'

// 여러 개 고르기(OE-UI-09, 2026-10-03 사용자 결정). 설비만, 편집 모드에서 Shift+클릭(목록·3D·평면도)과 Shift+끌기 상자로 고르고, 방향키·끌기로
// 같이 옮기고 Delete 로 같이 지운다 — 되돌리기 한 번에 전부. mep.ifc 의 사무실(0..10 × 0..8)에 디퓨저 둘 AT-101-01 (3,4)·AT-101-02 (7,4)이 있다.
const MEP = 'src/lib/ifc/fixtures/mep.ifc'

async function open(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(MEP)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '편집', exact: true }).click()
  return errors
}
// 디퓨저·조명은 천장 설비라 천장 편집 모드(T)에서 고친다(OE-OBJ-08).
async function enterCeiling(page: Page) {
  const on = page.getByRole('group', { name: '설비 편집 면' }).getByRole('button', { name: '천장' })
  if ((await on.getAttribute('aria-pressed')) === 'true') return
  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('t')
  await expect(on).toHaveAttribute('aria-pressed', 'true')
}

const row = (page: Page, name: string) => page.locator('.equipment tbody tr', { hasText: name }).last()
const coords = async (page: Page, name: string) => [0, 1].map(async (i) => Number(await row(page, name).locator('.coord').nth(i).inputValue()))
const at = async (page: Page, name: string) => Promise.all(await coords(page, name))
const keys = async (page: Page, ...combo: string[]) => {
  await page.locator('body').click({ position: { x: 5, y: 5 } })
  for (const k of combo) await page.keyboard.press(k)
}

test('목록에서 Shift+클릭으로 둘을 고르면 방향키로 같이 옮기고, Delete 로 같이 지우며, 되돌리기 한 번에 둘 다 돌아온다', async ({ page }) => {
  const errors = await open(page)
  await enterCeiling(page)
  await row(page, 'AT-101-01').getByRole('button', { name: 'AT-101-01', exact: true }).click()
  await row(page, 'AT-101-02').getByRole('button', { name: 'AT-101-02', exact: true }).click({ modifiers: ['Shift'] })
  const panel = page.locator('.group-picked')
  await expect(panel.locator('h3')).toHaveText('설비 2대 고름')
  await expect(page.locator('.equipment tbody tr.chosen')).toHaveCount(2)

  const [a0, b0] = [await at(page, 'AT-101-01'), await at(page, 'AT-101-02')]
  await keys(page, 'Shift+ArrowRight')
  await expect.poll(async () => (await at(page, 'AT-101-01')).join()).not.toBe(a0.join())
  const [a1, b1] = [await at(page, 'AT-101-01'), await at(page, 'AT-101-02')]
  // 같은 거리만큼(1m) 같은 쪽으로.
  expect([a1[0] - a0[0], a1[1] - a0[1]]).toEqual([b1[0] - b0[0], b1[1] - b0[1]])
  expect(Math.hypot(a1[0] - a0[0], a1[1] - a0[1])).toBeCloseTo(1, 2)
  await expect(page.locator('.edit-bar')).toContainText('설비 2대 옮김')
  await keys(page, 'Control+z')
  await expect.poll(async () => (await at(page, 'AT-101-01')).join()).toBe(a0.join())
  expect((await at(page, 'AT-101-02')).join()).toBe(b0.join())

  // 덕트는 넣지 않는다.
  await row(page, 'DUCT-01').getByRole('button', { name: 'DUCT-01', exact: true }).click({ modifiers: ['Shift'] })
  await expect(panel.locator('h3')).toHaveText('설비 2대 고름')

  // 같이 지우기 → 되돌리기 한 번에 둘 다.
  await keys(page, 'Delete')
  await expect(page.locator('.equipment tbody tr', { hasText: 'AT-101-01' })).toHaveCount(0)
  await expect(page.locator('.equipment tbody tr', { hasText: 'AT-101-02' })).toHaveCount(0)
  await expect(page.locator('.group-picked')).toHaveCount(0)
  await keys(page, 'Control+z')
  await expect(page.locator('.equipment tbody tr', { hasText: 'AT-101-01' })).not.toHaveCount(0)
  await expect(page.locator('.equipment tbody tr', { hasText: 'AT-101-02' })).not.toHaveCount(0)

  // Shift+클릭으로 하나를 빼면 보통 고르기로 돌아가고, Esc 는 묶음을 푼다.
  await row(page, 'AT-101-01').getByRole('button', { name: 'AT-101-01', exact: true }).click()
  await row(page, 'AT-101-02').getByRole('button', { name: 'AT-101-02', exact: true }).click({ modifiers: ['Shift'] })
  await row(page, 'AT-101-02').getByRole('button', { name: 'AT-101-02', exact: true }).click({ modifiers: ['Shift'] })
  await expect(page.locator('.group-picked')).toHaveCount(0)
  await expect(page.locator('.picked h3').first()).toHaveText('AT-101-01')
  await row(page, 'AT-101-02').getByRole('button', { name: 'AT-101-02', exact: true }).click({ modifiers: ['Shift'] })
  await expect(page.locator('.group-picked')).toBeVisible()
  await keys(page, 'Escape')
  await expect(page.locator('.group-picked')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('평면도에서 Shift+끌기 상자로 디퓨저 둘을 고르고, 3D 에서 Shift+클릭·Shift+끌기 상자로도 고른다', async ({ page }) => {
  const errors = await open(page)
  await enterCeiling(page)
  // 평면도. 두 디퓨저 점을 감싸는 상자를 Shift 를 누른 채 끈다.
  await page.getByRole('group', { name: '보기' }).getByRole('button', { name: '평면도' }).click()
  const plan = page.locator('svg.floor-plan')
  const dot = (id: string) => plan.locator(`circle[data-equipment="${id}"]`)
  const ids = await plan.locator('.devices circle').evaluateAll((els) => els.map((e) => [e.getAttribute('data-equipment'), e.querySelector('title')?.textContent]))
  const idOf = (name: string) => ids.find(([, t]) => t === name)![0]!
  const [a, b] = [(await dot(idOf('AT-101-01')).boundingBox())!, (await dot(idOf('AT-101-02')).boundingBox())!]
  const [x0, x1] = [Math.min(a.x, b.x) - 10, Math.max(a.x + a.width, b.x + b.width) + 10]
  const [y0, y1] = [Math.min(a.y, b.y) - 10, Math.max(a.y + a.height, b.y + b.height) + 10]
  await page.keyboard.down('Shift')
  await page.mouse.move(x0, y0)
  await page.mouse.down()
  await page.mouse.move(x1, y1, { steps: 6 })
  await page.mouse.up()
  await page.keyboard.up('Shift')
  await expect(page.locator('.group-picked h3')).toHaveText(/설비 \d+대 고름/)
  await expect(plan.locator('circle.chosen[data-equipment="' + idOf('AT-101-01') + '"]')).toHaveCount(1)
  await expect(plan.locator('circle.chosen[data-equipment="' + idOf('AT-101-02') + '"]')).toHaveCount(1)
  await keys(page, 'Escape')

  // 3D. 디퓨저 하나를 누르고 다른 하나를 Shift+클릭한다.
  await page.getByRole('group', { name: '보기' }).getByRole('button', { name: '3D' }).click()
  await page.locator('.viewport canvas').scrollIntoViewIfNeeded()
  await page.waitForTimeout(300)
  const screen = (id: string) => page.evaluate((x) => (window as any).__viewer.part(x) as { x: number; y: number }, id)
  const [pa, pb] = [await screen(idOf('AT-101-01')), await screen(idOf('AT-101-02'))]
  await page.mouse.click(pa.x, pa.y)
  await expect(page.locator('.picked h3').first()).toHaveText('AT-101-01')
  await page.keyboard.down('Shift')
  await page.mouse.click(pb.x, pb.y)
  await page.keyboard.up('Shift')
  await expect(page.locator('.group-picked h3')).toHaveText('설비 2대 고름')

  // 묶음 중 하나를 끌면 둘 다 같은 거리만큼 간다.
  const [a0, b0] = [await at(page, 'AT-101-01'), await at(page, 'AT-101-02')]
  await page.mouse.move(pa.x, pa.y)
  await page.mouse.down()
  await page.mouse.move(pa.x + 40, pa.y, { steps: 6 })
  await page.mouse.up()
  await expect.poll(async () => (await at(page, 'AT-101-01')).join()).not.toBe(a0.join())
  const [a1, b1] = [await at(page, 'AT-101-01'), await at(page, 'AT-101-02')]
  expect(a1[0] - a0[0]).toBeCloseTo(b1[0] - b0[0], 2)
  expect(a1[1] - a0[1]).toBeCloseTo(b1[1] - b0[1], 2)
  await keys(page, 'Control+z', 'Escape')

  // 3D Shift+끌기 상자.
  const [qa, qb] = [await screen(idOf('AT-101-01')), await screen(idOf('AT-101-02'))]
  await page.keyboard.down('Shift')
  await page.mouse.move(Math.min(qa.x, qb.x) - 30, Math.min(qa.y, qb.y) - 30)
  await page.mouse.down()
  await page.mouse.move(Math.max(qa.x, qb.x) + 30, Math.max(qa.y, qb.y) + 30, { steps: 6 })
  await page.mouse.up()
  await page.keyboard.up('Shift')
  await expect(page.locator('.group-picked h3')).toHaveText(/설비 \d+대 고름/)
  await expect(page.locator('.group-picked')).toContainText('AT-101-01')
  await expect(page.locator('.group-picked')).toContainText('AT-101-02')
  expect(errors).toEqual([])
})

test('묶음 중 하나라도 막히면(좌표 없는 설비 · 외벽 전용 설비가 방 안으로) 아무것도 옮기지 않는다', async ({ page }) => {
  const errors = await open(page)
  // 좌표가 없는 TEMP-101-01 이 묶음에 있으면 같이 옮기지 않는다.
  await row(page, 'TEMP-101-01').getByRole('button', { name: 'TEMP-101-01', exact: true }).click()
  await row(page, 'AT-101-01').getByRole('button', { name: 'AT-101-01', exact: true }).click({ modifiers: ['Shift'] })
  await expect(page.locator('.group-picked h3')).toHaveText('설비 2대 고름')
  const a0 = await at(page, 'AT-101-01')
  await keys(page, 'Shift+ArrowRight')
  await expect(page.locator('.edit-notice').first()).toContainText('좌표가 없는 설비가 묶음에 있어')
  expect((await at(page, 'AT-101-01')).join()).toBe(a0.join())
  await keys(page, 'Escape')

  // AHU-1 을 외기 온도 센서로 바꾼다 — 외벽 바깥 면이 아니면 옮길 수 없다(OE-OBJ-04). 디퓨저와 같이 옮기려 해도 둘 다 그대로다.
  await row(page, 'AHU-1').getByRole('button', { name: 'AHU-1', exact: true }).click()
  await page.locator('.picked').first().locator('.kind-edit select').selectOption({ label: '외기 온도 센서' })
  await row(page, 'AT-101-01').getByRole('button', { name: 'AT-101-01', exact: true }).click({ modifiers: ['Shift'] })
  await expect(page.locator('.group-picked h3')).toHaveText('설비 2대 고름')
  const h0 = await at(page, 'AHU-1')
  await keys(page, 'Shift+ArrowRight')
  await expect(page.locator('.edit-notice').first()).toContainText('묶음을 옮기지 않았습니다')
  expect((await at(page, 'AHU-1')).join()).toBe(h0.join())
  expect((await at(page, 'AT-101-01')).join()).toBe(a0.join())
  expect(errors).toEqual([])
})

// 아래는 위 셋이 놓치던 것이다 — 그 줄을 빼도 위 셋은 통과했다(변이 시험, 2026-10-03).
const viewer = <T,>(page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(([f, a]) => ((window as any).__viewer[f as string] as (...x: unknown[]) => T)(...(a as unknown[])), [fn, args] as const)
const tab = (page: Page, name: '3D' | '평면도') => page.getByRole('group', { name: '보기' }).getByRole('button', { name }).click()
type Pt = { x: number; y: number }
/** 이름 → id. 평면도 점의 title 로 읽는다. */
async function idsByName(page: Page) {
  await tab(page, '평면도')
  const pairs = await page
    .locator('svg.floor-plan .devices circle')
    .evaluateAll((els) => els.map((e) => [e.querySelector('title')?.textContent ?? '', e.getAttribute('data-equipment')!]))
  await tab(page, '3D')
  await page.locator('.viewport canvas').scrollIntoViewIfNeeded()
  await page.waitForTimeout(300)
  return new Map(pairs as [string, string][])
}
const screenOf = async (page: Page, id: string) => (await viewer<Pt>(page, 'part', id))!
const floorAt = (page: Page, x: number, y: number) => viewer<Pt>(page, 'point', [x, y, 0])
const shiftClick = async (page: Page, p: Pt) => {
  await page.keyboard.down('Shift')
  await page.mouse.click(p.x, p.y)
  await page.keyboard.up('Shift')
}
const panelTitle = (page: Page) => page.locator('.picked h3').first()
const nameButton = (page: Page, n: string) => row(page, n).getByRole('button', { name: n, exact: true })
/** 공조기·덕트와 이어지지 않은 설비 하나를 사무실 구석에 더한다. 디퓨저를 고르면 이것이 흐려진다. */
async function addLone(page: Page) {
  await page.locator('.viewport canvas').scrollIntoViewIfNeeded()
  await page.getByRole('button', { name: '설비 더하기' }).click()
  const spot = await floorAt(page, 8.5, 6.5)
  await page.mouse.click(spot.x, spot.y)
  await expect(panelTitle(page)).toHaveText('새 설비 1')
}

test('흐리게 칠한 설비도 Shift+클릭으로 더하고, 묶음 중에는 흐리게 하지 않으며, Shift+빈 바닥은 묶음을 두고 그냥 빈 곳은 푼다', async ({ page }) => {
  const errors = await open(page)
  await addLone(page)
  await keys(page, 'Escape')
  const id = await idsByName(page)
  const [a, b, lone] = [id.get('AT-101-01')!, id.get('AT-101-02')!, id.get('새 설비 1')!]

  // 디퓨저를 고르면 새 설비는 흐려져 보통 누르기로는 안 골라진다(전제).
  const pa = await screenOf(page, a)
  await page.mouse.click(pa.x, pa.y)
  await expect(panelTitle(page)).toHaveText('AT-101-01')
  const q = await screenOf(page, lone)
  expect((await viewer<{ equipment: string | null }>(page, 'pickAt', q.x, q.y)).equipment).toBeNull()
  // Shift+클릭은 흐린 것도 잡는다.
  await shiftClick(page, q)
  await expect(page.locator('.group-picked h3')).toHaveText('설비 2대 고름')
  // 묶음 중에는 나머지를 흐리게 하지 않는다 — 묶음 밖의 디퓨저가 보통 누르기로 잡힌다.
  const pb = await screenOf(page, b)
  expect((await viewer<{ equipment: string | null }>(page, 'pickAt', pb.x, pb.y)).equipment).toBe(b)

  // Shift 를 누른 채 방 바닥(빈 곳)을 누르면 묶음을 그대로 둔다.
  await shiftClick(page, await floorAt(page, 5, 1.5))
  await expect(page.locator('.group-picked h3')).toHaveText('설비 2대 고름')
  // 아무것도 없는 곳(캔버스 귀퉁이 — 하늘)을 그냥 누르면 푼다.
  const canvas = (await page.locator('.viewport canvas').boundingBox())!
  const out = { x: canvas.x + 8, y: canvas.y + 8 }
  expect(await viewer<{ equipment: string | null; space: string | null }>(page, 'pickAt', out.x, out.y)).toMatchObject({ equipment: null, space: null })
  await page.mouse.click(out.x, out.y)
  await expect(page.locator('.group-picked')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('다른 설비를 그냥 고르거나 편집을 끝내면 묶음이 풀리고, 되돌리기로 묶음의 설비가 없어지면 남은 하나를 고른다', async ({ page }) => {
  const errors = await open(page)
  // 그냥 누르면 그것 하나만.
  await nameButton(page, 'AT-101-01').click()
  await nameButton(page, 'AT-101-02').click({ modifiers: ['Shift'] })
  await expect(page.locator('.group-picked h3')).toHaveText('설비 2대 고름')
  await nameButton(page, 'AHU-1').click()
  await expect(page.locator('.group-picked')).toHaveCount(0)
  await expect(panelTitle(page)).toHaveText('AHU-1')
  await expect(page.locator('.equipment tbody tr.chosen')).toHaveCount(1)

  // 편집을 끝내면 푼다 — 다시 들어와도 묶음이 없다.
  await nameButton(page, 'AT-101-01').click()
  await nameButton(page, 'AT-101-02').click({ modifiers: ['Shift'] })
  await expect(page.locator('.group-picked h3')).toHaveText('설비 2대 고름')
  await page.getByRole('button', { name: '편집 종료' }).click()
  await expect(page.locator('.group-picked')).toHaveCount(0)
  await page.getByRole('button', { name: '편집', exact: true }).click()
  await expect(page.locator('.group-picked')).toHaveCount(0)

  // 더한 설비와 디퓨저를 묶은 뒤 더하기를 되돌리면, 묶음에서 빠지고 디퓨저 하나가 골라진 채다.
  await addLone(page)
  await nameButton(page, 'AT-101-01').click({ modifiers: ['Shift'] })
  await expect(page.locator('.group-picked h3')).toHaveText('설비 2대 고름')
  await keys(page, 'Control+z')
  await expect(row(page, '새 설비 1')).toHaveCount(0)
  await expect(page.locator('.group-picked')).toHaveCount(0)
  await expect(panelTitle(page)).toHaveText('AT-101-01')
  expect(errors).toEqual([])
})

test('묶음끼리는 서로의 옛 자리와 견주지 않는다 — 하나가 다른 하나의 옛 자리로 가도 같이 옮긴다', async ({ page }) => {
  // 겹침 금지(OE-OBJ-16)는 배관 없는 설비끼리다. 디퓨저는 덕트에 붙어 걸리지 않아서, 조명 둘을 더해 잰다.
  const errors = await open(page)
  await page.locator('.viewport canvas').scrollIntoViewIfNeeded()
  for (const [n, x] of [['새 설비 1', 2], ['새 설비 2', 5]] as const) {
    await page.getByRole('button', { name: '설비 더하기' }).click()
    const spot = await floorAt(page, x, 6.5)
    await page.mouse.click(spot.x, spot.y)
    await expect(panelTitle(page)).toHaveText(n)
    await page.locator('.picked').first().locator('.kind-edit select').selectOption({ label: '조명' })
  }
  const [A, B] = ['새 설비 1', '새 설비 2']
  const pick2 = async () => {
    await nameButton(page, A).click()
    await nameButton(page, B).click({ modifiers: ['Shift'] })
    await expect(page.locator('.group-picked h3')).toHaveText('설비 2대 고름')
  }
  // 방향키 한 번이 어느 쪽으로 가는지(카메라에 따라 다르다) 먼저 잰다.
  await pick2()
  const a0 = await at(page, A)
  await keys(page, 'Shift+ArrowRight')
  await expect.poll(async () => (await at(page, A)).join()).not.toBe(a0.join())
  const a1 = await at(page, A)
  const d = [a1[0] - a0[0], a1[1] - a0[1]]
  await keys(page, 'Control+z', 'Escape')
  await expect.poll(async () => (await at(page, A)).join()).toBe(a0.join())

  // B 를 A 가 한 걸음 가서 닿을 자리에 둔다. A 혼자 옮기면 거기서 막힌다(대조군).
  const next = [a0[0] + d[0], a0[1] + d[1]]
  const b = row(page, B).locator('.coord')
  for (const i of [0, 1]) {
    await b.nth(i).fill(String(next[i]))
    await b.nth(i).press('Enter')
  }
  await expect.poll(async () => (await at(page, B)).join()).toBe(next.join())
  await nameButton(page, A).click()
  await keys(page, 'Shift+ArrowRight')
  await expect(page.locator('.edit-notice').first()).toContainText('이미 오브젝트가 있는 위치입니다')
  expect((await at(page, A)).join()).toBe(a0.join())
  // 같이 옮기면 B 도 한 걸음 비키니 막지 않는다.
  await pick2()
  await keys(page, 'Shift+ArrowRight')
  await expect.poll(async () => (await at(page, A)).join()).toBe(next.join())
  expect((await at(page, B)).join()).toBe([next[0] + d[0], next[1] + d[1]].join())
  expect(errors).toEqual([])
})

const DUPLEX_MEP = 'data/NBU_Duplex/NBU_Duplex-Apt_Eng-MEP.ifc'
test('Duplex MEP: 한 층만 볼 때 3D 의 Shift+끌기 상자는 숨긴 층 설비를 넣지 않는다', async ({ page }) => {
  test.skip(!existsSync(DUPLEX_MEP), `${DUPLEX_MEP} 이 없다(npm run fetch:sample)`)
  test.setTimeout(120_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(DUPLEX_MEP)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 90_000 })
  await page.getByRole('button', { name: '편집', exact: true }).click()
  const storeyBox = page.getByRole('combobox', { name: '보일 층' })
  await storeyBox.selectOption({ label: 'Level 1만' })
  const canvas = page.locator('.viewport canvas')
  await canvas.scrollIntoViewIfNeeded()
  await page.waitForTimeout(300)
  // 캔버스 전체를 상자로 — 위층(Level 2)은 화면에서 같은 자리에 겹쳐 있지만 숨겨져 있다.
  const box = (await canvas.boundingBox())!
  const bottom = Math.min(box.y + box.height, page.viewportSize()!.height) - 4
  await page.keyboard.down('Shift')
  await page.mouse.move(box.x + 4, Math.max(box.y, 0) + 4)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width - 4, bottom, { steps: 8 })
  await page.mouse.up()
  await page.keyboard.up('Shift')
  await expect(page.locator('.group-picked h3')).toHaveText(/설비 \d+대 고름/)
  await expect(page.locator('.group-picked .stats')).toHaveText('Level 1')
  expect(errors).toEqual([])
})

test('보기 모드에서는 목록·평면도의 Shift+클릭과 평면도의 Shift+끌기로 여러 개를 고르지 않는다', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(MEP)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  await nameButton(page, 'AT-101-01').click()
  await nameButton(page, 'AT-101-02').click({ modifiers: ['Shift'] })
  await expect(page.locator('.group-picked')).toHaveCount(0)
  await expect(panelTitle(page)).toHaveText('AT-101-02')

  await tab(page, '평면도')
  const plan = page.locator('svg.floor-plan')
  const box = (await plan.boundingBox())!
  await page.keyboard.down('Shift')
  await page.mouse.move(box.x + 5, box.y + 5)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width - 5, box.y + box.height - 5, { steps: 6 })
  await expect(plan.locator('rect.box-select')).toHaveCount(0)
  await page.mouse.up()
  await page.keyboard.up('Shift')
  await expect(page.locator('.group-picked')).toHaveCount(0)
  expect(errors).toEqual([])
})
