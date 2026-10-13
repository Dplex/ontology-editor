import { expect, test, type Page } from '@playwright/test'

// [설비 더하기] 에서 이름을 미리 치면 종류 후보가 뜬다(ADR-0057). 사전이 이름을 읽으면 그것이 먼저, 이어서 Laya 의 후보다.
// 133 의 Laya 서버는 page.route 로 흉내 낸다. 고르지 않으면 지금처럼 종류 미상으로 놓인다(OE-EQP-13).
const MEP = 'src/lib/ifc/fixtures/mep.ifc'

/** 이름 → Laya 가 돌려줄 종류. 없는 이름은 자신 없는 답이다. */
const ANSWERS: Record<string, { kind: string; p: number }[]> = {
  '천장형 냉난방기': [{ kind: 'indoor_unit', p: 0.9 }, { kind: 'fcu', p: 0.06 }],
  송풍구: [{ kind: 'air_diffuser', p: 0.8 }, { kind: 'air_grille', p: 0.1 }],
}

async function open(page: Page, enabled = true) {
  const errors: string[] = []
  const asked: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.route('**/__laya', (r) => r.fulfill({ json: enabled ? { enabled: true, model: 'test/final' } : { enabled: false, reason: 'LAYA_URL 이 없습니다' } }))
  await page.route('**/__laya/kinds', async (r) => {
    const { states } = r.request().postDataJSON() as { states: string[] }
    asked.push(...states)
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
  await page.getByRole('button', { name: '편집', exact: true }).click()
  await page.locator('.viewport canvas').scrollIntoViewIfNeeded()
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
  const name = page.getByRole('textbox', { name: '새 설비 이름' })
  await expect(name).toBeFocused()
  await name.fill('천장형 냉난방기')
  const chips = page.getByRole('group', { name: '새 설비 종류 후보' })
  await expect(chips.getByRole('button').first()).toContainText('시스템에어컨 실내기')
  await expect(chips.getByRole('button').first()).toContainText('Laya 90%')
  expect(asked).toContain('새 설비 이름: 천장형 냉난방기\n놓는 면: 바닥·벽')
  await name.press('Enter')
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
  await expect(page.locator('.equipment tbody tr', { hasText: '천장형 냉난방기' })).toHaveCount(0)
  expect(errors).toEqual([])
})

test('사전이 읽는 이름은 사전 후보가 먼저이고, 고르지 않고 놓으면 종류 미상이다', async ({ page }) => {
  const { errors } = await open(page)
  await page.getByRole('button', { name: '설비 더하기' }).click()
  const name = page.getByRole('textbox', { name: '새 설비 이름' })
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
  await page.getByRole('textbox', { name: '새 설비 이름' }).fill('송풍구')
  await page.getByRole('group', { name: '새 설비 종류 후보' }).getByRole('button', { name: /디퓨저/ }).click()
  await expect(page.locator('.add-name')).toContainText('디퓨저는 천장에 놓는 종류입니다')
  expect(errors).toEqual([])
})

test('Laya 서버가 없으면 사전 후보만 보이고 묻지 않는다', async ({ page }) => {
  const { errors, asked } = await open(page, false)
  await page.getByRole('button', { name: '설비 더하기' }).click()
  const name = page.getByRole('textbox', { name: '새 설비 이름' })
  await name.fill('천장형 냉난방기')
  await page.waitForTimeout(400)
  await expect(page.getByRole('group', { name: '새 설비 종류 후보' })).toHaveCount(0)
  await name.fill('FCU-9')
  await expect(page.getByRole('group', { name: '새 설비 종류 후보' }).getByRole('button')).toHaveCount(1)
  expect(asked).toEqual([])
  expect(errors).toEqual([])
})
