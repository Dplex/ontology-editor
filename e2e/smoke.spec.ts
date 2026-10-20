import { expect, test } from '@playwright/test'
import { coordOf, enterEdit, openDrawer, pickEquipment, pickSpace, placeOf, systemChips } from './edit-part'

// 픽스처 IFC 를 그대로 올린다. 단위 테스트는 Node 에서 파서를 부르지만, 여기서는 브라우저가
// WASM 을 받아 와 실제로 돌린다 — public/web-ifc.wasm 이 안 실려 있으면 여기서 잡힌다.
const FIXTURE = 'src/lib/ifc/fixtures/two-rooms.ifc'

test('처음 열면 파일을 받을 자리만 보인다', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'ontology-editor' })).toBeVisible()
  await expect(page.getByText('IFC 파일을 여기에 드래그해서 놓으세요.')).toBeVisible()
  // 건축·설비가 따로인 파일을 한 번에 여는 길을 첫 화면에서 말한다.
  await expect(page.locator('.drop-multi')).toContainText('둘을 같이')
  await expect(page.locator('.drop input[type=file]')).toHaveAttribute('multiple', '')
})

test('IFC 를 올리면 검토 화면과 3D 가 나온다', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))

  await page.goto('/')
  await page.locator('input[type=file]').setInputFiles(FIXTURE)

  await expect(page.getByRole('heading', { name: 'two-rooms.ifc' })).toBeVisible({ timeout: 30_000 })
  // 파일 개요는 기준 · 검증 드로어에 있다. IFC 판(IFC4 ·) 줄은 #715 에서 개요에서 빠졌다.
  await openDrawer(page)

  // PRD #6 검토 항목. 픽스처의 실제 구성과 같아야 한다.
  const tile = (label: string) => page.locator('.tiles li', { hasText: label }).locator('b')
  await expect(tile('물리존')).toHaveText('3')
  await expect(tile('층')).toHaveText('2')
  await expect(tile('내력벽')).toHaveText('1')

  // 빠진 것을 조용히 넘기지 않는다.
  await expect(page.locator('.warnings')).toContainText('FootPrint')
  await expect(page.locator('.warnings')).toContainText('LoadBearing')

  // 층별 표가 실제 이름·높이·넓이 합을 보여 주고, 낮은 층이 먼저 온다.
  const rows = page.locator('.storeys tbody tr')
  await expect(rows.nth(0)).toContainText('회의실, 복도')
  await expect(rows.nth(0)).toContainText('0.00 m')
  await expect(rows.nth(0)).toContainText('24.0 ㎡')
  await expect(rows.nth(1)).toContainText('3.00 m')

  await expect(page.locator('.canvas-wrap > canvas')).toBeVisible()
  expect(errors).toEqual([])
})

test('MEP 가 든 IFC 는 설비와 계통까지 보여 준다', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))

  await page.goto('/')
  await page.locator('input[type=file]').setInputFiles('src/lib/ifc/fixtures/mep.ifc')

  await expect(page.getByRole('heading', { name: 'mep.ifc' })).toBeVisible({ timeout: 30_000 })

  const tile = (label: string) => page.locator('.tiles li', { hasText: label }).locator('b')
  // 다섯은 층에, 하나는 공간에 매달려 있다. 층만 보면 여섯 번째를 놓친다.
  // 기기와 덕트·배관을 따로 센다 — 합치면 대수가 부푼다(실측에서 85%가 도관이었다).
  await expect(tile('기기')).toHaveText('5')
  await expect(tile('덕트·배관')).toHaveText('1')
  await expect(tile('계통')).toHaveText('1')

  // 빠진 것이 무엇인지 화면이 말한다. 이게 고객사 BIM 스펙 협의에 쓰이는 목록이다.
  const warnings = page.locator('.warnings')
  await expect(warnings).toContainText('좌표가 없습니다')
  await expect(warnings).toContainText('용량 파라미터가 없습니다')

  expect(errors).toEqual([])
})

