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
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  return errors
}
// 디퓨저·조명은 천장 설비라 천장 편집 모드(T)에서 고친다(OE-OBJ-08).
async function enterCeiling(page: Page) {
  const on = page.getByRole('group', { name: '설비 편집 면' }).getByRole('button', { name: '천장' })
  if ((await on.getAttribute('aria-pressed')) === 'true') return
  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('t')
  await expect(on).toHaveAttribute('aria-pressed', 'true')
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

test('3D 위 편집 체크박스는 전체 화면에서만 뜨고 보기/편집 버튼과 같은 상태이며, 보기 모드에서 끌면 아무것도 안 바뀐다', async ({ page }) => {
  const errors = await open(page)
  const box = page.locator('.edit-toggle input')
  const editButton = page.getByRole('button', { name: '편집', exact: true })
  const viewButton = page.getByRole('button', { name: '보기', exact: true })

  // 평소에는 도구막대의 보기/편집 하나만 있다.
  await expect(box).toHaveCount(0)
  await page.getByRole('button', { name: '전체 화면' }).click()
  await expect(box).not.toBeChecked()
  await box.check()
  await expect(editButton).toHaveAttribute('aria-pressed', 'true')
  await box.uncheck()
  await expect(viewButton).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: /전체 화면 나가기/ }).click()
  await expect(box).toHaveCount(0)

  // 보기 모드에서 고른 설비를 끌면 시점만 돈다. 좌표는 그대로다.
  await pick(page, 'AHU-1')
  const before = await row(page, 'AHU-1').locator('td.num').first().textContent()
  const at = (await viewer<Pt>(page, 'part', AHU))!
  await drag(page, at, { x: at.x + 150, y: at.y })
  await expect(row(page, 'AHU-1').locator('td.num').first()).toHaveText(before!)
  expect(errors).toEqual([])
})

test('편집 모드에서 고른 설비를 3D 로 끌면 좌표와 소속이 바뀌고, 끄는 중 Esc 는 취소다', async ({ page }) => {
  const errors = await open(page)
  await page.getByRole('button', { name: '편집', exact: true }).click()
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
  await page.getByRole('button', { name: '편집', exact: true }).click()

  // 사무실 모서리 근처 빈 바닥. 설비가 없는 자리를 눌러야 물리존이 골라진다.
  const floor = (await viewer<Pt>(page, 'point', [9.6, 7.6, 0.1]))!
  await page.mouse.click(floor.x, floor.y)
  const panel = page.locator('.space-picked')
  await expect(panel).toContainText('사무실')
  await expect(panel).toContainText('80.0')
  await expect(panel.locator('.space-members').first()).toContainText('AT-101-02')
  expect(await viewer<unknown[]>(page, 'handles')).toHaveLength(4)

  // 엇갈리는 자리에는 놓지 않는다. (0,0) 을 (20,4) 로 끌면 두 변이 교차한다.
  await drag(page, (await viewer<Pt>(page, 'point', [0, 0, 0.12]))!, (await viewer<Pt>(page, 'point', [20, 4, 0.12]))!)
  await expect(page.locator('.edit-notice')).toContainText('교차')
  await expect(panel).toContainText('80.0')
  await expect(page.locator('.edit-bar')).toContainText('바뀐 것 0건')

  // (10,0) 을 (4,4) 로 끈다. 넓이가 36㎡ 가 되고, (7,4) 의 AT-101-02 가 밖으로 밀려난다.
  await drag(page, (await viewer<Pt>(page, 'point', [10, 0, 0.12]))!, (await viewer<Pt>(page, 'point', [4, 4, 0.12]))!)
  await expect(panel).toContainText('36.0')
  await expect(panel.locator('.src.edit')).toBeVisible()
  await expect(row(page, 'AT-101-02')).toContainText('(소속 없음)')
  await expect(page.locator('.report')).toContainText('80.0㎡ → 36.0㎡')
  await expect(page.locator('.report')).toContainText('AT-101-02')

  // 고른 방의 이름을 오른쪽 패널에서 그 자리에서 고친다(E1). 아래 표에서 같은 방을 다시 찾지 않는다.
  // 방 종류는 이름을 따라간다. 패널에 안 보이면 고친 사람이 TTL 의 클래스가 바뀐 줄 모른다. 편집 모드에서는 종류 칸이 고르는 상자라
  // (OE-SPC-17) [이름으로 정하기] 옆에 이름 사전이 읽은 종류가 보인다.
  const kindPick = panel.getByTestId('space-kind').locator('option:checked')
  await expect(kindPick).toHaveText('이름으로 정하기(사무실)')
  await expect(panel.locator('.space-kind')).toContainText('사전')
  const name = panel.locator('.space-name input')
  await name.fill('대회의실')
  await name.press('Enter')
  await expect(panel.locator('h3')).toHaveText('대회의실')
  await expect(kindPick).toHaveText('이름으로 정하기(회의실)')
  await expect(page.locator('.report')).toContainText('물리존 이름 사무실 → 대회의실')

  // 보기 모드로 가면 손잡이가 사라진다. 저장하지 않은 편집이 있어 묻는다(OE-COM-08) — 임시 저장하고 끝낸다.
  await page.getByRole('button', { name: '보기', exact: true }).click()
  await page.locator('dialog.exit-edit').getByRole('button', { name: '임시 저장' }).click()
  expect(await viewer<unknown[]>(page, 'handles')).toHaveLength(0)
  expect(errors).toEqual([])
})

