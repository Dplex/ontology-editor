import { expect, test, type Page } from '@playwright/test'

// 편집 리플레이(PoC). P 를 누르면 3D 가 창 전체로 커지고(극장), 이번 세션의 편집을 되돌리기로 되감은 뒤 다시 하기로 하나씩
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
  // 오프닝(건물 이름·편집 수) 뒤 되감기: 이력이 0 까지 내려간다.
  if (SHOTS) {
    await page.waitForTimeout(700)
    await page.screenshot({ path: `${SHOTS}/3d-0-opening.png` })
    await expect(hud).not.toHaveAttribute('data-at', String(total), { timeout: 15_000 })
    await page.screenshot({ path: `${SHOTS}/3d-0-rewind.png` })
  }
  await expect(hud).toHaveAttribute('data-at', '0', { timeout: 15_000 })
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

  // 연출 스타일: 고르면 화면 전체가 그 스타일로 바뀌고, 이 브라우저에 기억한다. 마지막 장면을 띄워 둔 채 스타일마다 찍는다.
  await page.keyboard.press('ArrowLeft')
  await expect(hud).toHaveAttribute('data-at', String(total - 1))
  await page.waitForTimeout(1200)
  for (const id of ['broadcast', 'cinema', 'neon', 'swiss']) {
    await hud.locator(`.styles [data-style-id="${id}"]`).click()
    await expect(hud).toHaveAttribute('data-style', id)
    if (SHOTS) {
      // 바꾸면 그 스타일의 장면 전환이 한 번 다시 돈다. 끝난 뒤를 찍는다.
      await page.waitForTimeout(1300)
      await page.screenshot({ path: `${SHOTS}/style-${id}.png` })
    }
  }
  expect(await page.evaluate(() => localStorage.getItem('oe-replay-style'))).toBe('swiss')
  await hud.locator('.styles [data-style-id="broadcast"]').click()
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

  // 첫 카드(벽 긋기)를 누르면 그 편집 앞까지 되돌린 뒤 그 장면만 다시 하고 멈춘다.
  await hud.locator('.card', { hasText: '#01' }).click()
  await expect(hud).toHaveAttribute('data-at', '0')
  await expect(hud).toHaveAttribute('data-at', '1', { timeout: 15_000 })
  await expect(hud.locator('.hud-bar .status')).toContainText('멈춤')
  await page.waitForTimeout(1300)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/arch-wall.png` })
  // 닫으면 남은 편집을 다시 해서 문이 옮긴 자리에 있다.
  await page.keyboard.press('Escape')
  await expect(hud).toHaveCount(0)
  expect(errors).toEqual([])
})
