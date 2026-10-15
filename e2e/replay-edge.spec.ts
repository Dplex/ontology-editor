import { expect, test, type Page } from '@playwright/test'

// 편집 리플레이의 조작이 서로 겹칠 때. 각 조작은 이력을 되돌리거나 다시 해서 상태를 옮기는데, 하나가 아직 끝나지 않았을 때 다른
// 것이 끼면 이력이 한 칸 어긋날 수 있다. 어긋나면 닫았을 때 편집한 상태가 아니게 된다 — 그래서 끝에 늘 닫고 다시 견준다.
test.use({ contextOptions: { reducedMotion: 'no-preference' } })

/** mep.ifc 를 열고 편집 셋(AHU-1 두 번 옮기기 · 사무실 꼭짓점 지우기)을 한 뒤 P 로 리플레이를 연다. */
async function openReplay(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles('src/lib/ifc/fixtures/mep.ifc')
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  await page.keyboard.press('e')
  await page.locator('.equipment tbody tr', { hasText: 'AHU-1' }).last().getByRole('button', { name: 'AHU-1', exact: true }).click()
  await page.locator('.canvas-wrap > canvas').scrollIntoViewIfNeeded()
  // 묶이지 않게 간격을 두고 두 번(되돌리기 두 단계).
  await page.keyboard.press('Shift+ArrowRight')
  await page.waitForTimeout(1800)
  await page.keyboard.press('Shift+ArrowUp')
  await page.waitForTimeout(1800)
  // 물리존 꼭짓점 하나 지우기(사무실 80㎡ → 40㎡). mep.ifc 의 사무실은 (0,0)(10,0)(10,8)(0,8) 이다.
  const floor = await page.evaluate(() => (window as any).__viewer.point([9.6, 7.6, 0.1]))
  await page.mouse.click(floor.x, floor.y)
  await expect(page.locator('.space-picked')).toContainText('80.0')
  await page.keyboard.press(']')
  await page.keyboard.press('Delete')
  await expect(page.locator('.space-picked')).toContainText('40.0')
  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('p')
  const hud = page.locator('.replay-hud')
  await expect(hud).toBeVisible()
  return { hud, errors }
}
async function drag(page: Page, hud: ReturnType<Page['locator']>, from: number, to: number) {
  const t = (await hud.locator('.track').boundingBox())!
  const y = t.y + t.height / 2
  await page.mouse.move(t.x + t.width * from, y)
  await page.mouse.down()
  await page.mouse.move(t.x + t.width * to, y, { steps: 6 })
  await page.mouse.up()
}
async function ttl(page: Page) {
  const [d] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '의미 내보내기 (Brick TTL)' }).click()])
  return (await import('node:fs')).readFileSync((await d.path())!, 'utf8')
}

test('B 를 누른 채 시간줄을 끌어도, 떼면 끈 자리 그대로다', async ({ page }) => {
  test.setTimeout(300_000)
  const { hud, errors } = await openReplay(page)
  await hud.getByRole('button', { name: '4×' }).click()
  await expect(hud).toHaveAttribute('data-phase', 'done', { timeout: 200_000 })
  await page.keyboard.press('Escape')
  await page.keyboard.press('Enter')
  const edited = await ttl(page)
  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('p')
  await expect(hud).toHaveAttribute('data-phase', 'play', { timeout: 30_000 })
  await page.keyboard.press('Space') // 멈춤
  await page.keyboard.down('b')
  await drag(page, hud, 0.6, 0.0)
  await page.keyboard.up('b')
  await page.waitForTimeout(800)
  await expect(hud).toHaveAttribute('data-at', '0')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Enter')
  await expect(hud).toHaveCount(0)
  expect(await ttl(page)).toBe(edited)
  expect(errors).toEqual([])
})

test('→ 로 넘어가는 중(층을 자르는 동안)에 시간줄을 끌면 끈 자리에 선다', async ({ page }) => {
  test.setTimeout(300_000)
  const { hud, errors } = await openReplay(page)
  await hud.getByRole('button', { name: '4×' }).click()
  await expect(hud).toHaveAttribute('data-phase', 'done', { timeout: 200_000 })
  // 끝 화면은 건물 전체를 본다. ← 하나 뒤 → 는 그 층을 자르며(1초) 들어간다 — 그 사이에 끈다.
  await page.keyboard.press('ArrowLeft')
  await page.waitForTimeout(300)
  await page.keyboard.press('ArrowRight')
  await page.waitForTimeout(100)
  await drag(page, hud, 0.5, 0.0)
  await page.waitForTimeout(2500)
  await expect(hud).toHaveAttribute('data-at', '0')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Enter')
  expect(errors).toEqual([])
})

test('아직 다시 한 편집이 없을 때 B 는 재생을 멈추지 않는다', async ({ page }) => {
  test.setTimeout(120_000)
  const { hud, errors } = await openReplay(page)
  await expect(hud).toHaveAttribute('data-phase', 'play', { timeout: 30_000 })
  await expect(hud).toHaveAttribute('data-at', '0')
  await page.keyboard.down('b')
  await page.keyboard.up('b')
  await expect(hud.locator('.hud-bar .status')).toContainText('재생 중')
  await expect(hud).toHaveAttribute('data-at', '1', { timeout: 30_000 })
  await page.keyboard.press('Escape')
  await page.keyboard.press('Enter')
  expect(errors).toEqual([])
})

