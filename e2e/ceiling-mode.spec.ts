import { existsSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'

// 천장 편집 모드(OE-OBJ-08). 설비 편집의 [바닥·벽 / 천장] 토글(T). 바닥·벽 쪽에서 천장 설비는 고르기·조회만, 천장 쪽에서는 천장 설비만
// 고친다. 반자 높이를 모르는 층은 천장 모드에서 입력을 받기 전에 천장 설비를 놓지 않는다. mep.ifc 에는 반자 높이가 없고, 사무실에
// 디퓨저 AT-101-01·02(z 2.7)와 공조기 AHU-1(바닥)이 있다.
const MEP = 'src/lib/ifc/fixtures/mep.ifc'
const DUPLEX = 'data/NBU_Duplex/NBU_Duplex-Apt_Eng-MEP.ifc'

const row = (page: Page, name: string) => page.locator('.equipment tbody tr', { hasText: name }).last()
const pick = (page: Page, name: string) => row(page, name).getByRole('button', { name, exact: true }).click()
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
  await page.getByRole('button', { name: '편집', exact: true }).click()
  return errors
}

test('바닥·벽 쪽에서 천장 설비는 고르기·조회만 되고, 천장 모드에서 천장고를 넣은 뒤 x·y 로 옮긴다', async ({ page }) => {
  const errors = await open(page)
  // 바닥·벽 쪽: 디퓨저는 잠겨 있다
  await pick(page, 'AT-101-01')
  await expect(page.locator('.picked .ceiling-lock')).toContainText('천장 설비는 천장 편집 모드에서 편집합니다')
  await expect(page.locator('.picked .position-edit')).toHaveCount(0)
  await expect(page.locator('.picked .danger-zone')).toHaveCount(0)
  await keys(page, 'Shift+ArrowRight')
  await expect(page.locator('.edit-notice').first()).toContainText('천장 편집 모드에서 편집')
  await expect(page.locator('.edit-bar')).toContainText('바뀐 것 0건')

  // T 로 천장 모드 — 선택이 풀리고, 반자 높이를 모르니 입력을 받는다. 그 전에는 설비를 더하지 못한다.
  await keys(page, 't')
  await expect(toggle(page).getByRole('button', { name: '천장' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.picked h3')).toHaveCount(0)
  await expect(page.locator('.ceiling-ask')).toBeVisible()
  await expect(page.getByRole('button', { name: '설비 더하기' })).toBeDisabled()
  // 공간 도구는 잠겨 있고 누르면 알린다
  await page.getByRole('button', { name: '물리존 그리기' }).click()
  await expect(page.locator('.edit-notice').first()).toContainText('공간은 [바닥·벽] 쪽에서 편집')

  await page.getByLabel('천장 모드 천장고(m)').fill('2.7')
  await page.getByLabel('천장 모드 천장고(m)').press('Enter')
  await expect(page.locator('.ceiling-now')).toContainText('천장고 2.70 m')
  await expect(page.getByRole('button', { name: '설비 더하기' })).toBeEnabled()
  await page.waitForTimeout(800)
  await page.screenshot({ path: 'test-results/ceiling-mode-mep.png' })

  // 천장 모드에서 더한 설비는 반자 높이(2.7)에 놓인다(OE-EQP-02). 이 전에는 바닥 높이(0)였다.
  await page.getByRole('button', { name: '설비 더하기' }).click()
  await page.locator('.viewport canvas').first().scrollIntoViewIfNeeded()
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

  // T 로 나오면 공조기를 다시 고친다
  await keys(page, 't')
  await expect(toggle(page).getByRole('button', { name: '바닥·벽' })).toHaveAttribute('aria-pressed', 'true')
  await pick(page, 'AHU-1')
  await expect(page.locator('.picked .position-edit')).toBeVisible()
  expect(errors).toEqual([])
})

test('Duplex: 천장 모드는 위에서 내려다보고 천장고에 천장면을 그린다 (스샷)', async ({ page }) => {
  test.skip(!existsSync(DUPLEX), `${DUPLEX} 이 없다(npm run fetch:sample)`)
  test.setTimeout(120_000)
  const errors = await open(page, DUPLEX)
  await page.locator('select.storey-view').selectOption({ label: 'Level 1만' })
  await page.locator('.viewport canvas').first().scrollIntoViewIfNeeded()
  await page.waitForTimeout(800)
  await page.locator('.viewport').first().screenshot({ path: 'test-results/ceiling-mode-floor-side.png' })
  await keys(page, 't')
  await expect(page.locator('.ceiling-now')).toContainText('천장고 2.60 m')
  await page.locator('.viewport canvas').first().scrollIntoViewIfNeeded()
  await page.waitForTimeout(1200)
  await page.locator('.viewport').first().screenshot({ path: 'test-results/ceiling-mode-ceiling-side.png' })
  expect(errors).toEqual([])
})
