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
    expect(d.message()).toContain('편집 1번')
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