test('요구사항 칸이 R 번호마다 표준 자리·다른 자리·없음을 가른다', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))

  await page.goto('/')
  await page.locator('input[type=file]').setInputFiles('src/lib/ifc/fixtures/mep.ifc')
  await expect(page.getByRole('heading', { name: 'mep.ifc' })).toBeVisible({ timeout: 30_000 })

  // 접힌 채로 한 줄 요약만 보인다.
  await openDrawer(page)
  const fold = page.locator('.requirements')
  await expect(fold.locator('.fold-meta')).toContainText('필수')
  await fold.getByRole('button', { name: /요구사항/ }).click()

  const row = (id: string) => fold.locator('tbody tr', { has: page.locator('td.mono', { hasText: new RegExp(`^${id}$`) }) })
  // 좌표 없는 센서 하나(일부), 용량 없는 토출구 하나(일부), 지도 변환 없음(없음), 단위는 있다(표준 자리).
  await expect(row('R11').locator('.req-state')).toHaveText('일부')
  await expect(row('R11')).toContainText('4 / 5')
  await expect(row('R21').locator('.req-state')).toHaveText('일부')
  await expect(row('R7').locator('.req-state')).toHaveText('없음')
  await expect(row('R6').locator('.req-state')).toHaveText('표준 자리')
  await expect(row('R12').locator('.req-state')).toHaveText('측정 불가')

  expect(errors).toEqual([])
})

test('연결을 읽어 계통 범례와 상류·하류를 보여 준다', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))

  await page.goto('/')
  await page.locator('input[type=file]').setInputFiles('src/lib/ifc/fixtures/mep.ifc')
  await expect(page.getByRole('heading', { name: 'mep.ifc' })).toBeVisible({ timeout: 30_000 })

  const tile = (label: string) => page.locator('.tiles li', { hasText: label }).locator('b')
  // 포트 연결 셋 중 둘만 흐름 방향이 있다. 나머지 하나는 SOURCEANDSINK 라 방향을 모른다.
  await expect(tile('연결')).toHaveText('3')
  await expect(tile('흐름 방향')).toHaveText('2')

  // 계통 범례는 층 현황 설비 칸의 계통 칩이다(#715). 색은 칩과 3D 가 같은 자리에서 가져온다.
  await expect(await systemChips(page)).toContainText('AHU-1 급기 계통')

  // 3D 를 클릭하는 대신 설비 표에서 고른다. 픽셀을 찍는 것은 화면 크기에 따라 흔들린다.
  await pickEquipment(page, 'DUCT-01', false)

  const picked = page.locator('.picked')
  await expect(picked).toContainText('DUCT-01')
  await expect(picked.locator('.flow .upstream b')).toHaveText('1')
  await expect(picked.locator('.flow .downstream b')).toHaveText('1')
  // SOURCEANDSINK 로 붙은 토출구. 이어진 것만 알고 방향은 모른다.
  await expect(picked.locator('.flow .linked b')).toHaveText('1')

  // 출처가 화면에 남는다. BIM 이 말한 것과 우리가 추정한 것을 구별할 수 있어야 한다. 포트 연결은 방향을 말했는지까지 적는다(OE-BIM-09).
  await expect(picked.locator('.neighbors')).toContainText('BIM 포트 · 방향 명시 BIM')
  await expect(picked.locator('.neighbors')).toContainText('BIM 포트 · 양방향/미지정 BIM')

  expect(errors).toEqual([])
})

