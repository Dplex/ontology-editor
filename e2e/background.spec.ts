import { expect, test } from '@playwright/test'

// 평면도 배경 이미지(OE-MAN-02). mep.ifc 1F 사무실은 (0..10 × 0..8)이다. plan-grid.png 는 400×200px 격자다.
const MEP = 'src/lib/ifc/fixtures/mep.ifc'
const PLAN = 'e2e/fixtures/plan-grid.png'
// 두 쪽 PDF: 1쪽 400×200pt, 2쪽 400×400pt(50pt 격자, 테두리, 왼쪽 아래 빨간 칸). 글꼴 없이 선만 있다.
const PLAN_PDF = 'e2e/fixtures/plan-grid.pdf'

test('도면 이미지를 깔면 건물 너비에 맞춰 놓이고, 두 점으로 스케일을, 한 점으로 원점을 맞추며, 걷을 수 있다 [OE-MAN-02#1]', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(MEP)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '편집', exact: true }).click()
  const fold = page.getByTestId('bg-plan')
  const head = fold.getByRole('button', { name: /평면도 배경/ })
  if ((await head.getAttribute('aria-expanded')) === 'false') await head.click()
  await fold.getByLabel('평면도 배경 이미지').setInputFiles(PLAN)
  // 400px 를 사무실 너비 10m 에 맞춘다: 1px = 25mm, 왼쪽 위 (0, 8).
  await expect(fold.getByTestId('bg-scale')).toContainText('1px = 25.0mm · 왼쪽 위 (0.00, 8.00)')
  expect(await page.evaluate(() => (window as any).__viewer.background())).toEqual([[0, 8], [10, 8], [10, 3], [0, 3]])

  const floor = async (x: number, y: number) => {
    const at = await page.evaluate(([px, py]) => (window as any).__viewer.point([px, py, 0]), [x, y])
    await page.mouse.click(at.x, at.y)
  }
  // 도면에서 5m 로 보이는 두 점이 실제로는 10m 다.
  await fold.getByRole('button', { name: '스케일 맞추기' }).click()
  await page.locator('.canvas-wrap > canvas').scrollIntoViewIfNeeded()
  await expect(page.locator('.key-note')).toContainText('두 점을 찍으세요')
  await floor(0, 4)
  await floor(5, 4)
  await fold.getByLabel('실제 거리(m)').fill('10')
  await fold.getByRole('button', { name: '맞추기', exact: true }).click()
  await expect(fold.getByTestId('bg-scale')).toContainText('1px = 50.0mm · 왼쪽 위 (0.00, 12.00)')

  // 찍은 점 (4, 6) 이 실제로는 (0, 0) 이다.
  await fold.getByRole('button', { name: '원점 맞추기' }).click()
  await page.locator('.canvas-wrap > canvas').scrollIntoViewIfNeeded()
  await expect(page.locator('.key-note')).toContainText('한 점을 찍으세요')
  await floor(4, 6)
  await expect(fold.getByLabel('실제 x')).toBeVisible()
  await fold.getByLabel('실제 x').fill('0')
  await fold.getByLabel('실제 y').fill('0')
  await fold.getByRole('button', { name: '맞추기', exact: true }).click()
  await expect(fold.getByTestId('bg-scale')).toContainText('왼쪽 위 (-4.00, 6.00)')

  // 온톨로지에는 나가지 않는다: 편집 막대의 바뀐 것이 0 이다.
  await expect(page.locator('.edit-bar')).toContainText('바뀐 것 0건')
  await fold.getByRole('button', { name: '걷기' }).click()
  expect(await page.evaluate(() => (window as any).__viewer.background())).toBeNull()
  expect(errors).toEqual([])
})

test('PDF 도면은 첫 쪽을 그려 같은 길로 깔고, 맞춘 스케일·원점을 둔 채 다른 쪽으로 바꾼다 [OE-MAN-02#1]', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(MEP)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '편집', exact: true }).click()
  const fold = page.getByTestId('bg-plan')
  const head = fold.getByRole('button', { name: /평면도 배경/ })
  if ((await head.getAttribute('aria-expanded')) === 'false') await head.click()
  await fold.getByLabel('평면도 배경 이미지').setInputFiles(PLAN_PDF)
  // 1쪽(400×200pt)을 긴 변 4096px 로 그려 사무실 너비 10m 에 맞춘다: 1px = 2.44mm. 비율이 PNG 와 같아 네 귀퉁이도 같다.
  await expect(fold.getByTestId('bg-scale')).toContainText('1px = 2.4mm · 왼쪽 위 (0.00, 8.00)')
  expect(await page.evaluate(() => (window as any).__viewer.background())).toEqual([[0, 8], [10, 8], [10, 3], [0, 3]])
  await expect(page.locator('.key-note')).toContainText('2쪽 중 1쪽')
  const pageInput = fold.getByLabel('PDF 쪽')
  await expect(pageInput).toHaveValue('1')

  // 도면에서 5m 로 보이는 두 점이 실제로는 10m 다.
  const floor = async (x: number, y: number) => {
    const at = await page.evaluate(([px, py]) => (window as any).__viewer.point([px, py, 0]), [x, y])
    await page.mouse.click(at.x, at.y)
  }
  await fold.getByRole('button', { name: '스케일 맞추기' }).click()
  await page.locator('.canvas-wrap > canvas').scrollIntoViewIfNeeded()
  await floor(0, 4)
  await floor(5, 4)
  await fold.getByLabel('실제 거리(m)').fill('10')
  await fold.getByRole('button', { name: '맞추기', exact: true }).click()
  expect(await page.evaluate(() => (window as any).__viewer.background())).toEqual([[0, 12], [20, 12], [20, 2], [0, 2]])

  // 2쪽(400×400pt)으로 바꾸면 종이 1pt 의 길이와 왼쪽 위가 그대로라 20m × 20m 로 깔린다.
  await pageInput.fill('2')
  await pageInput.press('Enter')
  await expect(fold).toContainText('/ 2')
  await expect.poll(() => page.evaluate(() => (window as any).__viewer.background())).toEqual([[0, 12], [20, 12], [20, -8], [0, -8]])
  await expect(pageInput).toHaveValue('2')
  await expect(page.locator('.edit-bar')).toContainText('바뀐 것 0건')
  expect(errors).toEqual([])
})

