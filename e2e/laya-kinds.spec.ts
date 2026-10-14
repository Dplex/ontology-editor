import { expect, test, type Page } from '@playwright/test'

// Laya 종류 후보(ADR-0057). 133 의 Laya 서버를 page.route 로 흉내 낸다 — e2e 는 133 에 닿지 않아도 돌아야 한다.
// 서버는 편집 화면이 보낸 단서 글(family-clues.ts 의 clueText)을 받아 확률 순서의 종류를 돌려준다. 화면은 보이기만 하고,
// 누르면 여느 후보처럼 그 패밀리에 붙는다(출처 편집, OE-EQP-14).
const MEP = 'src/lib/ifc/fixtures/mep.ifc'

async function open(page: Page, laya: { enabled: boolean; confidence?: number }) {
  const errors: string[] = []
  const asked: string[][] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.route('**/__laya', (r) => r.fulfill({ json: laya.enabled ? { enabled: true, model: 'test/final' } : { enabled: false, reason: 'LAYA_URL 이 없습니다' } }))
  await page.route('**/__laya/kinds', async (r) => {
    const { states } = r.request().postDataJSON() as { states: string[] }
    asked.push(states)
    const c = laya.confidence ?? 0.8
    await r.fulfill({ json: { results: states.map(() => ({ ranked: [{ kind: 'heat_detector', p: c }, { kind: 'smoke_detector', p: 0.1 }, { kind: 'nope', p: 0.05 }], confidence: c })), ms: 12 } })
  })
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(MEP)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '편집', exact: true }).click()
  const fold = page.getByRole('button', { name: /종류와 관제점 후보/ })
  if ((await fold.getAttribute('aria-expanded')) === 'false') await fold.click()
  return { errors, asked }
}

test('Laya 서버가 있으면 종류를 모르는 패밀리에 Laya 후보와 확률이 붙고, 누르면 그 패밀리에 붙어 출처가 편집이 된다 [OE-EQP-14#2~]', async ({ page }) => {
  const { errors, asked } = await open(page, { enabled: true })
  const row = page.locator('.unknown-types tr', { hasText: 'TEMP-101-01' })
  const laya = row.locator('.suggest.laya')
  await expect(laya).toContainText('열감지기')
  await expect(laya).toContainText('80%')
  // 라벨에 없는 종류(nope)는 보이지 않는다.
  await expect(laya.getByRole('button')).toHaveCount(2)
  await expect(laya).not.toHaveClass(/unsure/)
  // 서버에 간 글은 화면의 단서와 같은 줄이다.
  const sent = asked.flat().find((s) => s.includes('TEMP-101-01'))!
  expect(sent.split('\n').map((l) => l.split(':')[0])).toEqual(['패밀리 이름', 'IFC 클래스', '계통', '이웃', '위치'])

  await laya.getByRole('button', { name: /열감지기/ }).click()
  await expect(page.locator('.unknown-types tr', { hasText: 'TEMP-101-01' })).toHaveCount(0)
  await expect(page.locator('.report')).toContainText('종류 모름 → 열감지기')
  await page.locator('.fold.kinds').screenshot({ path: 'test-results/laya-kinds.png' })
  expect(errors).toEqual([])
})

test('Laya 가 자신 없으면 흐리게 "자신 없음" 으로 보인다', async ({ page }) => {
  const { errors } = await open(page, { enabled: true, confidence: 0.2 })
  const laya = page.locator('.unknown-types tr', { hasText: 'TEMP-101-01' }).locator('.suggest.laya')
  await expect(laya).toContainText('신뢰도 낮음')
  await expect(laya).toHaveClass(/unsure/)
  expect(errors).toEqual([])
})

test('Laya 서버가 없으면 Laya 줄이 보이지 않고 묻지도 않는다', async ({ page }) => {
  const { errors, asked } = await open(page, { enabled: false })
  const row = page.locator('.unknown-types tr', { hasText: 'TEMP-101-01' })
  await expect(row.locator('.clues')).toContainText('계통:')
  await expect(row.locator('.suggest.laya')).toHaveCount(0)
  expect(asked).toEqual([])
  expect(errors).toEqual([])
})
