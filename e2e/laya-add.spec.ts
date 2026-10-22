import { expect, test, type Page } from '@playwright/test'
import { countByLabel, enterEdit } from './edit-part'

// [설비 더하기] 에서 이름을 미리 치면 종류 후보가 뜬다(ADR-0057). 사전이 이름을 읽으면 그것이 먼저, 이어서 Laya 의 후보다.
// 사전이 못 읽은 이름에서 Enter 를 치면 Laya 의 순위대로 종류 목록이 열린다. Laya 서버는 page.route 로 흉내 낸다.
// 고르지 않으면 지금처럼 종류 미상으로 놓인다(OE-EQP-13).
const MEP = 'src/lib/ifc/fixtures/mep.ifc'

/** 이름 → Laya 가 돌려줄 종류. 없는 이름은 자신 없는 답이다. */
const ANSWERS: Record<string, { kind: string; p: number }[]> = {
  '천장형 냉난방기': [{ kind: 'indoor_unit', p: 0.9 }, { kind: 'fcu', p: 0.06 }],
  송풍구: [{ kind: 'air_diffuser', p: 0.8 }, { kind: 'air_grille', p: 0.1 }],
}

async function open(page: Page, enabled = true, delay = 0) {
  const errors: string[] = []
  const asked: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.route('**/__laya', (r) => r.fulfill({ json: enabled ? { enabled: true, model: 'test/final' } : { enabled: false, reason: 'LAYA_URL 이 없습니다' } }))
  await page.route('**/__laya/kinds', async (r) => {
    const { states } = r.request().postDataJSON() as { states: string[] }
    asked.push(...states)
    if (delay) await new Promise((ok) => setTimeout(ok, delay))
    const results = states.map((s) => {
      const name = s.split('\n')[0].replace('새 설비 이름: ', '')
      const ranked = ANSWERS[name] ?? [{ kind: 'panel', p: 0.2 }]
      return { ranked, confidence: ranked[0].p }
    })
    await r.fulfill({ json: { results, ms: 9 } })
  })
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(MEP)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  await enterEdit(page)
  await page.locator('.canvas-wrap > canvas').scrollIntoViewIfNeeded()
  await page.waitForTimeout(200)
  return { errors, asked }
}

async function clickFloor(page: Page, x: number, y: number) {
  const at = (await page.evaluate(([px, py]) => (window as any).__viewer.point([px, py, 0]), [x, y])) as { x: number; y: number }
  await page.mouse.click(at.x, at.y)
}

test('이름을 치면 Laya 후보가 뜨고, Enter 로 받아 놓으면 그 이름·종류로 놓인다(출처 편집) [OE-EQP-13#2~]', async ({ page }) => {
  const { errors, asked } = await open(page)
  await page.getByRole('button', { name: '설비 더하기' }).click()
  // 누르면 이름 칸으로 간다.
  const name = page.getByRole('combobox', { name: '새 설비 이름' })
  await expect(name).toBeFocused()
  await name.fill('천장형 냉난방기')
  const chips = page.getByRole('group', { name: '새 설비 종류 후보' })
  await expect(chips.getByRole('button').first()).toContainText('시스템에어컨 실내기')
  await expect(chips.getByRole('button').first()).toContainText('Laya 90%')
  expect(asked).toContain('새 설비 이름: 천장형 냉난방기\n놓는 면: 바닥·벽')
  // 사전이 못 읽은 이름이라 Enter 는 목록을 연다. Laya 가 자신 있으니(90%) 첫 줄을 가리키고, 한 번 더 Enter 면 그 종류다.
  await name.press('Enter')
  const menu = page.getByRole('listbox', { name: '새 설비 종류 목록' })
  await expect(menu.getByRole('option').first()).toContainText('시스템에어컨 실내기')
  await expect(menu.getByRole('option').first()).toHaveAttribute('aria-selected', 'true')
  await page.locator('.add-name').screenshot({ path: 'test-results/laya-add-menu.png' })
  await name.press('Enter')
  await expect(menu).toHaveCount(0)
  await expect(chips.getByRole('button', { name: /시스템에어컨 실내기/ })).toHaveAttribute('aria-pressed', 'true')
  await page.locator('.add-name').screenshot({ path: 'test-results/laya-add.png' })

  await clickFloor(page, 2, 2)
  const picked = page.locator('.picked')
  await expect(picked.locator('h3')).toHaveText('천장형 냉난방기')
  await expect(picked.locator('.kind-edit select')).toHaveValue('indoor_unit')
  await expect(picked.locator('.kind-edit .src.edit')).toBeVisible()
  // 놓고 나면 이름 칸은 비고 후보도 사라진다. 한 번 Ctrl+Z 면 설비가 빠진다.
  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('Control+z')
  await expect.poll(() => countByLabel(page, /천장형 냉난방기/)).toBe(0)
  expect(errors).toEqual([])
})

