import { expect, test } from '@playwright/test'

// 출처 표시(OE-UI-13). 패널의 값마다 출처(BIM · 계산 · 사전 · 사람 · 외부, glossary "출처")가 붙고, 사람이 고치면 "사람" 이 된다.
const MEP = 'src/lib/ifc/fixtures/mep.ifc'

test('설비 패널의 값마다 출처가 보이고, 좌표·종류를 고치면 그 값의 출처가 "사람" 이 된다 [OE-UI-13#1]', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(MEP)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '편집', exact: true }).click()
  await page.locator('.equipment tbody tr', { hasText: 'AHU-1' }).last().getByRole('button', { name: 'AHU-1', exact: true }).click()
  const panel = page.locator('.side .picked')
  await expect(panel.locator('h3')).toHaveText('AHU-1')
  // 값 줄마다 출처 칩이 있다(종류·역할·계통·소속·설치면). "지정" 줄은 값이 아니라 소속을 사람이 고르는 칸이다 — 고르면 "소속" 줄의
  // 출처가 사람이 된다(e2e/space-assign.spec.ts).
  const facts = panel.locator('dl.facts > div').filter({ hasNot: page.locator('dt', { hasText: /^지정$/ }) })
  expect(await facts.count()).toBeGreaterThan(3)
  for (const row of await facts.all()) await expect(row.locator('.src').first()).toBeVisible()
  // 출처 낱말은 PRD 다섯 가지 중 하나다.
  for (const t of await panel.locator('.src').allInnerTexts()) expect(['BIM', '계산', '사전', '사람', '외부']).toContain(t)

  // 좌표: BIM → 고치면 사람.
  const position = panel.locator('.position-edit')
  await expect(position.locator('.src')).toHaveText('BIM')
  await position.locator('.coord').first().fill('2')
  await position.locator('.coord').first().press('Enter')
  await expect(position.locator('.src')).toHaveText('사람')
  await expect(position.locator('.src')).toHaveAttribute('title', '사람이 직접 고친 값입니다.')

  // 종류: 사전 → 고르면 사람.
  const kind = facts.filter({ hasText: '종류' }).first()
  await expect(kind.locator('.src').first()).toHaveText('사전')
  await panel.getByRole('combobox', { name: '종류' }).first().selectOption({ label: '팬' })
  await expect(kind.locator('.src').first()).toHaveText('사람')
  expect(errors).toEqual([])
})
