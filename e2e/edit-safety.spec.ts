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
  await expect(page.locator('.appbar h2')).toHaveText('mep.ifc', { timeout: 30_000 })

  // 편집 전에는 묻지 않는다.
  let asked = 0
  page.on('dialog', (d) => {
    asked++
    expect(d.type()).toBe('confirm')
    expect(d.message()).toContain('편집 저장')
    void (asked === 1 ? d.dismiss() : d.accept())
  })
  await openFile(page, MEP)
  await expect(page.locator('.appbar h2')).toHaveText('mep.ifc')
  expect(asked).toBe(0)

  await editOnce(page)
  await openFile(page, ROOMS)
  await expect.poll(() => asked).toBe(1)
  await expect(page.locator('.appbar h2')).toHaveText('mep.ifc')
  await expect(page.locator('.edit-bar .last-edit')).toHaveText('AHU-1 옮김')

  // 받아들이면 연다. 같은 입력칸에 다른 파일을 고른다.
  await openFile(page, ROOMS)
  await expect.poll(() => asked).toBe(2)
  await expect(page.locator('.appbar h2')).toHaveText('two-rooms.ifc', { timeout: 30_000 })
})

test('편집이 남아 있으면 탭을 닫기 전에 브라우저가 묻는다', async ({ page }) => {
  await page.goto('/')
  await openFile(page, MEP)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
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
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
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
  await expect(page.locator('.edit-file-note')).toContainText('편집 2개를 적용했습니다')
  await expect(page.locator('.edit-bar')).toContainText('바뀐 것 2건')
  await expect(page.locator('.report')).toContainText('사무실 → 대회의실')
  await expect(page.locator('.equipment tbody tr', { hasText: 'AHU-1' }).last().locator('.coord').first()).toHaveValue(x)
  await expect(page.locator('.equipment tbody tr', { hasText: 'AHU-1' }).last().locator('.src.edit')).toBeVisible()

  // 다른 파일에 불러오면 못 찾은 것을 센다.
  await openFile(page, ROOMS)
  await expect(page.locator('.appbar h2')).toHaveText('two-rooms.ifc', { timeout: 30_000 })
  await page.locator('.load-edits input').setInputFiles(path)
  await expect(page.locator('.edit-file-note')).toContainText('찾지 못함: 설비 1 · 물리존 1')
  await expect(page.locator('.edit-file-note')).toContainText('원래 파일: mep.ifc')
})

// 합치기는 모델을 새로 만든다. 소속을 안 바꾸는 편집(이름·종류·확정·방향·잇기)도 합치면 "바뀐 것 0건" 이 되고 편집
// 파일·되돌리기에서 빠졌다 — 값은 TTL 에 그대로 나가는데. 그래서 편집이 하나라도 있으면 덧붙이기를 닫는다.
test('방 이름만 고쳐도 덧붙이기가 닫히고, 되돌리면 다시 열린다', async ({ page }) => {
  await page.goto('/')
  await openFile(page, MEP)
  await expect(page.locator('.appbar h2')).toHaveText('mep.ifc', { timeout: 30_000 })
  const append = page.locator('label.append')
  await expect(append).toHaveCount(1)

  await page.keyboard.press('e')
  const name = page.locator('.rows input').first()
  await name.fill('대회의실')
  await name.press('Enter')
  await expect(page.locator('.edit-bar')).toContainText('바뀐 것 1건')
  await expect(append).toHaveCount(0)

  await page.locator('.viewport canvas').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('Control+z')
  await expect(page.locator('.edit-bar')).toContainText('바뀐 것 0건')
  await expect(append).toHaveCount(1)
})
