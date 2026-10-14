import { expect, test, type Page } from '@playwright/test'

// 화면 레이아웃(OE-UI-04)의 액션바 위치 표시·층 선택 묶음, 오른쪽 패널의 현재 층 현황, 층 바꾸기·편집 종료의 확인 창.
// two-rooms.ifc + mep.ifc 를 합치면 층이 둘(1F·2F)이다. AHU-1 은 1F 설비다.
const MEP = 'src/lib/ifc/fixtures/mep.ifc'
const ROOMS = 'src/lib/ifc/fixtures/two-rooms.ifc'

const row = (page: Page, name: string) => page.locator('.equipment tbody tr', { hasText: name })
const dialog = (page: Page) => page.locator('dialog.exit-edit')
async function moveAhu(page: Page, x: string) {
  const cell = row(page, 'AHU-1').locator('.coord').first()
  await cell.fill(x)
  await cell.press('Enter')
}

test('액션바에 사이트 › 건물 › 층이 보이고, 층 선택이 건물로 묶여 층 범위와 임시 저장한 층 수를 보인다 [OE-UI-04#13,14]', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles([MEP, ROOMS])
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  const crumbs = page.getByTestId('breadcrumb')
  await expect(crumbs).toHaveText(/^.+ › .+ › 모든 층$/)
  const floor = page.getByRole('combobox', { name: '보일 층' })
  await floor.selectOption({ label: '1F만' })
  await expect(crumbs).toHaveText(/ › 1F$/)
  const group = floor.locator('optgroup')
  await expect(group).toHaveAttribute('label', /^.+ · 1F~2F · 임시 저장 0\/2개 층$/)
  // 1F 를 고쳐 임시 저장하면 묶음 머리의 임시 저장 층 수가 오른다.
  await page.getByRole('button', { name: '편집', exact: true }).click()
  await moveAhu(page, '2')
  await page.locator('.edit-bar').getByRole('button', { name: '임시 저장' }).click()
  await expect(group).toHaveAttribute('label', /임시 저장 1\/2개 층$/)
  expect(errors).toEqual([])
})

test('오른쪽 패널에 현재 층 현황이 늘 보이고, 고르면 속성이 그 위에 함께 보이며, 목록을 누르면 그 물리존이 골라진다 [OE-UI-04#9]', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(MEP)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  const summary = page.getByTestId('floor-summary')
  await expect(summary).toContainText('물리존 1 · 룸 0 · 커스텀존 0 · 공조존 0')
  await expect(summary).toContainText(/설비 \d+대 · 미배치 \d+대/)
  await expect(summary.getByTestId('floor-objects')).toContainText('벽 0 · 문 0 · 창 0')
  // 설비를 골라도 현황은 그대로 보인다.
  await row(page, 'AHU-1').getByRole('button', { name: 'AHU-1', exact: true }).click()
  await expect(page.locator('.picked h3')).toHaveText('AHU-1')
  await expect(summary).toBeVisible()
  // 목록의 물리존을 누르면 가운데 뷰에서 그 물리존이 골라진다.
  await summary.locator('summary').first().click()
  await summary.getByRole('button', { name: /사무실/ }).click()
  await expect(page.locator('.space-picked')).toContainText('사무실')
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT, fullPage: false })
  expect(errors).toEqual([])
})

test('층을 바꾸려 하면 묻고 [그대로 이동] 이면 앞 층의 편집이 남는다. [편집 종료] 는 "임시 저장하시겠습니까?" 로 저장 안 한 층을 보이고, 취소하면 에디터에 남는다 [OE-UI-04#10,11]', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles([MEP, ROOMS])
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '편집', exact: true }).click()
  const floor = page.getByRole('combobox', { name: '보일 층' })
  const shown = floor.locator('option:checked')
  await floor.selectOption({ label: '1F만' })
  await moveAhu(page, '2')
  await expect(page.getByTestId('floor-status')).toHaveText('저장 안 된 편집')

  await floor.selectOption({ label: '2F만' })
  await expect(dialog(page)).toBeVisible()
  await dialog(page).getByRole('button', { name: '그대로 이동' }).click()
  await expect(shown).toHaveText('2F만')
  await expect(page.getByTestId('floor-status')).toHaveText('미편집')
  await floor.selectOption({ label: '1F만' })
  await expect(dialog(page)).not.toBeVisible()
  await expect(row(page, 'AHU-1').locator('.coord').first()).toHaveValue('2')

  // 편집 종료: 저장 안 한 층을 보이고 [임시 저장 후 종료]·[저장하지 않고 종료]·[취소].
  await page.locator('.edit-bar').getByRole('button', { name: '편집 종료' }).click()
  await expect(dialog(page).getByRole('heading')).toHaveText('임시 저장하시겠습니까?')
  await expect(dialog(page).getByTestId('exit-floors')).toHaveText('1F')
  for (const name of ['임시 저장 후 종료', '저장하지 않고 종료', '취소']) await expect(dialog(page).getByRole('button', { name })).toBeVisible()
  await dialog(page).getByRole('button', { name: '취소' }).click()
  await expect(page.locator('.edit-bar')).toBeVisible()
  await page.locator('.edit-bar').getByRole('button', { name: '편집 종료' }).click()
  await dialog(page).getByRole('button', { name: '임시 저장 후 종료' }).click()
  await expect(page.locator('.edit-bar')).toHaveCount(0)
  expect(errors).toEqual([])
})
