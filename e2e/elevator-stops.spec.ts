import { expect, test, type Page } from '@playwright/test'

// 엘리베이터 정차 층(OE-ML-10)과 로봇 통과(OE-ML-04). two-rooms.ifc + mep.ifc 를 합치면 층이 둘(1F·2F)이다.
// 다중층 뷰에서 엘리베이터를 만들면 두 층 모두 정차로 시작하고, 2F 를 무정차로 바꾸면 그 층의 로봇 통과가 불가가 된다.
const MEP = 'src/lib/ifc/fixtures/mep.ifc'
const ROOMS = 'src/lib/ifc/fixtures/two-rooms.ifc'

const viewer = <T,>(page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(([f, a]) => (window as any).__viewer[f as string](...(a as unknown[])), [fn, args] as const) as Promise<T>

test('다중층 뷰에서 엘리베이터는 시작/끝 층을 고르고 위치를 한 번 찍으면 기본 크기 승강로가 생기고 전 층 정차로 시작하며, 건물 밖이면 만들지 않고, 층마다 무정차로 바꾸면 그 층의 로봇 통과가 불가가 되며, 되돌리면 돌아온다 [OE-ML-06#1~] [OE-ML-10#1] [OE-ML-04#1~]', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles([MEP, ROOMS])
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '편집', exact: true }).click()
  await page.getByRole('combobox', { name: '보일 층' }).selectOption({ label: '1F만' })
  await page.getByRole('button', { name: '다중층 뷰에서 편집' }).click()
  await expect(page.getByTestId('multi-banner')).toContainText('1F ~ 2F')
  await page.locator('.canvas-wrap > canvas').scrollIntoViewIfNeeded()

  await page.getByTestId('multi-banner').getByRole('button', { name: '수직 관통 오브젝트 만들기' }).click()
  const form = page.getByTestId('vertical-create')
  await form.getByLabel('만들 종류').selectOption({ label: '엘리베이터' })
  await form.getByLabel('만들 이름').fill('EL-1')
  const make = form.getByRole('button', { name: '만들기', exact: true })
  await expect(make).toBeDisabled()
  // 물리존 밖(20, 20)에 찍으면 경고하고 만들지 않는다.
  await page.getByTestId('vertical-create-start').click()
  let at = await viewer<{ x: number; y: number }>(page, 'point', [20, 20, 0])
  await page.mouse.click(at.x, at.y)
  await expect(page.getByTestId('vertical-create-block')).toContainText('건물(물리존) 밖')
  await expect(make).toBeDisabled()
  // 복도(x 10~12, y 2~8) 가운데에 다시 찍는다. 2.4m 승강로가 복도 안(여유 0.5m)에 든다.
  await page.getByTestId('vertical-create-place').click()
  at = await viewer<{ x: number; y: number }>(page, 'point', [11, 5, 0])
  await page.mouse.click(at.x, at.y)
  // 정차 층·진입 지점(OE-ML-10 AC1): 처음은 전 층 정차·첫 면이고, 확인해야 만든다. 2F 는 다른 면으로 고친다.
  const stopsBox = page.getByTestId('vertical-create-stops')
  await expect(stopsBox.getByLabel('1F 정차')).toBeChecked()
  await expect(stopsBox.getByLabel('2F 정차')).toBeChecked()
  await expect(page.getByTestId('vertical-create-block')).toHaveText('정차 층·진입 지점을 확인합니다')
  await expect(make).toBeDisabled()
  await stopsBox.getByLabel('2F 진입 면').selectOption({ index: 1 })
  await stopsBox.getByLabel('정차 층·진입 지점을 확인했습니다').check()
  await expect(page.getByTestId('vertical-create-block')).toHaveCount(0)
  await make.click()

  const panel = page.getByTestId('vertical-picked')
  await expect(panel.locator('h3')).toHaveText('EL-1')
  const stops = panel.getByTestId('elevator-stops')
  await expect(stops.getByLabel('1F 정차')).toHaveValue('stop')
  await expect(stops.getByLabel('2F 정차')).toHaveValue('stop')
  await expect(panel.getByTestId('vertical-passable')).toContainText('통과 가능')
  // 승강로 가운데가 찍은 자리이고, 기본 크기라 회전각은 0° 다.
  await expect(page.getByLabel('회전각(°)')).toHaveValue('0.0')
  // 진입 면은 고른 대로다(1F 첫 면 · 2F 둘째 면). 1F 진입 지점은 복도 안이라 그 물리존을 짚는다.
  await expect(stops.getByLabel('1F 진입 면')).toHaveValue('0')
  await expect(stops.getByLabel('2F 진입 면')).toHaveValue('1')
  await expect(panel.getByTestId('vertical-spaces')).toContainText('복도')

  // 2F 를 무정차로. 2F 조각을 고르면 그 층은 통과 불가다.
  await stops.getByLabel('2F 정차').selectOption('skip')
  await expect(page.locator('.edit-bar .last-edit')).toContainText('엘리베이터 2F 무정차')
  await panel.getByTestId('vertical-storeys').getByRole('button', { name: '2F' }).click()
  await expect(panel.getByTestId('vertical-passable')).toContainText('2F: 통과 불가 — 서지 않는 층입니다')

  // 되돌리면 정차로 돌아온다.
  await page.locator('.edit-bar .undo').click()
  await expect(stops.getByLabel('2F 정차')).toHaveValue('stop')
  await expect(panel.getByTestId('vertical-passable')).toContainText('2F: 통과 가능')
  expect(errors).toEqual([])
})

