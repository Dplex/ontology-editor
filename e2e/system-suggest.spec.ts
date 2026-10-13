import { expect, test, type Page } from '@playwright/test'

// 계통이 없는 설비의 계통 후보(ADR-0057). 근처에 구성원이 있는 계통을 거리 순으로 셋 보인다. 성수처럼 계통이 1,037개면 상자에서
// 고르기 어렵다. 누르면 패널의 계통 상자에서 고른 것과 같다(출처 편집, OE-PIP-02). Laya 는 쓰지 않는다 — 가장 가까운 계통보다 못했다.
const MEP = 'src/lib/ifc/fixtures/mep.ifc'

async function open(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(MEP)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '편집', exact: true }).click()
  await page.locator('.viewport canvas').scrollIntoViewIfNeeded()
  await page.waitForTimeout(200)
  return errors
}

async function addAt(page: Page, x: number, y: number) {
  await page.getByRole('button', { name: '설비 더하기' }).click()
  const at = (await page.evaluate(([px, py]) => (window as any).__viewer.point([px, py, 0]), [x, y])) as { x: number; y: number }
  await page.mouse.click(at.x, at.y)
  await expect(page.locator('.picked h3')).toHaveText(/새 설비/)
}

test('계통이 없는 설비를 고르면 근처 계통 후보가 거리와 함께 뜨고, 누르면 그 계통에 들고 후보 줄은 사라진다 [OE-PIP-02#1~]', async ({ page }) => {
  const errors = await open(page)
  await addAt(page, 2, 2)
  const chips = page.getByRole('group', { name: '계통 후보' })
  await expect(chips).toContainText('AHU-1')
  await expect(chips.getByRole('button').first()).toContainText(/\d+\.\dm/)
  await page.locator('.picked').screenshot({ path: 'test-results/system-suggest.png' })

  await chips.getByRole('button').first().click()
  await expect(page.locator('.picked .system-edit select').first()).not.toHaveValue('')
  await expect(page.locator('.picked .system-edit .src.edit')).toBeVisible()
  await expect(chips).toHaveCount(0)
  // 한 번 Ctrl+Z 면 계통이 빠지고 후보 줄이 돌아온다.
  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('Control+z')
  await expect(page.locator('.picked .system-edit select').first()).toHaveValue('')
  await expect(chips).toContainText('AHU-1')
  expect(errors).toEqual([])
})
