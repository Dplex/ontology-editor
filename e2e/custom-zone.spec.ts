import { existsSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'

// 커스텀존(OE-OBJ-01)을 실제 마우스로 그리고, 이름을 고치고, 나누고, 합치고, 지우며 되돌린다. mep.ifc 의 사무실은 0..10 × 0..8 이고
// 디퓨저 둘(AT-101-01 (3,4), AT-101-02 (7,4))과 공조기 AHU-1(1,1)이 그 안에 있다. 조명이 (50,50)에 있어 처음 시점에는 사무실이 작으니, 사무실을 눌러
// 고르고 F 로 시점을 맞춘 뒤 그린다. 바닥 자리는 e2e 모드의 window.__viewer.point 로 묻는다.
const MEP = 'src/lib/ifc/fixtures/mep.ifc'

async function clickFloor(page: Page, x: number, y: number) {
  const at = (await page.evaluate(([px, py]) => (window as any).__viewer.point([px, py, 0]), [x, y])) as { x: number; y: number }
  await page.mouse.click(at.x, at.y)
}

test('커스텀존을 그리면 품는 방·든 설비가 계산되고, 이름·나누기·합치기·지우기가 되돌리기에 쌓이며 리포트에 오른다', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(MEP)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '편집', exact: true }).click()
  await page.locator('.viewport canvas').scrollIntoViewIfNeeded()
  await page.waitForTimeout(200)
  await clickFloor(page, 6, 4)
  await expect(page.locator('.space-picked h3')).toHaveText('사무실')
  await page.keyboard.press('f')
  await page.waitForTimeout(800)
  await page.keyboard.press('Escape')

  // 사무실 대부분(1.5..9.5 × 0.5..7.5)을 덮는 존 — 사무실 바닥의 절반을 넘게 덮어 사무실을 품고, 디퓨저 둘이 안에 든다(AHU-1 은 밖).
  await page.getByRole('button', { name: '커스텀존 그리기' }).click()
  for (const [x, y] of [[1.5, 0.5], [9.5, 0.5], [9.5, 7.5], [1.5, 7.5]]) await clickFloor(page, x, y)
  await page.keyboard.press('Enter')
  const panel = page.locator('.custom-zone-picked')
  await expect(panel.locator('h3')).toHaveText('커스텀존 1')
  await expect(panel.getByTestId('zone-spaces')).toContainText('사무실')
  await expect(panel.getByTestId('zone-equipment')).toContainText('2대')

  // 이름(별명).
  const name = panel.getByTestId('zone-name')
  await name.fill('개발팀')
  await name.press('Enter')
  await expect(panel.locator('h3')).toHaveText('개발팀')

  // x=5 로 나누면 넓은 쪽(1.5..5 가 3.5m, 5..9.5 가 4.5m)이 이름을 이어받고 좁은 쪽이 "개발팀 2" 다. 디퓨저가 하나씩 든다.
  await panel.getByRole('button', { name: '나누기' }).click()
  await clickFloor(page, 5, -1)
  await clickFloor(page, 5, 9)
  await expect(panel.locator('h3')).toHaveText('개발팀')
  await expect(panel.getByTestId('zone-equipment')).toContainText('1대')
  await expect(page.locator('.edit-bar')).toContainText('바뀐 것 2건')

  // 다시 합친다.
  const zones = await panel.locator('select[aria-label="합칠 커스텀존"] option').allTextContents()
  expect(zones).toContain('개발팀 2')
  await panel.locator('select[aria-label="합칠 커스텀존"]').selectOption({ label: '개발팀 2' })
  await expect(panel.getByTestId('zone-equipment')).toContainText('2대')

  // 지우고 Ctrl+Z 로 되돌린다.
  await panel.getByRole('button', { name: '커스텀존 지우기' }).click()
  await expect(panel).toHaveCount(0)
  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('Control+z')
  await expect(page.locator('.overview')).toContainText('커스텀존 1')
  await page.locator('.overview').getByRole('button', { name: '개발팀' }).click()
  await expect(panel.locator('h3')).toHaveText('개발팀')
  expect(errors).toEqual([])
})

