import { existsSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { toEquipment, toSpace } from './edit-part'

// 내력 여부의 출처(OE-OBJ-06). BIM 이 적은 값은 "BIM", 패널에서 바꾸면 "편집" 이고, 연 때 값으로 돌리면 다시 "BIM" 이다.
// Duplex 건축 Level 1 의 벽은 전부 비내력(BIM)이다.
const DUPLEX = 'data/NBU_Duplex/NBU_Duplex-Apt_Arch.ifc'

test('BIM 벽의 내력 여부를 바꾸면 출처가 편집이 되고 잠기며, 되돌려 놓으면 BIM 으로 돌아온다 [OE-OBJ-06#3] [OE-BIM-06#1~]', async ({ page }) => {
  test.skip(!existsSync(DUPLEX), `${DUPLEX} 이 없다(npm run fetch:sample)`)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(DUPLEX)
  await expect(page.locator('.appbar h2')).toHaveText('NBU_Duplex-Apt_Arch.ifc', { timeout: 90_000 })
  await page.getByRole('button', { name: '편집', exact: true }).click()
  await toSpace(page)
  await page.getByRole('button', { name: '벽·문·창' }).click()
  await page.locator('.canvas-wrap > canvas').scrollIntoViewIfNeeded()
  await page.waitForTimeout(300)

  const panel = page.locator('.element-picked')
  const ids = (await page.evaluate(() => (window as any).__viewer.elements())) as string[]
  // 내벽을 하나 고른다. 문·창이나 벽 앞의 가구가 먼저 잡히는 자리도 있고, 외벽은 처음부터 잠겨 있어서(OE-EXT-02)
  // 잠기지 않은 벽 패널이 뜰 때까지 다음 것을 누른다.
  for (const id of ids) {
    const at = (await page.evaluate((x) => (window as any).__viewer.element(x), id)) as { x: number; y: number } | null
    if (!at) continue
    await page.mouse.click(at.x, at.y)
    if ((await panel.getByTestId('wall-bearing').isVisible()) && !(await panel.getByTestId('wall-locked').isVisible())) break
  }
  const bearing = panel.getByTestId('wall-bearing')
  const src = bearing.locator('xpath=ancestor::p[1]').locator('.src')
  await expect(bearing).toHaveValue('false')
  await expect(src).toHaveText('BIM')

  await bearing.selectOption('true')
  await expect(src).toHaveText('편집')
  await expect(panel.getByTestId('wall-locked')).toBeVisible()

  await bearing.selectOption('false')
  await expect(src).toHaveText('BIM')
  await expect(panel.getByTestId('wall-locked')).toHaveCount(0)
  expect(errors).toEqual([])
})
