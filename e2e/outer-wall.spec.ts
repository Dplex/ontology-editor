import { expect, test, type Page } from '@playwright/test'

// 외벽 편집(OE-OBJ-04)을 실제 마우스로 한다 — 외벽을 긋고, 문을 뚫고, 두께·높이·외벽 여부를 고치고, 설비를 바깥 면에 붙인다.
// mep.ifc 의 사무실은 0..10 × 0..8 이다. 그 동쪽 변 바로 바깥(x=10.1)에 벽을 그으면 동쪽이 건물 밖이라 외벽으로 계산된다.
// (남쪽 변은 카메라가 건물 전체를 잡을 때 왼쪽 도구 팔레트 밑에 깔린다 — AHU 가 (50,50)에 있어서다.)
// 바닥 자리는 e2e 모드에서만 열리는 window.__viewer.point 로 묻는다(viewer.ts).
const MEP = 'src/lib/ifc/fixtures/mep.ifc'

async function clickFloor(page: Page, x: number, y: number, z = 0) {
  const at = (await page.evaluate(([px, py, pz]) => (window as any).__viewer.point([px, py, pz]), [x, y, z])) as { x: number; y: number }
  await page.mouse.click(at.x, at.y)
}

const row = (page: Page, name: string) => page.locator('.equipment tbody tr', { hasText: name }).last()

test('외벽을 긋고 문을 뚫고 크기·외벽 여부를 고치며, 설비를 바깥 면에 붙이면 방 소속이 없어지고 Ctrl+Z 로 돌아온다', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(MEP)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '편집', exact: true }).click()
  await page.locator('.viewport canvas').scrollIntoViewIfNeeded()
  await page.waitForTimeout(200)

  // 외벽 긋기 — IsExternal 이 없으니 건물 바깥에 닿는지로 계산된다.
  await page.getByRole('button', { name: '벽·문·창' }).click()
  await page.getByRole('button', { name: '벽 긋기' }).click()
  await clickFloor(page, 10.1, 0.5)
  await clickFloor(page, 10.1, 7.5)
  const panel = page.locator('.element-picked')
  await expect(panel.locator('h3')).toHaveText('새 벽')
  await expect(panel.getByTestId('wall-external')).toHaveText('외벽')
  await expect(panel.getByTestId('wall-external-select')).toHaveValue('true')

  // 외벽에 문을 뚫는다.
  await page.getByRole('button', { name: '문 놓기' }).click()
  await clickFloor(page, 10.1, 6)
  await expect(panel.locator('h3')).toHaveText('새 문')
  await expect(panel).toContainText('외벽에 뚫림')

  // 벽을 다시 골라 두께·높이(크기 y·z)와 외벽 여부를 고친다. 세워 그린 벽(바닥 판 위 1.2m)의 윗면을 누른다.
  await clickFloor(page, 10.1, 2, 1.3)
  await expect(panel.locator('h3')).toHaveText('새 벽')
  const thickness = panel.getByTestId('wall-thickness')
  await thickness.fill('0.3')
  await thickness.press('Enter')
  await expect(panel.locator('.stats')).toContainText('두께 0.30m')
  const height = panel.getByTestId('wall-height')
  await expect(height).toHaveValue('')
  await height.fill('2.8')
  await height.press('Enter')
  // 편집 줄에 마지막 편집 이름이 뜬다(되돌리기 단위).
  await expect(page.getByText('새 벽 높이 2.80m')).toBeVisible()
  await panel.getByTestId('wall-external-select').selectOption('false')
  await expect(panel.getByTestId('wall-external')).toHaveText('내벽')
  await expect(panel.locator('.src.edit').first()).toBeVisible()
  await panel.getByTestId('wall-external-select').selectOption('true')
  await expect(panel.getByTestId('wall-external')).toHaveText('외벽')

  // 설비를 외벽 바깥 면에 붙인다. 벽·문·창 층을 끄고 표에서 AHU-1 을 고른다.
  await page.getByRole('button', { name: '벽·문·창' }).click()
  await row(page, 'AHU-1').getByRole('button', { name: 'AHU-1', exact: true }).click()
  await page.locator('.viewport canvas').scrollIntoViewIfNeeded()
  await page.waitForTimeout(200)
  const picked = page.locator('.picked').first()
  await picked.getByRole('button', { name: '벽에 붙이기' }).click()
  await clickFloor(page, 10.6, 3)
  await expect(page.locator('.key-note, .notice, .toast').first()).toContainText('새 벽에 붙였습니다')
  await expect(picked).toContainText('새 벽에 붙음')
  await expect(picked).toContainText('소속 방 없음')

  // 벽을 고치면 붙은 설비의 3D 형상도 그 자리에서 따라온다. [벽·문·창] 을 끌 때 다시 그리면서야 따라오던 것을 막는다.
  const AHU = '0MEP$Equip$AHU1$0000'
  const centerX = () => page.evaluate((id) => (window as any).__viewer.center(id)?.[0] ?? null, AHU)
  const x0 = (await centerX()) as number
  expect(x0).not.toBeNull()
  await page.getByRole('button', { name: '벽·문·창' }).click()
  await clickFloor(page, 10.1, 2, 1.3)
  await expect(panel.locator('h3')).toHaveText('새 벽')
  await thickness.fill('0.5')
  await thickness.press('Enter')
  await expect.poll(centerX).toBeCloseTo(x0 + 0.1, 2)
  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('Control+z')
  await expect.poll(centerX).toBeCloseTo(x0, 2)
  await page.getByRole('button', { name: '벽·문·창' }).click()
  await row(page, 'AHU-1').getByRole('button', { name: 'AHU-1', exact: true }).click()
  await expect(picked).toContainText('새 벽에 붙음')

  // 되돌리면 붙기 전으로 — 벽에서 떨어지고 원래 소속으로.
  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('Control+z')
  await expect(picked).not.toContainText('붙음')
  expect(errors).toEqual([])
})