test('설비를 옮기면 소속 물리존이 다시 판정된다', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))

  await page.goto('/')
  await page.locator('input[type=file]').setInputFiles('src/lib/ifc/fixtures/mep.ifc')
  await expect(page.getByRole('heading', { name: 'mep.ifc' })).toBeVisible({ timeout: 30_000 })
  await enterEdit(page)

  // 소속은 화면 모델(TTL)의 hasLocation 으로 읽고, 좌표는 고른 설비의 위치 칸에 넣는다(예전 설비 표는 #715 에서 빠졌다).
  // AHU-1 은 사무실 안에 있다.
  await expect.poll(() => placeOf(page, 'AHU-1')).toBe('사무실')
  await expect(page.locator('.report')).toHaveCount(0)

  // 물리존 밖으로 옮기면 소속이 사라진다. 이게 온톨로지에서 hasLocation 한 줄이다.
  await pickEquipment(page, 'AHU-1')
  await coordOf(page, 0).fill('50')
  await coordOf(page, 0).blur()
  await expect.poll(() => placeOf(page, 'AHU-1')).toBe('(소속 없음)')
  await expect(page.locator('.report')).toContainText('사무실')

  // 좌표가 없던 센서에 값을 주면 소속이 생긴다(E6). 셋이 다 차기 전에는 옮기지 않는다 — 빈 축을 0 으로
  // 채우면 모르는 것이 원점 쪽에 있는 것으로 바뀐다.
  const changed = page.getByTestId('changes-link')
  const position = page.locator('.position-edit')
  await expect(changed).toContainText('바뀐 것 1건')
  await pickEquipment(page, 'TEMP-101-01')
  expect(await placeOf(page, 'TEMP-101-01')).toBe('(소속 없음)')
  for (const [axis, value] of [[0, '5'], [1, '4']] as const) {
    await coordOf(page, axis).fill(value)
    await coordOf(page, axis).blur()
    expect(await placeOf(page, 'TEMP-101-01')).toBe('(소속 없음)')
    await expect(position).toContainText('x·y·z를 모두 넣어야 옮겨집니다')
    await expect(changed).toContainText('바뀐 것 1건')
  }
  await coordOf(page, 2).fill('2.5')
  await coordOf(page, 2).blur()
  await expect.poll(() => placeOf(page, 'TEMP-101-01')).toBe('사무실')
  await expect(position).not.toContainText('모두 넣어야')
  await expect(changed).toContainText('바뀐 것 2건')

  expect(errors).toEqual([])
})

test('설비 파일에 건축 파일을 덧붙이면 합쳐서 소속을 다시 판정한다', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))

  await page.goto('/')
  // 설비 파일을 먼저 연다. 덧붙이는 순서와 무관하게 방을 더 그린 쪽이 기준이 되어야 한다.
  await page.locator('.drop input[type=file]').setInputFiles('src/lib/ifc/fixtures/mep.ifc')
  await expect(page.getByRole('heading', { name: 'mep.ifc' })).toBeVisible({ timeout: 30_000 })

  await page.locator('.append input[type=file]').setInputFiles(FIXTURE)
  await expect(page.getByRole('heading', { name: 'two-rooms.ifc + mep.ifc' })).toBeVisible({ timeout: 30_000 })

  const tile = (label: string) => page.locator('.tiles li', { hasText: label }).locator('b')
  // 회의실·복도·창고(two-rooms) + 사무실(mep). 층 GUID 가 달라도 1F 로 맞춘다.
  await expect(tile('물리존')).toHaveText('4')
  await expect(tile('층')).toHaveText('2')
  await expect(tile('기기')).toHaveText('5')

  const merge = page.locator('.merge')
  await expect(merge).toContainText('이름으로 1')
  await expect(merge).toContainText('좌표 겹침')
  // 경고에 어느 파일 이야기인지 이름표가 붙는다.
  await expect(page.locator('.warnings')).toContainText('[mep.ifc]')
  await expect(page.locator('.warnings')).toContainText('[two-rooms.ifc]')

  expect(errors).toEqual([])
})

