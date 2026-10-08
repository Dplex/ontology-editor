import { expect, test } from '@playwright/test'

// 물리존 경계 수정(OE-SPC-03)의 화면 수용 기준 중 시험이 없던 둘. 꼭짓점이 셋 남은 물리존에서 Delete 를 누르면 지우지 않고
// 알리고, 표에서 좌표를 자기교차가 되게 고치면 값은 바뀌고 경고가 보인다(3D 에서 놓을 때와 달리 막지 않는다). mep.ifc 의
// 사무실은 (0,0)(10,0)(10,8)(0,8) 이다.
const MEP = 'src/lib/ifc/fixtures/mep.ifc'

test('꼭짓점이 셋이면 Delete 가 지우지 않고 알리며, 표에서 좌표를 자기교차로 고치면 값이 바뀌고 경고가 보인다', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(MEP)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '편집', exact: true }).click()
  await page.locator('.viewport canvas').scrollIntoViewIfNeeded()

  const floor = await page.evaluate(() => (window as any).__viewer.point([9.6, 7.6, 0.1]))
  await page.mouse.click(floor.x, floor.y)
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
  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('Control+z')
  await expect.poll(handles).toBe(4)

  // 표에서 (10,8) 의 y 를 -5 로 고치면 (10,-5)→(0,8) 변이 (0,0)→(10,0) 변을 가로지른다.
  const row = page.locator('tr', { has: page.locator('input[aria-label$="이름"][value="사무실"]') })
  const y = row.locator('.vertex').nth(2).locator('input.coord').nth(1)
  await y.fill('-5')
  await y.press('Enter')
  await y.blur()
  await expect(y).toHaveValue('-5')
  await expect(page.getByRole('alert').filter({ hasText: '경계선이 서로 교차합니다' })).toBeVisible()
  expect(errors).toEqual([])
})
