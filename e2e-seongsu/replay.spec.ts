import { existsSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'

// 편집 리플레이(PoC)를 성수 건축+기계로 잰다. 3D 에서 되감고(되돌리기) 하나씩 다시 하는(다시 하기) 동안 화면이 멈추지 않는지.
// 계통 확정처럼 연결 수백 개가 한꺼번에 바뀌는 편집이 섞인다. 잰 값은 콘솔에 찍고(결과 표는 seongsu.spec.ts 의 몫),
// REPLAY_SHOTS 가 있으면 장면마다 스크린숏을 남긴다. 움직임(미끄러짐·카메라)을 켜고 돈다.
//   npx playwright test -c playwright.seongsu.config.ts e2e-seongsu/replay.spec.ts
const ARCH = process.env.SEONGSU_ARCH ?? 'data/성수/Factorial_건축.ifc'
const MECH = process.env.SEONGSU_MECH ?? 'data/성수/Factorial_기계.ifc'
const DEVICE_A = process.env.SEONGSU_DEVICE_A ?? 'FCU3:FCU3:958283'
const DEVICE_B = process.env.SEONGSU_DEVICE_B ?? 'FCU3:FCU3:958291'
const SHOTS = process.env.REPLAY_SHOTS

test.use({
  contextOptions: { reducedMotion: 'no-preference' },
  // REPLAY_VIDEO 가 있으면 화면을 녹화한다(test-results 아래 webm). 리플레이가 어떻게 보이는지 공유할 때 쓴다.
  video: process.env.REPLAY_VIDEO ? { mode: 'on', size: { width: 1600, height: 1000 } } : 'off',
})
test.skip(!existsSync(ARCH) || !existsSync(MECH), `성수 파일이 없다(${ARCH}, ${MECH})`)

const settle = (page: Page) => page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))))
const search = (page: Page) => page.getByPlaceholder(/물리존·설비 이름이나 종류|설비 이름·종류나 소속 방/)

async function pickDevice(page: Page, name: string) {
  await search(page).fill(name)
  const head = page.locator('.fold-head', { hasText: /설비 목록|설비 위치와 소속/ }).first()
  if ((await head.getAttribute('aria-expanded')) !== 'true') await head.click()
  await page.locator('.equipment tbody tr').filter({ hasText: name }).first().locator('button').first().click()
  await search(page).fill('')
  await search(page).press('Escape')
  await page.locator('.viewport canvas').scrollIntoViewIfNeeded()
  await settle(page)
  await expect(page.locator('.picked h3')).toHaveText(name)
}

/** 프레임 간격을 모은다. 멈춘 가장 긴 시간과 평균 프레임을 본다. */
const startGaps = (page: Page) =>
  page.evaluate(() => {
    const w = window as any
    w.__gaps = []
    let last = performance.now()
    const tick = () => {
      const now = performance.now()
      w.__gaps.push(now - last)
      last = now
      w.__raf = requestAnimationFrame(tick)
    }
    w.__raf = requestAnimationFrame(tick)
  })
const stopGaps = (page: Page) =>
  page.evaluate(() => {
    const w = window as any
    cancelAnimationFrame(w.__raf)
    const g: number[] = w.__gaps.slice(1)
    const sorted = [...g].sort((a, b) => a - b)
    return { max: Math.round(Math.max(...g)), p95: Math.round(sorted[Math.floor(sorted.length * 0.95)]), mean: Math.round((g.reduce((a, b) => a + b, 0) / g.length) * 10) / 10 }
  })

test('성수: 편집 다섯 번(옮기기·계통 확정)을 3D 에서 리플레이하는 동안 화면이 멈추지 않는다', async ({ page }) => {
  test.setTimeout(900_000)
  const opened = Date.now()
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.evaluate(() => localStorage.setItem('oe-mode', 'view'))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles([MECH, ARCH])
  await expect(page.locator('.appbar h2')).toContainText('+', { timeout: 600_000 })
  await expect(page.locator('.progress-toast')).toHaveCount(0, { timeout: 600_000 })
  await page.getByRole('button', { name: '편집', exact: true }).click()

  // FCU 는 천장 설비라 천장 편집 모드(T)에서만 옮긴다(OE-OBJ-08).
  await page.keyboard.press('t')
  await pickDevice(page, DEVICE_A)
  await page.keyboard.press('Shift+ArrowRight')
  // 붙은 배관이 따라와 "바뀐 것" 은 여럿이다.
  await expect(page.locator('.edit-bar .state')).not.toContainText('바뀐 것 0건')
  await page.waitForTimeout(1500)
  await page.keyboard.press('Shift+ArrowUp')
  await page.waitForTimeout(1500)
  await pickDevice(page, DEVICE_B)
  await page.keyboard.press('Shift+ArrowLeft')
  await page.waitForTimeout(1500)
  // 고른 설비 계통의 규칙 방향 확정 — 연결 수백 개가 한 편집이다.
  await page.keyboard.press('c')
  await page.waitForTimeout(1500)
  await pickDevice(page, DEVICE_A)
  await page.keyboard.press('Shift+ArrowDown')
  await page.waitForTimeout(800)

  // 리플레이 내내(되감기·장면·요약) 프레임을 잰다.
  await startGaps(page)
  const t0 = Date.now()
  console.log(`  리플레이 시작: 녹화 ${((t0 - opened) / 1000).toFixed(1)}초 지점`)
  await page.locator('.edit-bar').click({ position: { x: 2, y: 2 } })
  await page.keyboard.press('p')
  const hud = page.locator('.replay-hud')
  await expect(hud).toBeVisible()
  const total = Number(await hud.getAttribute('data-total'))
  expect(total).toBeGreaterThanOrEqual(4)
  await expect(hud).toHaveAttribute('data-at', '0', { timeout: 60_000 })
  const rewindMs = Date.now() - t0
  await expect(hud).toHaveAttribute('data-ready', String(total), { timeout: 60_000 })
  for (let i = 1; i <= total; i++) {
    await expect(hud).toHaveAttribute('data-at', String(i), { timeout: 60_000 })
    await page.waitForTimeout(1400)
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/seongsu3d-${i}.png` })
  }
  await expect(hud).toHaveAttribute('data-phase', 'done', { timeout: 60_000 })
  const allMs = Date.now() - t0
  const gaps = await stopGaps(page)
  console.log(`  편집 ${total}건 · 되감기 ${rewindMs}ms · 끝까지 ${allMs}ms · 프레임 평균 ${gaps.mean}ms · p95 ${gaps.p95}ms · 가장 긴 ${gaps.max}ms`)
  await page.waitForTimeout(1000)
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/seongsu3d-end.png` })
  await page.keyboard.press('Escape')
  await page.keyboard.press('Enter')
  await expect(hud).toHaveCount(0)
  await expect(page.locator('.edit-bar .state')).not.toContainText('바뀐 것 0건')
  expect(gaps.max, '리플레이 중 화면이 1초 넘게 멈췄다').toBeLessThan(1000)
  expect(errors).toEqual([])
})
