import { expect, test, type Page } from '@playwright/test'
import { enterEdit, pickEquipment, toEquipment, toSpace } from './edit-part'

// 사람의 소속 지정(OE-MAP-01 · K17). 사무실(0..10 × 0..8) 밖에 더한 설비는 소속이 없어 패널에서 소속을 정할 수 있고, 외곽선 안의
// AHU-1 은 지정 칸이 막혀 까닭이 보인다. 지정한 설비 자리에 물리존을 그리면 "사람 지정 해제" 가 바뀐 내용에 보이고, Ctrl+Z 로
// 되돌리면 지정이 다시 쓰인다.
const MEP = 'src/lib/ifc/fixtures/mep.ifc'

async function clickFloor(page: Page, x: number, y: number) {
  const at = (await page.evaluate(([px, py]) => (window as any).__viewer.point([px, py, 0]), [x, y])) as { x: number; y: number }
  await page.mouse.click(at.x, at.y)
}

test('소속 없는 설비에 소속을 정하고, 외곽선 안 설비는 막히며, 자리에 물리존을 그리면 사람 지정 해제가 보인다 [OE-MAP-01#13~,14~,15]', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(MEP)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  await enterEdit(page)
  await page.locator('.canvas-wrap > canvas').scrollIntoViewIfNeeded()
  await page.waitForTimeout(200)

  await page.getByRole('button', { name: '설비 더하기' }).click()
  await clickFloor(page, 12, 4)
  const picked = page.locator('.picked')
  await expect(picked.locator('h3')).toHaveText('새 설비 1')
  await expect(picked.getByTestId('assign-space')).toBeEnabled()
  await picked.getByTestId('assign-space').selectOption({ label: '사무실' })
  await expect(picked).toContainText('사무실')
  await expect(page.locator('.report')).toContainText('설비 새 설비 1의 소속을 사무실(으)로 정했습니다')

  // 외곽선 안의 AHU-1 은 막힌다.
  await pickEquipment(page, 'AHU-1')
  await expect(picked.locator('h3')).toHaveText('AHU-1')
  await expect(picked.getByTestId('assign-space')).toBeDisabled()
  await expect(picked.getByTestId('assign-blocked')).toContainText('외곽선 안')

  // 지정한 설비 자리에 물리존(로비)을 그린다.
  await page.keyboard.press('Escape')
  await toSpace(page)
  await page.getByRole('button', { name: '물리존 그리기' }).click()
  for (const [x, y] of [[11, 3], [13, 3], [13, 5], [11, 5]]) await clickFloor(page, x, y)
  await page.keyboard.press('Enter')
  await expect(page.locator('.report')).toContainText('사람 지정 해제: 새 설비 1 사무실 → 새 물리존 1(외곽선 안)')

  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('Control+z')
  await expect(page.locator('.report')).toContainText('설비 새 설비 1의 소속을 사무실(으)로 정했습니다')
  await expect(page.locator('.report')).not.toContainText('사람 지정 해제')
  expect(errors).toEqual([])
})

test('사람이 정한 소속은 편집 저장·불러오기 뒤에도 그대로이고, 다시 연 모델에서 그 자리가 외곽선 안이면 지정이 풀리고 불러오기 알림에 보인다 [OE-HIST-03#4]', async ({ page }, info) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('dialog', (d) => void d.accept())
  const open = async () => {
    await page.locator('.drop input[type=file], input[type=file]').first().setInputFiles(MEP)
    await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('.edit-bar')).toHaveCount(0)
    await enterEdit(page)
    await page.locator('.canvas-wrap > canvas').scrollIntoViewIfNeeded()
    await page.waitForTimeout(200)
  }
  await page.goto('/')
  await open()
  await page.getByRole('button', { name: '설비 더하기' }).click()
  await clickFloor(page, 12, 4)
  const picked = page.locator('.picked')
  await picked.getByTestId('assign-space').selectOption({ label: '사무실' })
  const download = page.waitForEvent('download')
  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('Control+s')
  const path = info.outputPath('mep.edits.json')
  await (await download).saveAs(path)

  // 같은 파일을 새로 열어 불러오면 지정이 그대로다. 브라우저 자동 저장본은 지워 편집 파일만 얹는다.
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await open()
  await page.locator('.load-edits input').setInputFiles(path)
  await expect(page.locator('.edit-file-note')).toContainText('적용했습니다')
  await expect(page.locator('.edit-file-note')).not.toContainText('사람 지정 해제')
  await pickEquipment(page, '새 설비 1')
  await expect(picked.getByTestId('assign-space').locator('option:checked')).toHaveText('사무실')

  // 다시 열어 그 자리에 물리존(로비)이 있는 모델에 불러오면, 외곽선 안이라 지정을 쓰지 않고 알린다.
  await page.evaluate(() => localStorage.clear())
  await page.reload()
  await open()
  await toSpace(page)
  await page.getByRole('button', { name: '물리존 그리기' }).click()
  for (const [x, y] of [[11, 3], [13, 3], [13, 5], [11, 5]]) await clickFloor(page, x, y)
  await page.keyboard.press('Enter')
  await toEquipment(page)
  await page.locator('.load-edits input').setInputFiles(path)
  await expect(page.locator('.edit-file-note')).toContainText('사람 지정 해제 1대: 새 설비 1 사무실 → 새 물리존 1(외곽선 안)')
  expect(errors).toEqual([])
})
