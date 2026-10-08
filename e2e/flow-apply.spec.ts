import { expect, test, type Page } from '@playwright/test'

// 연결별 방향 지정(OE-PIP-04). 'A → B' 를 고르면 먼저 미리보기이고 [적용] 해야 정해진다. 규칙과 반대면 보정 사유를 받는다.
// [수동 지정 해제] 는 규칙 방향으로 돌아간다. 적용·해제는 연결 편집 이력에 남는다.
const AT02 = '0MEP$Equip$AT02$0000'
const arrows = (page: Page) =>
  page.evaluate(() => (window as any).__viewer.arrows() as { a: string; b: string; source: string }[])

test('미리보기는 바뀐 것이 아니고, 규칙과 반대면 사유를 받아 적용하며, 되돌리기·수동 지정 해제·이력이 된다', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('input[type=file]').first().setInputFiles('src/lib/ifc/fixtures/mep.ifc')
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '편집', exact: true }).click()
  await page.locator('.equipment tbody tr', { hasText: 'DUCT-01' }).getByRole('button', { name: 'DUCT-01', exact: true }).click()

  const terminal = page.locator('.picked .neighbors tr', { hasText: 'AT-101-02' })
  const bar = page.locator('.edit-bar')
  await expect(terminal.locator('.rel')).toHaveText('하류(추정)')

  // 규칙과 같은 방향의 미리보기. 사유 칸이 없고, 모델은 그대로라 바뀐 것 0건이며 3D 는 미리보기 화살표다.
  await terminal.getByTestId('flow-out').click()
  const preview = terminal.getByTestId('flow-preview')
  await expect(preview).toContainText('미리보기 DUCT-01 → AT-101-02 · 적용 전이라 TTL에 나가지 않습니다')
  await expect(preview.getByTestId('flow-reason')).toHaveCount(0)
  await expect(bar).toContainText('바뀐 것 0건')
  expect((await arrows(page)).find((x) => x.a === AT02 || x.b === AT02)!.source).toBe('preview')
  await preview.getByRole('button', { name: '취소' }).click()
  await expect(preview).toHaveCount(0)
  expect((await arrows(page)).find((x) => x.a === AT02 || x.b === AT02)!.source).toBe('rule')

  // 규칙과 반대. 차이를 보이고 사유 없이는 적용하지 않는다.
  await terminal.getByTestId('flow-in').click()
  await expect(preview).toContainText('규칙 방향(추정) DUCT-01 → AT-101-02과 반대입니다')
  await preview.getByTestId('flow-apply').click()
  await expect(page.getByText('규칙 방향과 반대입니다. 보정 사유를 적어 주세요').first()).toBeVisible()
  await expect(preview.getByTestId('flow-reason')).toBeFocused()
  await expect(bar).toContainText('바뀐 것 0건')
  await preview.getByTestId('flow-reason').fill('현장 확인 결과 반대로 흐름')
  await preview.getByTestId('flow-apply').click()
  await expect(terminal.locator('.rel')).toHaveText('상류')
  await expect(terminal).toContainText('사유: 현장 확인 결과 반대로 흐름')
  await expect(bar).toContainText('바뀐 것 1건')
  await expect(page.locator('.report')).toContainText('AT-101-02 → DUCT-01: 방향 직접 지정 (규칙 방향과 반대 · 사유: 현장 확인 결과 반대로 흐름')
  const log = page.getByTestId('release-log')
  await expect(log).toContainText('방향 적용: AT-101-02 → DUCT-01 · 현장 확인 결과 반대로 흐름')

  // 되돌리면 적용 전으로, 이력에서도 빠진다. 다시 하면 돌아온다.
  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('Control+z')
  await expect(terminal.locator('.rel')).toHaveText('하류(추정)')
  await expect(log).toHaveCount(0)
  await page.keyboard.press('Control+Shift+z')
  await expect(terminal.locator('.rel')).toHaveText('상류')

  // 수동 지정 해제. 규칙 방향으로 돌아가고 바뀐 것은 0건, 이력은 두 줄이다.
  await terminal.getByTestId('flow-clear').click()
  await expect(terminal.locator('.rel')).toHaveText('하류(추정)')
  await expect(bar).toContainText('바뀐 것 0건')
  await expect(log.locator('li')).toHaveCount(2)
  await expect(log.locator('li').first()).toContainText('수동 지정 해제: AT-101-02 → DUCT-01')
  expect(errors).toEqual([])
})
