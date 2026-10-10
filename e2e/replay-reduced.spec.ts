import { expect, test } from '@playwright/test'

// 움직임 줄이기를 켠 사람(prefers-reduced-motion)도 리플레이를 끝까지 본다. 3D 연출(호 비행·빛기둥·층 쌓기·철거)은 꺼지고,
// 장면 진행·카드·움직이지 않는 덧그림(변경 지도)은 그대로다. 기본 설정(playwright.config 의 reduce)으로 돈다.
test('움직임 줄이기에서도 리플레이가 끝까지 돌고, 빛기둥 없이 변경 지도는 보인다', async ({ page }) => {
  test.setTimeout(300_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles('src/lib/ifc/fixtures/mep.ifc')
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  await page.locator('.demo-button').click()
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
