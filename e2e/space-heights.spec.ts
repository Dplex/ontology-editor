import { existsSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'

// 물리존의 방 높이·반자 높이(OE-BIM-03). 방이 BIM 에 적은 값만 보이고, 없으면 "모름" 이다(0 이나 층고로 채우지 않는다).
// two-rooms.ifc: 방 높이·반자 높이 속성이 없다. AC20(FZK-Haus, ArchiCAD): 방마다 기준 물량 FinishCeilingHeight·Height 가 있다.
const ROOMS = 'src/lib/ifc/fixtures/two-rooms.ifc'
const AC20 = 'data/AC20-FZK-Haus.ifc'

/** 캔버스를 격자로 훑어 설비·벽이 아닌 물리존 바닥을 하나 눌러 고른다. */
async function pickAnySpace(page: Page) {
  const canvas = page.locator('.canvas-wrap > canvas')
  await canvas.scrollIntoViewIfNeeded()
  await page.waitForTimeout(400)
  const box = (await canvas.boundingBox())!
  for (let j = 1; j < 16; j++)
    for (let i = 1; i < 20; i++) {
      const x = box.x + (box.width * i) / 20
      const y = box.y + (box.height * j) / 16
      const hit = (await page.evaluate(([px, py]) => (window as any).__viewer.pickAt(px, py), [x, y])) as { equipment: string | null; element: string | null; space: string | null }
      if (hit.space && !hit.equipment && !hit.element) {
        await page.mouse.click(x, y)
        return page.locator('.space-picked')
      }
    }
  throw new Error('누를 물리존 바닥이 없다')
}

test('방 높이·반자 높이가 BIM 에 없는 물리존은 "모름" 이고, 있으면 그 값(BIM)이다 [OE-BIM-03#2]', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(ROOMS)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  const heights = (await pickAnySpace(page)).getByTestId('space-heights')
  await expect(heights).toHaveText(/방\s*모름\s*· 반자\s*모름/)
  await expect(heights.locator('.src')).toHaveCount(0)

  test.skip(!existsSync(AC20), `${AC20} 이 없다(npm run fetch:sample)`)
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(AC20)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 60_000 })
  const said = (await pickAnySpace(page)).getByTestId('space-heights')
  await expect(said).toHaveText(/방\s*\d+\.\d\dm\s*BIM\s*· 반자\s*\d+\.\d\dm\s*BIM/)
  expect(errors).toEqual([])
})