test('넓게 보기로 띄워도 고른 설비 패널이 같이 보이고, Esc 는 선택만 풀고 넓게 보기는 남는다', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))

  await page.goto('/')
  await page.locator('input[type=file]').setInputFiles('src/lib/ifc/fixtures/mep.ifc')
  await expect(page.getByRole('heading', { name: 'mep.ifc' })).toBeVisible({ timeout: 30_000 })
  // 층 현황의 설비 칸에서 하나 고른다.
  await page.getByTestId('floor-status').getByRole('button', { name: /설비$/ }).click()
  const first = page.locator('.shell-rows li > button').first()
  const name = (await first.locator('.name').getAttribute('title'))!
  await first.click()

  const button = page.locator('.viewport .fullscreen')
  await button.click()
  await expect(button).toHaveAttribute('aria-pressed', 'true')
  // 3D 만이 아니라 패널까지 든 칸이 창 가득이어야 한다. 3D 만 띄우면 무엇을 골랐는지 안 보인다.
  // 브라우저 전체 화면은 쓰지 않는다 — Esc 를 브라우저가 먼저 받아 꺼 버린다.
  expect(await page.evaluate(() => document.fullscreenElement)).toBeNull()
  const box = await page.locator('.stage').boundingBox()
  const view = page.viewportSize()!
  expect(box).toMatchObject({ x: 0, y: 0, width: view.width, height: view.height })
  await expect(page.locator('.stage .picked').first()).toContainText(name)

  // Esc 는 선택 해제다. 넓게 보기는 그대로 남는다.
  await page.keyboard.press('Escape')
  await expect(page.locator('.stage .picked')).toHaveCount(0)
  await expect(button).toHaveAttribute('aria-pressed', 'true')

  await page.keyboard.press('Control+Backslash')
  await expect(button).toHaveAttribute('aria-pressed', 'false')

  expect(errors).toEqual([])
})

test('3D 에서 누를 수 있는 곳에 올라가면 커서가 손가락이 되고, 거기를 누르면 설비가 골라진다', async ({ page }) => {
  // 격자를 칸마다 두 프레임씩 훑는다(최대 384칸). 바쁜 PC(e2e 병렬)에서는 기본 30초를 넘긴다.
  test.setTimeout(120_000)
  await page.goto('/')
  await page.locator('input[type=file]').setInputFiles('src/lib/ifc/fixtures/mep.ifc')
  await expect(page.getByRole('heading', { name: 'mep.ifc' })).toBeVisible({ timeout: 30_000 })
  // 설비가 작게 보이면 격자로 훑어도 못 맞춘다. 연결망에 맞춰 크게 본 뒤 선택을 푼다.
  await pickEquipment(page, 'DUCT-01', false)
  await page.getByRole('button', { name: '연결망 보기' }).click()
  await page.locator('.shell-sel .side-clear').click()

  const canvas = page.locator('.canvas-wrap > canvas')
  // 화면 좌표로 훑으므로 3D 가 화면 안에 있어야 한다.
  await canvas.scrollIntoViewIfNeeded()
  const box = (await canvas.boundingBox())!
  const cursor = () => canvas.evaluate((el) => el.style.cursor)
  const settle = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))))

  // 커서는 픽셀을 찍어서 찾는다. 설비 위치를 화면 좌표로 알려 주는 길이 없고, 그게 사람이 하는 일과도 같다.
  let hit: { x: number; y: number } | null = null
  for (let j = 1; j < 16 && !hit; j++) {
    for (let i = 1; i < 24 && !hit; i++) {
      const x = box.x + (box.width * i) / 24
      const y = box.y + (box.height * j) / 16
      await page.mouse.move(x, y)
      await settle()
      if ((await cursor()) === 'pointer') hit = { x, y }
    }
  }
  expect(hit).not.toBeNull()
  await page.mouse.click(hit!.x, hit!.y)
  await expect(page.locator('.picked')).toBeVisible()

  await page.mouse.move(box.x + box.width + 50, box.y + box.height + 50)
  await expect.poll(cursor).toBe('')
})

