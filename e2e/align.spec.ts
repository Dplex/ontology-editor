import { expect, test, type Page } from '@playwright/test'
import { toEquipment, toSpace } from './edit-part'

// 스냅(OE-UI-06)과 그리드 정렬(OE-UI-07)을 실제 마우스로 본다. mep.ifc 1F 사무실(0~10 × 0~8), 벽은 없다.
// 계산(우선순위·반경)은 snap.test.ts 가 본다. 여기서는 그리기에서 찍은 점, 마우스 아래 표시, 끄기의 보정을 본다.
const MEP = 'src/lib/ifc/fixtures/mep.ifc'
const AHU = '0MEP$Equip$AHU1$0000'

type Pt = { x: number; y: number }
type Snap = { at: [number, number]; kind: 'vertex' | 'edge' | 'grid' } | null

const viewer = <T,>(page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(([f, a]) => (window as any).__viewer[f as string](...(a as unknown[])), [fn, args] as const) as Promise<T>
const settle = (page: Page) =>
  page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))))
const floor = async (page: Page, x: number, y: number) => (await viewer<Pt>(page, 'point', [x, y, 0]))!

async function open(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  // 설정은 이 브라우저에 남는다. 시험마다 꺼진 채로 시작한다.
  await page.addInitScript(() => {
    localStorage.removeItem('oe.grid')
    localStorage.removeItem('oe.snap')
  })
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(MEP)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '편집', exact: true }).click()
  await page.locator('.canvas-wrap > canvas').scrollIntoViewIfNeeded()
  return errors
}

async function hover(page: Page, x: number, y: number) {
  const at = await floor(page, x, y)
  await page.mouse.move(at.x, at.y)
  await settle(page)
}

test('스냅을 켜면 사무실 변·꼭짓점 가까이 찍은 점이 거기 붙고 붙을 자리가 3D 에 보인다. 그리드와 같이 켜면 변이 앞선다. 끄면 찍은 자리다 [OE-UI-06#1,2,3]', async ({ page }) => {
  const errors = await open(page)
  await toSpace(page)
  if (process.env.SHOT) {
    // 스샷은 사무실에 시점을 맞춰 찍는다(F). 시험의 화면 좌표는 늘 __viewer 로 다시 재므로 시점과 상관없다.
    const office = await floor(page, 9.6, 7.6)
    await page.mouse.click(office.x, office.y)
    await page.keyboard.press('f')
    await page.waitForTimeout(800)
  }
  await page.getByRole('button', { name: '물리존 그리기' }).click()
  const bar = page.locator('.draw-bar')

  // 꺼져 있으면 아무 표시도 없고 찍은 자리 그대로다.
  await hover(page, 6.13, 0.2)
  expect(await viewer<Snap>(page, 'snap')).toBeNull()

  await bar.getByLabel('그리드 간격(m)').fill('1')
  await bar.getByLabel('그리드 간격(m)').press('Tab')
  await bar.getByLabel('그리드 정렬').check()
  await bar.getByLabel('스냅 반경(m)').fill('0.3')
  await bar.getByLabel('스냅 반경(m)').press('Tab')
  await bar.getByLabel('스냅', { exact: true }).check()

  // (6.13, 0.2): 그리드 교점 (6, 0) 도 가깝지만 사무실 아래 변 (6.13, 0) 에 붙는다.
  await hover(page, 6.13, 0.2)
  await expect.poll(() => viewer<Snap>(page, 'snap')).toEqual({ at: [6.13, 0], kind: 'edge' })
  if (process.env.SHOT) {
    // 사무실 둘레만 잘라 찍는다.
    const corners = await Promise.all([[-2, -2], [12, -2], [12, 10], [-2, 10]].map(([x, y]) => floor(page, x, y)))
    const xs = corners.map((c) => c.x)
    const ys = corners.map((c) => c.y)
    await page.screenshot({ path: process.env.SHOT, clip: { x: Math.min(...xs), y: Math.min(...ys), width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) } })
  }
  // 모서리 가까이면 꼭짓점.
  await hover(page, 9.85, 0.15)
  await expect.poll(() => viewer<Snap>(page, 'snap')).toEqual({ at: [10, 0], kind: 'vertex' })
  // 변이 멀면 그리드 교점.
  await hover(page, 6.1, 4.2)
  await expect.poll(() => viewer<Snap>(page, 'snap')).toEqual({ at: [6, 4], kind: 'grid' })

  // 찍으면 그 자리로 간다: (6.13,0) (10,0) (10,4.1) (6,4) → 넓이 15.94㎡.
  for (const [x, y] of [[6.13, 0.2], [9.85, 0.15], [9.8, 4.1], [6.1, 4.2]]) {
    const at = await floor(page, x, y)
    await page.mouse.click(at.x, at.y)
  }
  await expect(bar).toContainText('4개')
  await page.keyboard.press('Enter')
  await expect(page.locator('.space-picked')).toContainText('15.9')
  // 그리기가 끝나면 표시가 사라진다.
  expect(await viewer<Snap>(page, 'snap')).toBeNull()

  // 둘 다 끄고 다시 그리면 찍은 자리 그대로다(아무것도 붙지 않는다).
  await page.getByRole('button', { name: '물리존 그리기' }).click()
  await bar.getByLabel('스냅', { exact: true }).uncheck()
  await bar.getByLabel('그리드 정렬').uncheck()
  await hover(page, 6.13, 0.2)
  expect(await viewer<Snap>(page, 'snap')).toBeNull()
  await page.keyboard.press('Escape')
  expect(errors).toEqual([])
})

