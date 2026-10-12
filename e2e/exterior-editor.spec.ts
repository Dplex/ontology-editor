import { existsSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { toEquipment, toSpace } from './edit-part'

// 외벽 에디터(OE-EXT-03). 층 편집 화면에서 잠긴 외벽(OE-EXT-02)을, 외벽 에디터를 켜면 다른 층에서 같은 면에 쌓인 외벽까지 묶어 함께 옮긴다.
// Duplex 건축(gitignore)은 4개 층에 외벽 23개가 쌓여 있고 그중 7개가 내력벽이다.
const DUPLEX = 'data/NBU_Duplex/NBU_Duplex-Apt_Arch.ifc'

/**
 * 그 층 평면도에서 벽 외곽선 점들(층마다). 평면도 좌표는 층 범위에 맞춰 원점이 바뀌므로, 같은 층의 묶이지 않은 첫 벽의 첫 점을 빼 둔다.
 * 층을 오갈 때 "모든 층" 을 거치지 않는다 — 외벽 에디터에서는 층을 바꿔도 묻지 않아야 한다.
 */
async function planPoints(page: Page, storeys: string[], ids: string[]) {
  const out: Record<string, number[][]> = {}
  const parse = (raw: string) => raw.trim().split(/\s+/).map((p) => p.split(',').map(Number))
  for (const name of storeys) {
    await page.getByRole('combobox', { name: '보일 층' }).selectOption({ label: `${name}만` })
    await page.getByRole('group', { name: '보기' }).getByRole('button', { name: '평면도' }).click()
    const all = page.locator('svg.floor-plan polygon[data-wall]')
    const n = await all.count()
    let ref: number[] | null = null
    for (let i = 0; i < n && !ref; i++) if (!ids.includes((await all.nth(i).getAttribute('data-wall'))!)) ref = parse((await all.nth(i).getAttribute('points'))!)[0]
    for (const id of ids) {
      const poly = page.locator(`svg.floor-plan polygon[data-wall="${id}"]`).first()
      if (!(await poly.count())) continue
      out[id] = parse((await poly.getAttribute('points'))!).map((p) => [p[0] - ref![0], p[1] - ref![1]])
    }
    await page.getByRole('group', { name: '보기' }).getByRole('button', { name: '3D' }).click()
  }
  await page.getByRole('combobox', { name: '보일 층' }).selectOption({ label: '모든 층' })
  return out
}

test('외벽 에디터에서 외벽을 옮기면 같은 면에 쌓인 다른 층 외벽도 함께 옮겨져 층마다 평면도에서 새 자리에 있고, 되돌리기 한 번에 모두 돌아온다 [OE-EXT-03#1]', async ({ page }) => {
  test.skip(!existsSync(DUPLEX), `${DUPLEX} 이 없다(npm run fetch:sample)`)
  test.setTimeout(180_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(DUPLEX)
  await expect(page.locator('.appbar h2')).toHaveText('NBU_Duplex-Apt_Arch.ifc', { timeout: 90_000 })
  await page.getByRole('button', { name: '편집', exact: true }).click()
  await toSpace(page)
  await page.getByRole('button', { name: '벽·문·창' }).click()
  await page.getByTestId('exterior-editor').click()
  await expect(page.getByTestId('exterior-editor')).toHaveAttribute('aria-pressed', 'true')
  // 켜면 모든 층을 보인다.
  await expect(page.getByRole('combobox', { name: '보일 층' })).toHaveValue('모든 층')
  await page.locator('.viewport canvas').scrollIntoViewIfNeeded()
  await page.waitForTimeout(300)

  // 다른 층에 같은 면이 있는 외벽을 골라 방향키로 옮긴다. 내력벽(Duplex 는 면마다 기초벽 T/FDN)은 제자리에 두고 나머지 층만 옮긴다.
  // 화면 방향이 벽 면에 수직이 아니면 벽 길이 방향으로 미끄러져 모서리 벽을 가로지를 수 있어(그러면 옮기지 않는다) 두 방향을 시도한다.
  const panel = page.locator('.element-picked')
  const group = panel.getByTestId('facade-group')
  const bar = page.locator('.edit-bar')
  const ids = (await page.evaluate(() => (window as any).__viewer.elements())) as string[]
  let walls: string[] = []
  let storeys: string[] = []
  let kept = false
  for (const id of ids) {
    const at = (await page.evaluate((x) => (window as any).__viewer.element(x), id)) as { x: number; y: number } | null
    if (!at) continue
    await page.mouse.click(at.x, at.y)
    if (!(await group.isVisible())) continue
    const these = (await group.getAttribute('data-walls'))!.split(' ').filter(Boolean)
    if (these.length < 2) continue
    // 층 편집 화면의 외벽 잠금 안내 대신 외벽 에디터 안내가 선다.
    await expect(panel.getByTestId('wall-locked')).toHaveCount(0)
    kept = await panel.getByTestId('facade-bearing').isVisible()
    if (process.env.SHOT) {
      await page.mouse.move(5, 5)
      await page.screenshot({ path: process.env.SHOT })
    }
    await page.locator('body').click({ position: { x: 5, y: 5 } })
    for (const key of ['ArrowRight', 'ArrowUp']) {
      await page.keyboard.press(key)
      await page.waitForTimeout(200)
      if (/외벽 \d+개 옮김/.test((await bar.textContent()) ?? '')) break
    }
    if (!/외벽 \d+개 옮김/.test((await bar.textContent()) ?? '')) continue
    walls = these
    storeys = (await group.textContent())!.match(/같은 면 외벽 \d+개\(([^)]+)\)/)![1].split('·')
    break
  }
  expect(walls.length).toBeGreaterThanOrEqual(2)
  await expect(bar).toContainText(`외벽 ${walls.length}개 옮김`)
  if (kept) await expect(page.locator('.key-note')).toContainText('내력벽이라 제자리에 둡니다')
  const after = await planPoints(page, storeys, walls)
  expect(Object.keys(after).sort()).toEqual([...walls].sort())

  // 되돌리기 한 번에 모든 층이 돌아온다. 돌아온 자리와 옮긴 자리의 차가 층마다 같은 10cm 다.
  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('Control+z')
  await expect(page.locator('.edit-bar')).toContainText('바뀐 것 0건')
  const before = await planPoints(page, storeys, walls)
  for (const id of walls) {
    const shift = after[id].map((p, i) => Math.hypot(p[0] - before[id][i][0], p[1] - before[id][i][1]))
    for (const d of shift) expect(d).toBeCloseTo(0.1, 3)
  }
  expect(errors).toEqual([])
})