// DWG 는 서버(8084, src/server/dwg.ts)가 PNG 로 바꾼다. e2e 서버에는 /__data 가 없어 가로채 답한다 — 실제 변환은 src/server/dwg.test.ts 가 잰다.
// plan-mm.dwg 는 mm 단위 평면도(사무실 0..10 × 0..8m 와 창고)이고, 서버는 그림이 덮는 범위 -0.7..14.7 × -0.4..8.4m(여백 포함)를 알려 준다.
const PLAN_DWG = 'e2e/fixtures/plan-mm.dwg'
test('DWG 도면은 서버가 바꾼 그림을 도면 단위로 실제 크기에 맞춰 깔고, 도면 좌표가 건물과 겹치면 그 자리에 둔다 [OE-MAN-02#1]', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  let posted = ''
  await page.route('**/__data/__dwg', async (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { enabled: true, ezdxf: '1.4.4', libredwg: 'dwg2dxf 0.13.3' } })
    posted = (route.request().postDataBuffer() ?? Buffer.alloc(0)).subarray(0, 6).toString('latin1')
    const stats = { width: 400, height: 200, extents: [-700, -400, 14700, 8400], unit: 'mm', metersPerUnit: 0.001, minimal: false }
    return route.fulfill({ status: 200, contentType: 'image/png', headers: { 'X-Dwg2png': JSON.stringify(stats), 'Access-Control-Expose-Headers': 'X-Dwg2png' }, path: PLAN })
  })
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(MEP)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '편집', exact: true }).click()
  const fold = page.getByTestId('bg-plan')
  const head = fold.getByRole('button', { name: /평면도 배경/ })
  if ((await head.getAttribute('aria-expanded')) === 'false') await head.click()
  await expect(fold.getByTestId('dwg-ready')).toBeVisible()
  await fold.getByLabel('평면도 배경 이미지').setInputFiles(PLAN_DWG)
  await expect(page.locator('.key-note')).toContainText('도면 단위(mm)로 실제 크기에 맞췄고, 도면 좌표가 건물과 겹쳐 그 자리에 두었습니다')
  expect(posted).toBe('AC1015')
  // 400px 가 15.4m: 1px = 38.5mm, 왼쪽 위는 도면 좌표 그대로 (-0.7, 8.4).
  await expect(fold.getByTestId('bg-scale')).toContainText('1px = 38.5mm · 왼쪽 위 (-0.70, 8.40)')
  const corners = (await page.evaluate(() => (window as any).__viewer.background())) as number[][]
  expect(corners.flat().map((v) => Math.round(v * 1000) / 1000)).toEqual([-0.7, 8.4, 14.7, 8.4, 14.7, 0.7, -0.7, 0.7])
  if (process.env.SHOT_DWG) await page.locator('.viewport').screenshot({ path: process.env.SHOT_DWG })
  expect(errors).toEqual([])
})

test('DWG 를 바꿀 수 없는 서버면 안내에 까닭이 보이고, 골라도 깔지 않고 까닭을 알린다 [OE-MAN-02#1]', async ({ page }) => {
  const reason = '이 서버에서 DWG 를 바꿀 수 없습니다: dwg2dxf 를 실행하지 못했습니다'
  await page.route('**/__data/__dwg', (route) =>
    route.request().method() === 'GET' ? route.fulfill({ json: { enabled: false, reason } }) : route.fulfill({ status: 503, json: { error: reason } }),
  )
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(MEP)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '편집', exact: true }).click()
  const fold = page.getByTestId('bg-plan')
  const head = fold.getByRole('button', { name: /평면도 배경/ })
  if ((await head.getAttribute('aria-expanded')) === 'false') await head.click()
  await expect(fold.getByTestId('dwg-off')).toContainText(reason)
  await fold.getByLabel('평면도 배경 이미지').setInputFiles(PLAN_DWG)
  await expect(page.locator('.key-note')).toContainText(`DWG 를 깔지 못했습니다: ${reason}. PDF 나 이미지로 내보내 고를 수 있습니다`)
  expect(await page.evaluate(() => (window as any).__viewer.background())).toBeNull()
})