const row = (page: Page, name: string) => page.locator('.equipment tbody tr', { hasText: name }).last()
const coord = (page: Page, name: string, axis: number) => row(page, name).locator('.coord').nth(axis)

test('그리드를 켜기만 해서는 어긋난 설비가 그대로이고, 끌어 옮기면 그때부터 배치점이 교점으로 간다 [OE-UI-07#2,3]', async ({ page }) => {
  const errors = await open(page)
  await toEquipment(page)
  await row(page, 'AHU-1').getByRole('button', { name: 'AHU-1', exact: true }).click()
  await settle(page)
  // 그리드에 어긋난 자리로 옮겨 둔다(좌표 칸).
  for (const [axis, v] of [[0, '4.37'], [1, '2.61']] as const) {
    await coord(page, 'AHU-1', axis).fill(v)
    await coord(page, 'AHU-1', axis).press('Enter')
  }
  await expect(coord(page, 'AHU-1', 0)).toHaveValue('4.37')

  // 편집 막대에서 그리드를 켠다(1m). 놓인 설비는 그대로다.
  const bar = page.locator('.edit-bar')
  await bar.getByLabel('그리드 간격(m)').fill('1')
  await bar.getByLabel('그리드 간격(m)').press('Tab')
  await bar.getByLabel('그리드 정렬').check()
  await settle(page)
  await expect(coord(page, 'AHU-1', 0)).toHaveValue('4.37')
  await expect(coord(page, 'AHU-1', 1)).toHaveValue('2.61')
  await expect(page.locator('.edit-bar')).toContainText('바뀐 것 1건')

  // 좌표 칸에 넣느라 페이지가 내려가 있다. 캔버스를 화면 안으로 올린 뒤 화면 좌표를 잰다.
  await page.locator('.canvas-wrap > canvas').scrollIntoViewIfNeeded()
  await settle(page)
  // 끌면 배치점이 교점에 맞는다. 끌기는 형상 중심 높이의 수평면 위다 — 그 높이에서 x 로 -2.2m, y 로 +1.1m 자리로 끈다.
  const center = (await viewer<number[]>(page, 'center', AHU))!
  const from = (await viewer<Pt>(page, 'part', AHU))!
  const to = (await viewer<Pt>(page, 'point', [center[0] - 2.2, center[1] + 1.1, center[2]]))!
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 12 })
  await page.mouse.up()
  await settle(page)
  await expect.poll(async () => Number(await coord(page, 'AHU-1', 0).inputValue())).toBe(2)
  await expect.poll(async () => Number(await coord(page, 'AHU-1', 1).inputValue())).toBe(4)
  expect(errors).toEqual([])
})

test('그리드·스냅을 켜고 물리존 꼭짓점을 끌면 놓는 자리가 교점으로 간다', async ({ page }) => {
  const errors = await open(page)
  await toSpace(page)
  const bar = page.locator('.edit-bar')
  await bar.getByLabel('그리드 간격(m)').fill('1')
  await bar.getByLabel('그리드 간격(m)').press('Tab')
  await bar.getByLabel('그리드 정렬').check()
  await bar.getByLabel('스냅', { exact: true }).check()
  // 사무실을 고르고 (10,8) 꼭짓점을 (12.2, 8.3) 쪽으로 끈다. 제 변은 대상이 아니라 그리드 (12, 8) 로 간다.
  const empty = await floor(page, 9.6, 7.6)
  await page.mouse.click(empty.x, empty.y)
  const panel = page.locator('.space-picked')
  await expect(panel).toContainText('80.0')
  const a = (await viewer<Pt>(page, 'point', [10, 8, 0.12]))!
  const b = (await viewer<Pt>(page, 'point', [12.2, 8.3, 0.12]))!
  await page.mouse.move(a.x, a.y)
  await page.mouse.down()
  await page.mouse.move(b.x, b.y, { steps: 12 })
  await page.mouse.up()
  await settle(page)
  // (0,0) (10,0) (12,8) (0,8): 넓이 88㎡.
  await expect(panel).toContainText('88.0')
  expect(errors).toEqual([])
})