test('편집 모드에서 연결 화살표를 누르면 방향을 미리 보고 [적용] 으로 정하며, 포트 방향은 못 고친다', async ({ page }) => {
  const errors = await open(page)
  await page.getByRole('button', { name: '편집', exact: true }).click()
  await pick(page, 'DUCT-01')

  type ArrowAt = { key: string; a: string; b: string; source: string; at: Pt }
  const arrows = () => viewer<ArrowAt[]>(page, 'arrows')
  const toward = async (id: string) => (await arrows()).find((x) => x.a === id || x.b === id)!

  // 셋이다. 포트가 방향을 말한 둘(AHU·AT-101-01)과 규칙이 짐작한 하나(AT-101-02).
  expect(await arrows()).toHaveLength(3)
  expect((await toward(AHU)).source).toBe('port')
  expect((await toward(AT02)).source).toBe('rule')
  await expect(page.locator('.color-key')).toContainText('직접 정한 방향')

  const terminal = page.locator('.picked .neighbors tr', { hasText: 'AT-101-02' })
  await expect(terminal.locator('.rel')).toHaveText('하류(추정)')

  // 한 번: 이 설비에서 나간다(하류). 먼저 미리보기다(OE-PIP-04). [적용] 하면 사람이 정한 방향이라 규칙보다 앞서고 확정 없이 feeds 로 나간다.
  let at = (await toward(AT02)).at
  await page.mouse.click(at.x, at.y)
  expect((await toward(AT02)).source).toBe('preview')
  await expect(terminal.locator('.rel')).toHaveText('하류(추정)')
  await terminal.getByTestId('flow-apply').click()
  await expect(terminal.locator('.rel')).toHaveText('하류')
  await expect(terminal).toContainText('직접 정한 방향')
  expect((await toward(AT02)).source).toBe('edit')
  await expect(page.locator('.report')).toContainText('DUCT-01 → AT-101-02')

  // 두 번: 뒤집는다. 규칙과 반대라 보정 사유를 받는다.
  at = (await toward(AT02)).at
  await page.mouse.click(at.x, at.y)
  await terminal.getByTestId('flow-reason').fill('현장 확인')
  await terminal.getByTestId('flow-apply').click()
  await expect(terminal.locator('.rel')).toHaveText('상류')
  await expect(page.locator('.report')).toContainText('AT-101-02 → DUCT-01')

  // 수동 지정 해제. 규칙 방향으로 돌아가고 리포트에서 빠진다.
  await terminal.getByTestId('flow-clear').click()
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
  await expect(page.locator('.appbar h2')).toHaveText('two-rooms.ifc + mep.ifc', { timeout: 30_000 })

  await page.getByRole('button', { name: '편집', exact: true }).click()
  await pick(page, 'AHU-1')
  const z0 = Number(await coord(page, 'AHU-1', 2))

  const select = page.locator('.storey-move select')
  await expect(select.locator('option:checked')).toHaveText('1F')
  await expect(page.locator('.storey-move .src.bim')).toBeVisible()
  await select.selectOption({ label: '2F' })

  // two-rooms 의 2F 바닥은 3.0m 다.
  await expect.poll(async () => Number(await coord(page, 'AHU-1', 2))).toBeCloseTo(z0 + 3, 5)
  await expect(page.locator('.storey-move .src.edit')).toBeVisible()
  await expect(page.locator('.storeys tbody tr', { hasText: '2F' }).locator('td.storey-equipment')).toHaveText('1')
  // 2F 의 창고에는 외곽선이 없어 소속이 빠진다.
  await expect(row(page, 'AHU-1')).toContainText('(소속 없음)')

  // 되돌리면 1F·원래 높이·BIM 출처로 돌아온다. 선택 상자에 초점이 있어도 글자 칸이 아니라 받는다.
  await page.keyboard.press('Control+z')
  await expect.poll(async () => Number(await coord(page, 'AHU-1', 2))).toBeCloseTo(z0, 5)
  await expect(select.locator('option:checked')).toHaveText('1F')
  await expect(page.locator('.storey-move .src.bim')).toBeVisible()
  await expect(page.locator('.storeys tbody tr', { hasText: '2F' }).locator('td.storey-equipment')).toHaveText('0')
  expect(errors).toEqual([])
})

