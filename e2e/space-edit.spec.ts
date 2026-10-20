import { expect, test, type Page } from '@playwright/test'
import { enterEdit, pickSpace, toEquipment, toSpace } from './edit-part'

// 물리존 경계 수정(OE-SPC-03)과 모드 사이 되돌리기·분할·병합(OE-UI-05). 꼭짓점이 셋 남은 물리존에서 Delete 를 누르면 지우지 않고 알린다.
// mep.ifc 의 사무실은 (0,0)(10,0)(10,8)(0,8) 이다. 표에서 꼭짓점 좌표를 자기교차로 고치던 시험은 물리존 표가 빠져서(#715) 지웠다.
const MEP = 'src/lib/ifc/fixtures/mep.ifc'

async function clickFloor(page: Page, x: number, y: number) {
  await page.locator('.canvas-wrap > canvas').scrollIntoViewIfNeeded()
  const at = (await page.evaluate(([px, py]) => (window as any).__viewer.point([px, py, 0]), [x, y])) as { x: number; y: number }
  await page.mouse.click(at.x, at.y)
}

test('꼭짓점이 셋이면 Delete 가 지우지 않고 알린다 [OE-SPC-03#3]', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(MEP)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  await enterEdit(page)
  await toSpace(page)
  await pickSpace(page, '사무실')
  const panel = page.locator('.space-picked')
  await expect(panel).toContainText('80.0')
  const handles = () => page.evaluate(() => (window as any).__viewer.handles().length as number)
  await page.keyboard.press(']')
  await page.keyboard.press('Delete')
  await expect.poll(handles).toBe(3)
  await expect(panel).toContainText('40.0')
  await page.keyboard.press('Delete')
  await expect(page.locator('.key-note')).toContainText('꼭짓점이 셋이라 더 지울 수 없습니다')
  expect(await handles()).toBe(3)
  await page.locator('.appbar h2').click()
  await page.keyboard.press('Control+z')
  await expect.poll(handles).toBe(4)

  expect(errors).toEqual([])
})

test('공간 편집에서 그은 벽을 설비 편집에서 되돌리고, 물리존 나누기·합치기는 한 번에 되돌리고 다시 실행한다 [OE-UI-05#4,5]', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(MEP)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  await enterEdit(page)
  await page.locator('.canvas-wrap > canvas').scrollIntoViewIfNeeded()
  await page.waitForTimeout(200)

  // 공간 편집에서 벽을 그은 뒤 설비 편집으로 바꿔 Ctrl+Z 를 누르면 벽이 되돌아간다(OE-UI-05#4).
  await toSpace(page)
  await page.getByRole('button', { name: '벽·문·창' }).click()
  await page.getByRole('button', { name: '벽 긋기' }).click()
  await clickFloor(page, 5, 1)
  await clickFloor(page, 5, 7)
  await expect(page.locator('.element-picked h3')).toHaveText('새 벽')
  await toEquipment(page)
  await page.locator('.appbar h2').click()
  await page.keyboard.press('Control+z')
  await expect(page.locator('.key-note')).toContainText('되돌렸습니다: 벽 긋기')
  await expect(page.getByRole('navigation', { name: '도구 레일' }).getByRole('button', { name: /실행취소/ })).toBeDisabled()

  // 물리존 나누기·합치기는 Ctrl+Z 한 번에 통째로 되돌아가고 Ctrl+Shift+Z 한 번에 다시 실행된다(OE-UI-05#5).
  await toSpace(page)
  await pickSpace(page, '사무실')
  const panel = page.locator('.space-picked')
  await expect(panel).toContainText('80.0')
  await panel.getByRole('button', { name: '나누기' }).click()
  await clickFloor(page, 6, -1)
  await clickFloor(page, 6, 9)
  await expect(page.locator('.key-note')).toContainText('둘로 나눴습니다')
  await expect(panel).toContainText('32.0')
  await page.locator('.appbar h2').click()
  await page.keyboard.press('Control+z')
  await pickSpace(page, '사무실')
  await expect(panel).toContainText('80.0')
  await page.locator('.appbar h2').click()
  await page.keyboard.press('Control+Shift+z')
  await pickSpace(page, '사무실')
  await expect(panel).toContainText('48.0')

  await panel.locator('select[aria-label="합칠 물리존"]').selectOption({ index: 1 })
  await expect(panel).toContainText('80.0')
  await page.locator('.appbar h2').click()
  await page.keyboard.press('Control+z')
  await expect(panel).toContainText('48.0')
  await page.keyboard.press('Control+Shift+z')
  await expect(panel).toContainText('80.0')

  expect(errors).toEqual([])
})
