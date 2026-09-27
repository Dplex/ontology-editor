import { expect, test, type Page } from '@playwright/test'

// 설비 더하기·이름·지우기(E7)와 물리존 그리기·나누기·합치기·지우기(E3)를 실제 마우스로 한다. 3D 의 바닥 자리는
// e2e 모드에서만 열리는 window.__viewer.point 로 묻는다(viewer.ts).
const MEP = 'src/lib/ifc/fixtures/mep.ifc'

async function open(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(MEP)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '편집', exact: true }).click()
  await page.locator('.viewport canvas').scrollIntoViewIfNeeded()
  await page.waitForTimeout(200)
  return errors
}

const floor = (page: Page, x: number, y: number) =>
  page.evaluate(([px, py]) => (window as any).__viewer.point([px, py, 0]), [x, y]) as Promise<{ x: number; y: number }>

async function clickFloor(page: Page, x: number, y: number) {
  const at = await floor(page, x, y)
  await page.mouse.click(at.x, at.y)
}

test('설비를 바닥에 더하고, 이름을 고치고, 지우고, Ctrl+Z 로 하나씩 되돌린다', async ({ page }) => {
  const errors = await open(page)
  await page.getByRole('button', { name: '설비 더하기' }).click()
  await clickFloor(page, 2, 2)
  const picked = page.locator('.picked')
  await expect(picked.locator('h3')).toHaveText('새 설비 1')
  await expect(picked).toContainText('에디터에서 더한 설비')
  await expect(picked).toContainText('사무실')

  const name = picked.locator('.equipment-name-edit input')
  await name.fill('FCU-9')
  await name.press('Enter')
  await expect(picked.locator('h3')).toHaveText('FCU-9')
  await expect(page.locator('.report')).toContainText('설비 FCU-9을 더했습니다')

  await picked.getByRole('button', { name: '설비 지우기' }).click()
  await expect(picked).toHaveCount(0)
  await expect(page.locator('.report')).toHaveCount(0)

  // 지우기 → 이름 → 더하기 순으로 되돌린다.
  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('Control+z')
  await expect(page.locator('.report')).toContainText('설비 FCU-9을 더했습니다')
  await page.keyboard.press('Control+z')
  await expect(page.locator('.report')).toContainText('설비 새 설비 1을 더했습니다')
  await page.keyboard.press('Control+z')
  await expect(page.locator('.report')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('BIM 설비를 지우면 붙은 연결도 빠지고, 되돌리면 연결까지 돌아온다', async ({ page }) => {
  const errors = await open(page)
  const row = page.locator('.equipment tbody tr', { hasText: 'DUCT-01' })
  await row.getByRole('button', { name: 'DUCT-01', exact: true }).click()
  const picked = page.locator('.picked')
  const neighbors = picked.locator('table.neighbors tr')
  const before = await neighbors.count()
  expect(before).toBeGreaterThan(0)
  await picked.getByRole('button', { name: '설비 지우기' }).click()
  await expect(page.locator('.report')).toContainText('설비 DUCT-01을 지웠습니다')
  await expect(page.locator('.equipment tbody tr', { hasText: 'DUCT-01' })).toHaveCount(0)

  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('Control+z')
  await page.locator('.equipment tbody tr', { hasText: 'DUCT-01' }).getByRole('button', { name: 'DUCT-01', exact: true }).click()
  await expect(picked.locator('table.neighbors tr')).toHaveCount(before)
  expect(errors).toEqual([])
})

test('물리존을 그리면 안의 설비가 새 방으로 가고, 나누고 합치고 지운다', async ({ page }) => {
  const errors = await open(page)
  await page.getByRole('button', { name: '물리존 그리기' }).click()
  for (const [x, y] of [[2, 3], [4, 3], [4, 5], [2, 5]]) await clickFloor(page, x, y)
  await page.keyboard.press('Enter')
  const room = page.locator('.space-picked')
  await expect(room).toContainText('새 물리존 1')
  await expect(room).toContainText('AT-101-01')
  await expect(page.locator('.report')).toContainText('물리존 새 물리존 1을 만들었습니다')

  // 사무실을 x=6 에서 나눈다. 넓은 조각(48㎡)이 사무실로 남고 32㎡ 조각이 새로 생긴다.
  await clickFloor(page, 9.6, 7.6)
  await expect(room).toContainText('사무실')
  await room.getByRole('button', { name: '나누기' }).click()
  await clickFloor(page, 6, 0.5)
  await clickFloor(page, 6, 7.5)
  await expect(room).toContainText('48.0')
  await expect(page.locator('.report')).toContainText('사무실-2')

  // 맞댄 조각을 다시 합치면 80㎡ 다.
  await room.locator('.space-tools select').selectOption({ label: '사무실-2' })
  await expect(room).toContainText('80.0')

  // 새 물리존을 지운다.
  await clickFloor(page, 3, 4)
  await expect(room).toContainText('새 물리존 1')
  await room.getByRole('button', { name: '지우기', exact: true }).click()
  await expect(room).toHaveCount(0)
  // 만들고 나누고 합치고 지웠으니 연 때와 같다. 바뀐 것이 없으면 리포트가 비어 목록이 뜨지 않는다.
  await expect(page.locator('.report')).toHaveCount(0)
  expect(errors).toEqual([])
})