test('끌어서 끝에 닿으면 끝 화면처럼 장면 번호 빛기둥이 선다', async ({ page }) => {
  test.setTimeout(300_000)
  const { hud, errors } = await openReplay(page)
  await expect(hud).toHaveAttribute('data-phase', 'play', { timeout: 30_000 })
  await drag(page, hud, 0.0, 1.0)
  await expect(hud).toHaveAttribute('data-phase', 'done', { timeout: 30_000 })
  await expect.poll(() => page.evaluate(() => (window as any).__viewer.motion().spots), { timeout: 10_000 }).toBeGreaterThan(0)
  await page.keyboard.press('Escape')
  await page.keyboard.press('Enter')
  expect(errors).toEqual([])
})

test('녹화를 공유 확인 중에 한 번 더 눌러도 녹화는 하나다', async ({ page }) => {
  test.setTimeout(120_000)
  // 공유 확인 창(사람이 고르는 동안)을 0.8초 걸리는 것으로 흉내 내고 몇 번 불렸는지 센다.
  await page.addInitScript(() => {
    const w = window as any
    w.__gdm = 0
    navigator.mediaDevices.getDisplayMedia = async () => {
      w.__gdm++
      await new Promise((r) => setTimeout(r, 800))
      return (document.querySelector('.canvas-wrap > canvas') as HTMLCanvasElement).captureStream(30)
    }
  })
  const { hud, errors } = await openReplay(page)
  await expect(hud).toHaveAttribute('data-phase', 'play', { timeout: 30_000 })
  const rec = hud.getByRole('button', { name: /녹화/ })
  await rec.click()
  await rec.click()
  await expect(hud.locator('.rec.on')).toBeVisible()
  expect(await page.evaluate(() => (window as any).__gdm)).toBe(1)
  // 다시 누르면 멈추고 내려받는다(하나).
  const d = page.waitForEvent('download')
  await hud.locator('.rec.on').click()
  await d
  await expect(hud.locator('.rec.on')).toHaveCount(0)
  await page.keyboard.press('Escape')
  await page.keyboard.press('Enter')
  expect(errors).toEqual([])
})

test('화면 공유를 못 쓰는 주소(55 의 http://IP)에서는 3D 캔버스만 녹화하고 그 까닭을 HUD 에 띄운다', async ({ page }) => {
  test.setTimeout(120_000)
  // https·localhost 가 아니면 브라우저가 getDisplayMedia 를 주지 않는다. 그 상태를 흉내 낸다.
  await page.addInitScript(() => {
    Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', { value: undefined })
    Object.defineProperty(window, 'isSecureContext', { value: false })
  })
  const { hud, errors } = await openReplay(page)
  await expect(hud).toHaveAttribute('data-phase', 'play', { timeout: 30_000 })
  await hud.getByRole('button', { name: /녹화/ }).click()
  await expect(hud.locator('.rec.on')).toBeVisible()
  await expect(hud.getByTestId('rec-note')).toContainText('http 주소라')
  const d = page.waitForEvent('download')
  await hud.locator('.rec.on').click()
  const file = await d
  const { size } = (await import('node:fs')).statSync((await file.path())!)
  expect(size).toBeGreaterThan(1000)
  await page.keyboard.press('Escape')
  await page.keyboard.press('Enter')
  await expect(hud).toHaveCount(0)
  expect(errors).toEqual([])
})

test('리플레이 안에서 P 는 닫지 않고, Esc 는 한 번 묻는다 — Esc 로 계속 보고 Enter 로 닫는다', async ({ page }) => {
  test.setTimeout(120_000)
  const { hud, errors } = await openReplay(page)
  await expect(hud).toHaveAttribute('data-phase', 'play', { timeout: 30_000 })
  await page.keyboard.press('p')
  await expect(hud).toBeVisible()
  const ask = hud.locator('.ask-close')
  await page.keyboard.press('Escape')
  await expect(ask).toBeVisible()
  // 묻는 동안 다른 키(Space)는 받지 않는다.
  await page.keyboard.press('Space')
  await expect(ask).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(ask).toHaveCount(0)
  await expect(hud).toBeVisible()
  // 단추로도: 계속 보기 → 남고, 닫기 → 닫힌다.
  await page.keyboard.press('Escape')
  await ask.getByRole('button', { name: /계속 보기/ }).click()
  await expect(ask).toHaveCount(0)
  await page.keyboard.press('Escape')
  await page.keyboard.press('Enter')
  await expect(hud).toHaveCount(0)
  expect(errors).toEqual([])
})

test('판 모양은 T 나 조작 막대의 단추로 도면·중계를 바꾸고, 닫았다 다시 열어도 기억한다', async ({ page }) => {
  test.setTimeout(120_000)
  const { hud, errors } = await openReplay(page)
  await expect(hud).toHaveAttribute('data-theme', 'plan')
  await page.keyboard.press('t')
  await expect(hud).toHaveAttribute('data-theme', 'show')
  await expect(hud.locator('.themes button', { hasText: '중계' })).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Enter')
  await expect(hud).toHaveCount(0)
  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('p')
  await expect(hud).toHaveAttribute('data-theme', 'show')
  await hud.locator('.themes button', { hasText: '도면' }).click()
  await expect(hud).toHaveAttribute('data-theme', 'plan')
  await page.keyboard.press('Escape')
  await page.keyboard.press('Enter')
  expect(errors).toEqual([])
})
