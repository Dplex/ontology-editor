import { expect, test } from '@playwright/test'

// 픽스처 IFC 를 그대로 올린다. 단위 테스트는 Node 에서 파서를 부르지만, 여기서는 브라우저가
// WASM 을 받아 와 실제로 돌린다 — public/web-ifc.wasm 이 안 실려 있으면 여기서 잡힌다.
const FIXTURE = 'src/lib/ifc/fixtures/two-rooms.ifc'

test('처음 열면 파일을 받을 자리만 보인다', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'ontology-editor' })).toBeVisible()
  await expect(page.getByText('.ifc 파일을 여기에 끌어다 놓으세요.')).toBeVisible()
})

test('IFC 를 올리면 검토 화면과 3D 가 나온다', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))

  await page.goto('/')
  await page.locator('input[type=file]').setInputFiles(FIXTURE)

  await expect(page.getByRole('heading', { name: 'two-rooms.ifc' })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('IFC4 ·')).toBeVisible()

  // PRD #6 검토 항목. 픽스처의 실제 구성과 같아야 한다.
  const tile = (label: string) => page.locator('.tiles li', { hasText: label }).locator('b')
  await expect(tile('물리존')).toHaveText('3')
  await expect(tile('층')).toHaveText('2')
  await expect(tile('내력벽')).toHaveText('1')

  // 빠진 것을 조용히 넘기지 않는다.
  await expect(page.locator('.warnings')).toContainText('FootPrint')
  await expect(page.locator('.warnings')).toContainText('Structural')

  // 층별 표가 실제 이름·높이·넓이 합을 보여 주고, 낮은 층이 먼저 온다.
  const rows = page.locator('.storeys tbody tr')
  await expect(rows.nth(0)).toContainText('회의실, 복도')
  await expect(rows.nth(0)).toContainText('0.00 m')
  await expect(rows.nth(0)).toContainText('24.0 ㎡')
  await expect(rows.nth(1)).toContainText('3.00 m')

  await expect(page.locator('.viewport canvas')).toBeVisible()
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
  await expect(warnings).toContainText('좌표가 없어')
  await expect(warnings).toContainText('용량 파라미터가 없습니다')

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

  // 계통 범례가 3D 옆에 뜬다. 색은 범례와 3D 가 같은 자리에서 가져온다.
  await expect(page.locator('.legend')).toContainText('AHU-1 급기 계통')

  // 3D 를 클릭하는 대신 설비 표에서 고른다. 픽셀을 찍는 것은 화면 크기에 따라 흔들린다.
  await page.locator('.equipment tbody tr', { hasText: 'DUCT-01' }).getByRole('button').first().click()

  const picked = page.locator('.picked')
  await expect(picked).toContainText('DUCT-01')
  await expect(picked.locator('.flow .upstream b')).toHaveText('1')
  await expect(picked.locator('.flow .downstream b')).toHaveText('1')
  // SOURCEANDSINK 로 붙은 토출구. 이어진 것만 알고 방향은 모른다.
  await expect(picked.locator('.flow .linked b')).toHaveText('1')

  // 출처가 화면에 남는다. BIM 이 말한 것과 우리가 추정한 것을 구별할 수 있어야 한다.
  await expect(picked.locator('.neighbors')).toContainText('포트 BIM')

  expect(errors).toEqual([])
})

test('설비를 옮기면 소속 물리존이 다시 판정된다', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))

  await page.goto('/')
  await page.locator('input[type=file]').setInputFiles('src/lib/ifc/fixtures/mep.ifc')
  await expect(page.getByRole('heading', { name: 'mep.ifc' })).toBeVisible({ timeout: 30_000 })

  const row = (name: string) => page.locator('.equipment tbody tr', { hasText: name })

  // AHU-1 은 사무실 안에 있다.
  await expect(row('AHU-1')).toContainText('사무실')
  await expect(page.locator('.report')).toHaveCount(0)

  // 물리존 밖으로 옮기면 소속이 사라진다. 이게 온톨로지에서 hasLocation 한 줄이다.
  await row('AHU-1').locator('.coord').first().fill('50')
  await row('AHU-1').locator('.coord').first().blur()
  await expect(row('AHU-1')).toContainText('(소속 없음)')
  await expect(page.locator('.report')).toContainText('사무실')

  // 좌표가 없던 센서에 값을 주면 소속이 생긴다(E6).
  const sensor = row('TEMP-101-01')
  await expect(sensor).toContainText('(소속 없음)')
  await sensor.locator('.coord').nth(0).fill('5')
  await sensor.locator('.coord').nth(0).blur()
  await sensor.locator('.coord').nth(1).fill('4')
  await sensor.locator('.coord').nth(1).blur()
  await expect(sensor).toContainText('사무실')

  expect(errors).toEqual([])
})

