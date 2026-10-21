import { existsSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { toEquipment, toSpace, enterEdit, openDrawer, pickEquipment } from './edit-part'

// 천장 편집 모드(OE-OBJ-08). 설비 편집의 [바닥·벽 / 천장] 토글(T). 바닥·벽 쪽에서 천장 설비는 고르기·조회만, 천장 쪽에서는 천장 설비만
// 고친다. 반자 높이를 모르는 층은 천장 모드에서 입력을 받기 전에 천장 설비를 놓지 않는다. mep.ifc 에는 반자 높이가 없고, 사무실에
// 디퓨저 AT-101-01·02(z 2.7)와 공조기 AHU-1(바닥)이 있다.
const MEP = 'src/lib/ifc/fixtures/mep.ifc'
const DUPLEX = 'data/NBU_Duplex/NBU_Duplex-Apt_Eng-MEP.ifc'

const pick = (page: Page, name: string) => pickEquipment(page, name)
const xOf = async (page: Page) => Number(await page.locator('.picked .position-edit .coord').first().inputValue())
const keys = async (page: Page, ...combo: string[]) => {
  await page.locator('body').click({ position: { x: 5, y: 5 } })
  for (const k of combo) await page.keyboard.press(k)
}
const toggle = (page: Page) => page.getByRole('group', { name: '설비 편집 면' })

async function open(page: Page, file = MEP) {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(file)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 90_000 })
  await enterEdit(page)
  return errors
}

