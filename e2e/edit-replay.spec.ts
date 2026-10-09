import { expect, test, type Page } from '@playwright/test'

// 편집 리플레이(PoC). P 를 누르면 3D 가 창 전체로 커지고(극장), 이번 세션의 편집을 되돌리기로 한 번에 되돌린 뒤 다시 하기로 하나씩
// 다시 한다. 진행은 표시(.replay-hud)의 data-* 로, 모양은 스크린숏(REPLAY_SHOTS 가 있으면)으로 본다. 3D 의 미끄러짐·카메라
// 이동이 보이게 움직임을 켠다.
const MEP = 'src/lib/ifc/fixtures/mep.ifc'
const SHOTS = process.env.REPLAY_SHOTS
test.use({ contextOptions: { reducedMotion: 'no-preference' } })

async function open(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(MEP)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  return errors
}

const row = (page: Page, name: string) => page.locator('.equipment tbody tr', { hasText: name }).last()
async function pick(page: Page, name: string) {
  await row(page, name).getByRole('button', { name, exact: true }).click()
  await page.locator('.viewport canvas').scrollIntoViewIfNeeded()
}
const coords = async (page: Page, name: string) =>
  Promise.all([0, 1, 2].map(async (i) => Number(await row(page, name).locator('.coord').nth(i).inputValue())))

test('편집이 없으면 P 는 안내만 하고 리플레이를 띄우지 않는다', async ({ page }) => {
  const errors = await open(page)
  await page.keyboard.press('p')
  await expect(page.locator('.replay-hud')).toHaveCount(0)
  await expect(page.getByText('리플레이할 편집이 없습니다')).toBeVisible()
  expect(errors).toEqual([])
})