// --- 되돌리기 (Ctrl+Z) -----------------------------------------------------------

/** AHU-1 을 3D 로 사무실 밖(x −8m)에 끌어 놓는다. 끌기 전 형상 중심과 화면 자리를 돌려준다. */
async function dragAhuOut(page: Page) {
  await pick(page, 'AHU-1')
  const center = (await viewer<number[]>(page, 'center', AHU))!
  const from = (await viewer<Pt>(page, 'part', AHU))!
  const to = (await viewer<Pt>(page, 'point', [center[0] - 8, center[1], center[2]]))!
  await drag(page, from, to)
  await expect(row(page, 'AHU-1')).toContainText('(소속 없음)')
  return { center, from }
}

test('3D 로 끈 설비는 Ctrl+Z 로 좌표·출처·소속이 끌기 전으로 돌아가고 리포트에서 빠진다', async ({ page }) => {
  const errors = await open(page)
  await page.getByRole('button', { name: '편집', exact: true }).click()
  const undoButton = page.locator('.edit-bar .undo')
  await expect(undoButton).toBeDisabled()

  const x0 = await (async () => {
    await pick(page, 'AHU-1')
    return coord(page, 'AHU-1', 0)
  })()
  const { from } = await dragAhuOut(page)
  await expect(undoButton).toBeEnabled()
  await expect(page.locator('.edit-bar')).toContainText('AHU-1 옮김')
  await expect(page.locator('.report')).toContainText('AHU-1')

  await page.keyboard.press('Control+z')
  await expect(row(page, 'AHU-1')).toContainText('사무실')
  expect(await coord(page, 'AHU-1', 0)).toBe(x0)
  // 출처도 편집에서 BIM 으로 돌아온다. 반대로 옮기는 식이면 여기가 편집으로 남는다.
  await expect(row(page, 'AHU-1').locator('.src.edit')).toHaveCount(0)
  await expect(page.locator('.edit-bar')).toContainText('바뀐 것 0건')
  await expect(page.locator('.report')).toHaveCount(0)
  // 되돌린 것은 잠깐 뜨는 안내다(경고 칸에 남으면 다음 단축키 안내를 가린다).
  await expect(page.locator('.key-note')).toContainText('되돌렸습니다: AHU-1 옮김')
  await expect(undoButton).toBeDisabled()

  // 3D 에서도 제자리다.
  await settle(page)
  const back = (await viewer<Pt>(page, 'part', AHU))!
  expect(Math.hypot(back.x - from.x, back.y - from.y)).toBeLessThan(3)
  expect(errors).toEqual([])
})

