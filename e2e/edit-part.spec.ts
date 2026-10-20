import { expect, test, type Page } from '@playwright/test'
import { toEquipment, toSpace, enterEdit, pickEquipment } from './edit-part'

// 편집 대상 [공간 | 설비](OE-UI-04). 팔레트가 그 모드의 도구만 보이고, 다른 모드의 오브젝트는 고르고 볼 수 있지만 끌거나 방향키로 옮기면
// 막고 어느 모드에서 고치는지 알린다. mep.ifc 는 한 층에 사무실(0~10 · 0~8)과 공조기 AHU-1 이 있다. storey-height.ifc 는 두 층이다.
const MEP = 'src/lib/ifc/fixtures/mep.ifc'
const TWO = 'src/lib/ifc/fixtures/storey-height.ifc'
const AHU = '0MEP$Equip$AHU1$0000'
type Pt = { x: number; y: number }

async function open(page: Page, file = MEP) {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(file)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  await enterEdit(page)
  await page.locator('.canvas-wrap > canvas').scrollIntoViewIfNeeded()
  await page.waitForTimeout(300)
  return errors
}
const settle = (page: Page) => page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))))
const viewer = <T>(page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(([f, a]) => (window as any).__viewer[f as string](...(a as unknown[])), [fn, args] as const) as Promise<T>
async function drag(page: Page, from: Pt, to: Pt) {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 12 })
  await page.mouse.up()
  await settle(page)
}

test('모드를 바꾸면 팔레트 도구가 바뀌고, 초기 구축의 편집 막대에는 [임시 저장]·[미리보기]·[구축하기]·[편집 종료] 가 있다 [OE-UI-04#2,3]', async ({ page }) => {
  const errors = await open(page)
  const bar = page.locator('.edit-bar')
  for (const name of ['임시 저장', '미리보기', '구축하기', '편집 종료']) await expect(bar.getByRole('button', { name, exact: true })).toBeVisible()
  await expect(bar.getByRole('button', { name: '반영하기', exact: true })).toHaveCount(0)
  // 처음은 설비 편집 모드다.
  const palette = page.getByRole('navigation', { name: '편집 도구' })
  await expect(palette.getByRole('button', { name: '설비 더하기' })).toBeVisible()
  await expect(palette.getByRole('button', { name: '물리존 그리기' })).toHaveCount(0)
  await toSpace(page)
  await expect(palette.getByRole('button', { name: '물리존 그리기' })).toBeVisible()
  await expect(palette.getByRole('button', { name: '벽·문·창' })).toBeVisible()
  await expect(palette.getByRole('button', { name: '설비 더하기' })).toHaveCount(0)
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT })
  // M 으로 돌아간다.
  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('m')
  await expect(palette.getByRole('button', { name: '설비 더하기' })).toBeVisible()
  expect(errors).toEqual([])
})

test('공간 편집 모드에서 설비를 끌면 움직이지 않고 안내가 뜨며, 설비 편집 모드에서 물리존 꼭짓점을 끌어도 같다 [OE-UI-04#4]', async ({ page }) => {
  const errors = await open(page)
  const bar = page.getByTestId('changes-link')
  await toSpace(page)
  // 설비는 고르고 볼 수 있지만 끌면 제자리다.
  await pickEquipment(page, 'AHU-1')
  await page.waitForTimeout(200)
  await expect(page.locator('.picked h3')).toHaveText('AHU-1')
  const center = (await viewer<number[]>(page, 'center', AHU))!
  const from = (await viewer<Pt>(page, 'part', AHU))!
  await drag(page, from, (await viewer<Pt>(page, 'point', [center[0] - 4, center[1], center[2]]))!)
  await expect(page.locator('.edit-notice').first()).toContainText('설비는 설비 편집 모드에서 편집합니다')
  expect(await viewer<number[]>(page, 'center', AHU)).toEqual(center)
  await expect(bar).toContainText('바뀐 것 0건')

  // 설비 편집 모드에서 사무실 꼭짓점 (10,0) 을 끌어도 넓이가 그대로다.
  await toEquipment(page)
  const floor = (await viewer<Pt>(page, 'point', [9.6, 7.6, 0.1]))!
  await page.mouse.click(floor.x, floor.y)
  const panel = page.locator('.space-picked')
  await expect(panel).toContainText('80.0')
  await drag(page, (await viewer<Pt>(page, 'point', [10, 0, 0.12]))!, (await viewer<Pt>(page, 'point', [4, 4, 0.12]))!)
  await expect(page.locator('.edit-notice').first()).toContainText('물리존·룸·벽은 공간 편집 모드에서 편집합니다')
  await expect(panel).toContainText('80.0')
  await expect(bar).toContainText('바뀐 것 0건')
  expect(errors).toEqual([])
})

test('설비 편집 모드에서 [라이저] 를 누르면 다중층 뷰가 열린다 [OE-UI-04#7]', async ({ page }) => {
  const errors = await open(page, TWO)
  await page.getByRole('navigation', { name: '편집 도구' }).getByRole('button', { name: '라이저' }).click()
  // 다중층 뷰가 열리면 오른쪽 위 [다중층 ▾] 칩이 범위 이름으로 바뀌고 켜진다.
  await expect(page.locator('.shell-range .multi-open')).toHaveClass(/\bon\b/)
  expect(errors).toEqual([])
})
