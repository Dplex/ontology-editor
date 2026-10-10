// [임시 — 리플레이 데모] 뺄 때 지울 곳은 src/lib/replay-demo.ts 맨 위.
import { expect, test, type Page } from '@playwright/test'

// 리플레이 데모. [데모] 를 누르면 미리 정한 편집 스무 개 남짓(공간·벽·문·창·설비·연결·종류·계통·천장)이 이력에 심기고 바로
// 리플레이가 열린다. 다시 누르면 앞 데모의 편집은 되돌리고 심어서 겹쳐 쌓이지 않는다.
const MEP = 'src/lib/ifc/fixtures/mep.ifc'
test.use({ contextOptions: { reducedMotion: 'no-preference' } })

async function open(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(MEP)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  return errors
}

async function demo(page: Page) {
  await page.locator('.demo-button').click()
  const hud = page.locator('.replay-hud')
  await expect(hud).toBeVisible()
  await hud.getByRole('button', { name: '2×' }).click()
  return hud
}

test('데모를 누르면 편집이 심기고 리플레이가 끝까지 돌며, 다시 누르면 앞 데모는 빠진다', async ({ page }) => {
  test.setTimeout(300_000)
  const errors = await open(page)
  const hud = await demo(page)
  const total = Number(await hud.getAttribute('data-total'))
  // replay-demo.test.ts 와 같은 모델이다(mep.ifc, 18건 이상).
  expect(total).toBeGreaterThanOrEqual(18)
  // 층이 하나뿐인 파일이라 장면 내내 그 층이 왼쪽 위에 보이고, 층이 바뀌지 않으니 화면이 검게 잠기는 장면 전환이 없다.
  await expect(hud.locator('.bug-storey')).toContainText('1F', { timeout: 30_000 })
  await expect(hud).toHaveAttribute('data-at', '2', { timeout: 30_000 })
  await expect(hud.locator('.swipe')).toHaveCount(0)
  await expect(hud).toHaveAttribute('data-phase', 'done', { timeout: 200_000 })
  const chips = await hud.locator('.hud-done').innerText()
  for (const c of ['물리존', '벽·문·창', '설비 배치', '연결', '설비 종류', '계통']) expect(chips, c).toContain(c)
  await page.keyboard.press('Escape')
  await expect(hud).toHaveCount(0)
  await expect(page.locator('.edit-bar')).toBeVisible()
  // 다시 누르면 앞 데모를 되돌리고 심는다 — 장면 수가 같다.
  const again = await demo(page)
  await expect(again).toHaveAttribute('data-total', String(total))
  await page.keyboard.press('Escape')
  expect(errors).toEqual([])
})

test('손으로 한 편집 뒤에 데모를 심으면 손 편집은 남고 리플레이에 같이 나온다', async ({ page }) => {
  test.setTimeout(120_000)
  const errors = await open(page)
  await page.keyboard.press('e')
  await page.locator('.equipment tbody tr', { hasText: 'AHU-1' }).last().getByRole('button', { name: 'AHU-1', exact: true }).click()
  await page.locator('.viewport canvas').scrollIntoViewIfNeeded()
  await page.keyboard.press('Shift+ArrowRight')
  await page.waitForTimeout(1500)
  const hud = await demo(page)
  const total = Number(await hud.getAttribute('data-total'))
  await page.keyboard.press('Escape')
  // 데모를 다시 눌러도 손 편집은 그대로다(데모 몫만 바뀐다).
  const again = await demo(page)
  await expect(again).toHaveAttribute('data-total', String(total))
  await page.keyboard.press('Escape')
  await page.locator('body').click({ position: { x: 5, y: 5 } })
  for (let i = 0; i < total; i++) await page.keyboard.press('Control+z')
  await expect(page.locator('.edit-bar .undo')).toBeDisabled()
  expect(errors).toEqual([])
})