test('외기 센서는 외벽 바깥 면에만 — 방 안으로 옮기기·안쪽 면 붙이기는 막고, 바깥 면을 따라 옮기기는 된다 (2026-10-03 사용자 결정)', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(MEP)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '편집', exact: true }).click()
  await page.locator('.viewport canvas').scrollIntoViewIfNeeded()
  await page.waitForTimeout(200)
  // 사무실 동쪽 바로 바깥에 외벽을 긋는다(위 시험과 같다).
  await page.getByRole('button', { name: '벽·문·창' }).click()
  await page.getByRole('button', { name: '벽 긋기' }).click()
  await clickFloor(page, 10.1, 0.5)
  await clickFloor(page, 10.1, 7.5)
  await expect(page.locator('.element-picked').getByTestId('wall-external')).toHaveText('외벽')
  await page.getByRole('button', { name: '벽·문·창' }).click()

  // 사무실 안의 온도 센서를 외기 온도 센서로 바꾸면 자리가 틀렸다고 알린다.
  await row(page, 'TEMP-101-01').getByRole('button', { name: 'TEMP-101-01', exact: true }).click()
  const picked = page.locator('.picked').first()
  await picked.locator('.kind-edit select').selectOption({ label: '외기 온도 센서' })
  await expect(picked.locator('.exterior-misplaced')).toBeVisible()

  // 안쪽 면을 누르면 붙이지 않는다.
  await page.locator('.viewport canvas').scrollIntoViewIfNeeded()
  await picked.getByRole('button', { name: '벽에 붙이기' }).click()
  await clickFloor(page, 9.8, 3)
  await expect(page.locator('.key-note').first()).toContainText('외벽의 바깥쪽(방이 없는 쪽)을 누르세요')
  // 바깥쪽을 누르면 붙고 경고가 사라진다.
  await picked.getByRole('button', { name: '벽에 붙이기' }).click()
  await clickFloor(page, 10.6, 3)
  await expect(page.locator('.key-note').first()).toContainText('새 벽에 붙였습니다')
  await expect(picked.locator('.exterior-misplaced')).toHaveCount(0)
  await expect(picked).toContainText('소속 방 없음')
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT })

  // 좌표 칸으로 옮긴다(방향키는 카메라 방향을 따라 축이 바뀐다). 여느 이동과 같은 길이다.
  const coord = (i: number) => row(page, 'TEMP-101-01').locator('.coord').nth(i)
  const [x0, y0] = [Number(await coord(0).inputValue()), Number(await coord(1).inputValue())]
  // 바깥 면을 따라(북쪽으로 1m)는 된다.
  await coord(1).fill(String(y0 + 1))
  await coord(1).press('Enter')
  await expect.poll(async () => Number(await coord(1).inputValue())).toBeCloseTo(y0 + 1, 2)
  // 방 안쪽으로 1m 는 막는다 — 자리가 그대로다.
  await coord(0).fill(String(x0 - 1))
  await coord(0).press('Enter')
  await expect(page.locator('.edit-notice').first()).toContainText('외기 센서는 외벽 바깥 면에만 놓습니다')
  await expect.poll(async () => Number(await coord(0).inputValue())).toBeCloseTo(x0, 2)
  expect(errors).toEqual([])
})

