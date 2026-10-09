import { existsSync } from 'node:fs'
import { expect, test } from '@playwright/test'

// 천장 설비 표시(OE-EQP-04). 편집 모드에서 천장 설비마다 바닥 발자국 링이 있고, 고른 천장 설비에서 링까지 수직 점선이 보이며
// 선택을 풀면 숨는다. 링은 층별로 보기를 따른다. 보기 모드에서는 그리지 않는다. Duplex MEP(gitignore)로 본다.
const DUPLEX = 'data/NBU_Duplex/NBU_Duplex-Apt_Eng-MEP.ifc'
const marks = (page: import('@playwright/test').Page) => page.evaluate(() => (window as any).__viewer.ceilingMarks()) as Promise<{ rings: number; guide: string | null }>

test('편집 모드에서 천장 설비는 바닥 링으로 보이고, 고르면 수직 점선이 링까지 내려온다', async ({ page }) => {
  test.skip(!existsSync(DUPLEX), `${DUPLEX} 이 없다(npm run fetch:sample)`)
  test.setTimeout(120_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(DUPLEX)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 90_000 })
  expect((await marks(page)).rings).toBe(0)

  await page.getByRole('button', { name: '편집', exact: true }).click()
  // 모든 층을 보면 판정 천장 12대(반자 2.6m, 조명·연기감지기)가 다 링이다. 스위치(1.22m)는 사전이 조명으로 잡지만 판정이 천장이 아니라 링이 없다.
  await page.locator('select.storey-view').selectOption({ label: '모든 층' })
  await expect.poll(async () => (await marks(page)).rings).toBe(12)
  await expect(page.locator('.ceiling-key')).toContainText('반자 부착')

  await page.getByLabel('설치면으로 거르기').selectOption('ceiling')
  const list = page.getByRole('button', { name: /설비 위치와 소속/ })
  if ((await list.getAttribute('aria-expanded')) === 'false') await list.click()
  const row = page.locator('.equipment tbody tr').filter({ hasText: 'Pendant Light' }).first()
  await row.getByRole('button').first().click()
  await expect.poll(async () => (await marks(page)).guide).not.toBeNull()
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.locator('.viewport canvas').first().screenshot({ path: 'test-results/ceiling-marks-duplex.png' })

  await page.getByRole('button', { name: '선택 해제' }).click()
  await expect.poll(async () => (await marks(page)).guide).toBeNull()

  // 한 층만 보면 그 층의 링만 남는다
  await page.locator('select.storey-view').selectOption({ label: 'Level 2만' })
  const level2 = (await marks(page)).rings
  expect(level2).toBeGreaterThan(0)
  expect(level2).toBeLessThan(12)
  expect(errors).toEqual([])
})