test('규칙이 짐작한 방향은 (추정)으로 보이고, 사람이 연결 하나의 방향을 정하고 되돌릴 수 있다', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))

  await page.goto('/')
  await page.locator('input[type=file]').setInputFiles('src/lib/ifc/fixtures/mep.ifc')
  await expect(page.getByRole('heading', { name: 'mep.ifc' })).toBeVisible({ timeout: 30_000 })
  await enterEdit(page)
  await pickEquipment(page, 'DUCT-01', false)

  const picked = page.locator('.picked')
  // 포트가 방향을 말한 이웃은 그냥 "상류" 이고 고칠 수 없다.
  const ahu = picked.locator('.neighbors tr', { hasText: 'AHU-1' })
  await expect(ahu.locator('.rel')).toHaveText('상류')
  await expect(ahu.getByTestId('flow-in')).toHaveCount(0)

  // SOURCEANDSINK 로 붙은 토출구. 규칙이 짐작한 방향이라 (추정)이 붙는다.
  const terminal = picked.locator('.neighbors tr', { hasText: 'AT-101-02' })
  await expect(terminal.locator('.rel')).toHaveText('하류(추정)')

  // 규칙과 반대로 정해 본다(사유를 적고 적용). 편집 표시가 붙고 리포트에 남는다.
  await terminal.getByTestId('flow-in').click()
  await terminal.getByTestId('flow-reason').fill('현장 확인')
  await terminal.getByTestId('flow-apply').click()
  await expect(terminal.locator('.rel')).toHaveText('상류')
  await expect(terminal).toContainText('직접 정한 방향 사람')
  const report = page.locator('.report')
  await expect(report).toContainText('AT-101-02 → DUCT-01')
  await expect(report).toContainText('규칙 방향과 반대')

  // 되돌리면 규칙 방향으로 돌아가고 리포트에서 빠진다.
  await terminal.getByTestId('flow-clear').click()
  await expect(terminal.locator('.rel')).toHaveText('하류(추정)')
  await expect(page.locator('.report')).toHaveCount(0)

  expect(errors).toEqual([])
})

test('보기 모드는 고치는 칸을 숨기고, 편집 모드는 막대와 고치는 칸을 드러낸다', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type=file]').setInputFiles('src/lib/ifc/fixtures/mep.ifc')
  await expect(page.getByRole('heading', { name: 'mep.ifc' })).toBeVisible({ timeout: 30_000 })

  // 처음은 보기다. 고른 설비의 좌표 입력칸과 흐름 방향 버튼이 없다.
  await expect(page.getByTestId('edit-start')).toBeVisible()
  await expect(page.locator('.edit-bar')).toHaveCount(0)
  await pickEquipment(page, 'DUCT-01', false)
  await expect(page.locator('.picked .flow-edit')).toHaveCount(0)
  await expect(page.locator('.position-edit')).toHaveCount(0)

  await enterEdit(page)
  await expect(page.getByTestId('changes-link')).toContainText('바뀐 것 0건')
  await expect(page.locator('.picked .flow-edit').first()).toBeVisible()
  await expect(page.locator('.position-edit .coord').first()).toBeVisible()

  // 편집한 것은 편집 막대가 센다. 보기로 돌아가도 리포트는 남는다.
  const terminal = page.locator('.picked .neighbors tr', { hasText: 'AT-101-02' })
  await terminal.getByTestId('flow-in').click()
  await terminal.getByTestId('flow-reason').fill('현장 확인')
  await terminal.getByTestId('flow-apply').click()
  await expect(page.getByTestId('changes-link')).toContainText('바뀐 것 1건')
  await page.getByRole('button', { name: '편집 종료' }).click()
  await expect(page.locator('.report')).toContainText('AT-101-02 → DUCT-01')
})

test('공기 원천을 고르면 흐름을 따라 말단이 있는 방을 담당 공간으로 보인다', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type=file]').setInputFiles('src/lib/ifc/fixtures/mep.ifc')
  await expect(page.getByRole('heading', { name: 'mep.ifc' })).toBeVisible({ timeout: 30_000 })
  await pickEquipment(page, 'AHU-1', false)

  // 토출구 둘이 사무실에 있다(하나는 규칙 방향으로 닿는다). 추정이라 [계산] 이 붙는다.
  const served = page.locator('.picked .served')
  await expect(served).toContainText('담당 공간 계산')
  const office = served.locator('tbody tr', { hasText: '사무실' })
  await expect(office.locator('td').nth(1)).toHaveText('2')

  // 규칙 방향을 끄면 포트가 말한 토출구 하나만 남는다.
  await page.locator('.rule-toggle input').uncheck()
  await expect(office.locator('td').nth(1)).toHaveText('1')

  // 말단을 고르면 담당 공간 칸이 없다. 원천이 아니다.
  await pickEquipment(page, 'AT-101-01', false)
  await expect(page.locator('.picked .served')).toHaveCount(0)
})

