import { existsSync } from 'node:fs'
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
  await expect(tip.locator('.tip-kind')).toHaveText('설비')
  await expect.poll(() => page.evaluate(() => (window as any).__viewer.hoverMark())).toBe(`equipment:${AHU}`)
  // 빈 바닥 위에서는 물리존이다(설비와 다른 표시).
  const floor = await page.evaluate(() => (window as any).__viewer.point([9.6, 7.6, 0.1]))
  await page.mouse.move(floor.x, floor.y)
  await expect(tip.locator('.tip-kind')).toHaveText('물리존')
  await expect.poll(() => page.evaluate(() => (window as any).__viewer.hoverMark())).toMatch(/^space:/)
  // 캔버스를 벗어나면 숨는다.
  await page.mouse.move(5, 5)
  await expect(tip).toBeHidden()
  expect(await page.evaluate(() => (window as any).__viewer.hoverMark())).toBe('')
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

test('경로를 쓸 수 없는 덕트·배관 구간이 완전성 검사에 까닭과 원본 GlobalId 로 보인다 (OE-PIP-13)', async ({ page }) => {
  const errors = await open(page)
  const fold = page.getByRole('button', { name: /완전성 검사/ })
  if ((await fold.getAttribute('aria-expanded')) === 'false') await fold.click()
  // mep.ifc 의 DUCT-01 은 배치점은 있지만 형상이 없어 경로(두 끝)를 모른다.
  await page.locator('.checks tbody tr', { hasText: '유효한 경로' }).click()
  await expect(page.locator('.check-list li', { hasText: 'DUCT-01' })).toContainText('형상 없음(경로를 모름) · BIM GlobalId 0MEP$Duct$D01$00000')
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
  // 놓기는 편집 팔레트의 미배치 목록에서 한다(OE-EQP-02).
  await page.getByRole('button', { name: /미배치 \d+대/ }).click()
  await page.getByRole('list', { name: '미배치 설비' }).getByRole('button', { name: 'TEMP-101-01' }).click()
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

test('미배치 목록에서 바로 3D 바닥을 눌러 놓으면 목록에서 빠진다', async ({ page }) => {
  // OE-BIM-07 "좌표 없는 설비는 미배치 목록". 검토 화면의 목록을 보고, 편집 팔레트의 미배치 목록에서 놓는다.
  const errors = await open(page)
  const fold = page.locator('.unplaced')
  await expect(fold).toContainText('미배치 설비')
  await expect(fold).toContainText('1대')
  const item = fold.locator('li', { hasText: 'TEMP-101-01' })
  await expect(item).toContainText('1F')
  // 놓기는 편집 팔레트의 미배치 목록에서 한다(OE-EQP-02).
  await page.getByRole('button', { name: '편집', exact: true }).click()
  await page.getByRole('button', { name: /미배치 \d+대/ }).click()
  await page.getByRole('list', { name: '미배치 설비' }).getByRole('button', { name: 'TEMP-101-01' }).click()
  await expect(page.locator('.picked')).toContainText('TEMP-101-01')
  await page.locator('.viewport canvas').scrollIntoViewIfNeeded()
  await page.waitForTimeout(200)
  const at = await page.evaluate(() => (window as any).__viewer.point([6, 5, 0]))
  await page.mouse.click(at.x, at.y)
  await expect(fold).toBeHidden()
  await expect(page.locator('.picked')).toContainText('사무실')
  // 되돌리면 다시 목록에 든다.
  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('Control+z')
  await expect(fold.locator('li', { hasText: 'TEMP-101-01' })).toBeVisible()
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

test('펼친 칸의 제목 줄은 스크롤을 따라와서 끝에서 바로 접는다', async ({ page }) => {
  const errors = await open(page)
  const head = page.getByRole('button', { name: /층별 요약/ })
  if ((await head.getAttribute('aria-expanded')) === 'false') await head.click()
  const fold = page.locator('section.fold', { has: head })
  // 칸 머리가 도구막대 밑으로 들어가게 내린다. 제목 줄은 도구막대 바로 아래 붙어 있어야 한다.
  await fold.evaluate((el) => {
    const bar = document.querySelector('.appbar')!.getBoundingClientRect().height
    window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - bar + 60)
  })
  const bar = await page.locator('.appbar').boundingBox()
  const box = await head.boundingBox()
  expect(Math.abs(box!.y - (bar!.y + bar!.height))).toBeLessThan(2)
  // 접으면 칸 머리가 화면 안에 남는다.
  await head.click()
  await expect(head).toHaveAttribute('aria-expanded', 'false')
  await expect(head).toBeInViewport()
  expect(errors).toEqual([])
})

test('층별 요약에 층고를 출처와 같이 보이고, 모르면 모름이라 적는다 (OE-BIM-02)', async ({ page }) => {
  // fixture 는 BIM 이 층 높이를 안 적었다. 1F 는 윗층(2F, 3m)과의 차로 계산하고, 맨 위 2F 는 모른다.
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('input[type=file]').first().setInputFiles('src/lib/ifc/fixtures/two-rooms.ifc')
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  const height = (i: number) => page.locator('.storeys tbody tr').nth(i).locator('td.storey-height')
  await expect(height(0)).toHaveText(/3\.00 m\s*계산/)
  await expect(height(1)).toHaveText('모름')

  // AC20 은 ArchiCAD 가 기준 물량(GrossHeight)을 적었다. 맨 위 다락(2.0m)도 BIM 값으로 안다.
  const AC20 = 'data/AC20-FZK-Haus.ifc'
  if (existsSync(AC20)) {
    await page.locator('input[type=file]').first().setInputFiles(AC20)
    await expect(page.locator('.appbar h2')).toHaveText('AC20-FZK-Haus.ifc', { timeout: 60_000 })
    await expect(height(0)).toHaveText(/2\.70 m\s*BIM/)
    await expect(height(1)).toHaveText(/2\.00 m\s*BIM/)
    await expect(height(0).locator('span[title]').first()).toHaveAttribute('title', /BaseQuantities\.GrossHeight[\s\S]*순 높이\(BIM, 윗층 바닥판 아래까지\) 2\.70 m/)
    if (process.env.SHOT) await page.locator('.storeys').screenshot({ path: process.env.SHOT })
  }

  // BIM 값(3.2m)과 계산 값(3.0m)이 1cm 넘게 다르면 계산 값을 옆에 붙인다. 밀리미터 파일이라 미터로 바꿔 읽는다.
  await page.locator('input[type=file]').first().setInputFiles('src/lib/ifc/fixtures/storey-height.ifc')
  await expect(page.locator('.appbar h2')).toHaveText('storey-height.ifc', { timeout: 30_000 })
  await expect(height(0)).toHaveText(/3\.20 m\s*BIM\s*계산 3\.00 m/)
  await expect(height(0).locator('.height-mismatch')).toHaveText(/계산 3\.00 m/)

  // 단위를 mm 로 잘못 선언한 Duplex COBie 는 층고가 몇 mm 다. 0.00 으로 뭉개지 않고 유효 숫자로 보인다.
  const COBIE = 'data/NBU_Duplex/NBU_Duplex-Apt-COBie_Arch-Design.ifc'
  if (existsSync(COBIE)) {
    await page.locator('input[type=file]').first().setInputFiles(COBIE)
    await expect(page.locator('.appbar h2')).toHaveText(/COBie_Arch-Design/, { timeout: 60_000 })
    await expect(page.locator('.storeys tbody td.storey-height').filter({ hasText: '0.0031 m' })).toHaveCount(1)
  }
  expect(errors).toEqual([])
})