test('층이 둘 이상이면 왼쪽 층 레일에 층마다 장면 점이 찍히고, 지금 층이 밝으며, 층을 누르면 그 층의 첫 장면을 반복한다', async ({ page }) => {
  test.setTimeout(300_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles('src/lib/ifc/fixtures/two-rooms.ifc')
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  const hud = await demo(page)
  const total = Number(await hud.getAttribute('data-total'))
  await expect(hud).toHaveAttribute('data-ready', String(total), { timeout: 30_000 })
  const rows = hud.locator('.rail-row')
  await expect(rows).toHaveCount(2)
  // 층마다 찍힌 점의 합은 층이 있는 장면 수 이상이다(두 층을 같이 고친 장면은 두 층에 찍힌다).
  const dots = await hud.locator('.rail-dots i').count()
  expect(dots).toBeGreaterThanOrEqual(2)
  // 장면이 한 층을 보이면 그 층이 밝다.
  await expect(hud.locator('.rail-row.here')).toHaveCount(1, { timeout: 30_000 })
  // 아래층(레일의 아래 줄)을 누르면 그 층의 첫 장면을 반복한다.
  const lower = rows.last()
  await lower.click()
  await expect(hud).not.toHaveAttribute('data-loop', '')
  await expect(hud.locator('.hud-bar .status')).toContainText('반복 중')
  await page.keyboard.press('Escape')
  expect(errors).toEqual([])
})

test('끝 화면에서 갈래를 누르면 그 갈래 장면만 처음부터 틀고, 다른 갈래 편집은 연출 없이 지나간다', async ({ page }) => {
  test.setTimeout(300_000)
  const errors = await open(page)
  const hud = await demo(page)
  await hud.getByRole('button', { name: '4×' }).click()
  await expect(hud).toHaveAttribute('data-phase', 'done', { timeout: 200_000 })
  const total = Number(await hud.getAttribute('data-total'))
  // 장면 제목에 뜬 갈래를 모은다.
  await page.evaluate(() => {
    const w = window as any
    w.__cats = new Set<string>()
    w.__catTimer = setInterval(() => {
      const t = document.querySelector('.replay-hud .scene-kicker span')?.textContent
      if (t) w.__cats.add(t.trim())
    }, 50)
  })
  await hud.locator('.hud-done .sum-row', { hasText: '계통' }).click()
  await expect(hud.locator('.hud-bar .status')).toContainText('계통만')
  await expect(hud).toHaveAttribute('data-phase', 'done', { timeout: 120_000 })
  await expect(hud).toHaveAttribute('data-at', String(total))
  const cats = await page.evaluate(() => { const w = window as any; clearInterval(w.__catTimer); return [...w.__cats] })
  expect(cats).toEqual(['계통'])
  // 다시 누르면 거르기를 풀고 처음부터 모두.
  await hud.locator('.hud-done .sum-row', { hasText: '계통' }).click()
  await expect(hud.locator('.hud-bar .status')).not.toContainText('계통만')
  await page.keyboard.press('Escape')
  expect(errors).toEqual([])
})

test('끝 화면에서 D 를 누르면 변경 지도(더함·고침·지움 수)가 켜지고, 다시 누르거나 처음부터 틀면 걷힌다', async ({ page }) => {
  test.setTimeout(300_000)
  const errors = await open(page)
  const hud = await demo(page)
  await hud.getByRole('button', { name: '4×' }).click()
  await expect(hud).toHaveAttribute('data-phase', 'done', { timeout: 200_000 })
  await page.keyboard.press('d')
  const legend = hud.locator('.diff-legend')
  await expect(legend).toBeVisible()
  // 데모는 설비를 더하고(더함) 방 이름·경계를 고친다(고침).
  const n = async (label: string) => Number(((await legend.locator('span', { hasText: label }).innerText()).match(/\d+/) ?? ['0'])[0])
  expect(await n('더함')).toBeGreaterThanOrEqual(1)
  expect(await n('고침')).toBeGreaterThanOrEqual(1)
  await page.keyboard.press('d')
  await expect(legend).toHaveCount(0)
  // 요약판 버튼으로 켜고, 처음부터 틀면 걷힌다.
  await hud.getByRole('button', { name: /변경 지도/ }).click()
  await expect(legend).toBeVisible()
  await page.keyboard.press('Home')
  await expect(legend).toHaveCount(0)
  await page.keyboard.press('Escape')
  expect(errors).toEqual([])
})

test('관계가 바뀐 장면의 카드에는 그 변화가 DT 질의의 답을 어떻게 바꾸는지 한 줄이 보인다', async ({ page }) => {
  test.setTimeout(300_000)
  const errors = await open(page)
  const hud = await demo(page)
  await hud.getByRole('button', { name: '4×' }).click()
  await expect(hud).toHaveAttribute('data-phase', 'done', { timeout: 200_000 })
  const total = Number(await hud.getAttribute('data-total'))
  const seen: string[] = []
  for (let k = 0; k < total && seen.length < 2; k++) {
    await hud.locator('.track .tick').nth(k).click()
    await expect(hud).toHaveAttribute('data-loop', String(k))
    const q = hud.locator('.card.looping .line.query')
    if (await q.count()) {
      await expect(q.first()).toBeVisible()
      seen.push(await q.first().innerText())
    }
  }
  // 데모는 방을 나누고(층의 구성) 설비를 잇는다(공급) — 둘 다 질의 영향이 있다.
  expect(seen.length).toBeGreaterThanOrEqual(2)
  expect(seen.join('\n')).toMatch(/의 구성에|공급하는 것에|안의 설비/)
  await page.keyboard.press('Escape')
  expect(errors).toEqual([])
})

test('옮긴 문·벽은 순간이동하지 않고 미끄러지며, 룸·커스텀존 장면은 그 자리로 가 울타리를 세운다', async ({ page }) => {
  test.setTimeout(300_000)
  const errors = await open(page)
  const hud = await demo(page)
  const total = Number(await hud.getAttribute('data-total'))
  await expect(hud).toHaveAttribute('data-ready', String(total), { timeout: 30_000 })
  // 오프닝이 끝난 뒤(오프닝 중의 장면 누르기는 받지 않는다).
  await expect(hud).toHaveAttribute('data-phase', 'play', { timeout: 30_000 })
  // 룸 만들기 장면을 반복해 그 자리를 비추는지(울타리·이름표 = 빛기둥 무리) 본다.
  const room = await hud.locator('.track .tick').evaluateAll((els) => els.findIndex((e) => /룸 만들기/.test(e.getAttribute('title') ?? '')))
  expect(room).toBeGreaterThanOrEqual(0)
  await hud.locator('.track .tick').nth(room).click()
  await expect.poll(() => page.evaluate(() => (window as any).__viewer.motion().spots), { timeout: 15_000 }).toBeGreaterThan(0)
  // 끝까지 틀면 옮긴 문·벽이 미끄러졌다.
  await page.keyboard.press('Space')
  await hud.getByRole('button', { name: '4×' }).click()
  await expect(hud).toHaveAttribute('data-phase', 'done', { timeout: 200_000 })
  expect(await page.evaluate(() => (window as any).__viewer.motion().slid)).toBeGreaterThanOrEqual(1)
  await page.keyboard.press('Escape')
  expect(errors).toEqual([])
})

test('옮기는 장면은 도착 자리에 유령 상자를 먼저 띄우고 도착하면 걷으며, 설비 수가 바뀐 방에는 소속 카드가 뜬다', async ({ page }) => {
  test.setTimeout(300_000)
  const errors = await open(page)
  const hud = await demo(page)
  await hud.getByRole('button', { name: '4×' }).click()
  // 데모는 문·설비를 옮기고(유령), 방을 나누고 설비를 더한다(소속 카드).
  await expect.poll(() => page.evaluate(() => (window as any).__viewer.motion().ghosts), { timeout: 200_000 }).toBeGreaterThan(0)
  await expect(hud).toHaveAttribute('data-phase', 'done', { timeout: 200_000 })
  const m = await page.evaluate(() => (window as any).__viewer.motion())
  expect(m.ghosted).toBeGreaterThanOrEqual(2)
  expect(m.carded).toBeGreaterThanOrEqual(2)
  // 다 도착했으니 남은 유령이 없다.
  await expect.poll(() => page.evaluate(() => (window as any).__viewer.motion().ghosts), { timeout: 10_000 }).toBe(0)
  await page.keyboard.press('Escape')
  expect(errors).toEqual([])
})

test('끝 화면에서 S 를 누르면 바뀐 양이 큰 장면 몇 개만 처음부터 틀고, 다시 누르면 모두', async ({ page }) => {
  test.setTimeout(300_000)
  const errors = await open(page)
  const hud = await demo(page)
  await hud.getByRole('button', { name: '4×' }).click()
  await expect(hud).toHaveAttribute('data-phase', 'done', { timeout: 200_000 })
  const total = Number(await hud.getAttribute('data-total'))
  const button = hud.locator('.hud-done .report.highlight')
  const n = Number(((await button.innerText()).match(/(\d+)장면/) ?? ['', '0'])[1])
  expect(n).toBeGreaterThanOrEqual(4)
  expect(n).toBeLessThanOrEqual(6)
  // 장면 제목에 뜬 번호를 모은다.
  await page.evaluate(() => {
    const w = window as any
    w.__scenes = new Set<string>()
    w.__sceneTimer = setInterval(() => {
      const t = document.querySelector('.replay-hud .scene-kicker b')?.textContent
      if (t) w.__scenes.add(t.trim())
    }, 50)
  })
  await page.keyboard.press('s')
  await expect(hud.locator('.hud-bar .status')).toContainText(`요약 ${n}장면`)
  await expect(hud.locator('.track .tick.star')).toHaveCount(n)
  await expect(hud).toHaveAttribute('data-phase', 'done', { timeout: 120_000 })
  await expect(hud).toHaveAttribute('data-at', String(total))
  const scenes = await page.evaluate(() => { const w = window as any; clearInterval(w.__sceneTimer); return [...w.__scenes] })
  expect(scenes.length).toBe(n)
  // 다시 누르면 요약을 풀고 처음부터 모두.
  await hud.locator('.hud-done .report.highlight').click()
  await expect(hud.locator('.hud-bar .status')).not.toContainText('요약')
  await expect(hud.locator('.track .tick.star')).toHaveCount(0)
  await page.keyboard.press('Escape')
  expect(errors).toEqual([])
})

test('층이 둘 이상이고 아래층을 고쳤으면 끝 화면에서 그 위층을 들어 올려 펼치고, E 로 접고 편다', async ({ page }) => {
  test.setTimeout(300_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles('src/lib/ifc/fixtures/two-rooms.ifc')
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  const hud = await demo(page)
  await hud.getByRole('button', { name: '4×' }).click()
  await expect(hud).toHaveAttribute('data-phase', 'done', { timeout: 200_000 })
  const button = hud.locator('.hud-done .report.spread')
  await expect(button).toHaveClass(/on/)
  const lift = () => page.evaluate(() => (window as any).__viewer.motion().lift as number)
  // 다이오라마의 층 띄우기(1.5~6m)보다 크게 뜬다.
  await expect.poll(lift, { timeout: 10_000 }).toBeGreaterThan(6)
  const spread = await lift()
  await page.keyboard.press('e')
  await expect(button).not.toHaveClass(/on/)
  await expect.poll(lift, { timeout: 10_000 }).toBeLessThan(spread - 3)
  await button.click()
  await expect.poll(lift, { timeout: 10_000 }).toBeGreaterThan(spread - 0.5)
  // 장면으로 돌아가면 접는다.
  await page.keyboard.press('Home')
  await expect.poll(() => page.evaluate(() => (window as any).__viewer.motion().spread), { timeout: 10_000 }).toBe(false)
  await page.keyboard.press('Escape')
  expect(errors).toEqual([])
})