test('다중층 뷰에서 에스컬레이터는 시작점만 찍으면 끝 층이 바로 위층으로 정해지고 기본 형상·끝점이 계산되며, 회전각으로 방향을 정하고 상행 처음 선택을 확인해야 만들어진다 [OE-ML-06#2~,3~] [OE-ML-11#1~,2]', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles([MEP, ROOMS])
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '편집', exact: true }).click()
  await page.getByRole('combobox', { name: '보일 층' }).selectOption({ label: '1F만' })
  await page.getByRole('button', { name: '다중층 뷰에서 편집' }).click()
  await page.locator('.canvas-wrap > canvas').scrollIntoViewIfNeeded()
  await page.getByTestId('multi-banner').getByRole('button', { name: '수직 관통 오브젝트 만들기' }).click()
  const form = page.getByTestId('vertical-create')
  await form.getByLabel('만들 종류').selectOption({ label: '에스컬레이터' })
  await form.getByLabel('만들 이름').fill('ES-1')
  await expect(page.getByTestId('vertical-create-to')).toContainText('2F (바로 위층, 자동)')
  // 복도 (11, 2.5) 에 시작점을 찍고 +y(90°)로 돌린다. 층고 3m ÷ tan 30° = 5.20m.
  await page.getByTestId('vertical-create-start').click()
  const start = await viewer<{ x: number; y: number }>(page, 'point', [11, 2.5, 0])
  await page.mouse.click(start.x, start.y)
  // 처음 방위 0°(+x)면 형상이 복도 밖(x 16.2)으로 나가 경고하고 만들지 않는다(OE-ML-06 AC3).
  await expect(page.getByTestId('vertical-create-block')).toContainText('건물(물리존) 밖')
  // 회전 손잡이를 91.5° 쪽으로 끌면 건물 축 90° 에 붙고, 미리보기 끝점이 따라 돈다.
  const h = (await viewer<{ knob: { x: number; y: number }; spec: { center: [number, number]; elevation: number; radius: number } }>(page, 'rotateHandle'))!
  const r = (91.5 * Math.PI) / 180
  const target = await viewer<{ x: number; y: number }>(page, 'screenOf', [h.spec.center[0] + Math.cos(r) * h.spec.radius, h.spec.center[1] + Math.sin(r) * h.spec.radius, h.spec.elevation])
  await page.mouse.move(h.knob.x, h.knob.y)
  await page.mouse.down()
  await page.mouse.move(target.x, target.y, { steps: 6 })
  await expect(page.getByTestId('rotate-label')).toContainText('90.0° · 건물 축에 붙음')
  await page.mouse.up()
  await expect(form.getByLabel('만들 회전각(°)')).toHaveValue('90.0')
  await expect(page.getByTestId('vertical-create-length')).toContainText('수평 길이 5.20m')
  // 상행이 처음 선택이고, 확인하기 전에는 만들지 않는다.
  const direction = page.getByTestId('vertical-create-direction')
  await expect(direction.getByLabel('상행(처음 선택)')).toBeChecked()
  await expect(page.getByTestId('vertical-create-block')).toHaveText('운행 방향을 확인합니다')
  const make = form.getByRole('button', { name: '만들기', exact: true })
  await expect(make).toBeDisabled()
  await direction.getByLabel('이 방향이 맞습니다').check()
  await make.click()

  const panel = page.getByTestId('vertical-picked')
  await expect(panel.locator('h3')).toHaveText('ES-1')
  const dir = panel.getByTestId('escalator-direction')
  await expect(dir.getByLabel('운행 방향')).toHaveValue('up')
  // 상행: 1F(0m) 시작점 → 2F(3m) 끝점.
  await expect(dir).toContainText(/11\.00, 2\.50, 0\.00 → 11\.00, 7\.70, 3\.00/)
  await expect(panel.getByTestId('vertical-passable')).toContainText('통과 불가')
  // 만들기와 방향이 되돌리기 한 번이다.
  await page.locator('.edit-bar .undo').click()
  await expect(panel).toHaveCount(0)
  expect(errors).toEqual([])
})
