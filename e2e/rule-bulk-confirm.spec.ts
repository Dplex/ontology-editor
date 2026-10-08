import { existsSync } from 'node:fs'
import { expect, test } from '@playwright/test'

// 규칙 방향 일괄 확정(OE-PIP-05). 포트와 견줄 연결이 20개 이상이고 일치율이 문턱 이상인 계통만 한꺼번에 확정하고, 되돌리기는 한 번이다.
// 가진 BIM 중 규칙 방향과 포트 방향이 같이 많은 파일은 성수 기계뿐이다(일괄 확정 후보 2개).
const SEONGSU = 'data/성수/Factorial_기계.ifc'
test.setTimeout(400_000)

test('포트와 20개 이상 견줘 문턱 이상 맞는 계통만 한꺼번에 확정하고, 되돌리면 다시 확정 전이다', async ({ page }) => {
  test.skip(!existsSync(SEONGSU), `${SEONGSU} 이 없다(성수 파일이 있는 PC 나 55 에서 돈다)`)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(SEONGSU)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 300_000 })
  await page.getByRole('button', { name: '편집', exact: true }).click()

  const fold = page.locator('.fold-head', { hasText: '규칙 방향 확정 (계통별)' }).first()
  if ((await fold.getAttribute('aria-expanded')) !== 'true') await fold.click()
  const section = page.locator('.rule-systems')
  const bulk = section.getByRole('button', { name: /개 한꺼번에 확정/ })
  const count = Number((await bulk.innerText()).match(/\d+/)![0])
  expect(count).toBeGreaterThan(0)

  // 후보는 확정 전이고, 견준 연결 20개 이상 · 일치율 90% 이상이다.
  const rows = section.locator('tbody tr')
  // 칸을 따로 읽는다. 줄 글을 통째로 읽으면 규칙 방향 수와 일치율이 붙는다("63" + "90%").
  const before = await rows.evaluateAll((trs) =>
    trs.map((tr) => {
      const cells = [...tr.querySelectorAll('td')].map((td) => td.textContent ?? '')
      return { match: cells[3] ?? '', confirmed: (cells[4] ?? '').includes('확정함') }
    }),
  )
  const eligible = before.filter((r) => {
    const m = r.match.match(/(\d+)%\s*(\d+)\/(\d+)/)
    return !r.confirmed && m && Number(m[3]) >= 20 && Number(m[1]) >= 90
  })
  expect(eligible).toHaveLength(count)

  await bulk.click()
  await expect(section.locator('tbody tr', { hasText: '확정함' })).toHaveCount(before.filter((r) => r.confirmed).length + count)
  await expect(page.locator('.report')).toContainText('규칙 방향')

  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('Control+z')
  await expect(section.locator('tbody tr', { hasText: '확정함' })).toHaveCount(before.filter((r) => r.confirmed).length)
  expect(errors).toEqual([])
})