test('바닥·벽 쪽에서 천장 설비는 고르기·조회만 되고, 천장 모드에서 천장고(50% 반투명 면)를 넣은 뒤 x·y 로 옮긴다 [OE-EQP-02#6] [OE-EQP-04#2,3] [OE-EQP-04#1~] [OE-OBJ-08#1,2,3,4,5,6]', async ({ page }) => {
  const errors = await open(page)
  // 바닥·벽 쪽: 디퓨저는 잠겨 있다
  await pick(page, 'AT-101-01')
  await expect(page.locator('.picked .ceiling-lock')).toContainText('천장 설비는 천장 편집 모드에서 편집합니다')
  await expect(page.locator('.picked .position-edit')).toHaveCount(0)
  await expect(page.locator('.picked .danger-zone')).toHaveCount(0)
  await keys(page, 'Shift+ArrowRight')
  await expect(page.locator('.edit-notice').first()).toContainText('천장 편집 모드에서 편집')
  await expect(page.getByTestId('changes-link')).toContainText('바뀐 것 0건')
  // 종류는 놓기·옮기기가 아니라 패밀리 속성이라 잠겨도 고친다 — 숨기면 [U]→[K] 가 천장 설비에서 멈췄다(성수 H-2).
  await keys(page, 'k')
  await expect(page.locator('.picked .kind-edit select')).toBeFocused()

  // T 로 천장 모드 — 선택이 풀리고, 반자 높이를 모르니 입력을 받는다. 그 전에는 설비를 더하지 못한다.
  await keys(page, 't')
  await expect(toggle(page).getByRole('button', { name: '천장' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.picked h3')).toHaveCount(0)
  await expect(page.locator('.ceiling-ask')).toBeVisible()
  await expect(page.getByRole('button', { name: '설비 더하기' })).toBeDisabled()
  // 천장은 설비 편집 모드의 한쪽이라 공간 도구가 팔레트에 없다(OE-UI-04)
  await expect(page.getByRole('button', { name: '물리존 그리기' })).toHaveCount(0)

  await page.getByLabel('천장 모드 천장고(m)').fill('2.7')
  await page.getByLabel('천장 모드 천장고(m)').press('Enter')
  await expect(page.locator('.ceiling-now')).toContainText('천장고 2.70 m')
  await expect(page.getByRole('button', { name: '설비 더하기' })).toBeEnabled()
  // 천장 편집 모드 진입 시 물리존 외곽선 자리에 50% 반투명(opacity 0.5) 천장면이 반자 높이(2.7m)로 표시된다(OE-OBJ-08 AC1·AC3·AC4·AC6)
  const planesInMode = await page.evaluate(() => (window as any).__viewer.ceilingPlanes())
  expect(planesInMode.length).toBeGreaterThan(0)
  expect(planesInMode[0]).toMatchObject({ y: 2.7, visible: true, opacity: 0.5 })
  await page.waitForTimeout(800)
  await page.screenshot({ path: 'test-results/ceiling-mode-mep.png' })

  // 천장 모드에서 더한 설비는 반자 높이(2.7)에 놓인다(OE-EQP-02). 이 전에는 바닥 높이(0)였다.
  await page.getByRole('button', { name: '설비 더하기' }).click()
  await page.locator('.canvas-wrap > canvas').first().scrollIntoViewIfNeeded()
  const spot = (await page.evaluate(() => (window as any).__viewer.point([8.5, 6.5, 2.7]))) as { x: number; y: number }
  await page.mouse.click(spot.x, spot.y)
  await expect(page.locator('.picked h3')).toHaveText('새 설비 1')
  await expect(page.locator('.picked .position-edit .coord').nth(2)).toHaveValue('2.7')
  await keys(page, 'Escape')

  // 천장 모드: 디퓨저는 옮긴다(x·y), z 는 그대로
  await pick(page, 'AT-101-01')
  await expect(page.locator('.picked .ceiling-lock')).toHaveCount(0)
  const x0 = await xOf(page)
  await keys(page, 'Shift+ArrowRight')
  await expect.poll(() => xOf(page)).not.toBe(x0)
  await expect(page.locator('.picked .position-edit .coord').nth(2)).toHaveValue('2.7')

  // z 를 구역 밖(반자 2.7 에서 0.3m 넘게 아래)으로 고치면 막고 이유를 보인다(Q10)
  const z = page.locator('.picked .position-edit .coord').nth(2)
  await z.fill('1')
  await z.press('Enter')
  await expect(page.locator('.edit-notice').first()).toContainText('0.3m 안쪽')
  await expect(z).toHaveValue('2.7')

  // 천장 모드에서 공조기는 천장에 둘 수 없는 설비다
  await pick(page, 'AHU-1')
  await expect(page.locator('.picked .ceiling-lock')).toContainText('천장에 설치할 수 없는 설비입니다')

  // T 로 나오면 천장면이 숨김으로 전환되고(레이어 패널에서 켜면 50% 반투명으로 표시, AC2), 공조기를 다시 고친다
  await keys(page, 't')
  await expect(toggle(page).getByRole('button', { name: '바닥·벽' })).toHaveAttribute('aria-pressed', 'true')
  expect(await page.evaluate(() => (window as any).__viewer.ceilingPlanes())).toEqual([])
  await page.getByTestId('layer-ceiling').check()
  const planesFromLayer = await page.evaluate(() => (window as any).__viewer.ceilingPlanes())
  expect(planesFromLayer.length).toBeGreaterThan(0)
  expect(planesFromLayer[0]).toMatchObject({ y: 2.7, visible: true, opacity: 0.5 })
  await page.getByTestId('layer-ceiling').uncheck()
  expect(await page.evaluate(() => (window as any).__viewer.ceilingPlanes())).toEqual([])
  await pick(page, 'AHU-1')
  await expect(page.locator('.picked .position-edit')).toBeVisible()
  expect(errors).toEqual([])
})

test('Duplex: 천장 모드는 위에서 내려다보고 천장고에 50% 반투명 천장면을 그린다 (스샷) [OE-OBJ-08#1,2,6]', async ({ page }) => {
  test.skip(!existsSync(DUPLEX), `${DUPLEX} 이 없다(npm run fetch:sample)`)
  test.setTimeout(120_000)
  const errors = await open(page, DUPLEX)
  await page.locator('select.storey-view').selectOption({ label: 'Level 1' })
  await page.locator('.canvas-wrap > canvas').first().scrollIntoViewIfNeeded()
  await page.waitForTimeout(800)
  await page.locator('.viewport').first().screenshot({ path: 'test-results/ceiling-mode-floor-side.png' })
  await keys(page, 't')
  await expect(page.locator('.ceiling-now')).toContainText('천장고 2.60 m')
  await page.locator('.canvas-wrap > canvas').first().scrollIntoViewIfNeeded()
  await page.waitForTimeout(1200)
  await page.locator('.viewport').first().screenshot({ path: 'test-results/ceiling-mode-ceiling-side.png' })
  expect(errors).toEqual([])
})

test('완전성 검사의 [방 안으로 옮기기]는 천장 설비도 바닥·벽 쪽에서 바로 옮긴다(높이는 그대로)', async ({ page }) => {
  const errors = await open(page)
  // 천장 모드에서 디퓨저를 사무실(0..10) 경계 30cm 밖으로 낸다.
  await keys(page, 't')
  await page.getByLabel('천장 모드 천장고(m)').fill('2.7')
  await page.getByLabel('천장 모드 천장고(m)').press('Enter')
  await pick(page, 'AT-101-01')
  const x = page.locator('.picked .position-edit .coord').first()
  await x.fill('10.3')
  await x.press('Enter')
  await keys(page, 'Escape', 't')
  await expect(toggle(page).getByRole('button', { name: '바닥·벽' })).toHaveAttribute('aria-pressed', 'true')
  // 바닥·벽 쪽에서 검사의 고치기를 누른다. 모드 잠금에 막히면 안내만 뜨고 안 옮겨졌다(성수 J-1). 검사는 기준 · 검증 패널에 있다.
  await openDrawer(page)
  const fold = page.getByRole('button', { name: /완전성 검사/ })
  if ((await fold.getAttribute('aria-expanded')) === 'false') await fold.click()
  await page.locator('.checks tbody tr', { hasText: '소속 방이 있다' }).click()
  // 검사 줄을 누르면 걸린 설비를 3D 에 보이려고 패널이 닫힌다. 다시 열면 그 줄의 목록이 펼쳐져 있다.
  await openDrawer(page)
  const item = page.locator('.check-list li', { hasText: 'AT-101-01' })
  await item.getByRole('button', { name: '사무실 안으로 옮기기' }).click()
  await expect(page.locator('.check-list li', { hasText: 'AT-101-01' })).toHaveCount(0)
  // 위치 칸은 그 설비를 고칠 수 있는 쪽(천장)에서만 보인다. 천장 모드로 가서 값을 읽는다.
  await keys(page, 't')
  await pick(page, 'AT-101-01')
  const coords = page.locator('.picked .position-edit .coord')
  await expect(coords.first()).toHaveValue('9.9')
  await expect(coords.nth(2)).toHaveValue('2.7')
  expect(errors).toEqual([])
})
