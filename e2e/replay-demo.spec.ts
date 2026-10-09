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
