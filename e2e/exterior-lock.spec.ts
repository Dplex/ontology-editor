import { existsSync } from 'node:fs'
import { expect, test } from '@playwright/test'

// 에디터 내 외벽 불변(OE-EXT-02). 층 편집 화면에서 외벽은 고르고 속성을 볼 수 있지만, 옮기기·지우기·크기 바꾸기는 안 된다 — 외벽 형상은
// 외벽 에디터(OE-EXT-03)의 일이다. 외벽 여부를 바꾸면 풀린다. Duplex 건축(gitignore)은 벽마다 IsExternal 을 적는다.
const DUPLEX = 'data/NBU_Duplex/NBU_Duplex-Apt_Arch.ifc'

test('외벽은 크기 칸·지우기가 없고 방향키로 옮기지 않으며, 외벽 여부를 내벽으로 바꾸면 풀린다', async ({ page }) => {
  test.skip(!existsSync(DUPLEX), `${DUPLEX} 이 없다(npm run fetch:sample)`)
  test.setTimeout(120_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(DUPLEX)
  await expect(page.locator('.appbar h2')).toHaveText('NBU_Duplex-Apt_Arch.ifc', { timeout: 90_000 })
  await page.getByRole('button', { name: '편집', exact: true }).click()
  await page.getByRole('button', { name: '벽·문·창' }).click()
  await page.locator('.viewport canvas').scrollIntoViewIfNeeded()
  await page.waitForTimeout(300)

  const panel = page.locator('.element-picked')
  const external = panel.getByTestId('wall-external-select')
  const bearing = panel.getByTestId('wall-bearing')
  // BIM 이 외벽이라 하고 내력은 아닌 벽을 고른다(내력벽은 내력 잠금이 먼저 걸린다).
  const ids = (await page.evaluate(() => (window as any).__viewer.elements())) as string[]
  let found = false
  for (const id of ids) {
    const at = (await page.evaluate((x) => (window as any).__viewer.element(x), id)) as { x: number; y: number } | null
    if (!at) continue
    await page.mouse.click(at.x, at.y)
    if (!(await external.isVisible())) continue
    if ((await external.inputValue()) === 'true' && (await bearing.inputValue()) !== 'true') {
      found = true
      break
    }
  }
  expect(found).toBe(true)

  const lock = panel.getByTestId('wall-locked')
  await expect(lock).toContainText('외벽이라 층 편집 화면에서는 옮기거나 지우거나 크기를 바꿀 수 없습니다')
  await expect(panel.getByTestId('wall-height')).toHaveCount(0)
  await expect(panel.getByRole('button', { name: '벽 지우기' })).toHaveCount(0)
  await page.screenshot({ path: 'test-results/exterior-lock.png' })
  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('.key-note')).toContainText('외벽은 층 편집 화면에서 옮기거나')
  await expect(page.locator('.edit-bar')).toContainText('바뀐 것 0건')

  // 내벽으로 바꾸면 풀린다
  await external.selectOption('false')
  await expect(lock).toHaveCount(0)
  await expect(panel.getByTestId('wall-height')).toBeVisible()
  await expect(panel.getByRole('button', { name: '벽 지우기' })).toBeVisible()
  expect(errors).toEqual([])
})