test('완전성 검사는 규칙마다 통과 수를 세고, 어긴 것을 펼쳐 고를 수 있다', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type=file]').setInputFiles('src/lib/ifc/fixtures/mep.ifc')
  await expect(page.getByRole('heading', { name: 'mep.ifc' })).toBeVisible({ timeout: 30_000 })

  await openDrawer(page)
  const checks = page.locator('.checks')
  const rows = checks.locator('tbody tr')
  // 공기 계통 셋, 물 계통 둘, 도관 끝, 도관 경로(OE-PIP-13), 유체 흐름이 아닌 연결(OE-PIP-18), 소속, 연결망, 스프링클러 소화 배관 — 규칙이 열하나다.
  // 이 파일에 잴 대상이 없는 규칙은 표가 아니라 아래 접은 목록에 있다.
  const empty = checks.getByTestId('checks-empty').locator('li')
  await expect.poll(async () => (await rows.count()) + (await empty.count())).toBe(11)
  expect(await empty.count()).toBeGreaterThan(0)
  await expect(checks).toContainText('공기 말단(디퓨저·그릴)이 원천(공조기·FCU 등)과 이어져 있다')

  // 어긴 것이 있는 첫 규칙을 펼치고, 목록에서 하나를 고르면 설비 패널이 뜬다.
  const failing = rows.filter({ has: page.locator('button') }).first()
  await failing.click()
  // 검사 줄을 누르면 결과를 3D 에 보이려고 드로어가 닫힌다(shell.ts). 목록은 다시 열어 본다.
  await openDrawer(page)
  await expect(failing).toHaveClass(/chosen/)
  const first = checks.locator('.check-list li button').first()
  const name = (await first.textContent())!.trim()
  await first.click()
  await expect(page.locator('.picked h3')).toHaveText(name)
})

test('문·창 형상은 기본으로 읽지 않고, 파일을 열기 전에 켤 수 있다', async ({ page }) => {
  await page.goto('/')
  const option = page.getByRole('checkbox', { name: /문·창 자리/ })
  await expect(option).not.toBeChecked()
  await option.check()
  await page.reload()
  // 고른 값은 이 브라우저가 기억한다.
  await expect(page.getByRole('checkbox', { name: /문·창 자리/ })).toBeChecked()
})

test('벽·문·창은 피처 단위로 골라 읽고, 읽지 않은 것은 요구사항에서 "없음" 이 아니다', async ({ page }) => {
  await page.goto('/')
  const walls = page.getByRole('checkbox', { name: '벽', exact: true })
  await expect(walls).toBeChecked()
  await walls.uncheck()
  await page.getByRole('checkbox', { name: '창', exact: true }).uncheck()
  // 문도 창도 끄면 문·창 자리는 고를 수 없다.
  await page.getByRole('checkbox', { name: '문', exact: true }).uncheck()
  await expect(page.getByRole('checkbox', { name: /문·창 자리/ })).toBeDisabled()
  await page.getByRole('checkbox', { name: '문', exact: true }).check()

  await page.locator('.drop input[type=file]').setInputFiles('src/lib/ifc/fixtures/two-rooms.ifc')
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  await openDrawer(page)
  const tiles = page.locator('.tiles')
  // 0 이 아니라 "읽지 않음" 이다. 0 이면 BIM 에 벽이 없다는 말이 된다.
  await expect(tiles.locator('li.skipped', { hasText: '벽' })).toContainText('읽지 않음')
  await expect(tiles.locator('li.skipped', { hasText: '창문' })).toContainText('읽지 않음')
  await expect(tiles.locator('li', { hasText: '내력벽' })).toHaveCount(0)
  await expect(tiles.locator('li', { hasText: '문' }).first()).toBeVisible()
  // 요구사항 R22(벽의 내력 속성)은 잴 수 없음이다.
  await openDrawer(page)
  await page.locator('.requirements .fold-head').click()
  await expect(page.locator('.requirements tr', { hasText: 'R22' })).toContainText('벽을 읽지 않고 열었습니다')
})

