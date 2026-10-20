import { expect, test } from '@playwright/test'
import { pickEquipment } from './edit-part'

// 움직임 줄이기를 켠 사람(prefers-reduced-motion)도 리플레이를 끝까지 본다. 3D 연출(호 비행·빛기둥·층 쌓기·철거)은 꺼지고,
// 장면 진행·카드·움직이지 않는 덧그림(변경 지도)은 그대로다. 기본 설정(playwright.config 의 reduce)으로 돈다.
test('움직임 줄이기에서도 리플레이가 끝까지 돌고, 빛기둥 없이 변경 지도는 보인다', async ({ page }) => {
  test.setTimeout(300_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles('src/lib/ifc/fixtures/mep.ifc')
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  // 편집 둘(AHU-1 옮기기 · 사무실 꼭짓점 지우기). 움직임 줄이기라 옮기기는 미끄러지지 않고 바로 놓인다.
  await page.keyboard.press('e')
  await pickEquipment(page, 'AHU-1')
  await page.locator('.canvas-wrap > canvas').scrollIntoViewIfNeeded()
  await page.keyboard.press('Shift+ArrowRight')
  await page.waitForTimeout(1800)
  const floor = await page.evaluate(() => (window as any).__viewer.point([9.6, 7.6, 0.1]))
  await page.mouse.click(floor.x, floor.y)
  await expect(page.locator('.space-picked')).toContainText('80.0')
  await page.keyboard.press(']')
  await page.keyboard.press('Delete')
  await expect(page.locator('.space-picked')).toContainText('40.0')
  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('p')
  const hud = page.locator('.replay-hud')
  await expect(hud).toBeVisible()
  await hud.getByRole('button', { name: '4×' }).click()
  await expect(hud).toHaveAttribute('data-phase', 'done', { timeout: 200_000 })
  const motion = await page.evaluate(() => (window as any).__viewer.motion())
  expect(motion.spots).toBe(0)
  expect(motion.demolished).toBe(0)
  // 3D 위 글은 치지 않고 다 쓴 채로 뜬다.
  expect(motion.typed).toBe(0)
  await page.keyboard.press('d')
  await expect(hud.locator('.diff-legend')).toBeVisible()
  await page.keyboard.press('Escape')
  await page.keyboard.press('Enter')
  await expect(hud).toHaveCount(0)
  expect(errors).toEqual([])
})