test('설비 끌기 → 꼭짓점 → 연결 방향을 Ctrl+Z 세 번이면 한 단계씩 거꾸로 되돌린다', async ({ page }) => {
  const errors = await open(page)
  await page.getByRole('button', { name: '편집', exact: true }).click()
  const bar = page.locator('.edit-bar')

  // ① 설비 끌기
  await dragAhuOut(page)
  // ② 꼭짓점: (10,0) 을 (4,4) 로. 넓이 36, AT-101-02 가 밖으로.
  const floor = (await viewer<Pt>(page, 'point', [9.6, 7.6, 0.1]))!
  await page.mouse.click(floor.x, floor.y)
  await drag(page, (await viewer<Pt>(page, 'point', [10, 0, 0.12]))!, (await viewer<Pt>(page, 'point', [4, 4, 0.12]))!)
  await expect(page.locator('.space-picked')).toContainText('36.0')
  // ③ 연결 방향: DUCT-01 → AT-101-02 를 사람이 정한다.
  await pick(page, 'DUCT-01')
  const terminal = page.locator('.picked .neighbors tr', { hasText: 'AT-101-02' })
  const arrow = (await viewer<{ a: string; b: string; at: Pt }[]>(page, 'arrows')).find((x) => x.a === AT02 || x.b === AT02)!
  await page.mouse.click(arrow.at.x, arrow.at.y)
  await terminal.getByTestId('flow-apply').click()
  await expect(terminal.locator('.rel')).toHaveText('하류')
  await expect(bar).toContainText('방향')

  // ③ 을 되돌린다 — 방향만 규칙으로 돌아가고 앞의 둘은 그대로다.
  await page.keyboard.press('Control+z')
  await expect(terminal.locator('.rel')).toHaveText('하류(추정)')
  await expect(row(page, 'AT-101-02')).toContainText('(소속 없음)')
  await expect(row(page, 'AHU-1')).toContainText('(소속 없음)')

  // ② 를 되돌린다 — 넓이 80, AT-101-02 가 사무실로.
  await page.keyboard.press('Control+z')
  await expect(row(page, 'AT-101-02')).toContainText('사무실')
  await expect(page.locator('.spaces-edit tbody tr', { hasText: '101' }).first()).toContainText('80.0 ㎡')
  await expect(row(page, 'AHU-1')).toContainText('(소속 없음)')

  // ① 을 되돌린다 — 아무것도 안 바뀐 상태.
  await page.keyboard.press('Control+z')
  await expect(row(page, 'AHU-1')).toContainText('사무실')
  await expect(bar).toContainText('바뀐 것 0건')
  await expect(page.locator('.edit-bar .undo')).toBeDisabled()
  expect(errors).toEqual([])
})

test('글자를 치는 칸의 Ctrl+Z 와 보기 모드의 Ctrl+Z 는 편집을 되돌리지 않는다', async ({ page }) => {
  const errors = await open(page)
  await page.getByRole('button', { name: '편집', exact: true }).click()
  await dragAhuOut(page)
  const bar = page.locator('.edit-bar')
  await expect(bar).toContainText('바뀐 것 1건')

  // 물리존 이름 칸에 글자를 치고 Ctrl+Z. 그 칸의 실행취소일 뿐 3D 편집은 그대로다.
  const name = page.locator('.rows input[type=text]').first()
  await name.click()
  await name.press('End')
  await page.keyboard.type('X')
  await page.keyboard.press('Control+z')
  await expect(bar).toContainText('바뀐 것 1건')
  await expect(row(page, 'AHU-1')).toContainText('(소속 없음)')

  // 보기 모드에서는 고치는 손잡이가 없으니 되돌리지도 않는다. 임시 저장하고 보기로 간다(OE-COM-08).
  await page.getByRole('button', { name: '보기', exact: true }).click()
  await page.locator('dialog.exit-edit').getByRole('button', { name: '임시 저장' }).click()
  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('Control+z')
  await page.getByRole('button', { name: '편집', exact: true }).click()
  await expect(bar).toContainText('바뀐 것 1건')
  await expect(row(page, 'AHU-1')).toContainText('(소속 없음)')
  expect(errors).toEqual([])
})

test('고른 설비는 앞에 다른 설비가 가려도 끌 수 있고, 끌지 않고 떼면 앞의 것을 고른다', async ({ page }) => {
  const errors = await open(page)
  await page.getByRole('button', { name: '편집', exact: true }).click()
  // DUCT-01(z 3.0) 위에 AHU-1(z 3.2) 상자가 겹쳐 있다. 어느 점이 가리는지는 카메라 거리에 따라 달라서,
  // 덕트 둘레에서 맨 앞은 공조기이고 시선이 덕트도 지나는 점을 찾는다.
  await pick(page, 'DUCT-01')
  const center = (await viewer<number[]>(page, 'center', DUCT))!
  const mid = (await viewer<Pt>(page, 'part', DUCT))!
  let from: Pt | null = null
  for (let r = 0; r <= 12 && !from; r++) {
    for (let dx = -r; dx <= r && !from; dx++) {
      for (const dy of [-r, r]) {
        const h = await viewer<{ front: string | null; through: boolean; arrow: boolean }>(page, 'hit', mid.x + dx, mid.y + dy, DUCT)
        if (h.front === AHU && h.through && !h.arrow) {
          from = { x: mid.x + dx, y: mid.y + dy }
          break
        }
      }
    }
  }
  expect(from).not.toBeNull()

  // 끌지 않고 떼면 맨 앞의 것(공조기)을 고른다 — 가려진 것을 잡을 수 있게 됐다고 앞의 것을 못 고르면 안 된다.
  await page.mouse.click(from!.x, from!.y)
  await expect(page.locator('.picked h3')).toHaveText('AHU-1')

  // 다시 덕트를 고르고 같은 자리에서 끈다. 덕트가 옮겨진다.
  await pick(page, 'DUCT-01')
  const x0 = Number(await coord(page, 'DUCT-01', 0))
  const to = (await viewer<Pt>(page, 'point', [center[0] - 5, center[1], center[2]]))!
  await drag(page, from!, to)
  await expect.poll(async () => Number(await coord(page, 'DUCT-01', 0))).toBeCloseTo(x0 - 5, 0)
  await expect(page.locator('.picked h3')).toHaveText('DUCT-01')
  expect(errors).toEqual([])
})