test('P 로 3D 위에서 되감고 하나씩 다시 하며, 앞뒤로 넘기고, 닫으면 편집한 상태 그대로다', async ({ page }) => {
  test.setTimeout(120_000)
  const errors = await open(page)
  await page.keyboard.press('e')
  await pick(page, 'AHU-1')
  // 묶이지 않게 간격을 두고 두 번(되돌리기 두 단계). AT-101-01 같은 천장 설비는 천장 모드에서만 옮겨진다.
  await page.keyboard.press('Shift+ArrowRight')
  await page.waitForTimeout(1800)
  await page.keyboard.press('Shift+ArrowUp')
  await page.waitForTimeout(1800)
  // 물리존 꼭짓점 하나 지우기(사무실 80㎡ → 40㎡). mep.ifc 의 사무실은 (0,0)(10,0)(10,8)(0,8) 이다.
  const floor = await page.evaluate(() => (window as any).__viewer.point([9.6, 7.6, 0.1]))
  await page.mouse.click(floor.x, floor.y)
  await expect(page.locator('.space-picked')).toContainText('80.0')
  await page.keyboard.press(']')
  await page.keyboard.press('Delete')
  await expect(page.locator('.space-picked')).toContainText('40.0')
  const before = await coords(page, 'AHU-1')

  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('p')
  const hud = page.locator('.replay-hud')
  await expect(hud).toBeVisible()
  // 극장: 3D 가 창을 채운다.
  const box = (await page.locator('.viewport').boundingBox())!
  const view = page.viewportSize()!
  expect([box.width, box.height]).toEqual([view.width, view.height])
  const total = Number(await hud.getAttribute('data-total'))
  expect(total).toBeGreaterThanOrEqual(3)
  // 열자마자 편집 전 상태로 한 번에 돌아가 있고(되감는 장면은 없다), 오프닝(건물 이름·편집 수, 건물이 솟아오름) 동안 그대로다.
  await expect(hud).toHaveAttribute('data-phase', 'opening')
  await expect(hud).toHaveAttribute('data-at', '0')
  await expect(hud.locator('.opening')).toBeVisible()
  if (SHOTS) {
    await page.waitForTimeout(700)
    await page.screenshot({ path: `${SHOTS}/3d-0-opening.png` })
  }
  await expect(hud).toHaveAttribute('data-phase', 'play', { timeout: 15_000 })
  // 장면마다 다시 하기 한 번. 카드가 하나씩 쌓인다.
  for (let i = 1; i <= total; i++) {
    await expect(hud).toHaveAttribute('data-at', String(i), { timeout: 15_000 })
    await page.waitForTimeout(1300)
    await expect(hud.locator('.card')).toHaveCount(Math.min(i, 5))
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/3d-${i}.png` })
  }
  await expect(hud).toHaveAttribute('data-phase', 'done', { timeout: 15_000 })
  await expect(hud.locator('.hud-done')).toContainText('사람이 고친 곳')
  if (SHOTS) {
    await page.waitForTimeout(900)
    await page.screenshot({ path: `${SHOTS}/3d-end.png` })
  }
  // 앞뒤: 되돌리기·다시 하기 한 번씩이다.
  await page.keyboard.press('ArrowLeft')
  await expect(hud).toHaveAttribute('data-at', String(total - 1))
  await page.keyboard.press('ArrowRight')
  await expect(hud).toHaveAttribute('data-at', String(total))

  // 중간에 닫아도 남은 편집을 다시 해서 편집한 상태로 돌아온다.
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('ArrowLeft')
  await expect(hud).toHaveAttribute('data-at', String(total - 2))
  await page.keyboard.press('Escape')
  await expect(hud).toHaveCount(0)
  expect(await coords(page, 'AHU-1')).toEqual(before)
  const here = await page.evaluate(() => (window as any).__viewer.point([9.6, 7.6, 0.1]))
  await page.mouse.click(here.x, here.y)
  await expect(page.locator('.space-picked')).toContainText('40.0')
  // 편집 모드로 돌아와 있고, 이력도 그대로다 — 장면 수만큼 Ctrl+Z 하면 연 때로 간다.
  await expect(page.locator('.edit-bar')).toBeVisible()
  await page.locator('body').click({ position: { x: 5, y: 5 } })
  for (let i = 0; i < total; i++) await page.keyboard.press('Control+z')
  // 리플레이가 카메라를 옮겼으니 바닥 점을 다시 짚는다.
  const again = await page.evaluate(() => (window as any).__viewer.point([9.6, 7.6, 0.1]))
  await page.mouse.click(again.x, again.y)
  await expect(page.locator('.space-picked')).toContainText('80.0')
  expect(errors).toEqual([])
})

test('벽·문·창 장면은 그 자리로 카메라를 보내고 외곽선 층을 켜며, 카드를 누르면 그 장면만 다시 튼다', async ({ page }) => {
  test.setTimeout(120_000)
  const errors = await open(page)
  await page.getByRole('button', { name: '편집', exact: true }).click()
  await page.locator('.viewport canvas').scrollIntoViewIfNeeded()
  const clickFloor = async (x: number, y: number) => {
    const at = await page.evaluate(([px, py]) => (window as any).__viewer.point([px, py, 0]), [x, y])
    await page.mouse.click(at.x, at.y)
  }
  // 사무실(0..10, 0..8) 오른쪽 끝에 벽을 긋고, 문을 놓고, 문을 벽을 따라 옮긴다. 묶이지 않게 간격을 둔다.
  await page.getByRole('button', { name: '벽·문·창' }).click()
  await page.getByRole('button', { name: '벽 긋기' }).click()
  await clickFloor(10.1, 0)
  await clickFloor(10.1, 8)
  const panel = page.locator('.element-picked')
  await expect(panel.locator('h3')).toHaveText('새 벽')
  await page.waitForTimeout(1500)
  await page.getByRole('button', { name: '문 놓기' }).click()
  await clickFloor(10.1, 4)
  await expect(panel.locator('h3')).toHaveText('새 문')
  await page.waitForTimeout(1500)
  const y = panel.locator('.position-edit .coord').nth(1)
  await y.fill('6.5')
  await y.press('Enter')
  await expect(y).toHaveValue('6.5')
  await page.waitForTimeout(1500)

  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('p')
  const hud = page.locator('.replay-hud')
  await expect(hud).toBeVisible()
  const total = Number(await hud.getAttribute('data-total'))
  expect(total).toBeGreaterThanOrEqual(3)
  await expect(hud).toHaveAttribute('data-at', '0', { timeout: 15_000 })
  await expect(hud).toHaveAttribute('data-at', String(total), { timeout: 40_000 })
  // 문 옮기기 장면: 편집 모드가 아니어도 벽·문·창 외곽선이 그려져 있고, 카메라는 문(10.1, 4 → 6.5) 쪽을 본다.
  expect(await page.evaluate(() => (window as any).__viewer.elements().length)).toBeGreaterThan(0)
  const { target } = await page.evaluate(() => (window as any).__viewer.camera())
  expect(Math.abs(target[0] - 10.1)).toBeLessThan(3)
  expect(-target[2]).toBeGreaterThan(2)
  expect(-target[2]).toBeLessThan(9)
  await page.waitForTimeout(1300)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/arch-door.png` })
  await expect(hud).toHaveAttribute('data-phase', 'done', { timeout: 15_000 })

  // 첫 카드(벽 긋기)를 누르면 그 편집 앞까지 되돌리고 그 장면만 되풀이한다(되돌림 → 다시 함 → 되돌림 …). 그 뒤 장면의 카드는
  // 남고(지금 모델에는 없으니 흐리게), 반복 중인 카드가 펼쳐진다.
  const cards = await hud.locator('.card').count()
  await hud.locator('.card', { hasText: '#01' }).click()
  await expect(hud).toHaveAttribute('data-loop', '0')
  await expect(hud).toHaveAttribute('data-at', '0')
  await expect(hud.locator('.hud-bar .status')).toContainText('반복 중')
  await expect(hud.locator('.card')).toHaveCount(cards)
  await expect(hud.locator('.card.ahead')).toHaveCount(cards - 1)
  await expect(hud.locator('.card.looping')).not.toHaveClass(/old/)
  // 반복 중에는 카메라가 첫 바퀴에만 그 자리로 간다. 사람이 다가가면(휠) 그 시점이 다음 바퀴에도 그대로다 — 저절로 돌지도 않는다.
  await expect(hud).toHaveAttribute('data-at', '1', { timeout: 15_000 })
  await page.waitForTimeout(800)
  const canvas = (await page.locator('.viewport canvas').boundingBox())!
  await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2)
  await page.mouse.wheel(0, -400)
  await page.waitForTimeout(600)
  const near = await page.evaluate(() => (window as any).__viewer.camera())
  for (const at of ['0', '1']) await expect(hud).toHaveAttribute('data-at', at, { timeout: 15_000 })
  await page.waitForTimeout(800)
  const later = await page.evaluate(() => (window as any).__viewer.camera())
  for (const k of [0, 1, 2]) {
    expect(Math.abs(later.position[k] - near.position[k])).toBeLessThan(0.01)
    expect(Math.abs(later.target[k] - near.target[k])).toBeLessThan(0.01)
  }
  await page.waitForTimeout(500)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/arch-wall.png` })
  // Space 는 반복을 멈추고 그 다음 장면부터 끝까지 잇는다.
  await page.keyboard.press('Space')
  await expect(hud).toHaveAttribute('data-loop', '')
  await expect(hud).toHaveAttribute('data-at', '2', { timeout: 15_000 })
  await expect(hud).toHaveAttribute('data-phase', 'done', { timeout: 40_000 })
  await expect(hud).toHaveAttribute('data-at', String(total))
  // 반복 중에 닫아도 남은 편집을 다시 해서 문이 옮긴 자리에 있다.
  await hud.locator('.card', { hasText: '#02' }).click()
  await expect(hud).toHaveAttribute('data-loop', '1')
  await page.keyboard.press('Escape')
  await expect(hud).toHaveCount(0)
  await page.locator('body').click({ position: { x: 5, y: 5 } })
  for (let i = 0; i < total; i++) await page.keyboard.press('Control+z')
  await expect(page.locator('.edit-bar .undo')).toBeDisabled()
  expect(errors).toEqual([])
})

test('끝 화면의 빛기둥을 누르면 카드를 누른 것처럼 그 장면을 되풀이한다', async ({ page }) => {
  test.setTimeout(120_000)
  const errors = await open(page)
  await page.keyboard.press('e')
  await pick(page, 'AHU-1')
  await page.keyboard.press('Shift+ArrowRight')
  await page.waitForTimeout(1800)
  await page.keyboard.press('Shift+ArrowUp')
  await page.waitForTimeout(1800)
  const [x, y, z] = await coords(page, 'AHU-1')
  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('p')
  const hud = page.locator('.replay-hud')
  await hud.getByRole('button', { name: '2×' }).click()
  await expect(hud).toHaveAttribute('data-phase', 'done', { timeout: 60_000 })
  // 건물 전체로 물러나는 비행이 끝난 뒤. AHU-1 은 두 장면(#01·#02)에서 옮겼고 빛기둥은 처음 장면 번호를 단다.
  await page.waitForTimeout(2500)
  const at = await page.evaluate((p) => (window as any).__viewer.point(p), [x, y, z + 1])
  await page.mouse.move(at.x, at.y)
  await expect(page.locator('.viewport canvas')).toHaveCSS('cursor', 'pointer')
  await page.mouse.click(at.x, at.y)
  await expect(hud).toHaveAttribute('data-loop', '0')
  await expect(hud).toHaveAttribute('data-phase', 'play')
  await expect(hud.locator('.hud-bar .status')).toContainText('반복 중')
  // 빈 바닥을 누르는 것은 아무 장면도 고르지 않는다(반복은 그대로).
  await page.keyboard.press('Escape')
  await expect(hud).toHaveCount(0)
  expect(errors).toEqual([])
})
