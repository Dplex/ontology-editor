import { expect, test, type Page } from '@playwright/test'

// 저장하지 않은 편집이 있는데 편집을 끝내거나 다른 층으로 가려 하면 묻는다(OE-COM-08): 임시 저장 / 저장 안 함 / 취소.
const MEP = 'src/lib/ifc/fixtures/mep.ifc'

async function open(page: Page) {
  await page.goto('/')
  await page.locator('input[type=file]').first().setInputFiles(MEP)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '편집', exact: true }).click()
}

const row = (page: Page, name: string) => page.locator('.equipment tbody tr', { hasText: name })
const dialog = (page: Page) => page.locator('dialog.exit-edit')

async function moveAhu(page: Page, x: string) {
  const cell = row(page, 'AHU-1').locator('.coord').first()
  await cell.fill(x)
  await cell.press('Enter')
}

test('편집이 없거나 저장한 뒤에는 묻지 않고 끝난다', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: '편집 종료' }).click()
  await expect(dialog(page)).not.toBeVisible()
  await expect(page.locator('.edit-bar')).toHaveCount(0)

  await page.getByRole('button', { name: '편집', exact: true }).click()
  await moveAhu(page, '2')
  const download = page.waitForEvent('download')
  await page.locator('.edit-bar').getByRole('button', { name: '편집 저장' }).click()
  await download
  await page.getByRole('button', { name: '편집 종료' }).click()
  await expect(dialog(page)).not.toBeVisible()
  await expect(page.locator('.edit-bar')).toHaveCount(0)
})

test('취소하면 편집이 이어지고, 임시 저장은 브라우저에 남기고 끝낸다', async ({ page }) => {
  await open(page)
  await moveAhu(page, '2')
  // 끝내는 길 넷이 같은 질문을 거친다: 편집 종료 · 보기 · E.
  await page.getByRole('button', { name: '편집 종료' }).click()
  await expect(dialog(page)).toBeVisible()
  await expect(dialog(page)).toContainText('1건')
  await dialog(page).getByRole('button', { name: '취소' }).click()
  await expect(dialog(page)).not.toBeVisible()
  await expect(page.locator('.edit-bar')).toContainText('바뀐 것 1건')

  await page.getByRole('button', { name: '보기', exact: true }).click()
  await expect(dialog(page)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog(page)).not.toBeVisible()
  await expect(page.locator('.edit-bar')).toBeVisible()

  await page.locator('.viewport canvas').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('KeyE')
  await expect(dialog(page)).toBeVisible()
  await dialog(page).getByRole('button', { name: '임시 저장' }).click()
  await expect(page.locator('.edit-bar')).toHaveCount(0)
  await expect(page.locator('.key-note')).toContainText('임시 저장했습니다')
  // 임시 저장은 브라우저에 남기고, 편집은 화면에 그대로다. 다시 편집으로 가서 끝내면 묻지 않는다.
  expect(await page.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith('oe-draft:')))).toBe(true)
  await page.getByRole('button', { name: '편집', exact: true }).click()
  await expect(page.locator('.edit-bar')).toContainText('바뀐 것 1건')
  await page.getByRole('button', { name: '편집 종료' }).click()
  await expect(dialog(page)).not.toBeVisible()

  // 같은 파일을 새로 열고 편집에 들어가면 묻지 않고 임시 저장본이 열린다(OE-WF-02).
  await page.reload()
  await page.locator('input[type=file]').first().setInputFiles(MEP)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('.draft-bar')).toHaveCount(0)
  await page.getByRole('button', { name: '편집', exact: true }).click()
  await expect(page.locator('.edit-bar')).toContainText('바뀐 것 1건')
  await expect(row(page, 'AHU-1').locator('.coord').first()).toHaveValue('2')
})

test('저장 안 한 편집이 있는 층에서 다른 층으로 가려 하면 묻고, 층마다 임시 저장본이 따로 남는다 (OE-COM-08)', async ({ page }) => {
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles([MEP, 'src/lib/ifc/fixtures/two-rooms.ifc'])
  await expect(page.locator('.appbar h2')).toHaveText('two-rooms.ifc + mep.ifc', { timeout: 30_000 })
  await page.getByRole('button', { name: '편집', exact: true }).click()
  const floor = page.getByRole('combobox', { name: '보일 층' })
  const shown = floor.locator('option:checked')
  await floor.selectOption({ label: '1F만' })
  await moveAhu(page, '2')
  const ahuX = row(page, 'AHU-1').locator('.coord').first()

  // 취소하면 층이 그대로다
  await floor.selectOption({ label: '2F만' })
  await expect(dialog(page)).toBeVisible()
  await expect(dialog(page)).toContainText('1F')
  await dialog(page).getByRole('button', { name: '취소' }).click()
  await expect(shown).toHaveText('1F만')

  // 임시 저장하면 1F 만 남기고 2F 로 간다. 2F 에는 저장 안 한 편집이 없으니 1F 로 돌아올 때 묻지 않는다.
  await floor.selectOption({ label: '2F만' })
  await dialog(page).getByRole('button', { name: '임시 저장', exact: true }).click()
  await expect(shown).toHaveText('2F만')
  const drafts = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('oe-draft:two-rooms.ifc + mep.ifc@')))
  expect(drafts).toHaveLength(1)
  await floor.selectOption({ label: '1F만' })
  await expect(dialog(page)).not.toBeVisible()
  await expect(ahuX).toHaveValue('2')

  // 저장 안 함은 그 층을 임시 저장한 때로 되돌린다
  await moveAhu(page, '3')
  await floor.selectOption({ label: '2F만' })
  await dialog(page).getByRole('button', { name: '저장 안 함' }).click()
  await expect(shown).toHaveText('2F만')
  await floor.selectOption({ label: '1F만' })
  await expect(dialog(page)).not.toBeVisible()
  await expect(ahuX).toHaveValue('2')
})

test('저장 안 함은 연 때로 되돌리고, 버린 편집은 위 줄에서 한 번 되살린다', async ({ page }) => {
  await open(page)
  const before = await row(page, 'AHU-1').locator('.coord').first().inputValue()
  await moveAhu(page, '2')
  await page.getByRole('button', { name: '편집 종료' }).click()
  await dialog(page).getByRole('button', { name: '저장 안 함' }).click()
  await expect(page.locator('.edit-bar')).toHaveCount(0)
  await expect(page.locator('.key-note')).toContainText('편집 1건을 버리고')

  await page.getByRole('button', { name: '편집', exact: true }).click()
  await expect(row(page, 'AHU-1').locator('.coord').first()).toHaveValue(before)
  await expect(page.locator('.edit-bar')).toContainText('바뀐 것 0건')

  const bar = page.locator('.draft-bar')
  await expect(bar).toContainText('편집 1건')
  await bar.getByRole('button', { name: '이어서 하기' }).click()
  await expect(row(page, 'AHU-1').locator('.coord').first()).toHaveValue('2')
  await expect(page.locator('.edit-bar')).toContainText('바뀐 것 1건')
})