test('편집 뒤 화면이 다시 그려져도 치고 있던 칸은 지워지지 않는다', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type=file]').setInputFiles('src/lib/ifc/fixtures/mep.ifc')
  await expect(page.getByRole('heading', { name: 'mep.ifc' })).toBeVisible({ timeout: 30_000 })
  await enterEdit(page)
  await pickEquipment(page, 'AHU-1', false)

  // 오른쪽 패널에서 x 를 바꾸면 조금 뒤(등급을 다시 잴 때) 화면 전체가 다시 그려진다. 그 사이 y 를 치고 있다.
  const coords = page.locator('.picked .position-edit .coord')
  await coords.nth(0).fill('2')
  await coords.nth(0).press('Enter')
  await coords.nth(1).fill('3.5')
  await page.waitForTimeout(1000)
  await expect(coords.nth(1)).toHaveValue('3.5')
  // 넣는 것은 여전히 Enter 한 번이다.
  await coords.nth(1).press('Enter')
  await expect.poll(() => page.evaluate(() => (window as any).__viewer.center('0MEP$Equip$AHU1$0000')?.[1])).toBeCloseTo(3.5, 2)
})

// 열려 있는 파일 위에 다른 파일을 열다 실패하면 열려 있던 모델·편집이 그대로 남는다(OE-BIM-01#2). 예전에는 모델을 비워서, 읽지 못한
// 파일 하나 때문에 저장하지 않은 편집까지 잃었다. STEP 이 아닌 파일과 받지 않는 판(IFC2X2) 둘로 본다.
test('다른 파일을 열다 실패하면 이유를 보이고 열려 있던 모델과 편집은 그대로다 [OE-BIM-01#2~]', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  // 편집이 있으면 열기 전에 "편집이 사라진다" 고 묻는다. 확인을 눌러도 실패하면 편집은 남아야 한다.
  page.on('dialog', (d) => void d.accept())
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(FIXTURE)
  await expect(page.getByRole('heading', { name: 'two-rooms.ifc' })).toBeVisible({ timeout: 30_000 })
  await enterEdit(page)
  await pickSpace(page, '회의실')
  const name = page.locator('.space-name input')
  await name.fill('대회의실')
  await name.press('Enter')
  await expect(page.getByTestId('changes-link')).toContainText('바뀐 것 1건')

  const open = page.locator('.appbar label', { hasText: '열기' }).locator('input[type=file]').first()
  const v2x2 = ['ISO-10303-21;', 'HEADER;', "FILE_DESCRIPTION((''),'2;1');", "FILE_NAME('','',(''),(''),'','','');", "FILE_SCHEMA(('IFC2X2_FINAL'));", 'ENDSEC;', 'DATA;', 'ENDSEC;', 'END-ISO-10303-21;'].join('\n')
  for (const [file, reason] of [
    [{ name: 'not-ifc.ifc', mimeType: 'application/octet-stream', buffer: Buffer.from('이건 IFC 가 아니다') }, 'IFC(STEP) 파일이 아닙니다'],
    [{ name: 'old.ifc', mimeType: 'application/octet-stream', buffer: Buffer.from(v2x2) }, '지원하지 않는 IFC 판입니다(IFC2X2_FINAL)'],
  ] as const) {
    await open.setInputFiles(file)
    const alert = page.getByRole('alert').filter({ hasText: file.name })
    await expect(alert).toContainText(reason, { timeout: 30_000 })
    await expect(alert).toContainText('열려 있던 two-rooms.ifc 는 그대로입니다')
    await expect(page.getByRole('heading', { name: 'two-rooms.ifc' })).toBeVisible()
    await expect(page.locator('.tiles li', { hasText: '물리존' }).locator('b')).toHaveText('3')
    await expect(page.getByTestId('changes-link')).toContainText('바뀐 것 1건')
    await expect(page.locator('.report')).toContainText('대회의실')
  }
  expect(errors).toEqual([])
})
