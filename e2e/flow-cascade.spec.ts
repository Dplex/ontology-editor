import { existsSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'

// 흐름 방향 근거(1 BIM 포트 · 2 규칙 · 3 사람 → TTL brick:feeds)와 연쇄(flow-cascade.ts · viewer.ts 의 playCascade).
// 확정하면 새로 나가는 연결이 원천 쪽부터 강조색 화살표로 차례로 켜졌다가 걷힌다.
const viewer = <T,>(page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(([f, a]) => (window as any).__viewer[f as string](...(a as unknown[])), [fn, args] as const) as Promise<T>
type Motion = { cascading: number; started: { cascades: number } }
const motion = (page: Page) => viewer<Motion>(page, 'motion')
const row = (page: Page, n: number) => page.getByTestId('flow-basis').locator('li').nth(n).locator('b')

test('계통을 확정하면 근거의 규칙 확정 수와 brick:feeds 가 그만큼 늘고, 바뀐 연결이 3D 에 차례로 켜졌다가 걷히며, 되돌리면 숫자가 돌아온다', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('input[type=file]').first().setInputFiles('src/lib/ifc/fixtures/mep.ifc')
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '편집', exact: true }).click()
  await page.locator('.equipment tbody tr', { hasText: 'DUCT-01' }).getByRole('button', { name: 'DUCT-01', exact: true }).click()

  const basis = page.getByTestId('flow-basis')
  await expect(basis).toBeVisible()
  await expect(basis.locator('li')).toHaveCount(4)
  const rule = Number(await row(page, 1).textContent())
  const feeds0 = Number((await row(page, 3).textContent())!.split('/')[0])
  expect(rule).toBeGreaterThan(0)
  await expect(basis.locator('li').nth(1)).toContainText('확정 0')

  const cascades0 = (await motion(page)).started.cascades
  await page.locator('.picked .rule-system').getByTestId('rule-confirm').click()
  await expect(basis.locator('li').nth(1)).toContainText(`확정 ${rule}`)
  await expect.poll(async () => Number((await row(page, 3).textContent())!.split('/')[0])).toBe(feeds0 + rule)
  // 연쇄가 시작되고, 다 퍼진 뒤 걷힌다.
  await expect.poll(async () => (await motion(page)).started.cascades).toBe(cascades0 + 1)
  await page.screenshot({ path: test.info().outputPath('cascade.png') })
  await expect.poll(async () => (await motion(page)).cascading, { timeout: 5000 }).toBe(0)

  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('Control+z')
  await expect(basis.locator('li').nth(1)).toContainText('확정 0')
  await expect.poll(async () => Number((await row(page, 3).textContent())!.split('/')[0])).toBe(feeds0)
  expect(errors).toEqual([])
})

test('리플레이의 흐름 방향 장면(계통 확정)에서도 바뀐 연결이 같은 순서로 켜진다', async ({ page }) => {
  test.setTimeout(90_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('input[type=file]').first().setInputFiles('src/lib/ifc/fixtures/mep.ifc')
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '편집', exact: true }).click()
  await page.locator('.equipment tbody tr', { hasText: 'DUCT-01' }).getByRole('button', { name: 'DUCT-01', exact: true }).click()
  await page.locator('.picked .rule-system').getByTestId('rule-confirm').click()
  await expect.poll(async () => (await motion(page)).started.cascades).toBe(1)
  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('p')
  await expect(page.locator('.replay-hud')).toBeVisible()
  // 리플레이는 처음까지 되돌린 뒤 다시 한다 — 확정 장면에서 연쇄가 한 번 더 켜진다.
  await expect.poll(async () => (await motion(page)).started.cascades, { timeout: 30_000 }).toBeGreaterThan(1)
  expect(errors).toEqual([])
})

