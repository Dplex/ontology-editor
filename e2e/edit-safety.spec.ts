import { expect, test, type Page } from '@playwright/test'

// 편집은 탭 안에만 있다. 새로 고침·탭 닫기·다른 파일 열기가 편집을 조용히 버리지 않는지 본다.
const MEP = 'src/lib/ifc/fixtures/mep.ifc'
const ROOMS = 'src/lib/ifc/fixtures/two-rooms.ifc'

async function openFile(page: Page, file: string) {
  await page.locator('.drop input[type=file]').setInputFiles(file)
}

async function editOnce(page: Page) {
  await page.keyboard.press('e')
  await page.locator('.equipment tbody tr', { hasText: 'AHU-1' }).last().getByRole('button', { name: 'AHU-1', exact: true }).click()
  await page.keyboard.press('Shift+ArrowRight')
  // 방 안에서 1m 라 소속(관계)은 그대로다. 그래도 좌표를 고친 편집이다.
  await expect(page.locator('.edit-bar .last-edit')).toHaveText('AHU-1 옮김')
}

test('편집이 남아 있으면 다른 파일을 열기 전에 묻고, 물리치면 편집이 그대로다', async ({ page }) => {
  await page.goto('/')
  await openFile(page, MEP)
  await expect(page.locator('.review h2')).toHaveText('mep.ifc', { timeout: 30_000 })

  // 편집 전에는 묻지 않는다.
  let asked = 0
  page.on('dialog', (d) => {
    asked++
    expect(d.type()).toBe('confirm')
    expect(d.message()).toContain('편집 저장')
    void (asked === 1 ? d.dismiss() : d.accept())
  })
  await openFile(page, MEP)
  await expect(page.locator('.review h2')).toHaveText('mep.ifc')
  expect(asked).toBe(0)

  await editOnce(page)
  await openFile(page, ROOMS)
  await expect.poll(() => asked).toBe(1)
  await expect(page.locator('.review h2')).toHaveText('mep.ifc')
  await expect(page.locator('.edit-bar .last-edit')).toHaveText('AHU-1 옮김')

  // 받아들이면 연다. 같은 입력칸에 다른 파일을 고른다.
  await openFile(page, ROOMS)
  await expect.poll(() => asked).toBe(2)
  await expect(page.locator('.review h2')).toHaveText('two-rooms.ifc', { timeout: 30_000 })
})

test('편집이 남아 있으면 탭을 닫기 전에 브라우저가 묻는다', async ({ page }) => {
  await page.goto('/')
  await openFile(page, MEP)
  await expect(page.locator('.review h2')).toBeVisible({ timeout: 30_000 })
  await editOnce(page)
  const dialog = page.waitForEvent('dialog')
  void page.close({ runBeforeUnload: true })
  const d = await dialog
  expect(d.type()).toBe('beforeunload')
  await d.dismiss()
})

test('편집을 저장하고 같은 파일을 다시 연 뒤 불러오면 편집이 그대로 돌아온다', async ({ page }, info) => {
  await page.goto('/')
  await openFile(page, MEP)
  await expect(page.locator('.review h2')).toBeVisible({ timeout: 30_000 })
  await editOnce(page)
  const name = page.locator('.rows input').first()
  await name.fill('대회의실')
  await name.press('Enter')
  const x = await page.locator('.equipment tbody tr', { hasText: 'AHU-1' }).last().locator('.coord').first().inputValue()
  await expect(page.locator('.edit-bar')).toContainText('바뀐 것 2건')

  // Ctrl+S 는 글자 칸에 커서가 있어도 편집 저장이다.
  const download = page.waitForEvent('download')
  await name.press('Control+s')
  const file = await download
  expect(file.suggestedFilename()).toBe('mep.edits.json')
  const path = info.outputPath('mep.edits.json')
  await file.saveAs(path)

  page.on('dialog', (d) => void d.accept())
  await openFile(page, MEP)
  await expect(page.locator('.edit-bar')).toContainText('바뀐 것 0건', { timeout: 30_000 })

  await page.locator('.load-edits input').setInputFiles(path)
  await expect(page.locator('.edit-file-note')).toContainText('편집 2개를 얹었습니다')
  await expect(page.locator('.edit-bar')).toContainText('바뀐 것 2건')
  await expect(page.locator('.report')).toContainText('사무실 → 대회의실')
  await expect(page.locator('.equipment tbody tr', { hasText: 'AHU-1' }).last().locator('.coord').first()).toHaveValue(x)
  await expect(page.locator('.equipment tbody tr', { hasText: 'AHU-1' }).last().locator('.src.edit')).toBeVisible()

  // 다른 파일에 불러오면 못 찾은 것을 센다.
  await openFile(page, ROOMS)
  await expect(page.locator('.review h2')).toHaveText('two-rooms.ifc', { timeout: 30_000 })
  await page.locator('.load-edits input').setInputFiles(path)
  await expect(page.locator('.edit-file-note')).toContainText('못 찾은 것: 설비 1 · 물리존 1')
  await expect(page.locator('.edit-file-note')).toContainText('저장한 파일은 mep.ifc')
})
