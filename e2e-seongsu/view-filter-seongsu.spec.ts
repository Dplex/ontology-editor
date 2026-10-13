import { existsSync } from 'node:fs'
import { basename } from 'node:path'
import { expect, test, type Page } from '@playwright/test'

// 성수 건축+기계에서 보기 필터·격리·분해도가 화면을 멈추지 않는지 잰다(ADR-0062). 걸린 시간(다음 두 프레임까지)과
// 그동안 가장 긴 프레임 간격을 콘솔에 찍는다. 기준: 한 동작 1.5초 안, 프레임 멈춤 1초 안.
const ARCH = process.env.SEONGSU_ARCH ?? 'data/성수/Factorial_건축.ifc'
const MECH = process.env.SEONGSU_MECH ?? 'data/성수/Factorial_기계.ifc'
const escape = (t: string) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

async function measure(page: Page, label: string, fn: () => Promise<unknown>) {
  await page.evaluate(() => {
    const w = window as any
    w.__gaps = []
    let last = performance.now()
    const tick = () => {
      const now = performance.now()
      w.__gaps.push(now - last)
      last = now
      w.__raf = requestAnimationFrame(tick)
    }
    tick()
  })
  const t = Date.now()
  await fn()
  await page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))))
  const ms = Date.now() - t
  await page.waitForTimeout(600)
  const gap = await page.evaluate(() => {
    const w = window as any
    cancelAnimationFrame(w.__raf)
    return Math.round(Math.max(...(w.__gaps as number[])))
  })
  console.log(`MEASURE ${label}: ${ms}ms · 가장 긴 프레임 ${gap}ms`)
  return { ms, gap }
}

test('성수: 덕트·배관 빼기 · 격리 · 분해도 · 모두 보이기가 1.5초 안이고 화면이 1초 넘게 멈추지 않는다', async ({ page }) => {
  test.skip(!existsSync(ARCH) || !existsSync(MECH), '성수 파일이 없다')
  const viewer = <T,>(fn: string, ...args: unknown[]) =>
    page.evaluate(([f, a]) => (window as any).__viewer[f as string](...(a as unknown[])), [fn, args] as const) as Promise<T>
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles([MECH, ARCH])
  await expect(page.locator('.appbar h2')).toHaveText(new RegExp(`${escape(basename(ARCH))} \\+ ${escape(basename(MECH))}`), { timeout: 600_000 })
  await expect(page.locator('.progress-toast')).toHaveCount(0, { timeout: 600_000 })
  await page.getByRole('combobox', { name: '보일 층' }).selectOption({ label: '모든 층' })
  await page.waitForTimeout(1500)
  await page.getByTestId('filter-toggle').click()
  const panel = page.getByTestId('filter-panel')
  const results: Record<string, { ms: number; gap: number }> = {}
  results.open = await measure(page, '패널 열기(항목 세기)', async () => {
    await page.getByTestId('filter-toggle').click()
    await page.getByTestId('filter-toggle').click()
    await expect(panel).toContainText('fso:Segment')
  })
  results.conduits = await measure(page, '덕트·배관 빼기', async () => {
    await panel.getByRole('button', { name: '덕트·배관 빼기' }).click()
    await expect(page.getByTestId('filter-summary')).toBeVisible()
  })
  const shown = await viewer<{ hidden: number; parts: number }>('shown')
  console.log(`MEASURE 숨김 ${shown.hidden} / 설비 ${shown.parts}`)
  results.explode = await measure(page, '분해도 펼치기', async () => {
    await panel.getByTestId('explode-toggle').click()
    await expect.poll(async () => (await viewer<{ labels: number }>('shown')).labels).toBeGreaterThan(1)
  })
  await page.screenshot({ path: test.info().outputPath('seongsu-explode.png') })
  const labels = (await viewer<{ labels: number; exploded: number }>('shown'))
  console.log(`MEASURE 분해도 켜 ${labels.labels} · 띄운 기기 ${labels.exploded}`)
  results.collapse = await measure(page, '분해도 접기', async () => {
    await panel.getByTestId('explode-toggle').click()
    await expect.poll(async () => (await viewer<{ exploded: number }>('shown')).exploded).toBe(0)
  })
  results.clear = await measure(page, '모두 보이기', async () => {
    await panel.getByRole('button', { name: '모두 보이기' }).click()
    await expect.poll(async () => (await viewer<{ hidden: number }>('shown')).hidden).toBe(0)
  })
  for (const [k, r] of Object.entries(results)) {
    expect(r.ms, k).toBeLessThan(1500)
    expect(r.gap, k).toBeLessThan(1000)
  }
})
