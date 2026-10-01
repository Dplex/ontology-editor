import { expect, test } from '@playwright/test'

// 3D 아래 칸의 움직임(lib/motion.ts, Roll, Meter). 다른 e2e 는 값을 재려고 움직임을 끄고(playwright.config.ts) 돌므로
// 여기서만 켠다. 원칙은 "바뀐 것만 움직인다" 다 — 연 직후에는 숫자가 0 에서 올라오고 막대가 차오르며, 그 뒤에는
// 편집으로 바뀐 줄만 번쩍인다.
test.use({ contextOptions: { reducedMotion: 'no-preference' } })
const MEP = 'src/lib/ifc/fixtures/mep.ifc'

test('숫자는 굴러 올라오고 막대는 차오르며, 편집으로 바뀐 줄만 번쩍인다', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(MEP)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })

  // 요약 타일: 화면에 들어오면 0 에서 실제 값까지 굴러간다.
  const tile = page.locator('.tiles li', { hasText: '연결' }).locator('b')
  await tile.scrollIntoViewIfNeeded()
  await expect.poll(async () => Number((await tile.innerText()).replace(/,/g, ''))).toBeGreaterThan(0)

  // 완전성 검사의 통과 막대가 0 에서 차오른다.
  const bar = page.locator('.checks .meter i').first()
  await bar.scrollIntoViewIfNeeded()
  await expect.poll(async () => bar.evaluate((el) => el.getBoundingClientRect().width)).toBeGreaterThan(0)

  // 계통을 확정하면 그 줄만 번쩍이고 "확정함" 이 떠오른다. 다른 줄은 가만히 있다.
  await page.keyboard.press('e')
  await page.getByRole('button', { name: /규칙 방향 확정 \(계통별\)/ }).click()
  const fold = page.locator('.rule-systems')
  const row = fold.locator('tbody tr', { hasText: 'AHU-1 급기 계통' })
  await expect(fold.locator('.meter i').first()).toBeVisible()
  await row.getByRole('button', { name: '확정' }).click()
  await expect(row).toHaveClass(/flash/)
  await expect(row.locator('.confirmed')).toBeVisible()
  await expect(fold.locator('tbody tr.flash')).toHaveCount(1)
  expect(errors).toEqual([])
})

// 3D·패널·도구막대의 움직임. 고르면 카메라가 날아가고, 소속이 바뀐 방이 번쩍이며, 되돌리면 설비가 미끄러져 돌아간다.
test('카메라는 날아가고, 되돌리면 설비가 미끄러지며 돌아간 방이 번쩍이고, 저장한 단추에 ✓ 가 뜬다', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(MEP)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  const motion = () => page.evaluate(() => (window as any).__viewer.motion()) as Promise<{ flying: boolean; gliding: number; pulsing: number; started: { flights: number; glides: number; pulses: number } }>
  const AHU = '0MEP$Equip$AHU1$0000'

  await page.getByRole('button', { name: '편집', exact: true }).click()
  const row = page.locator('.equipment tbody tr', { hasText: 'AHU-1' }).last()
  const flights = (await motion()).started.flights
  await row.getByRole('button', { name: 'AHU-1', exact: true }).click()
  expect((await motion()).started.flights).toBeGreaterThan(flights)
  await expect.poll(async () => (await motion()).flying).toBe(false)
  await expect(page.locator('.picked h3')).toHaveText('AHU-1')

  // 사무실 밖으로 끌어 놓는다(edit-3d.spec.ts 와 같은 자리).
  await page.locator('.viewport canvas').scrollIntoViewIfNeeded()
  const center = await page.evaluate((id) => (window as any).__viewer.center(id), AHU)
  const from = await page.evaluate((id) => (window as any).__viewer.part(id), AHU)
  const to = await page.evaluate((p) => (window as any).__viewer.point(p), [center[0] - 8, center[1], center[2]])
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 12 })
  await page.mouse.up()
  await expect(page.locator('.picked dd', { hasText: '소속 없음' })).toBeVisible()

  // 되돌리면 형상이 미끄러져 돌아가고, 돌아간 방(사무실)이 번쩍이며, 패널의 소속 칸이 번쩍인다.
  const before = (await motion()).started
  await page.keyboard.press('Control+z')
  await expect.poll(async () => (await motion()).started.glides).toBeGreaterThan(before.glides)
  await expect.poll(async () => (await motion()).started.pulses).toBeGreaterThan(before.pulses)
  await expect(page.locator('.picked .facts dd.flash', { hasText: '사무실' })).toBeVisible()
  await expect.poll(async () => (await motion()).gliding).toBe(0)
  await expect.poll(async () => (await motion()).pulsing).toBe(0)

  // 다시 하고 편집 저장: 단추에 ✓ 가 떴다 사라진다.
  await page.keyboard.press('Control+Shift+z')
  await expect(page.locator('.picked dd', { hasText: '소속 없음' })).toBeVisible()
  await page.locator('.edit-bar .save-edits').click()
  await expect(page.locator('.edit-bar .save-edits')).toHaveClass(/done/)
  await expect(page.locator('.edit-bar .save-edits')).not.toHaveClass(/done/, { timeout: 3000 })
  expect(errors).toEqual([])
})
