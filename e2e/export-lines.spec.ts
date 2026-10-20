import { expect, test, type Page } from '@playwright/test'
import { openFileMenu, enterEdit } from './edit-part'

// 고른 것이 내보내는 TTL·GeoJSON 의 어디에 어떻게 남나(오른쪽 패널의 "내보내면" 칸). 칸의 Turtle 원문은 [TTL] 이 내려받는 파일의 그 블록과 같다.
const MEP = 'src/lib/ifc/fixtures/mep.ifc'
const AHU = '0MEP$Equip$AHU1$0000'

async function open(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('input[type=file]').first().setInputFiles(MEP)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  return errors
}

async function clickPart(page: Page, id: string) {
  const at = await page.evaluate((x) => (window as any).__viewer.part(x), id)
  await page.mouse.click(at.x, at.y)
}

test('고른 설비의 TTL 관계·DT 플랫폼이 버리는 줄·GeoJSON feature 가 보이고, Turtle 원문이 내려받는 TTL 의 블록과 같다', async ({ page }) => {
  const errors = await open(page)
  const box = page.getByTestId('export-lines')
  // 아무것도 고르지 않으면 칸이 없다.
  await expect(box).toHaveCount(0)
  await clickPart(page, AHU)
  await expect(box).toContainText('이 설비의 TTL·GeoJSON 줄')
  // 접힌 채로 시작하고, 접힌 동안에는 몸통(내보내기)이 붙지 않는다.
  await expect(page.getByTestId('export-lines-body')).toHaveCount(0)
  await box.locator('.fold-head').click()

  await expect(page.getByTestId('export-status')).toContainText('DT 플랫폼(ttl.go)이 읽습니다')
  await expect(page.getByTestId('export-status')).toContainText('brick:Air_Handling_Unit')
  const rels = page.getByTestId('export-rels')
  await expect(rels.locator('tr', { hasText: 'brick:hasLocation' }).locator('.rel-chip')).toHaveText(['사무실'])
  await expect(rels.locator('tr.incoming', { hasText: 'brick:hasPart' })).toContainText('AHU-1 급기 계통')
  await expect(page.getByTestId('export-dropped')).toContainText('ex:ifcClass')
  await expect(box).toContainText('kind: equipment')

  // 칸의 원문 = 내려받은 ontology.ttl 의 AHU 블록.
  await box.getByText('Turtle 원문').click()
  const shown = (await box.locator('.export-source pre').first().innerText()).trim()
  const download = page.waitForEvent('download')
  await openFileMenu(page)
  await page.getByRole('button', { name: '의미 내보내기 (Brick TTL)' }).click()
  const ttl = Buffer.concat(await (await (await download).createReadStream()).toArray()).toString()
  const block = ttl.split(/\n\s*\n/).find((b) => b.trim().startsWith('ex:0MEP\\$Equip\\$AHU1\\$0000 '))!.trim()
  expect(shown.split('\n').map((l) => l.trim())).toEqual(block.split('\n').map((l) => l.trim()))
  expect(errors).toEqual([])
})

test('관계의 상대를 누르면 그것을 고르고, 칸은 편 채로 따라온다. 이름을 고치면 칸도 따라 바뀐다', async ({ page }) => {
  const errors = await open(page)
  await clickPart(page, AHU)
  const box = page.getByTestId('export-lines')
  await box.locator('.fold-head').click()
  await page.getByTestId('export-rels').locator('tr', { hasText: 'brick:hasLocation' }).locator('.rel-chip').click()

  // 방으로 건너갔다 — 방을 가리키는 hasLocation 에 AHU 가 있다.
  await expect(box).toContainText('이 물리존의 TTL·GeoJSON 줄')
  await expect(page.getByTestId('export-rels').locator('tr.incoming', { hasText: 'brick:hasLocation' })).toContainText('AHU-1')
  await expect(page.getByTestId('export-dropped')).toContainText('ex:areaM2')
  await expect(box).toContainText('kind: space')

  // 편집 모드에서 이름을 고치면 TTL 의 rdfs:label 이 바뀐다.
  await enterEdit(page)
  const name = page.locator('.space-name', { hasText: '공간명' }).locator('input')
  await name.fill('대회의실')
  await name.press('Enter')
  await box.getByText('Turtle 원문').click()
  await expect(box.locator('.export-source pre').first()).toContainText('rdfs:label "대회의실"')
  expect(errors).toEqual([])
})

test('덕트·배관은 TTL 에 나가지만 DT 플랫폼이 블록째 읽지 않는다고 말한다', async ({ page }) => {
  const errors = await open(page)
  // 덕트는 AHU 와 겹쳐 3D 로 누르기 어렵다. 챗봇 답의 [3D] 와 같은 길(window.__editor3d)로 고른다.
  await page.evaluate(() => (window as any).__editor3d.show(['0MEP$Duct$D01$00000']))
  const box = page.getByTestId('export-lines')
  await box.locator('.fold-head').click()
  await expect(page.getByTestId('export-status')).toContainText('fso:')
  await expect(page.getByTestId('export-status')).toContainText('통째로 읽지 않습니다')
  // 받는 쪽이 버리는 블록이라 관계 줄도 버리는 줄로 보인다.
  await expect(page.getByTestId('export-dropped')).toContainText('brick:hasLocation')
  expect(errors).toEqual([])
})
