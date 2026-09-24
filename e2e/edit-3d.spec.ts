import { expect, test, type Page } from '@playwright/test'

// 3D 에서 고치는 네 가지(설비 끌기 E5, 꼭짓점 끌기 E2, 연결 방향, 층 옮기기 E6)를 실제 마우스로 재현한다.
// 3D 는 DOM 이 아니라서 어디를 눌러야 하는지를 e2e 모드에서만 열리는 window.__viewer 로 묻는다
// (viewer.ts). 누르고 끄는 것은 전부 page.mouse 다 — 이벤트를 흉내 내면 캡처·컨트롤 충돌을 못 잡는다.
const MEP = 'src/lib/ifc/fixtures/mep.ifc'
const ROOMS = 'src/lib/ifc/fixtures/two-rooms.ifc'
const AHU = '0MEP$Equip$AHU1$0000'
const DUCT = '0MEP$Duct$D01$00000'
const AT02 = '0MEP$Equip$AT02$0000'

type Pt = { x: number; y: number }

async function open(page: Page, file = MEP) {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(file)
  await expect(page.locator('.review h2')).toBeVisible({ timeout: 30_000 })
  return errors
}

/** 두 프레임을 기다린다. 3D 는 다음 프레임에 그리고, 화면 좌표는 그린 뒤의 카메라로 잰다. */
const settle = (page: Page) =>
  page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))))

const viewer = <T>(page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(([f, a]) => (window as any).__viewer[f as string](...(a as unknown[])), [fn, args] as const) as Promise<T>

async function drag(page: Page, from: Pt, to: Pt) {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 12 })
  await page.mouse.up()
  await settle(page)
}

const row = (page: Page, name: string) => page.locator('.equipment tbody tr', { hasText: name }).last()
const coord = (page: Page, name: string, axis: number) => row(page, name).locator('.coord').nth(axis).inputValue()

/** 표에서 설비를 고른다. 3D 가 그 자리로 시점을 옮긴다. 표는 3D 아래라 누르면 스크롤이 내려가니 3D 를 다시 띄운다. */
async function pick(page: Page, name: string) {
  await row(page, name).getByRole('button', { name, exact: true }).click()
  await page.locator('.viewport canvas').scrollIntoViewIfNeeded()
  await page.waitForTimeout(200)
  await settle(page)
}