test('물리존 경계를 고치면 넓이와 설비 소속이 같이 바뀐다', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))

  await page.goto('/')
  await page.locator('input[type=file]').setInputFiles('src/lib/ifc/fixtures/mep.ifc')
  await expect(page.getByRole('heading', { name: 'mep.ifc' })).toBeVisible({ timeout: 30_000 })

  const spaceRow = page.locator('.equipment tbody tr', { hasText: '사무실' }).first()
  await expect(spaceRow).toContainText('80.0 ㎡')

  // AT-101-02 는 (7,4) 에 있다. 두 번째 꼭짓점 x 를 5 로 당기면 밖으로 밀려난다.
  const terminal = page.locator('.equipment tbody tr', { hasText: 'AT-101-02' })
  await expect(terminal).toContainText('사무실')

  // 오른쪽 두 꼭짓점의 x 를 5 로 당겨 폭을 절반으로 줄인다. 하나만 당기면 사다리꼴이
  // 되어 (7,4) 가 아직 안에 남는다 — 경계 편집은 이렇게 직관과 어긋난다.
  for (const i of [1, 2]) {
    const x = spaceRow.locator('.vertex').nth(i).locator('.coord').first()
    await x.fill('5')
    await x.blur()
  }

  // 넓이가 줄고, 소속이 빠지고, 리포트에 둘 다 남는다.
  await expect(spaceRow).toContainText('40.0 ㎡')
  await expect(page.locator('.report')).toContainText('AT-101-02')
  await expect(page.locator('.report')).toContainText('80.0㎡ → 40.0㎡')

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

test('3D 를 전체 화면으로 띄워도 고른 설비 패널이 같이 보인다', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))

  await page.goto('/')
  await page.locator('input[type=file]').setInputFiles('src/lib/ifc/fixtures/mep.ifc')
  await expect(page.getByRole('heading', { name: 'mep.ifc' })).toBeVisible({ timeout: 30_000 })
  await page.locator('.equipment tbody tr', { hasText: 'DUCT-01' }).getByRole('button').first().click()

  const button = page.locator('.viewport .fullscreen')
  await button.click()
  await expect(button).toHaveAttribute('aria-pressed', 'true')
  // 3D 만이 아니라 패널까지 든 칸이 전체 화면이어야 한다. 3D 만 띄우면 무엇을 골랐는지 안 보인다.
  expect(await page.evaluate(() => document.fullscreenElement?.classList.contains('stage'))).toBe(true)
  await expect(page.locator('.stage .picked')).toContainText('DUCT-01')

  await button.click()
  await expect(button).toHaveAttribute('aria-pressed', 'false')
  expect(await page.evaluate(() => document.fullscreenElement)).toBeNull()

  expect(errors).toEqual([])
})

test('3D 에서 누를 수 있는 곳에 올라가면 커서가 손가락이 되고, 거기를 누르면 설비가 골라진다', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type=file]').setInputFiles('src/lib/ifc/fixtures/mep.ifc')
  await expect(page.getByRole('heading', { name: 'mep.ifc' })).toBeVisible({ timeout: 30_000 })
  // 설비가 작게 보이면 격자로 훑어도 못 맞춘다. 연결망에 맞춰 크게 본 뒤 선택을 푼다.
  await page.locator('.equipment tbody tr', { hasText: 'DUCT-01' }).getByRole('button').first().click()
  await page.getByRole('button', { name: '연결망에 맞추기' }).click()
  await page.getByRole('button', { name: '선택 해제' }).click()

  const canvas = page.locator('.viewport canvas')
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
  await page.locator('.equipment tbody tr', { hasText: 'DUCT-01' }).getByRole('button').first().click()

  const picked = page.locator('.picked')
  // 포트가 방향을 말한 이웃은 그냥 "상류" 이고 고칠 수 없다.
  const ahu = picked.locator('.neighbors tr', { hasText: 'AHU-1' })
  await expect(ahu.locator('.rel')).toHaveText('상류')
  await expect(ahu.getByRole('button', { name: '상류로' })).toHaveCount(0)

  // SOURCEANDSINK 로 붙은 토출구. 규칙이 짐작한 방향이라 (추정)이 붙는다.
  const terminal = picked.locator('.neighbors tr', { hasText: 'AT-101-02' })
  await expect(terminal.locator('.rel')).toHaveText('하류(추정)')

  // 규칙과 반대로 정해 본다. 편집 표시가 붙고 리포트에 남는다.
  await terminal.getByRole('button', { name: '상류로' }).click()
  await expect(terminal.locator('.rel')).toHaveText('상류')
  await expect(terminal).toContainText('사람이 정한 방향 편집')
  const report = page.locator('.report')
  await expect(report).toContainText('AT-101-02 → DUCT-01')
  await expect(report).toContainText('규칙 방향과 반대')

  // 되돌리면 규칙 방향으로 돌아가고 리포트에서 빠진다.
  await terminal.getByRole('button', { name: '되돌리기' }).click()
  await expect(terminal.locator('.rel')).toHaveText('하류(추정)')
  await expect(page.locator('.report')).toHaveCount(0)

  expect(errors).toEqual([])
})
