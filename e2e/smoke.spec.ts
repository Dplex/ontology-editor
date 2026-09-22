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
  await expect(tile('설비')).toHaveText('5')
  await expect(tile('계통')).toHaveText('1')

  // 빠진 것이 무엇인지 화면이 말한다. 이게 고객사 BIM 스펙 협의에 쓰이는 목록이다.
  const warnings = page.locator('.warnings')
  await expect(warnings).toContainText('좌표가 없어')
  await expect(warnings).toContainText('용량 파라미터가 없습니다')

  expect(errors).toEqual([])
})
