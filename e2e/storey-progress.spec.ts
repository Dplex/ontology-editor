import { expect, test, type Page } from '@playwright/test'

// 층 단위 진행(OE-MAN-06). 층별 요약에서 층마다 완료를 표시한다. 완료한 층을 고치면 "완료 뒤 고침" 으로 저절로 풀리고, Ctrl+Z 로
// 되돌리면 다시 완료다. 표시는 편집 파일에 남아 다시 열어 불러오면 그대로다.
// 두 층 fixture 에 설비 파일을 합친다. 공조기 AHU-1 은 1F 에 있다.
const FILES = ['src/lib/ifc/fixtures/mep.ifc', 'src/lib/ifc/fixtures/two-rooms.ifc']

const row = (page: Page, floor: string) => page.locator('.storeys tbody tr', { hasText: floor })
const progress = (page: Page, floor: string) => row(page, floor).locator('td.storey-done')

async function open(page: Page) {
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(FILES)
  await expect(page.locator('.appbar h2')).toHaveText('two-rooms.ifc + mep.ifc', { timeout: 30_000 })
  const head = page.getByRole('button', { name: /층별 요약/ })
  if ((await head.getAttribute('aria-expanded')) === 'false') await head.click()
}

test('층을 완료로 표시하고, 그 층을 고치면 저절로 풀리며, 되돌리면 다시 완료다', async ({ page }, info) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await open(page)
  const head = page.getByRole('button', { name: /층별 요약/ })
  await expect(head).toContainText('완료 0/2')
  await expect(page.locator('.storey-progress')).toContainText('남은 층 1F, 2F')

  await row(page, '1F').getByRole('button', { name: '1F 완료 표시' }).click()
  await expect(progress(page, '1F')).toContainText('완료 ✓')
  await expect(head).toContainText('완료 1/2')
  await expect(page.locator('.storey-progress')).toContainText('남은 층 2F')

  // 1F 의 공조기를 옮기면 1F 완료가 풀린다.
  await page.getByRole('button', { name: '편집', exact: true }).click()
  await page.locator('.equipment tbody tr', { hasText: 'AHU-1' }).getByRole('button', { name: 'AHU-1', exact: true }).click()
  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('Shift+ArrowRight')
  await expect(progress(page, '1F')).toContainText('완료 뒤 고침')
  await expect(page.locator('.storey-progress')).toContainText('완료 뒤 고침 1F')
  await expect(head).toContainText('완료 0/2')

  // 되돌리면 1F 가 완료한 때와 같아져 다시 완료다.
  await page.keyboard.press('Control+z')
  await expect(progress(page, '1F')).toContainText('완료 ✓')

  // 다시 고치고 [다시 완료] — 지금 상태가 완료다.
  await page.keyboard.press('Shift+ArrowRight')
  await expect(progress(page, '1F')).toContainText('완료 뒤 고침')
  await row(page, '1F').getByRole('button', { name: '1F 다시 완료' }).click()
  await expect(progress(page, '1F')).toContainText('완료 ✓')
  await row(page, '2F').getByRole('button', { name: '2F 완료 표시' }).click()
  await expect(head).toContainText('완료 2/2')
  if (process.env.SHOT) await page.locator('.storeys').screenshot({ path: process.env.SHOT })

  // 편집 저장 → 같은 파일을 다시 열고 불러오면 두 층 다 완료다.
  const download = page.waitForEvent('download')
  await page.keyboard.press('Control+s')
  const file = await download
  const path = info.outputPath(file.suggestedFilename())
  await file.saveAs(path)
  page.on('dialog', (d) => void d.accept())
  await open(page)
  await expect(head).toContainText('완료 0/2')
  await page.getByRole('button', { name: '편집', exact: true }).click()
  await page.locator('.load-edits input').setInputFiles(path)
  await expect(head).toContainText('완료 2/2')
  await expect(progress(page, '1F')).toContainText('완료 ✓')
  expect(errors).toEqual([])
})

test('편집 없이 완료만 눌러도 저장할 것이 있고, 지우면 남은 층으로 돌아간다', async ({ page }) => {
  await open(page)
  await row(page, '2F').getByRole('button', { name: '2F 완료 표시' }).click()
  await page.getByRole('button', { name: '편집', exact: true }).click()
  const download = page.waitForEvent('download')
  await page.keyboard.press('Control+s')
  const text = Buffer.concat(await (await (await download).createReadStream()).toArray()).toString()
  expect(JSON.parse(text).storeysDone).toHaveLength(1)
  await row(page, '2F').getByRole('button', { name: '2F 완료 지우기' }).click()
  await expect(page.locator('.storey-progress')).toContainText('남은 층 1F, 2F')
})

// 완료 표시는 되돌리기 이력에 들지 않아서 "고친 것" 판정·자동 저장이 따로 센다. 위 둘은 [편집 저장] 만 지났다.
test('완료만 눌러도 편집을 끝낼 때 묻고 자동 저장에 남으며, 완료한 층을 고치면 알린다. 파일을 새로 열면 셈이 0 이다', async ({ context }) => {
  const page = await context.newPage()
  await open(page)
  await row(page, '1F').getByRole('button', { name: '1F 완료 표시' }).click()
  await page.getByRole('button', { name: '편집', exact: true }).click()
  // 자동 저장은 편집이 멈추고 잠시 뒤다. 새 탭에서 같은 파일을 열면 이어서 할 것이 있다.
  await page.waitForTimeout(1500)
  const other = await context.newPage()
  await open(other)
  await expect(other.locator('.draft-bar')).toContainText('편집 1건')
  await other.close()
  // 끝내려 하면 묻는다 — 1건.
  await page.getByRole('button', { name: '편집 종료' }).click()
  const dialog = page.locator('dialog.exit-edit')
  await expect(dialog).toBeVisible()
  await expect(dialog).toContainText('1건')
  await dialog.getByRole('button', { name: '취소' }).click()

  // 완료한 층의 설비를 옮기면 풀렸다고 알린다.
  await page.locator('.equipment tbody tr', { hasText: 'AHU-1' }).getByRole('button', { name: 'AHU-1', exact: true }).click()
  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('Shift+ArrowRight')
  await expect(page.getByText('1F 층을 완료한 뒤 고쳤습니다 — 완료가 풀렸습니다')).toBeVisible()

  // 다른 파일을 (새로 고침 없이) 열면 완료 셈도 처음부터다 — 저장할 것이 없고, 또 다른 파일을 열 때 묻지 않는다.
  const asked: string[] = []
  page.on('dialog', (d) => {
    asked.push(d.message())
    void d.accept()
  })
  await page.locator('.appbar label.drop input[type=file]').setInputFiles('src/lib/ifc/fixtures/two-rooms.ifc')
  await expect(page.locator('.appbar h2')).toHaveText('two-rooms.ifc', { timeout: 30_000 })
  expect(asked).toHaveLength(1) // 앞 파일의 편집을 버릴지는 물었다
  const draft = page.locator('.draft-bar')
  if (await draft.isVisible()) await draft.getByRole('button', { name: '버리기' }).click()
  if (!(await page.getByRole('button', { name: '편집 종료' }).isVisible())) await page.getByRole('button', { name: '편집', exact: true }).click()
  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('Control+s')
  await expect(page.locator('.key-note').first()).toContainText('저장할 편집이 없습니다')
  await page.locator('.appbar label.drop input[type=file]').setInputFiles('src/lib/ifc/fixtures/mep.ifc')
  await expect(page.locator('.appbar h2')).toHaveText('mep.ifc', { timeout: 30_000 })
  expect(asked).toHaveLength(1)
})
