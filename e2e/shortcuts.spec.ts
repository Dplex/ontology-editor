import { expect, test, type Page } from '@playwright/test'

// 편집 화면의 단축키. 키 표(lib/shortcuts.ts)가 안내와 동작을 같이 정하므로, 안내에 적힌 키가 실제로 먹는지를
// 키보드로 누르며 본다. 3D 가 어디를 그렸는지는 e2e 모드의 window.__viewer 로 묻는다(viewer.ts).
const MEP = 'src/lib/ifc/fixtures/mep.ifc'
const AT02 = '0MEP$Equip$AT02$0000'

async function open(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(MEP)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  return errors
}

const settle = (page: Page) =>
  page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))))

const row = (page: Page, name: string) => page.locator('.equipment tbody tr', { hasText: name }).last()
const coords = async (page: Page, name: string) =>
  Promise.all([0, 1, 2].map(async (i) => Number(await row(page, name).locator('.coord').nth(i).inputValue())))

async function pick(page: Page, name: string) {
  await row(page, name).getByRole('button', { name, exact: true }).click()
  await page.locator('.viewport canvas').scrollIntoViewIfNeeded()
  await settle(page)
}

test('? 를 누르면 단축키 안내가 뜨고 Esc 로 닫힌다. 글자 칸에서 친 ? 는 안내를 열지 않는다', async ({ page }) => {
  const errors = await open(page)
  await page.keyboard.press('Shift+Slash')
  const help = page.getByRole('dialog', { name: '단축키' })
  await expect(help).toBeVisible()
  // 안내는 키 표 그대로다. 보기 모드라 편집 키에는 "편집" 표시가 붙는다.
  await expect(help).toContainText('보기 ↔ 편집')
  await expect(help).toContainText('다시 하기')
  await expect(help.locator('dd', { hasText: '되돌리기' }).locator('.tag')).toHaveText('편집')
  // 열린 동안 뒤의 화면은 키를 받지 않는다.
  await page.keyboard.press('e')
  await expect(page.getByRole('button', { name: '보기', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('Escape')
  await expect(help).toBeHidden()

  // 버튼으로도 연다.
  await page.locator('.appbar .keys-help').click()
  await expect(help).toBeVisible()
  await help.getByRole('button', { name: /닫기/ }).click()
  await expect(help).toBeHidden()

  await page.getByRole('button', { name: '편집', exact: true }).click()
  const name = page.locator('.rows input').first()
  await name.click()
  await page.keyboard.press('Shift+Slash')
  await expect(help).toBeHidden()
  expect(errors).toEqual([])
})

test('E 는 보기와 편집을 오간다', async ({ page }) => {
  const errors = await open(page)
  await page.keyboard.press('e')
  await expect(page.locator('.edit-bar')).toBeVisible()
  await expect(page.getByRole('button', { name: '편집', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.keyboard.press('e')
  await expect(page.locator('.edit-bar')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('방향키는 고른 설비를 10cm(Shift 1m) 옮기고, 누른 만큼이 되돌리기 한 번이며, 다시 하기로 돌아온다', async ({ page }) => {
  const errors = await open(page)
  await page.keyboard.press('e')
  await pick(page, 'AHU-1')
  const start = await coords(page, 'AHU-1')

  await page.keyboard.press('ArrowRight')
  let now = await coords(page, 'AHU-1')
  // 화면 방향에 가장 가까운 평면 축 하나로만 움직인다. 높이는 그대로다.
  const moved = [Math.abs(now[0] - start[0]), Math.abs(now[1] - start[1])]
  expect(moved.sort()).toEqual([0, expect.closeTo(0.1, 5)])
  expect(now[2]).toBe(start[2])
  await expect(row(page, 'AHU-1').locator('.src.edit')).toBeVisible()

  await page.keyboard.press('Shift+ArrowRight')
  await page.keyboard.press('ArrowUp')
  now = await coords(page, 'AHU-1')
  expect(Math.hypot(now[0] - start[0], now[1] - start[1])).toBeGreaterThan(1)
  await expect(page.locator('.key-note')).toContainText('AHU-1')

  // 이어 누른 것은 한 단계다. 한 번 되돌리면 처음 자리다.
  await page.keyboard.press('Control+z')
  await expect.poll(() => coords(page, 'AHU-1')).toEqual(start)
  await expect(page.locator('.edit-bar')).toContainText('바뀐 것 0건')
  await expect(page.locator('.edit-bar .undo')).toBeDisabled()

  await page.keyboard.press('Control+Shift+z')
  await expect.poll(() => coords(page, 'AHU-1')).toEqual(now)
  await expect(page.locator('.edit-bar .redo')).toBeDisabled()
  // 버튼으로도 되돌리고 다시 한다.
  await page.locator('.edit-bar .undo').click()
  await expect.poll(() => coords(page, 'AHU-1')).toEqual(start)
  await page.locator('.edit-bar .redo').click()
  await expect.poll(() => coords(page, 'AHU-1')).toEqual(now)

  // 새 편집을 하면 다시 할 것이 사라진다.
  await page.keyboard.press('Control+z')
  await page.keyboard.press('ArrowLeft')
  await expect(page.locator('.edit-bar .redo')).toBeDisabled()
  expect(errors).toEqual([])
})

test('[ ] 로 연결을 짚고 D 로 방향을 바꾼다. Esc 는 짚은 연결, 그다음 고른 설비를 푼다', async ({ page }) => {
  const errors = await open(page)
  await page.keyboard.press('e')
  await pick(page, 'DUCT-01')

  type ArrowAt = { a: string; b: string; source: string; active: boolean }
  const arrows = () => page.evaluate(() => (window as any).__viewer.arrows()) as Promise<ArrowAt[]>
  const rows = page.locator('.picked .neighbors tr')
  const target = rows.filter({ hasText: 'AT-101-02' })
  const index = await rows.evaluateAll((trs) => trs.findIndex((tr) => tr.textContent!.includes('AT-101-02')))

  // 연결이 셋이라 D 만 누르면 먼저 짚으라고 한다.
  await page.keyboard.press('d')
  await expect(page.locator('.key-note')).toContainText('[ ]')
  await expect(rows.nth(0)).toHaveClass(/active/)

  for (let i = 0; i < index; i++) await page.keyboard.press(']')
  await expect(target).toHaveClass(/active/)
  expect((await arrows()).find((x) => x.a === AT02 || x.b === AT02)!.active).toBe(true)

  // D 는 미리보기, Enter 가 [적용] 이다(OE-PIP-04).
  await page.keyboard.press('d')
  await expect(target.getByTestId('flow-preview')).toContainText('DUCT-01 → AT-101-02')
  await page.keyboard.press('Enter')
  await expect(target.locator('.rel')).toHaveText('하류')
  await expect(page.locator('.report')).toContainText('DUCT-01 → AT-101-02')
  await page.keyboard.press('d')
  await expect(target.getByTestId('flow-preview')).toContainText('AT-101-02 → DUCT-01')
  await page.keyboard.press('d')
  await expect(target.getByTestId('flow-preview')).toHaveCount(0)
  await expect(target.locator('.rel')).toHaveText('하류')

  await page.keyboard.press('Escape')
  await expect(target).not.toHaveClass(/active/)
  await expect(page.locator('.picked')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.locator('.picked')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('U 는 종류를 모르는 타입의 설비로 가고, K 로 종류 상자를 연다. 고르면 상자가 포커스를 놓는다', async ({ page }) => {
  const errors = await open(page)
  await page.keyboard.press('e')
  await page.keyboard.press('u')
  await expect(page.locator('.picked h3')).toHaveText('TEMP-101-01')
  await expect(page.locator('.key-note')).toContainText('1/1')

  await page.keyboard.press('k')
  const kind = page.locator('.kind-edit select')
  await expect(kind).toBeFocused()
  await kind.selectOption({ label: '열감지기' })
  await expect(kind).not.toBeFocused()
  await expect(page.locator('.report')).toContainText('열감지기')

  // 상자를 놓았으니 다음 키가 다시 단축키다.
  await page.keyboard.press('u')
  await expect(page.locator('.key-note')).toContainText('종류를 모르는 설비가 없습니다')
  expect(errors).toEqual([])
})

test('되돌린 뒤에도 다음 단축키의 안내가 보인다', async ({ page }) => {
  // 되돌리기 알림이 경고 칸에 남아 있어서, 뒤이어 누른 U 의 "종류 모르는 패밀리" 안내가 가려졌었다.
  const errors = await open(page)
  await page.keyboard.press('e')
  await pick(page, 'AHU-1')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Control+z')
  await expect(page.locator('.key-note')).toContainText('되돌렸습니다')
  await page.keyboard.press('u')
  await expect(page.locator('.key-note')).toContainText('종류 모르는 패밀리 1/1')
  await expect(page.locator('.edit-notice')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('보기 모드에서는 편집 키가 먹지 않는다', async ({ page }) => {
  const errors = await open(page)
  await pick(page, 'AHU-1')
  const before = await row(page, 'AHU-1').locator('td.num').first().textContent()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('PageUp')
  await expect(row(page, 'AHU-1').locator('td.num').first()).toHaveText(before!)
  await expect(page.locator('.key-note')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('방 안에서 옮긴 좌표와 물리존 이름도 바뀐 것으로 세고, 되돌리면 빠진다', async ({ page }) => {
  const errors = await open(page)
  await page.keyboard.press('e')
  await pick(page, 'AHU-1')
  // 방 안에서 1m. 소속은 그대로지만 GeoJSON 의 좌표가 바뀐다.
  await page.keyboard.press('Shift+ArrowRight')
  await expect(page.locator('.edit-bar')).toContainText('바뀐 것 1건')
  await expect(page.locator('.report .moved-only')).toContainText('AHU-1')

  const name = page.locator('.rows input').first()
  await name.fill('대회의실')
  await name.press('Enter')
  await expect(page.locator('.edit-bar')).toContainText('바뀐 것 2건')
  await expect(page.locator('.report')).toContainText('사무실 → 대회의실 (rdfs:label)')

  await page.locator('.edit-bar .undo').click()
  await page.locator('.edit-bar .undo').click()
  await expect(page.locator('.edit-bar')).toContainText('바뀐 것 0건')
  await expect(page.locator('.report')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('물리존을 고르면 [ ] 로 꼭짓점을 짚고 방향키로 옮기며, 이어 누른 것은 되돌리기 한 번이다', async ({ page }) => {
  const errors = await open(page)
  await page.keyboard.press('e')
  await page.locator('.viewport canvas').scrollIntoViewIfNeeded()
  // 사무실 모서리 근처 빈 바닥(edit-3d.spec.ts 와 같은 자리).
  const floor = (await page.evaluate(() => (window as any).__viewer.point([9.6, 7.6, 0.1]))) as { x: number; y: number }
  await page.mouse.click(floor.x, floor.y)
  const panel = page.locator('.space-picked')
  await expect(panel).toContainText('80.0')

  // 짚지 않고 방향키를 누르면 먼저 짚으라고 한다.
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('.key-note')).toContainText('[ ]')

  await page.keyboard.press(']')
  await expect(page.locator('.key-note')).toContainText('꼭짓점 1/4')
  // 1m 씩 두 번. 사무실 한 변이 2m 늘거나 줄어 넓이가 80 에서 벗어난다. 이어 누른 것은 한 단계다.
  await page.keyboard.press('Shift+ArrowRight')
  await page.keyboard.press('Shift+ArrowRight')
  await expect(panel).not.toContainText('80.0')
  await expect(page.locator('.report')).toContainText('80.0㎡ →')
  await page.keyboard.press('Control+z')
  await expect(panel).toContainText('80.0')
  await expect(page.locator('.edit-bar')).toContainText('바뀐 것 0건')

  // Esc 는 짚은 꼭짓점을 먼저 풀고, 그다음 물리존을 푼다.
  await page.keyboard.press('Escape')
  await expect(panel).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(panel).toHaveCount(0)
  expect(errors).toEqual([])
})

test('계통별 확정 표에서 남은 계통과 일치율을 보고 바로 확정하며, 되돌리면 다시 확정 전이다', async ({ page }) => {
  const errors = await open(page)
  await page.keyboard.press('e')
  await page.getByRole('button', { name: /규칙 방향 확정 \(계통별\)/ }).click()
  const fold = page.locator('.rule-systems')
  const row = fold.locator('tbody tr', { hasText: 'AHU-1 급기 계통' })
  await expect(row).toContainText('100%')
  await expect(fold).toContainText('확정 0개')

  await row.getByRole('button', { name: '확정' }).click()
  await expect(row).toContainText('확정함')
  await expect(page.locator('.report')).toContainText('AHU-1 급기 계통')
  await expect(fold).toContainText('확정 1개')

  // 이름을 누르면 3D 에 그 계통만 남긴다(범례와 같은 선택).
  await row.getByRole('button', { name: 'AHU-1 급기 계통' }).click()
  await expect(row).toHaveClass(/chosen/)

  await page.keyboard.press('Control+z')
  await expect(row.getByRole('button', { name: '확정' })).toBeVisible()
  expect(errors).toEqual([])
})

test('N 은 완전성 검사에서 어긴 것을 하나씩 고르고, 펼친 규칙이 없으면 첫 규칙을 편다', async ({ page }) => {
  const errors = await open(page)
  await page.keyboard.press('n')
  await expect(page.locator('.key-note')).toContainText('위반 1/1')
  await expect(page.locator('.picked h3')).toBeVisible()
  // 펼친 규칙이 표에 표시된다.
  await expect(page.locator('.checks tbody tr.chosen')).toHaveCount(1)
  expect(errors).toEqual([])
})

test('N 으로 소속 없는 설비에 가서 패널에서 좌표를 넣으면 그 규칙이 통과하고, N 은 다음 규칙으로 간다', async ({ page }) => {
  const errors = await open(page)
  await page.keyboard.press('e')
  await page.keyboard.press('n')
  await expect(page.locator('.picked h3')).toHaveText('TEMP-101-01')
  const inputs = page.locator('.position-edit input')
  await expect(page.locator('.position-edit')).toContainText('좌표가 없습니다')

  // 한 축만 넣으면 옮기지 않는다(0 으로 채우지 않는다).
  await inputs.nth(0).fill('5')
  await inputs.nth(0).press('Enter')
  await expect(page.locator('.position-edit')).toContainText('모두 넣어야')
  await inputs.nth(1).fill('4')
  await inputs.nth(1).press('Enter')
  await inputs.nth(2).fill('2.7')
  await inputs.nth(2).press('Enter')
  await expect(page.locator('.position-edit')).toContainText('소속 사무실')

  // 글자 칸의 Esc 는 칸에서 나온다. 그다음 N 은 다시 단축키다.
  await page.keyboard.press('Escape')
  await expect(inputs.nth(2)).not.toBeFocused()
  await expect(page.locator('.picked h3')).toHaveText('TEMP-101-01')
  // 소속 규칙은 이제 통과다. N 은 어긴 것이 남은 다음 규칙으로 간다(픽스처에는 열원이 없어 공조기가 물 계통 규칙을 어긴다).
  await expect(page.locator('.checks tbody tr', { hasText: '소속 방이 있다' }).locator('button')).toHaveCount(0)
  await page.keyboard.press('n')
  await expect(page.locator('.key-note')).toContainText('열원과 이어져 있다')
  await expect(page.locator('.key-note')).toContainText('위반 1/1: AHU-1')
  expect(errors).toEqual([])
})
