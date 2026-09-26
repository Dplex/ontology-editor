import { expect, test, type Page } from '@playwright/test'

// 고치기 전에 판단할 정보가 화면에 있는가. 이름만 있으면 무엇인지·왜 어겼는지·무슨 종류인지 알 수 없었다.
const MEP = 'src/lib/ifc/fixtures/mep.ifc'
const AHU = '0MEP$Equip$AHU1$0000'

async function open(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('input[type=file]').first().setInputFiles(MEP)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  return errors
}

test('3D 에서 마우스를 올리면 무엇인지 보인다', async ({ page }) => {
  const errors = await open(page)
  const tip = page.locator('.hover-tip')
  await expect(tip).toBeHidden()
  const at = await page.evaluate((id) => (window as any).__viewer.part(id), AHU)
  await page.mouse.move(at.x, at.y)
  await expect(tip).toBeVisible()
  await expect(tip).toContainText('AHU-1')
  await expect(tip).toContainText('공조기')
  await expect(tip).toContainText('AHU-1 급기 계통')
  await expect(tip).toContainText('소속 사무실')
  // 캔버스를 벗어나면 숨는다.
  await page.mouse.move(5, 5)
  await expect(tip).toBeHidden()
  expect(errors).toEqual([])
})

test('완전성 검사의 위반마다 이유가 붙는다', async ({ page }) => {
  const errors = await open(page)
  const fold = page.getByRole('button', { name: /완전성 검사/ })
  if ((await fold.getAttribute('aria-expanded')) === 'false') await fold.click()
  await page.locator('.checks tbody tr', { hasText: '소속 방이 있다' }).click()
  // 센서는 좌표가 없어서 방이 없다.
  await expect(page.locator('.check-list li', { hasText: 'TEMP-101-01' })).toContainText('좌표가 없습니다')
  expect(errors).toEqual([])
})

test('종류를 모르는 패밀리에 계통·이웃·위치 단서가 붙는다', async ({ page }) => {
  const errors = await open(page)
  await page.getByRole('button', { name: '편집', exact: true }).click()
  const fold = page.getByRole('button', { name: /종류와 관제점/ })
  if ((await fold.getAttribute('aria-expanded')) === 'false') await fold.click()
  const row = page.locator('.unknown-types tr', { hasText: 'TEMP-101-01' })
  await expect(row.locator('.clues')).toContainText('계통:')
  await expect(row.locator('.clues')).toContainText('위치:')
  expect(errors).toEqual([])
})

test('위반 목록에서 한 번에 고친다: 방 경계 바로 밖의 설비를 방 안으로', async ({ page }) => {
  const errors = await open(page)
  await page.getByRole('button', { name: '편집', exact: true }).click()
  // 공조기를 사무실(0..10) 경계 30cm 밖으로 옮긴다.
  const x = page.locator('.equipment tbody tr', { hasText: 'AHU-1' }).locator('.coord').first()
  await x.fill('10.3')
  await x.press('Enter')
  const fold = page.getByRole('button', { name: /완전성 검사/ })
  if ((await fold.getAttribute('aria-expanded')) === 'false') await fold.click()
  await page.locator('.checks tbody tr', { hasText: '소속 방이 있다' }).click()
  const item = page.locator('.check-list li', { hasText: 'AHU-1' })
  await expect(item).toContainText('가장 가까운 방은 사무실(0.30m)')
  await item.getByRole('button', { name: '사무실 안으로 옮기기' }).click()
  await expect(x).toHaveValue('9.9')
  await expect(page.locator('.check-list li', { hasText: 'AHU-1' })).toHaveCount(0)
  // 여느 편집과 같이 되돌릴 수 있다.
  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('Control+z')
  await expect(x).toHaveValue('10.3')
  expect(errors).toEqual([])
})

test('층이 여럿이면 한 층만 볼 수 있다', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('input[type=file]').first().setInputFiles('src/lib/ifc/fixtures/two-rooms.ifc')
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  const visible = () => page.evaluate(() => (window as any).__viewer.visibleStoreys() as string[])
  // 이 파일은 1F 에만 방이 있다. 2F 만 보면 1F 판이 사라진다.
  expect(await visible()).toHaveLength(1)
  const pick = page.locator('.storey-view')
  await pick.selectOption({ label: '2F만' })
  await expect.poll(async () => (await visible()).length).toBe(0)
  await pick.selectOption({ label: '1F만' })
  await expect.poll(async () => (await visible()).length).toBe(1)
  await pick.selectOption({ label: '모든 층' })
  await expect.poll(async () => (await visible()).length).toBe(1)
  expect(errors).toEqual([])
})

test('좌표가 없는 설비를 3D 바닥을 눌러 놓는다', async ({ page }) => {
  const errors = await open(page)
  await page.getByRole('button', { name: '편집', exact: true }).click()
  const row = page.locator('.equipment tbody tr', { hasText: 'TEMP-101-01' })
  await row.getByRole('button', { name: 'TEMP-101-01', exact: true }).click()
  await page.locator('.picked').getByRole('button', { name: '3D에서 놓기' }).click()
  await page.locator('.viewport canvas').scrollIntoViewIfNeeded()
  await page.waitForTimeout(200)
  const at = await page.evaluate(() => (window as any).__viewer.point([6, 5, 0]))
  await page.mouse.click(at.x, at.y)
  await expect.poll(async () => Number(await row.locator('.coord').nth(0).inputValue())).toBeCloseTo(6, 0)
  await expect.poll(async () => Number(await row.locator('.coord').nth(1).inputValue())).toBeCloseTo(5, 0)
  await expect(row).toContainText('사무실')
  // 여느 이동처럼 되돌린다.
  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('Control+z')
  await expect(row.locator('.coord').nth(0)).toHaveValue('')
  expect(errors).toEqual([])
})

test('물리존 꼭짓점을 넣고 지운다(Insert·Delete)', async ({ page }) => {
  const errors = await open(page)
  await page.getByRole('button', { name: '편집', exact: true }).click()
  await page.locator('.viewport canvas').scrollIntoViewIfNeeded()
  const floor = await page.evaluate(() => (window as any).__viewer.point([9.6, 7.6, 0.1]))
  await page.mouse.click(floor.x, floor.y)
  await expect(page.locator('.space-picked')).toContainText('사무실')
  const handles = () => page.evaluate(() => (window as any).__viewer.handles().length as number)
  expect(await handles()).toBe(4)
  await page.keyboard.press(']')
  await expect(page.locator('.vertex-tools')).toContainText('꼭짓점 1/4')
  await page.keyboard.press('Insert')
  await expect.poll(handles).toBe(5)
  await expect(page.locator('.vertex-tools')).toContainText('꼭짓점 2/5')
  // 변 위에 넣었으니 넓이는 그대로다.
  await expect(page.locator('.space-picked')).toContainText('80.0')
  await page.keyboard.press('Delete')
  await expect.poll(handles).toBe(4)
  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('Control+z')
  await expect.poll(handles).toBe(5)
  expect(errors).toEqual([])
})
