import { existsSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { toEquipment, toSpace } from './edit-part'

// 3D 편집 화면의 겉모습(ArtCraft 에서 가져온 넷, reference.md). 고른 것의 외곽선(selection-outline.ts) · 바닥 아래 격자(ground-grid.ts) ·
// 벽·가구의 모서리 선(model-edges.ts) · 놓을 때 떨어져 앉기(drop-in.ts). 움직임을 끈 기본 설정에서는 외곽선이 빛 퍼짐 없이 바로 서고
// 떨어지기도 없다. 움직임을 켜면 고를 때 빛이 한 번 퍼지고, 새로 놓은 설비·오브젝트가 떨어져 앉은 뒤 놓은 자리·크기 그대로다.
const MEP = 'src/lib/ifc/fixtures/mep.ifc'
const ROOMS = 'src/lib/ifc/fixtures/two-rooms.ifc'
const AHU = '0MEP$Equip$AHU1$0000'
const DUPLEX_ARCH = 'data/NBU_Duplex/NBU_Duplex-Apt_Arch.ifc'

type Outline = { objects: number; flashing: boolean; flashes: number; key: string }
type Motion = { dropping: number; started: { drops: number } }
const viewer = <T,>(page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(([f, a]) => (window as any).__viewer[f as string](...(a as unknown[])), [fn, args] as const) as Promise<T>
const ids = (page: Page) => viewer<Record<string, number[]>>(page, 'centers').then((c) => Object.keys(c))
async function open(page: Page, files: string | string[]) {
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(files)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  await page.locator('.canvas-wrap > canvas').scrollIntoViewIfNeeded()
}
async function clickFloor(page: Page, x: number, y: number) {
  const at = await viewer<{ x: number; y: number }>(page, 'point', [x, y, 0])
  await page.mouse.click(at.x, at.y)
}
/** 새로 놓은 설비 하나를 [설비 더하기] 로 사무실 바닥에 놓고 그 id 를 돌려준다. */
async function addEquipment(page: Page): Promise<string> {
  await page.getByRole('button', { name: '편집', exact: true }).click()
  await toEquipment(page)
  const before = new Set(await ids(page))
  await page.locator('.tool-palette').getByRole('button', { name: '설비 더하기' }).click()
  await clickFloor(page, 5, 4)
  await expect.poll(async () => (await ids(page)).filter((id) => !before.has(id)).length).toBe(1)
  return (await ids(page)).find((id) => !before.has(id))!
}

test('고른 설비에 외곽선이 서고, 바닥 밑에 격자가 깔린다. 움직임을 끄면 빛 퍼짐·떨어지기가 없다', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await open(page, [MEP, ROOMS])
  expect((await viewer<{ visible: boolean }>(page, 'ground')).visible).toBe(true)
  expect((await viewer<Outline>(page, 'outline')).objects).toBe(0)

  await page.locator('.equipment tbody tr', { hasText: 'AHU-1' }).last().getByRole('button', { name: 'AHU-1', exact: true }).click()
  await expect.poll(() => viewer<Outline>(page, 'outline')).toMatchObject({ objects: 1, key: `equipment:${AHU}`, flashes: 0 })

  // 빈 곳을 누르면 풀린다.
  await page.keyboard.press('Escape')
  await expect.poll(async () => (await viewer<Outline>(page, 'outline')).objects).toBe(0)

  const id = await addEquipment(page)
  expect((await viewer<Motion>(page, 'motion')).started.drops).toBe(0)
  await expect.poll(() => viewer<Outline>(page, 'outline')).toMatchObject({ objects: 1, key: `equipment:${id}` })
  expect(errors).toEqual([])
})

test('Duplex 건축: 보기 모드의 IFC 벽에 층마다 모서리 선이 붙는다', async ({ page }) => {
  test.skip(!existsSync(DUPLEX_ARCH), `${DUPLEX_ARCH} 이 없다(npm run fetch:sample)`)
  test.setTimeout(120_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(DUPLEX_ARCH)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 90_000 })
  const walls = await viewer<{ triangles: number; meshes: number; edged: number } | null>(page, 'walls')
  expect(walls?.triangles).toBeGreaterThan(0)
  expect(walls?.edged).toBe(walls?.meshes)
  expect(errors).toEqual([])
})

