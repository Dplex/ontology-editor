import { existsSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'

// 작은 화면 손질(docs/dev/ui-notes.md "층별 칩·휠 회전 중심·성능 표·리플레이 하단 자막"). 시점은 __viewer.camera() 로 잰다.
const DUPLEX = 'data/NBU_Duplex/NBU_Duplex-Apt_Eng-MEP.ifc'
const MEP = 'src/lib/ifc/fixtures/mep.ifc'
const viewer = <T,>(page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(([f, a]) => (window as any).__viewer[f as string](...(a as unknown[])), [fn, args] as const) as Promise<T>
type Cam = { position: number[]; target: number[] }
const dirOf = (c: Cam) => {
  const d = c.position.map((v, i) => v - c.target[i])
  const n = Math.hypot(...d)
  return d.map((v) => +(v / n).toFixed(4))
}
const settled = async (page: Page) => {
  let last = ''
  await expect
    .poll(async () => {
      const now = JSON.stringify(await viewer(page, 'camera'))
      const same = now === last
      last = now
      return same
    })
    .toBe(true)
}

test('Duplex: 층별 칩은 위층부터 쌓이고 누르면 그 층만 보며, 휠 클릭은 각도를 둔 채 그 자리를 회전 중심으로, ` 는 성능 표를 켠다', async ({ page }) => {
  test.skip(!existsSync(DUPLEX), `${DUPLEX} 이 없다(npm run fetch:sample)`)
  test.setTimeout(120_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.setViewportSize({ width: 1500, height: 900 })
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(DUPLEX)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 90_000 })

  // 층별 칩: Duplex 는 Level 1 · Level 2 · Roof. 위층이 위다.
  const chips = page.getByTestId('storey-chips').getByRole('button')
  await expect(chips).toHaveCount(3)
  await expect(chips.locator('.sc-name')).toHaveText(['Roof', 'Level 2', 'Level 1'])
  const storey = page.getByRole('combobox', { name: '보일 층' })
  await chips.filter({ hasText: 'Level 2' }).click()
  await expect(storey.locator('option:checked')).toHaveText('Level 2만')
  await expect(chips.filter({ hasText: 'Level 2' })).toHaveAttribute('aria-pressed', 'true')
  await chips.filter({ hasText: 'Level 2' }).click()
  await expect(storey.locator('option:checked')).not.toHaveText('Level 2만')
  await page.screenshot({ path: test.info().outputPath('storey-chips.png') })

  // 휠 클릭: 시점 방향은 그대로, 대상(회전 중심)이 누른 자리로 옮겨 가고 고리가 잠깐 뜬다.
  await settled(page)
  const before = await viewer<Cam>(page, 'camera')
  const c = (await page.locator('.canvas-wrap > canvas').first().boundingBox())!
  await page.mouse.move(c.x + c.width * 0.3, c.y + c.height * 0.6)
  await page.mouse.down({ button: 'middle' })
  await page.mouse.up({ button: 'middle' })
  await expect.poll(() => viewer(page, 'pivot')).not.toBeNull()
  await settled(page)
  const after = await viewer<Cam>(page, 'camera')
  expect(after.target).not.toEqual(before.target)
  expect(dirOf(after)).toEqual(dirOf(before))

  // 성능 표.
  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('Backquote')
  const hud = page.getByTestId('perf-hud')
  await expect(hud).toBeVisible()
  await expect(hud).toContainText('draw call')
  await expect(hud.locator('dd').nth(3)).not.toHaveText('0')
  await page.keyboard.press('Backquote')
  await expect(hud).toHaveCount(0)
  expect(errors).toEqual([])
})

test.use({ contextOptions: { reducedMotion: 'no-preference' } })
test('리플레이 장면 머리말은 "01 / 02" 번호·갈래, 제목 아래 바꾼 출력 한 줄을 보이고, 다시 한 순간 반영 토스트가 뜬다', async ({ page }) => {
  test.setTimeout(120_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(MEP)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  await page.keyboard.press('e')
  const row = page.locator('.equipment tbody tr', { hasText: 'AHU-1' }).last()
  await row.getByRole('button', { name: 'AHU-1', exact: true }).click()
  await page.keyboard.press('Shift+ArrowRight')
  await page.waitForTimeout(1800)
  await page.keyboard.press('Shift+ArrowUp')
  await page.waitForTimeout(1800)
  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('p')
  const kicker = page.getByTestId('scene-kicker')
  await expect(kicker).toContainText('01/ 02', { timeout: 20_000 })
  await expect(kicker).toContainText('설비 배치')
  // 같은 방 안에서 옮겨 TTL 은 그대로이고 GeoJSON 좌표만 바뀐다.
  await expect(page.locator('.scene-sub')).toHaveText('GeoJSON 1')
  await expect(page.getByTestId('replay-toast')).toContainText('반영', { timeout: 10_000 })
  await page.screenshot({ path: test.info().outputPath('replay-kicker.png') })
  expect(errors).toEqual([])
})
