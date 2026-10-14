import { existsSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { toSpace } from './edit-part'

// 내력벽 속성(OE-BIM-06). LoadBearing 이 없는 벽은 "모름", false 인 벽은 "비내력벽(아니오)" 으로 갈리고, 내력벽은 잠긴 까닭이 보인다.
// Duplex 건축: 내력벽 7 · 비내력벽 50. AC20(FZK-Haus): 벽 13개 전부 LoadBearing 이 없다.
const DUPLEX = 'data/NBU_Duplex/NBU_Duplex-Apt_Arch.ifc'
const AC20 = 'data/AC20-FZK-Haus.ifc'

async function openWalls(page: Page, file: string) {
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(file)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 90_000 })
  await page.getByRole('button', { name: '편집', exact: true }).click()
  await toSpace(page)
  await page.getByRole('button', { name: '벽·문·창' }).click()
  await page.locator('.canvas-wrap > canvas').scrollIntoViewIfNeeded()
  await page.waitForTimeout(300)
}
/** 벽을 차례로 눌러 내력 칸이 `value` 인 첫 벽 패널을 연다. `unlocked` 면 잠기지 않은(외벽이 아닌) 벽만. */
async function pickWall(page: Page, value: 'true' | 'false' | 'null', unlocked = false) {
  const panel = page.locator('.element-picked')
  const ids = (await page.evaluate(() => (window as any).__viewer.elements())) as string[]
  for (const id of ids) {
    const at = (await page.evaluate((x) => (window as any).__viewer.element(x), id)) as { x: number; y: number } | null
    if (!at) continue
    await page.mouse.click(at.x, at.y)
    // 누른 뒤 패널이 다시 그려지는 사이에 읽으면 기다림에 걸린다. 짧게 읽고 못 읽으면 다음 벽으로 간다.
    const v = await panel.getByTestId('wall-bearing').inputValue({ timeout: 1000 }).catch(() => null)
    if (v === value && (!unlocked || (await panel.getByTestId('wall-locked').count()) === 0)) return panel
  }
  throw new Error(`내력 ${value} 인 벽을 못 찾았다(${ids.length}개 중)`)
}

test('LoadBearing 이 없는 벽은 "모름"(AC20), false 인 벽은 "비내력벽"(Duplex)으로 갈리고, 내력벽이면 옮기거나 지울 수 없다는 까닭이 보인다 [OE-BIM-06#1]', async ({ page }) => {
  test.skip(!existsSync(DUPLEX) || !existsSync(AC20), `${DUPLEX} · ${AC20} 이 없다(npm run fetch:sample)`)
  test.setTimeout(240_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))

  // AC20: 모름은 아니오가 아니다.
  await openWalls(page, AC20)
  const unknown = await pickWall(page, 'null')
  await expect(unknown.getByTestId('wall-bearing').locator('option:checked')).toHaveText('모름')
  await expect(unknown).toContainText("'모름'은 비내력벽과 구분되며 내벽처럼 편집할 수 있습니다.")

  // Duplex: BIM 이 false 라고 적은 벽은 비내력벽(BIM)이다.
  await openWalls(page, DUPLEX)
  const no = await pickWall(page, 'false', true)
  await expect(no.getByTestId('wall-bearing').locator('option:checked')).toHaveText('비내력벽')
  await expect(no.getByTestId('wall-bearing').locator('xpath=ancestor::p[1]').locator('.src')).toHaveClass(/\bbim\b/)
  await expect(no).toContainText("'모름'은 비내력벽과 구분됩니다.")
  // 내력벽은 잠기고 까닭이 보인다. Duplex 의 BIM 내력벽 7개는 모두 외벽이라 3D 에서 앞의 창·문이 먼저 잡혀, 이 비내력벽을 내력벽으로 바꿔 본다.
  const bearing = no.getByTestId('wall-bearing')
  await bearing.selectOption('true')
  await expect(no.getByTestId('wall-locked')).toContainText('내력벽이라 옮기거나 지울 수 없습니다')
  await expect(bearing.locator('xpath=ancestor::p[1]').locator('.src')).toHaveClass(/\bedit\b/)
  await bearing.selectOption('false')
  await expect(no.getByTestId('wall-locked')).toHaveCount(0)
  expect(errors).toEqual([])
})
