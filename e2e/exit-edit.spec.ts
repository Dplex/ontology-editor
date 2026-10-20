import { expect, test, type Page } from '@playwright/test'
import { enterEdit, pickEquipment, coordOf } from './edit-part'

// 저장하지 않은 편집이 있는데 편집을 끝내거나 다른 층으로 가려 하면 묻는다(OE-COM-08): 임시 저장 / 저장 안 함 / 취소.
const MEP = 'src/lib/ifc/fixtures/mep.ifc'

async function open(page: Page) {
  await page.goto('/')
  await page.locator('input[type=file]').first().setInputFiles(MEP)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  await enterEdit(page)
}

const dialog = (page: Page) => page.locator('dialog.exit-edit')

/** AHU-1 을 고르고 그 x 칸(오른쪽 위 선택 카드)을 돌려준다. */
async function ahuX(page: Page) {
  await pickEquipment(page, 'AHU-1')
  return coordOf(page, 0)
}
async function moveAhu(page: Page, x: string) {
  const cell = await ahuX(page)
  await cell.fill(x)
  await cell.press('Enter')
}

test('편집이 없거나 저장한 뒤에는 묻지 않고 끝난다', async ({ page }) => {
  await open(page)
  await page.getByRole('button', { name: '편집 종료' }).click()
  await expect(dialog(page)).not.toBeVisible()
  await expect(page.locator('.edit-bar')).toHaveCount(0)

  await enterEdit(page)
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
  await expect(page.getByTestId('changes-link')).toContainText('바뀐 것 1건')

  await page.getByRole('button', { name: '편집 종료' }).click()
  await expect(dialog(page)).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(dialog(page)).not.toBeVisible()
  await expect(page.locator('.edit-bar')).toBeVisible()

  await page.locator('.appbar h2').click()
  await page.keyboard.press('KeyE')
  await expect(dialog(page)).toBeVisible()
  await dialog(page).getByRole('button', { name: '임시 저장' }).click()
  await expect(page.locator('.edit-bar')).toHaveCount(0)
  await expect(page.locator('.key-note')).toContainText('임시 저장했습니다')
  // 임시 저장은 브라우저에 남기고, 편집은 화면에 그대로다. 다시 편집으로 가서 끝내면 묻지 않는다.
  expect(await page.evaluate(() => Object.keys(localStorage).some((k) => k.startsWith('oe-draft:')))).toBe(true)
  await enterEdit(page)
  await expect(page.getByTestId('changes-link')).toContainText('바뀐 것 1건')
  await page.getByRole('button', { name: '편집 종료' }).click()
  await expect(dialog(page)).not.toBeVisible()

  // 같은 파일을 새로 열고 편집에 들어가면 묻지 않고 임시 저장본이 열린다(OE-WF-02).
  await page.reload()
  await page.locator('input[type=file]').first().setInputFiles(MEP)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  await expect(page.locator('.draft-bar')).toHaveCount(0)
  await enterEdit(page)
  await expect(page.getByTestId('changes-link')).toContainText('바뀐 것 1건')
  await expect(await ahuX(page)).toHaveValue('2')
})

test('저장 안 한 편집이 있는 층에서 다른 층으로 가려 하면 묻고, 층마다 임시 저장본이 따로 남는다. 저장 안 한 편집이 있으면 탭을 닫을 때도 묻는다 [OE-COM-08#2,3~]', async ({ page }) => {
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles([MEP, 'src/lib/ifc/fixtures/two-rooms.ifc'])
  await expect(page.locator('.appbar h2')).toHaveText('two-rooms.ifc + mep.ifc', { timeout: 30_000 })
  await enterEdit(page)
  const floor = page.getByRole('combobox', { name: '보일 층' })
  const shown = floor.locator('option:checked')
  await floor.selectOption({ label: '1F' })
  await moveAhu(page, '2')

  // 취소하면 층이 그대로다
  await floor.selectOption({ label: '2F' })
  await expect(dialog(page)).toBeVisible()
  await expect(dialog(page)).toContainText('1F')
  await dialog(page).getByRole('button', { name: '취소' }).click()
  await expect(shown).toHaveText('1F')

  // 임시 저장하면 1F 만 남기고 2F 로 간다. 2F 에는 저장 안 한 편집이 없으니 1F 로 돌아올 때 묻지 않는다.
  await floor.selectOption({ label: '2F' })
  await dialog(page).getByRole('button', { name: '임시 저장', exact: true }).click()
  await expect(shown).toHaveText('2F')
  const drafts = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('oe-draft:two-rooms.ifc + mep.ifc@')))
  expect(drafts).toHaveLength(1)
  await floor.selectOption({ label: '1F' })
  await expect(dialog(page)).not.toBeVisible()
  await expect(await ahuX(page)).toHaveValue('2')

  // 저장 안 함은 그 층을 임시 저장한 때로 되돌린다
  await moveAhu(page, '3')
  await floor.selectOption({ label: '2F' })
  await dialog(page).getByRole('button', { name: '저장 안 함' }).click()
  await expect(shown).toHaveText('2F')
  await floor.selectOption({ label: '1F' })
  await expect(dialog(page)).not.toBeVisible()
  await expect(await ahuX(page)).toHaveValue('2')

  // 다시 고친 채 탭을 닫으려 하면 브라우저가 묻는다
  await moveAhu(page, '4')
  const unload = page.waitForEvent('dialog')
  void page.close({ runBeforeUnload: true })
  const d = await unload
  expect(d.type()).toBe('beforeunload')
  await d.dismiss()
})

test('저장 안 함은 연 때로 되돌리고, 버린 편집은 위 줄에서 한 번 되살린다', async ({ page }) => {
  await open(page)
  const before = await (await ahuX(page)).inputValue()
  await moveAhu(page, '2')
  await page.getByRole('button', { name: '편집 종료' }).click()
  await dialog(page).getByRole('button', { name: '저장하지 않고 종료' }).click()
  await expect(page.locator('.edit-bar')).toHaveCount(0)
  await expect(page.locator('.key-note')).toContainText('편집 1건을 버리고')

  await enterEdit(page)
  await expect(await ahuX(page)).toHaveValue(before)
  await expect(page.getByTestId('changes-link')).toContainText('바뀐 것 0건')

  const bar = page.locator('.draft-bar')
  await expect(bar).toContainText('편집 1건')
  await bar.getByRole('button', { name: '예', exact: true }).click()
  await expect(await ahuX(page)).toHaveValue('2')
  await expect(page.getByTestId('changes-link')).toContainText('바뀐 것 1건')
})