test('사전이 읽는 이름은 사전 후보가 먼저이고, 고르지 않고 놓으면 종류 미상이다', async ({ page }) => {
  const { errors } = await open(page)
  await page.getByRole('button', { name: '설비 더하기' }).click()
  const name = page.getByRole('combobox', { name: '새 설비 이름' })
  await name.fill('FCU-9')
  const first = page.getByRole('group', { name: '새 설비 종류 후보' }).getByRole('button').first()
  await expect(first).toContainText('FCU')
  await expect(first).toContainText('사전')
  await expect(first).toHaveAttribute('aria-pressed', 'false')
  await clickFloor(page, 2, 2)
  const picked = page.locator('.picked')
  await expect(picked.locator('h3')).toHaveText('FCU-9')
  await expect(picked.locator('.kind-edit select')).toHaveValue('')
  expect(errors).toEqual([])
})

test('고른 종류가 지금 놓는 면에 맞지 않으면 알린다(디퓨저는 천장)', async ({ page }) => {
  const { errors } = await open(page)
  await page.getByRole('button', { name: '설비 더하기' }).click()
  await page.getByRole('combobox', { name: '새 설비 이름' }).fill('송풍구')
  await page.getByRole('group', { name: '새 설비 종류 후보' }).getByRole('button', { name: /디퓨저/ }).click()
  await expect(page.locator('.add-name')).toContainText('디퓨저는 천장에 놓는 종류입니다')
  expect(errors).toEqual([])
})

test('이름 칸에서 Esc 한 번이면 더하기를 그만두고, 다시 열면 이름·종류가 비어 있다', async ({ page }) => {
  const { errors } = await open(page)
  await page.getByRole('button', { name: '설비 더하기' }).click()
  const name = page.getByRole('combobox', { name: '새 설비 이름' })
  await name.fill('천장형 냉난방기')
  const chip = page.getByRole('group', { name: '새 설비 종류 후보' }).getByRole('button', { name: /시스템에어컨 실내기/ })
  await expect(chip).toBeVisible()
  await name.press('Enter')
  await name.press('Enter')
  await expect(chip).toHaveAttribute('aria-pressed', 'true')
  await name.press('Escape')
  await expect(name).toHaveCount(0)
  await expect(page.getByRole('button', { name: '설비 더하기' })).toBeVisible()
  await page.getByRole('button', { name: '설비 더하기' }).click()
  await expect(page.getByRole('combobox', { name: '새 설비 이름' })).toHaveValue('')
  await expect(page.getByRole('group', { name: '새 설비 종류 후보' })).toHaveCount(0)
  expect(errors).toEqual([])
})

test('Laya 서버가 없으면 사전 후보만 보이고 묻지 않는다', async ({ page }) => {
  const { errors, asked } = await open(page, false)
  await page.getByRole('button', { name: '설비 더하기' }).click()
  const name = page.getByRole('combobox', { name: '새 설비 이름' })
  await name.fill('천장형 냉난방기')
  await page.waitForTimeout(400)
  await expect(page.getByRole('group', { name: '새 설비 종류 후보' })).toHaveCount(0)
  await name.fill('FCU-9')
  await expect(page.getByRole('group', { name: '새 설비 종류 후보' }).getByRole('button')).toHaveCount(1)
  expect(asked).toEqual([])
  expect(errors).toEqual([])
})

test('사전이 읽는 이름은 Enter 가 목록 없이 사전 종류를 받는다', async ({ page }) => {
  const { errors } = await open(page)
  await page.getByRole('button', { name: '설비 더하기' }).click()
  const name = page.getByRole('combobox', { name: '새 설비 이름' })
  await name.fill('FCU-9')
  await name.press('Enter')
  await expect(page.getByRole('listbox', { name: '새 설비 종류 목록' })).toHaveCount(0)
  await expect(page.getByRole('group', { name: '새 설비 종류 후보' }).getByRole('button', { name: /FCU/ })).toHaveAttribute('aria-pressed', 'true')
  expect(errors).toEqual([])
})

