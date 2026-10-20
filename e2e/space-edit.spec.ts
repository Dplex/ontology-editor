import { expect, test } from '@playwright/test'
import { enterEdit, pickSpace, toSpace } from './edit-part'

// 물리존 경계 수정(OE-SPC-03). 꼭짓점이 셋 남은 물리존에서 Delete 를 누르면 지우지 않고 알린다. mep.ifc 의 사무실은
// (0,0)(10,0)(10,8)(0,8) 이다. 표에서 꼭짓점 좌표를 자기교차로 고치던 시험은 물리존 표가 빠져서(#715) 지웠다.
const MEP = 'src/lib/ifc/fixtures/mep.ifc'

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
