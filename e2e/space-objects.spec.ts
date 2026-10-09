import { expect, test, type Page } from '@playwright/test'

// 추가 공간 오브젝트(OE-OBJ-09 · OE-SPC-14 · OE-SPC-15 · OE-SPC-16 · OE-P3-08). 팔레트의 라이브러리에서 항목을 골라 바닥을 누르면
// 놓이고, 다른 오브젝트와 겹치는 놓기·끌기·키우기는 막혀 상대가 붉게 짚이며 오브젝트는 원래 자리에 남는다. 넣은 glb 는 라이브러리
// 항목이 되어 같은 방법으로 놓인다. two-rooms.ifc 의 1F 회의실은 (2..6, 1..4) 다.
const FIXTURE = 'src/lib/ifc/fixtures/two-rooms.ifc'
/** 0.8(가로) × 0.6(세로) × 1.1(높이) m 상자 하나인 glb. */
const MODEL = 'e2e/fixtures/lounge-chair.glb'

const point = (page: Page, x: number, y: number, z = 0) => page.evaluate(([px, py, pz]) => (window as any).__viewer.point([px, py, pz]), [x, y, z]) as Promise<{ x: number; y: number }>
async function clickAt(page: Page, x: number, y: number, z = 0) {
  const at = await point(page, x, y, z)
  await page.mouse.click(at.x, at.y)
}
const objects = (page: Page) => page.evaluate(() => (window as any).__viewer.objects()) as Promise<string[]>
const objectAt = (page: Page, id: string) => page.evaluate((x) => (window as any).__viewer.object(x), id) as Promise<{ x: number; y: number }>
async function place(page: Page, name: string, x: number, y: number) {
  await page.locator('.object-library').getByRole('button', { name, exact: true }).click()
  await clickAt(page, x, y)
}

test('라이브러리에서 골라 놓고, 겹치는 놓기·끌기·키우기는 막으며, 넣은 glb 도 놓이고 지우면 Ctrl+Z 로 돌아온다 [OE-OBJ-09#1,2]', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(FIXTURE)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '편집', exact: true }).click()
  await page.getByRole('combobox', { name: '보일 층' }).selectOption({ label: '1F만' })
  await page.locator('.viewport canvas').scrollIntoViewIfNeeded()
  await page.waitForTimeout(400)

  // 라이브러리(OE-SPC-16): 내장 항목 9개
  await page.getByRole('button', { name: /^오브젝트/ }).click()
  await expect(page.locator('.object-library .ghost:not(.object-import)')).toHaveCount(9)

  // 책상을 (3, 2)에 놓는다
  await place(page, '책상', 3, 2)
  const panel = page.locator('.object-picked')
  await expect(panel.locator('h3')).toHaveText('책상 1')
  await expect(panel).toContainText('3.00, 2.00')
  await expect(page.locator('.edit-bar')).toContainText('바뀐 것 1건')

  // 책상과 겹치는 자리에는 의자를 놓지 못한다(OE-SPC-15)
  await place(page, '의자', 3.2, 2.1)
  await expect(page.locator('.edit-notice').first()).toContainText('이미 오브젝트가 있는 위치입니다')
  expect(await objects(page)).toHaveLength(1)

  // 비켜 놓으면 놓인다
  await place(page, '의자', 3, 3)
  await expect(panel.locator('h3')).toHaveText('의자 1')
  const [deskId, chairId] = await objects(page)

  // 의자를 책상 위로 끌면 막히고 의자는 원래 자리에 남는다
  const from = await objectAt(page, chairId)
  const onto = await point(page, 3, 2.1, 0.9)
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(onto.x, onto.y, { steps: 8 })
  await page.mouse.up()
  await expect(page.locator('.edit-notice').first()).toContainText('이미 오브젝트가 있는 위치입니다')
  await expect(panel).toContainText('3.00, 3.00')

  // 비켜 끌면 옮겨진다
  const back = await objectAt(page, chairId)
  const free = await point(page, 4.5, 3, 0.9)
  await page.mouse.move(back.x, back.y)
  await page.mouse.down()
  await page.mouse.move(free.x, free.y, { steps: 8 })
  await page.mouse.up()
  await expect(page.locator('.edit-bar')).toContainText('의자 1 옮김')
  await expect(panel).toContainText('4.50, 3.00')

  // 책상을 골라 가로를 키운다. 의자까지 닿게 키우면 막힌다
  const desk = await objectAt(page, deskId)
  await page.mouse.click(desk.x, desk.y)
  await expect(panel.locator('h3')).toHaveText('책상 1')
  await panel.getByTestId('object-size-0').fill('1.6')
  await panel.getByTestId('object-size-0').press('Enter')
  await expect(page.locator('.edit-bar')).toContainText('책상 1 크기')
  await expect(page.locator('.edit-bar')).toContainText('바뀐 것 2건')
  // 세로 2m 는 의자(4.5, 3)에 안 닿는다. 그다음 가로 3.5m 는 의자에 닿아 막힌다.
  await panel.getByTestId('object-size-1').fill('2')
  await panel.getByTestId('object-size-1').press('Enter')
  await expect(panel.getByTestId('object-size-1')).toHaveValue('2')
  await panel.getByTestId('object-size-0').fill('3.5')
  await panel.getByTestId('object-size-0').press('Enter')
  await expect(page.locator('.edit-notice').first()).toContainText('이미 오브젝트가 있는 위치입니다')
  await expect(panel.getByTestId('object-size-0')).toHaveValue('1.6')

  // 넣은 glb(OE-P3-08)가 라이브러리 항목이 되고, 바로 놓기가 시작된다
  await page.getByTestId('object-model-input').setInputFiles(MODEL)
  await expect(page.locator('.object-library')).toContainText('lounge-chair')
  await clickAt(page, 5, 1.6)
  await expect(panel.locator('h3')).toHaveText('lounge-chair 1')
  await expect(panel.getByTestId('object-size-0')).toHaveValue('0.8')
  await expect(panel.getByTestId('object-size-1')).toHaveValue('0.6')
  await expect(panel.getByTestId('object-size-2')).toHaveValue('1.1')
  const ids = await objects(page)
  const box = (await page.evaluate((x) => (window as any).__viewer.objectBox(x), ids[2])) as { min: number[]; max: number[] }
  expect(box.max[1] - box.min[1]).toBeCloseTo(1.1, 2)
  await expect(page.locator('.edit-bar')).toContainText('바뀐 것 3건')
  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await page.waitForTimeout(1800) // 막힌 상대의 붉은 표시가 사라진 뒤
  await page.screenshot({ path: 'test-results/space-objects.png' })

  // Delete 로 지우고 Ctrl+Z 로 돌아온다
  await page.keyboard.press('Delete')
  await expect(panel).toHaveCount(0)
  expect(await objects(page)).toHaveLength(2)
  await page.keyboard.press('Control+z')
  await expect.poll(async () => (await objects(page)).length).toBe(3)
  await expect(page.locator('.report, .changes').filter({ hasText: 'lounge-chair 1' }).first()).toBeAttached()
  expect(errors).toEqual([])
})