test('3D 위 편집 체크박스는 보기/편집 버튼과 같은 상태이고, 끄면 끌어도 아무것도 안 바뀐다', async ({ page }) => {
  const errors = await open(page)
  const box = page.locator('.edit-toggle input')
  const editButton = page.getByRole('button', { name: '편집', exact: true })

  await expect(box).not.toBeChecked()
  await editButton.click()
  await expect(box).toBeChecked()
  await expect(page.locator('.edit-bar')).toBeVisible()

  await box.uncheck()
  await expect(page.getByRole('button', { name: '보기', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.edit-bar')).toHaveCount(0)

  // 보기 모드에서 고른 설비를 끌면 시점만 돈다. 좌표는 그대로다.
  await pick(page, 'AHU-1')
  const before = await row(page, 'AHU-1').locator('td.num').first().textContent()
  const at = (await viewer<Pt>(page, 'part', AHU))!
  await drag(page, at, { x: at.x + 150, y: at.y })
  await expect(row(page, 'AHU-1').locator('td.num').first()).toHaveText(before!)

  // 다시 켜면 버튼도 따라온다.
  await box.check()
  await expect(editButton).toHaveAttribute('aria-pressed', 'true')
  expect(errors).toEqual([])
})

test('편집 모드에서 고른 설비를 3D 로 끌면 좌표와 소속이 바뀌고, 끄는 중 Esc 는 취소다', async ({ page }) => {
  const errors = await open(page)
  await page.locator('.edit-toggle input').check()
  await pick(page, 'AHU-1')
  await expect(row(page, 'AHU-1')).toContainText('사무실')

  // 끌기는 형상 중심 높이의 수평면 위다. 같은 높이에서 x 로 8m 옮긴 자리의 화면 좌표로 끈다.
  const center = (await viewer<number[]>(page, 'center', AHU))!
  const from = (await viewer<Pt>(page, 'part', AHU))!
  const to = (await viewer<Pt>(page, 'point', [center[0] - 8, center[1], center[2]]))!

  // Esc: 끄다가 버리면 제자리다.
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 12 })
  await page.keyboard.press('Escape')
  await page.mouse.up()
  await settle(page)
  await expect(page.locator('.edit-bar')).toContainText('바뀐 것 0건')
  await expect(row(page, 'AHU-1')).toContainText('사무실')

  // 이번엔 놓는다. 사무실(0~10, 0~8) 밖이라 소속이 빠지고 리포트에 한 줄이 생긴다.
  const x0 = Number(await coord(page, 'AHU-1', 0))
  await drag(page, from, to)
  await expect(row(page, 'AHU-1')).toContainText('(소속 없음)')
  await expect(page.locator('.edit-bar')).toContainText('바뀐 것 1건')
  await expect(page.locator('.report')).toContainText('AHU-1')
  const x1 = Number(await coord(page, 'AHU-1', 0))
  expect(x1).toBeCloseTo(x0 - 8, 0)
  // 사람이 옮긴 좌표라 출처가 편집이다.
  await expect(row(page, 'AHU-1').locator('.src.edit')).toBeVisible()

  // 제자리로 끌어 오면 리포트에서 빠진다(되돌린 것은 변경이 아니다).
  const back = (await viewer<Pt>(page, 'part', AHU))!
  const home = (await viewer<Pt>(page, 'point', center))!
  await drag(page, back, home)
  await expect(row(page, 'AHU-1')).toContainText('사무실')
  await expect(page.locator('.edit-bar')).toContainText('바뀐 것 0건')
  expect(errors).toEqual([])
})

test('편집 모드에서 바닥을 누르면 물리존이 골라지고, 꼭짓점을 끌면 넓이와 소속이 바뀐다', async ({ page }) => {
  const errors = await open(page)
  await page.locator('.edit-toggle input').check()

  // 사무실 모서리 근처 빈 바닥. 설비가 없는 자리를 눌러야 물리존이 골라진다.
  const floor = (await viewer<Pt>(page, 'point', [9.6, 7.6, 0.1]))!
  await page.mouse.click(floor.x, floor.y)
  const panel = page.locator('.space-picked')
  await expect(panel).toContainText('사무실')
  await expect(panel).toContainText('80.0')
  await expect(panel.locator('.space-members')).toContainText('AT-101-02')
  expect(await viewer<unknown[]>(page, 'handles')).toHaveLength(4)

  // 엇갈리는 자리에는 놓지 않는다. (0,0) 을 (20,4) 로 끌면 두 변이 교차한다.
  await drag(page, (await viewer<Pt>(page, 'point', [0, 0, 0.12]))!, (await viewer<Pt>(page, 'point', [20, 4, 0.12]))!)
  await expect(page.locator('.edit-notice')).toContainText('엇갈리는')
  await expect(panel).toContainText('80.0')
  await expect(page.locator('.edit-bar')).toContainText('바뀐 것 0건')

  // (10,0) 을 (4,4) 로 끈다. 넓이가 36㎡ 가 되고, (7,4) 의 AT-101-02 가 밖으로 밀려난다.
  await drag(page, (await viewer<Pt>(page, 'point', [10, 0, 0.12]))!, (await viewer<Pt>(page, 'point', [4, 4, 0.12]))!)
  await expect(panel).toContainText('36.0')
  await expect(panel.locator('.src.edit')).toBeVisible()
  await expect(row(page, 'AT-101-02')).toContainText('(소속 없음)')
  await expect(page.locator('.report')).toContainText('80.0㎡ → 36.0㎡')
  await expect(page.locator('.report')).toContainText('AT-101-02')

  // 보기 모드로 가면 손잡이가 사라진다.
  await page.locator('.edit-toggle input').uncheck()
  expect(await viewer<unknown[]>(page, 'handles')).toHaveLength(0)
  expect(errors).toEqual([])
})

test('편집 모드에서 연결 화살표를 누르면 방향이 하류 → 상류 → 지움으로 바뀌고, 포트 방향은 못 고친다', async ({ page }) => {
  const errors = await open(page)
  await page.locator('.edit-toggle input').check()
  await pick(page, 'DUCT-01')

  type ArrowAt = { key: string; a: string; b: string; source: string; at: Pt }
  const arrows = () => viewer<ArrowAt[]>(page, 'arrows')
  const toward = async (id: string) => (await arrows()).find((x) => x.a === id || x.b === id)!

  // 셋이다. 포트가 방향을 말한 둘(AHU·AT-101-01)과 규칙이 짐작한 하나(AT-101-02).
  expect(await arrows()).toHaveLength(3)
  expect((await toward(AHU)).source).toBe('port')
  expect((await toward(AT02)).source).toBe('rule')
  await expect(page.locator('.color-key')).toContainText('사람이 정한 방향')

  const terminal = page.locator('.picked .neighbors tr', { hasText: 'AT-101-02' })
  await expect(terminal.locator('.rel')).toHaveText('하류(추정)')

  // 한 번: 이 설비에서 나간다(하류). 사람이 정한 방향이라 규칙보다 앞서고 확정 없이 feeds 로 나간다.
  let at = (await toward(AT02)).at
  await page.mouse.click(at.x, at.y)
  await expect(terminal.locator('.rel')).toHaveText('하류')
  await expect(terminal).toContainText('사람이 정한 방향')
  expect((await toward(AT02)).source).toBe('edit')
  await expect(page.locator('.report')).toContainText('DUCT-01 → AT-101-02')

  // 두 번: 뒤집는다.
  at = (await toward(AT02)).at
  await page.mouse.click(at.x, at.y)
  await expect(terminal.locator('.rel')).toHaveText('상류')
  await expect(page.locator('.report')).toContainText('AT-101-02 → DUCT-01')

  // 세 번: 지운다. 규칙 방향으로 돌아가고 리포트에서 빠진다.
  at = (await toward(AT02)).at
  await page.mouse.click(at.x, at.y)
  await expect(terminal.locator('.rel')).toHaveText('하류(추정)')
  await expect(page.locator('.edit-bar')).toContainText('바뀐 것 0건')

  // 포트가 말한 방향은 누르면 이유를 말하고 그대로 둔다.
  at = (await toward(AHU)).at
  await page.mouse.click(at.x, at.y)
  await expect(page.locator('.edit-notice')).toContainText('포트(BIM)')
  await expect(page.locator('.picked .neighbors tr', { hasText: 'AHU-1' }).locator('.rel')).toHaveText('상류')
  expect(errors).toEqual([])
})

test('편집 모드에서 고른 설비의 층을 바꾸면 높이도 층 차만큼 옮긴다', async ({ page }) => {
  const errors = await open(page)
  // 층이 둘인 모델이 필요하다. 설비 파일에 건축 파일을 덧붙인다(1F 는 이름으로 맞춰진다).
  await page.locator('.append input[type=file]').setInputFiles(ROOMS)
  await expect(page.locator('.review h2')).toHaveText('two-rooms.ifc + mep.ifc', { timeout: 30_000 })

  await page.locator('.edit-toggle input').check()
  await pick(page, 'AHU-1')
  const z0 = Number(await coord(page, 'AHU-1', 2))

  const select = page.locator('.storey-move select')
  await expect(select.locator('option:checked')).toHaveText('1F')
  await expect(page.locator('.storey-move .src.bim')).toBeVisible()
  await select.selectOption({ label: '2F' })

  // two-rooms 의 2F 바닥은 3.0m 다.
  await expect.poll(async () => Number(await coord(page, 'AHU-1', 2))).toBeCloseTo(z0 + 3, 5)
  await expect(page.locator('.storey-move .src.edit')).toBeVisible()
  await expect(page.locator('.storeys tbody tr', { hasText: '2F' }).locator('td').last()).toHaveText('1')
  // 2F 의 창고에는 외곽선이 없어 소속이 빠진다.
  await expect(row(page, 'AHU-1')).toContainText('(소속 없음)')
  expect(errors).toEqual([])
})