test.describe('움직임을 켜면', () => {
  test.use({ contextOptions: { reducedMotion: 'no-preference' } })

  test('고를 때 빛이 한 번 퍼지고, 새로 놓은 설비는 떨어져 앉은 뒤 놓은 자리·크기 그대로다', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await open(page, [MEP, ROOMS])
    await page.locator('.equipment tbody tr', { hasText: 'AHU-1' }).last().getByRole('button', { name: 'AHU-1', exact: true }).click()
    await expect.poll(async () => (await viewer<Outline>(page, 'outline')).flashes).toBe(1)
    await expect.poll(async () => (await viewer<Outline>(page, 'outline')).flashing).toBe(false)

    const id = await addEquipment(page)
    expect((await viewer<Motion>(page, 'motion')).started.drops).toBe(1)
    await expect.poll(async () => (await viewer<Motion>(page, 'motion')).dropping).toBe(0)
    // 형상 없는 설비의 표시 상자(0.4m)가 바닥(층 바닥 + 0.2m 가운데)에 그대로 선다.
    expect(await viewer<number[]>(page, 'size', id)).toEqual([0.4, 0.4, 0.4])
    const c = await viewer<number[]>(page, 'center', id)
    expect(c[0]).toBeCloseTo(5, 1)
    expect(c[1]).toBeCloseTo(4, 1)
    // 되돌리고 다시 하면 다시 떨어진다(되살아난 것도 새로 생긴 것이다).
    await page.keyboard.press('Control+z')
    await expect.poll(async () => (await ids(page)).includes(id)).toBe(false)
    await page.keyboard.press('Control+Shift+z')
    await expect.poll(async () => (await viewer<Motion>(page, 'motion')).started.drops).toBe(2)
    await expect.poll(async () => (await viewer<Motion>(page, 'motion')).dropping).toBe(0)
    expect(errors).toEqual([])
  })

  test('추가 공간 오브젝트도 떨어져 앉고, 고른 오브젝트에 외곽선이 선다. 파일을 열 때 있던 것은 떨어지지 않는다', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await open(page, ROOMS)
    expect((await viewer<Motion>(page, 'motion')).started.drops).toBe(0)
    await page.getByRole('button', { name: '편집', exact: true }).click()
    await toSpace(page)
    await page.getByRole('combobox', { name: '보일 층' }).selectOption({ label: '1F만' })
    await page.getByRole('button', { name: /^오브젝트/ }).click()
    await page.locator('.object-library').getByRole('button', { name: '책상', exact: true }).click()
    await clickFloor(page, 3, 2)
    await expect(page.locator('.object-picked h3')).toHaveText('책상 1')
    expect((await viewer<Motion>(page, 'motion')).started.drops).toBe(1)
    await expect.poll(async () => (await viewer<Motion>(page, 'motion')).dropping).toBe(0)
    const [desk] = await viewer<string[]>(page, 'objects')
    await expect.poll(() => viewer<Outline>(page, 'outline')).toMatchObject({ objects: 1, key: `object:${desk}` })
    // 가구 조각마다 모서리 선이 붙는다.
    expect(await viewer<number>(page, 'edges')).toBeGreaterThan(1)
    expect(errors).toEqual([])
  })
})

// 미리 강조(OE-UI-27 AC3). 커서 아래에서 누르면 골라질 설비·오브젝트에 옅은 외곽선이 서고, 커서가 떠나면 걷힌다. 평면도는 같은 뜻으로
// 설비 점에 옅은 강조색 고리가 선다.
test('커서를 올리면 클릭 전에 골라질 설비가 옅은 외곽선으로, 평면도 설비 점이 옅은 고리로 미리 강조된다 [OE-UI-27#3]', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await open(page, [MEP, ROOMS])
  const at = await viewer<{ x: number; y: number }>(page, 'part', AHU)
  await page.mouse.move(at.x, at.y)
  await expect.poll(() => viewer<Outline>(page, 'hoverOutline')).toMatchObject({ objects: 1, key: `equipment:${AHU}`, flashes: 0 })
  // 고른 것의 외곽선과 따로다 — 아직 아무것도 고르지 않았다.
  expect((await viewer<Outline>(page, 'outline')).objects).toBe(0)
  const box = (await page.locator('.canvas-wrap > canvas').boundingBox())!
  await page.mouse.move(box.x + 8, box.y + box.height - 8)
  await expect.poll(async () => (await viewer<Outline>(page, 'hoverOutline')).objects).toBe(0)

  // 평면도: 설비 점 위에 커서를 올리면 옅은 고리가 선다.
  await page.getByRole('button', { name: '평면도', exact: true }).click()
  const dot = page.locator('.floor-plan .devices circle:not(.chosen)').first()
  await dot.hover()
  await expect.poll(() => dot.evaluate((el) => getComputedStyle(el).strokeOpacity)).toBe('0.45')
  expect(errors).toEqual([])
})

test('커서를 올리면 클릭 전에 골라질 추가 공간 오브젝트가 옅은 외곽선으로 미리 강조된다 [OE-UI-27#3]', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await open(page, ROOMS)
  await page.getByRole('button', { name: '편집', exact: true }).click()
  await toSpace(page)
  await page.getByRole('combobox', { name: '보일 층' }).selectOption({ label: '1F만' })
  await page.getByRole('button', { name: /^오브젝트/ }).click()
  await page.locator('.object-library').getByRole('button', { name: '책상', exact: true }).click()
  await clickFloor(page, 3, 2)
  await expect(page.locator('.object-picked h3')).toHaveText('책상 1')
  const [desk] = await viewer<string[]>(page, 'objects')
  const box = (await page.locator('.canvas-wrap > canvas').boundingBox())!
  await page.mouse.move(box.x + 8, box.y + box.height - 8)
  await expect.poll(async () => (await viewer<Outline>(page, 'hoverOutline')).objects).toBe(0)
  const o = await viewer<{ x: number; y: number }>(page, 'object', desk)
  await page.mouse.move(o.x, o.y)
  await expect.poll(() => viewer<Outline>(page, 'hoverOutline')).toMatchObject({ objects: 1, key: `object:${desk}` })
  await expect.poll(() => viewer<string>(page, 'hoverMark')).toBe(`object:${desk}`)
  expect(errors).toEqual([])
})