// --- 종류 지정 (타입 단위) -------------------------------------------------------------

test('고른 설비의 종류를 바꾸면 규칙 방향이 다시 서고, Ctrl+Z 로 되돌린다', async ({ page }) => {
  const errors = await open(page)
  await page.getByRole('button', { name: '편집', exact: true }).click()

  // DUCT-01 → AT-101-02 는 공조기가 공기의 원천이라서 선 규칙 방향이다.
  await pick(page, 'DUCT-01')
  const terminal = page.locator('.picked .neighbors tr', { hasText: 'AT-101-02' })
  await expect(terminal.locator('.rel')).toHaveText('하류(추정)')

  // 공조기의 종류를 "모름" 으로 하면 원천이 없어져 그 규칙 방향도 사라진다.
  await pick(page, 'AHU-1')
  const kind = page.locator('.kind-edit select')
  await expect(kind).toHaveValue('ahu')
  await expect(page.locator('.kind-edit .src.dict')).toBeVisible()
  await kind.selectOption('')
  await expect(page.locator('.report')).toContainText('종류 공조기 → 모름')
  await expect(page.locator('.edit-bar')).toContainText('바뀐 것 1건')

  await pick(page, 'DUCT-01')
  await expect(terminal.locator('.rel')).toHaveText('방향 미지정')

  await page.keyboard.press('Control+z')
  await expect(terminal.locator('.rel')).toHaveText('하류(추정)')
  await expect(page.locator('.edit-bar')).toContainText('바뀐 것 0건')
  expect(errors).toEqual([])
})

test('종류를 모르는 패밀리를 목록에서 한 번 고르면 그 패밀리 설비에 붙고 출처가 편집이 된다', async ({ page }) => {
  const errors = await open(page)
  await page.getByRole('button', { name: '편집', exact: true }).click()
  await page.getByRole('button', { name: /종류와 관제점 후보/ }).click()

  // 픽스처의 온도 센서는 사전에 없다. ObjectType 이 비어 있어 설비 이름이 곧 타입이다(그 한 대에만 붙는다).
  const list = page.locator('.unknown-types')
  await expect(list).toContainText('종류를 모르는 패밀리')
  const sensorType = list.locator('tr', { hasText: 'TEMP-101-01' })
  await expect(sensorType).toBeVisible()
  await sensorType.locator('select').selectOption({ label: '열감지기' })

  await expect(list.locator('tr', { hasText: 'TEMP-101-01' })).toHaveCount(0)
  const sensor = row(page, 'TEMP-101-01')
  await expect(sensor).toContainText('열감지기')
  await expect(sensor.locator('.src.edit')).toBeVisible()
  await expect(page.locator('.report')).toContainText('종류 모름 → 열감지기')
  expect(errors).toEqual([])
})

test('종류를 바꿔 규칙 방향이 포트와 어긋나기 시작하면 그 계통을 바로 알린다', async ({ page }) => {
  const errors = await open(page)
  await page.getByRole('button', { name: '편집', exact: true }).click()
  await enterCeiling(page)
  await pick(page, 'AT-101-01')
  // 포트가 덕트 → 디퓨저라고 말한 디퓨저를 팬(공기의 원천)으로 바꾼다.
  await page.locator('.kind-edit select').selectOption({ label: '팬' })
  const warning = page.locator('.picked .edit-notice.inline')
  await expect(warning).toContainText('포트와 어긋나는 계통')
  await expect(warning).toContainText('AHU-1 급기 계통')
  // 같은 알림을 3D 아래에 또 띄우지 않는다(패널과 한 화면에 같이 보인다).
  await expect(page.locator('.viewport .edit-notice')).toHaveCount(0)

  await page.keyboard.press('Control+z')
  await expect(warning).toHaveCount(0)
  expect(errors).toEqual([])
})
