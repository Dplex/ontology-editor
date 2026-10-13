import { existsSync } from 'node:fs'
import { expect, test } from '@playwright/test'

// 편집기 3D 옆의 결과 비교 판(ADR-0061). 지금 모델을 내보낸 TTL·층 GeoJSON 을 받는 쪽처럼 다시 읽어 보이고, 고르기는 id 하나로
// 양쪽이 같다. Duplex MEP 1층: 라디에이터 536919 · 계단실(Stair) 물리존.
const DUPLEX = 'data/NBU_Duplex/NBU_Duplex-Apt_Eng-MEP.ifc'
const RADIATOR = 'M_Radiator - Hosted:Readiator - 25:Readiator - 25:536919'

test('Duplex: [결과 비교] 판은 받는 쪽이 읽은 TTL·GeoJSON 을 보이고, 평면에서 고르면 3D 가 고르며, 3D 에서 고르면 판이 그 TTL 블록을 보이고, 이름을 고치면 다시 쓴다', async ({ page }) => {
  test.skip(!existsSync(DUPLEX), `${DUPLEX} 이 없다(npm run fetch:sample)`)
  test.setTimeout(180_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.setViewportSize({ width: 1600, height: 900 })
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(DUPLEX)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 90_000 })
  await page.getByRole('combobox', { name: '보일 층' }).selectOption({ label: 'Level 1만' })

  const pane = page.getByTestId('export-compare')
  await page.getByTestId('compare-toggle').click()
  const counts = page.getByTestId('export-compare-counts')
  await expect(counts).toContainText(/주어 [\d,]+ · 관계 [\d,]+ · feature [\d,]+/, { timeout: 60_000 })
  await expect(counts).not.toContainText('다시 쓰는 중')
  // 3D 의 층을 따라간다.
  await expect(pane.getByLabel('비교할 층 파일').locator('option:checked')).toHaveText('floor-Level_1.geojson')

  // 평면에서 계단실을 누르면 3D 쪽도 그 물리존을 고르고, 카드에 그 TTL 블록이 뜬다.
  const stair = pane.locator('path.space', { has: page.locator('title', { hasText: 'Stair' }) }).first()
  await stair.dispatchEvent('click')
  await expect(page.locator('.picked h3').first()).toHaveText('Stair')
  const card = page.getByTestId('export-compare-card')
  await expect(card).toContainText('brick:Staircase')
  await expect(page.getByTestId('export-compare-ttl')).toContainText('a brick:Staircase')
  await expect(page.getByTestId('export-compare-ttl')).toContainText('rdfs:label "Stair"')
  await expect(pane.locator('path.space.sel')).toHaveCount(1)

  // 3D 쪽(설비 표)에서 라디에이터를 고르면 판이 그것을 칠하고 TTL·GeoJSON 을 보인다.
  await page.locator('input[type=search]').fill('536919')
  await page.locator('.equipment tbody tr', { hasText: RADIATOR }).last().getByRole('button', { name: RADIATOR, exact: true }).click()
  await expect(card.locator('h4')).toContainText('536919')
  await expect(page.getByTestId('export-compare-ttl')).toContainText(`rdfs:label "${RADIATOR}"`)
  await expect(page.getByTestId('export-compare-ttl')).toContainText('brick:hasLocation')
  await card.getByText('GeoJSON feature').click()
  await expect(page.getByTestId('export-compare-geojson')).toContainText('"kind": "equipment"')
  const id = await pane.locator('circle.sel').getAttribute('data-id')
  expect(id).toBeTruthy()

  // 편집하면 다시 쓴다 — 이름을 고치면 판의 TTL 라벨이 새 이름이 된다.
  await page.getByRole('button', { name: '편집', exact: true }).click()
  const name = page.locator('.equipment-name-edit .name-input')
  await name.fill('RAD-1F-A')
  await name.press('Enter')
  await expect(page.getByTestId('export-compare-ttl')).toContainText('rdfs:label "RAD-1F-A"', { timeout: 10_000 })
  await expect(counts).not.toContainText('다시 쓰는 중')

  // 닫으면 판이 없고, 평면도로 가도 뜨지 않는다.
  await pane.getByRole('button', { name: '닫기' }).click()
  await expect(pane).toHaveCount(0)
  expect(errors).toEqual([])
})
