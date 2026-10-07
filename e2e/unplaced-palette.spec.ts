import { existsSync } from 'node:fs'
import { expect, test } from '@playwright/test'

// 미배치 설비 배치(OE-EQP-02). 편집 팔레트의 미배치 목록에서 설비를 누르면 바로 놓기 — 따로 [3D에서 놓기] 버튼이 없다. 같은 설비를
// 다시 누르거나 Esc 면 취소이고 좌표가 생기지 않는다. 바닥을 누르면 그 자리에 놓이고 목록에서 빠지며, Ctrl+Z 한 번에 미배치로
// 돌아온다. 종류를 모르는 설비는 바닥에 놓는다. ifc4Mep(gitignore)는 00층에 좌표 없는 퓨즈(종류 모름)가 있다.
const MEP = 'data/ifc4Mep_IFC4.ifc'

test('팔레트의 미배치 설비를 누르면 바로 놓고, 다시 누르거나 Esc 면 취소이며, 놓은 것은 Ctrl+Z 로 미배치로 돌아온다', async ({ page }) => {
  test.skip(!existsSync(MEP), `${MEP} 이 없다(npm run fetch:sample)`)
  test.setTimeout(120_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(MEP)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 90_000 })
  // 검토 화면의 미배치 목록에는 [3D에서 놓기] 버튼이 없다
  await expect(page.locator('.unplaced').getByRole('button', { name: '3D에서 놓기' })).toHaveCount(0)

  await page.getByRole('button', { name: '편집', exact: true }).click()
  await page.getByRole('combobox', { name: '보일 층' }).selectOption({ label: '00. Begane grond만' })
  const toggle = page.getByRole('button', { name: /미배치 \d+대/ })
  const count = async () => Number((await toggle.textContent())!.match(/(\d+)대/)![1])
  const before = await count()
  await toggle.click()
  const item = page.getByRole('list', { name: '미배치 설비' }).getByRole('button').first()
  const name = (await item.textContent())!.trim()

  // 다시 누르면 취소
  await item.click()
  await expect(item).toHaveAttribute('aria-pressed', 'true')
  await item.click()
  await expect(item).toHaveAttribute('aria-pressed', 'false')
  // Esc 도 취소
  await item.click()
  await page.keyboard.press('Escape')
  await expect(item).toHaveAttribute('aria-pressed', 'false')

  // 누르고 바닥을 누르면 그 자리에 놓인다. 설비가 없는 자리(건물 바깥 1m)를 누른다.
  await item.click()
  const centers = (await page.evaluate(() => (window as any).__viewer.centers())) as Record<string, number[]>
  const xs = Object.values(centers).map((c) => c[0] / 1000)
  const ys = Object.values(centers).map((c) => c[1] / 1000)
  await page.locator('.viewport canvas').first().scrollIntoViewIfNeeded()
  const spot = (await page.evaluate(([x, y]) => (window as any).__viewer.point([x, y, 0]), [Math.min(...xs) + 0.5, Math.min(...ys) - 1])) as { x: number; y: number }
  await page.mouse.click(spot.x, spot.y)
  await expect.poll(count).toBe(before - 1)
  await expect(page.locator('.key-note')).toContainText('종류를 모르는 설비라 바닥 높이에 놓았습니다')
  await expect(page.locator('.edit-bar')).toContainText('옮김')

  // Ctrl+Z 한 번에 미배치로
  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('Control+z')
  await expect.poll(count).toBe(before)
  await expect(page.getByRole('list', { name: '미배치 설비' })).toContainText(name)
  expect(errors).toEqual([])
})