test('커스텀존에 별명을 여럿 달면 패널·TTL 에 나온다 (ADR-0012)', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(MEP)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '편집', exact: true }).click()
  await page.locator('.viewport canvas').scrollIntoViewIfNeeded()
  await page.waitForTimeout(200)
  await clickFloor(page, 6, 4)
  await page.keyboard.press('f')
  await page.waitForTimeout(800)
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '커스텀존 그리기' }).click()
  for (const [x, y] of [[1.5, 0.5], [9.5, 0.5], [9.5, 7.5], [1.5, 7.5]]) await clickFloor(page, x, y)
  await page.keyboard.press('Enter')
  const panel = page.locator('.custom-zone-picked')
  await panel.getByTestId('zone-name').fill('임원석')
  await panel.getByTestId('zone-name').press('Enter')
  // 쉼표는 반각·전각(한글 입력기의 ，) 둘 다 가른다.
  const aliases = panel.getByTestId('zone-aliases-input')
  await aliases.fill('임원 구역, 경영진석，임원실')
  await aliases.press('Enter')
  await expect(panel.getByTestId('zone-aliases')).toHaveText(/임원 구역, 경영진석, 임원실/)
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT })

  // 별명으로 설비 찾기는 아래 Duplex 시험이 본다 — 이 fixture 는 작아서 검색 칸이 없다.
  const ttl = page.waitForEvent('download')
  await page.getByRole('button', { name: '의미 내보내기 (Brick TTL)' }).click()
  const text = Buffer.concat(await (await (await ttl).createReadStream()).toArray()).toString()
  expect(text).toContain('rdfs:label "임원석" ;')
  expect(text).toContain('ex:alias "임원 구역", "경영진석", "임원실" ;')
  expect(errors).toEqual([])
})

// 설비 검색은 든 커스텀존의 이름·별명으로도 찾는다(ADR-0012). 검색 칸은 물리존+설비가 50 을 넘는 파일에만 있어 Duplex MEP 로 잰다.
const DUPLEX_MEP = 'data/NBU_Duplex/NBU_Duplex-Apt_Eng-MEP.ifc'
test('Duplex MEP: 커스텀존의 별명으로 검색하면 그 존 안의 설비가 나온다', async ({ page }) => {
  test.skip(!existsSync(DUPLEX_MEP), `${DUPLEX_MEP} 이 없다(npm run fetch:sample)`)
  test.setTimeout(120_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(DUPLEX_MEP)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 90_000 })
  await page.getByRole('button', { name: '편집', exact: true }).click()
  // 처음 보이는 층(Level 1)의 설비 하나를 평면도에서 고른다 — 이름과 자리를 읽는다.
  const view = page.getByRole('group', { name: '보기' })
  await view.getByRole('button', { name: '평면도' }).click()
  const dot = page.locator('svg.floor-plan .devices circle').first()
  const [id, name] = await dot.evaluate((e) => [e.getAttribute('data-equipment')!, e.querySelector('title')?.textContent ?? ''])
  await view.getByRole('button', { name: '3D' }).click()
  await page.locator('.viewport canvas').scrollIntoViewIfNeeded()
  await page.waitForTimeout(300)
  const [x, y] = (await page.evaluate((i) => (window as any).__viewer.center(i), id)) as number[]
  // 이름으로는 안 나온다(대조군).
  const search = page.locator('input[type=search]')
  await search.fill('경영진석')
  await expect(page.locator('.equipment tbody tr')).toHaveCount(0)
  await search.fill('')

  // 그 설비를 둘러 커스텀존을 그리고 별명을 단다.
  await page.getByRole('button', { name: '커스텀존 그리기' }).click()
  for (const [dx, dy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) await clickFloor(page, x + dx, y + dy)
  await page.keyboard.press('Enter')
  const panel = page.locator('.custom-zone-picked')
  await expect(panel.getByTestId('zone-equipment')).not.toContainText('0대')
  await panel.getByTestId('zone-aliases-input').fill('경영진석')
  await panel.getByTestId('zone-aliases-input').press('Enter')
  await expect(panel.getByTestId('zone-aliases')).toContainText('경영진석')

  await search.fill('경영진석')
  await expect(page.locator('.equipment tbody tr', { hasText: name }).first()).toBeVisible()
  if (process.env.SHOT) await page.locator('table.equipment').screenshot({ path: process.env.SHOT })
  expect(errors).toEqual([])
})