test('Laya 가 자신 없으면 목록이 아무 줄도 가리키지 않아 Enter 두 번에 아무것도 붙지 않고, ↓ 로 골라야 붙는다', async ({ page }) => {
  const { errors } = await open(page)
  await page.getByRole('button', { name: '설비 더하기' }).click()
  const name = page.getByRole('combobox', { name: '새 설비 이름' })
  await name.fill('알 수 없는 것')
  await expect(page.getByRole('group', { name: '새 설비 종류 후보' })).toContainText('Laya 20%')
  await name.press('Enter')
  const menu = page.getByRole('listbox', { name: '새 설비 종류 목록' })
  await expect(menu).toContainText('자신 없습니다')
  await expect(menu.locator('[aria-selected=true]')).toHaveCount(0)
  await page.locator('.add-name').screenshot({ path: 'test-results/laya-add-unsure.png' })
  await name.press('Enter')
  await expect(menu).toHaveCount(0)
  await expect(page.getByRole('group', { name: '새 설비 종류 후보' }).locator('[aria-pressed=true]')).toHaveCount(0)
  await name.press('ArrowDown')
  await expect(menu).toBeVisible()
  await name.press('ArrowDown')
  await expect(menu.getByRole('option').first()).toHaveAttribute('aria-selected', 'true')
  await name.press('Enter')
  await expect(page.getByRole('group', { name: '새 설비 종류 후보' }).getByRole('button', { name: /분전반/ })).toHaveAttribute('aria-pressed', 'true')
  expect(errors).toEqual([])
})

test('[전체 보기] 는 Laya 순위를 앞에 둔 채 모든 종류를 펼치고, [미상으로 두기] 는 고른 것을 푼다. Esc 는 목록만 닫는다', async ({ page }) => {
  const { errors } = await open(page)
  await page.getByRole('button', { name: '설비 더하기' }).click()
  const name = page.getByRole('combobox', { name: '새 설비 이름' })
  await name.fill('송풍구')
  await name.press('Enter')
  const menu = page.getByRole('listbox', { name: '새 설비 종류 목록' })
  const options = menu.getByRole('option')
  // Laya 후보 둘 + [전체 보기] + [미상으로 두기]
  await expect(options).toHaveCount(4)
  await options.filter({ hasText: /전체 \d+종 보기/ }).click()
  await expect(options.nth(0)).toContainText('디퓨저')
  await expect(options.nth(1)).toContainText('그릴')
  expect(await options.count()).toBeGreaterThan(30)
  await expect(options.filter({ hasText: /전체 \d+종 보기/ })).toHaveCount(0)
  await menu.getByRole('option', { name: '펌프', exact: true }).click()
  await expect(menu).toHaveCount(0)
  await expect(name).toBeFocused()
  // 칩에 없던 종류라 [목록] 칩으로 앞에 선다.
  const chips = page.getByRole('group', { name: '새 설비 종류 후보' })
  await expect(chips.getByRole('button').first()).toContainText('펌프 목록')
  await expect(chips.getByRole('button').first()).toHaveAttribute('aria-pressed', 'true')

  await name.press('ArrowDown')
  await options.filter({ hasText: '종류 미상으로 두기' }).click()
  await expect(chips.locator('[aria-pressed=true]')).toHaveCount(0)
  await expect(chips).not.toContainText('펌프')

  await name.press('ArrowDown')
  await expect(menu).toBeVisible()
  await name.press('Escape')
  await expect(menu).toHaveCount(0)
  await expect(name).toBeVisible()
  expect(errors).toEqual([])
})

test('Laya 답이 오기 전에 Enter 를 치면 "묻는 중" 을 보이다가, 답이 오면 첫 줄을 가리킨다', async ({ page }) => {
  const { errors } = await open(page, true, 800)
  await page.getByRole('button', { name: '설비 더하기' }).click()
  const name = page.getByRole('combobox', { name: '새 설비 이름' })
  await name.fill('천장형 냉난방기')
  await name.press('Enter')
  const menu = page.getByRole('listbox', { name: '새 설비 종류 목록' })
  await expect(menu).toContainText('Laya 에 묻는 중')
  await expect(menu.getByRole('option').first()).toContainText('시스템에어컨 실내기')
  await expect(menu.getByRole('option').first()).toHaveAttribute('aria-selected', 'true')
  await expect(menu).not.toContainText('묻는 중')
  expect(errors).toEqual([])
})
