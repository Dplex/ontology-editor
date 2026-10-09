import { expect, test, type Page } from '@playwright/test'

// 룸(OE-OBJ-03 · OE-SPC-11). 물리존 안에 대각선 두 꼭짓점으로 그리는 사각 편집 단위. 다른 룸과 겹치거나 물리존 밖으로 나가는 시도는
// 막고 원래 상태로 둔다. 바닥을 누르면 룸이 물리존보다 먼저 골라지고, 꼭짓점 손잡이로 크기를, 방향키로 자리를 바꾼다.
// two-rooms.ifc 의 1F 회의실은 (2..6, 1..4) 이다.
const FIXTURE = 'src/lib/ifc/fixtures/two-rooms.ifc'

// 그릴 때는 층 바닥 평면(z 0)을, 고를 때는 룸 외곽선 높이(z 0.18)를 누른다.
const point = (page: Page, x: number, y: number, z = 0) => page.evaluate(([px, py, pz]) => (window as any).__viewer.point([px, py, pz]), [x, y, z]) as Promise<{ x: number; y: number }>
async function clickAt(page: Page, x: number, y: number, z = 0) {
  const at = await point(page, x, y, z)
  await page.mouse.click(at.x, at.y)
}
async function drawRoom(page: Page, a: [number, number], b: [number, number]) {
  await page.getByRole('button', { name: '룸 그리기' }).click()
  await clickAt(page, ...a)
  await clickAt(page, ...b)
}

test('룸을 그리고, 겹치거나 물리존 밖이면 막으며, 골라서 옮기고 크기를 바꾸고 지우면 Ctrl+Z 로 돌아온다 [OE-OBJ-03#1]', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(FIXTURE)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '편집', exact: true }).click()
  await page.getByRole('combobox', { name: '보일 층' }).selectOption({ label: '1F만' })
  await page.locator('.viewport canvas').scrollIntoViewIfNeeded()
  await page.waitForTimeout(400)

  // 회의실 안에 1.5 × 1.5 룸
  await drawRoom(page, [2.5, 1.5], [4, 3])
  const panel = page.locator('.room-picked')
  await expect(panel.locator('h3')).toHaveText('룸 1')
  await expect(panel).toContainText('회의실 안')
  await expect(panel.getByTestId('room-size')).toContainText('1.50 × 1.50')

  // 겹치는 룸은 막는다
  await drawRoom(page, [3.5, 2.5], [5, 3.5])
  await expect(page.locator('.edit-notice').first()).toContainText('이미 오브젝트가 있는 위치입니다')
  // 물리존 밖으로 나가는 룸도 막는다
  await drawRoom(page, [5, 2], [9, 3])
  await expect(page.locator('.edit-notice').first()).toContainText('물리존 경계 밖')
  await expect(page.locator('.edit-bar')).toContainText('룸 만들기')
  await expect(page.locator('.edit-bar')).toContainText('바뀐 것 1건')

  // 바닥을 누르면 룸이 회의실보다 먼저 골라진다
  await page.keyboard.press('Escape')
  await clickAt(page, 3, 2, 0.18)
  await expect(panel.locator('h3')).toHaveText('룸 1')
  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('Shift+ArrowRight')
  await expect(page.locator('.edit-bar')).toContainText('룸 1 옮김')
  await expect(panel.getByTestId('room-size')).toContainText('1.50 × 1.50')

  // 오른쪽 위 꼭짓점(2)을 끌어 크기를 바꾼다
  const handles = (await page.evaluate(() => (window as any).__viewer.handles())) as { x: number; y: number }[]
  expect(handles).toHaveLength(4)
  const to = await point(page, 5.8, 3.8, 0.12)
  await page.mouse.move(handles[2].x, handles[2].y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 8 })
  await page.mouse.up()
  // 방향키로 x 를 1m 옮긴 뒤라 왼아래 꼭짓점은 (3.5, 1.5) 다.
  await expect(panel.getByTestId('room-size')).toContainText('2.30 × 2.30')
  await page.waitForTimeout(1800) // 겹침으로 막은 룸의 붉은 표시가 사라진 뒤
  await page.screenshot({ path: 'test-results/rooms.png' })

  await panel.getByRole('button', { name: '룸 지우기' }).click()
  await expect(panel).toHaveCount(0)
  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('Control+z')
  await expect.poll(() => page.evaluate(() => (window as any).__viewer.rooms().length)).toBe(1)
  const id = ((await page.evaluate(() => (window as any).__viewer.rooms())) as string[])[0]
  const center = (await page.evaluate((x) => (window as any).__viewer.room(x), id)) as { x: number; y: number }
  await page.mouse.click(center.x, center.y)
  await expect(panel.locator('h3')).toHaveText('룸 1')
  expect(errors).toEqual([])
})