const DUPLEX_MEP ='data/NBU_Duplex/NBU_Duplex-Apt_Eng-MEP.ifc'
// 퍼지는 순서를 보려면 움직임을 켠다(이 설정의 기본은 움직임 줄이기라 한꺼번에 뜬다).
test.describe('움직임 켬', () => {
  test.use({ contextOptions: { reducedMotion: 'no-preference' } })
test('Duplex MEP: 계통 하나를 확정하면 바뀐 연결이 여러 물결로 퍼진다(스샷)', async ({ page }) => {
  test.skip(!existsSync(DUPLEX_MEP), `${DUPLEX_MEP} 이 없다(npm run fetch:sample)`)
  test.setTimeout(120_000)
  await page.setViewportSize({ width: 1500, height: 900 })
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(DUPLEX_MEP)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 90_000 })
  await page.getByRole('button', { name: '편집', exact: true }).click()
  // 규칙 방향 계통 표(재검토 · 미확정 · 규칙 방향 많은 순)의 첫 미확정 계통을 골라 근거를 보고 확정한다.
  await page.locator('.rule-systems').getByText('규칙 방향 확정 (계통별)').first().click()
  const row = page.locator('.rule-systems tr', { has: page.getByRole('button', { name: '확정', exact: true }) }).first()
  await expect(row).toBeVisible()
  test.skip(!(await row.count()), '확정할 계통이 없다')
  await row.locator('td.sys button').click()
  const basis = page.locator('.system-picked').getByTestId('flow-basis')
  await expect(basis).toBeVisible()
  await basis.scrollIntoViewIfNeeded()
  await page.screenshot({ path: test.info().outputPath('basis.png') })
  // 고른 계통에 시점을 맞추고 3D 가 화면에 보이게 둔다.
  await page.locator('body').press('f')
  await page.locator('.viewport').scrollIntoViewIfNeeded()
  await page.waitForTimeout(600)
  const c0 = (await motion(page)).started.cascades
  // 확정을 누르기 전에 페이지 안에서 매 프레임 프레임 간격과 켜진 연쇄 화살표 수를 적는다(스샷은 느려서 순서를 잴 수 없다).
  await page.evaluate(() => {
    const w = window as any
    w.__frames = []
    let last = performance.now()
    const tick = (t: number) => {
      w.__frames.push({ gap: t - last, shown: w.__viewer.motion().cascadeShown })
      last = t
      if (w.__frames.length < 240) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  })
  await row.getByRole('button', { name: '확정', exact: true }).click()
  await page.waitForTimeout(250)
  await page.screenshot({ path: test.info().outputPath('cascade-mid.png') })
  await expect.poll(async () => (await motion(page)).started.cascades).toBe(c0 + 1)
  await expect.poll(async () => (await motion(page)).cascading, { timeout: 8000 }).toBe(0)
  const frames = (await page.evaluate(() => (window as any).__frames)) as { gap: number; shown: number }[]
  const gaps = frames.map((f) => f.gap).sort((x, y) => x - y)
  const shown = frames.map((f) => f.shown)
  const peak = Math.max(...shown)
  const steps = new Set(shown.filter((n) => n > 0 && n < peak)).size
  console.log(
    `FRAMES n=${gaps.length} median=${gaps[gaps.length >> 1].toFixed(1)} p95=${gaps[Math.floor(gaps.length * 0.95)].toFixed(1)} max=${gaps.at(-1)!.toFixed(1)} · 연쇄 최대 ${peak}개, 중간 단계 ${steps}개`,
  )
  // 한꺼번에 켜지지 않고 여러 단계를 거쳐 다 켜진다(켜진 수가 줄지 않는다 — 걷기 전까지).
  expect(peak).toBeGreaterThan(0)
  expect(steps).toBeGreaterThan(2)
  const upToPeak = shown.slice(0, shown.indexOf(peak) + 1)
  expect(upToPeak.every((n, i) => i === 0 || n >= upToPeak[i - 1])).toBe(true)
})
})