// 층 옮기기(PageUp)도 같다 — 윗층의 같은 자리가 외벽 바깥 면이 아니면 막는다. 위 시험들은 층이 하나인 파일이라 이 길을 안 지났다.
// two-rooms.ifc: 1층 회의실(2..6 × 1..4)과 복도(10..12 × 2..8) 사이는 방이 없어 바깥이다. 2층에는 형상 있는 벽이 없다.
test('외기 센서를 윗층으로 옮기려 해도 그 층의 같은 자리가 외벽 바깥 면이 아니면 막는다', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles('src/lib/ifc/fixtures/two-rooms.ifc')
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '편집', exact: true }).click()
  await page.locator('.viewport canvas').scrollIntoViewIfNeeded()
  await page.waitForTimeout(200)
  // 회의실 동쪽 바로 바깥에 외벽을 긋는다.
  await page.getByRole('button', { name: '벽·문·창' }).click()
  await page.getByRole('button', { name: '벽 긋기' }).click()
  await clickFloor(page, 6.1, 1.5)
  await clickFloor(page, 6.1, 3.5)
  await expect(page.locator('.element-picked').getByTestId('wall-external')).toHaveText('외벽')
  await page.getByRole('button', { name: '벽·문·창' }).click()

  // 회의실에 설비를 더해 외기 온도 센서로 바꾸고 그 벽 바깥 면에 붙인다.
  await page.getByRole('button', { name: '설비 더하기' }).click()
  await clickFloor(page, 4, 2.5)
  const picked = page.locator('.picked').first()
  await expect(picked.locator('h3')).toHaveText('새 설비 1')
  await picked.locator('.kind-edit select').selectOption({ label: '외기 온도 센서' })
  await picked.getByRole('button', { name: '벽에 붙이기' }).click()
  await clickFloor(page, 6.4, 2.5)
  await expect(page.locator('.key-note').first()).toContainText('새 벽에 붙였습니다')
  await expect(picked.locator('.exterior-misplaced')).toHaveCount(0)

  // 윗층으로(PageUp) — 2층의 같은 자리는 외벽 바깥 면이 아니다.
  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('PageUp')
  await expect(page.locator('.edit-notice').first()).toContainText('그 층의 같은 자리는 외벽 바깥 면이 아닙니다')
  // 1층에 그대로다 — 옮겼다면 고른 설비를 따라 보이는 층이 2층으로 바뀐다.
  await expect(page.getByRole('combobox', { name: '보일 층' }).locator('option:checked')).toHaveText('1F만')
  await expect(picked.locator('.exterior-misplaced')).toHaveCount(0)
  await expect(page.locator('.edit-bar')).not.toContainText('→ 2F')
  expect(errors).toEqual([])
})
