import { expect, test, type Page } from '@playwright/test'

// 사람의 소속 지정(OE-MAP-01 · K17). 사무실(0..10 × 0..8) 밖에 더한 설비는 소속이 없어 패널에서 소속을 정할 수 있고, 외곽선 안의
// AHU-1 은 지정 칸이 막혀 까닭이 보인다. 지정한 설비 자리에 물리존을 그리면 "사람 지정 해제" 가 바뀐 내용에 보이고, Ctrl+Z 로
// 되돌리면 지정이 다시 쓰인다.
const MEP = 'src/lib/ifc/fixtures/mep.ifc'

async function clickFloor(page: Page, x: number, y: number) {
  const at = (await page.evaluate(([px, py]) => (window as any).__viewer.point([px, py, 0]), [x, y])) as { x: number; y: number }
  await page.mouse.click(at.x, at.y)
}

test('소속 없는 설비에 소속을 정하고, 외곽선 안 설비는 막히며, 자리에 물리존을 그리면 사람 지정 해제가 보인다', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(MEP)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '편집', exact: true }).click()
  await page.locator('.viewport canvas').scrollIntoViewIfNeeded()
  await page.waitForTimeout(200)

  await page.getByRole('button', { name: '설비 더하기' }).click()
  await clickFloor(page, 12, 4)
  const picked = page.locator('.picked')
  await expect(picked.locator('h3')).toHaveText('새 설비 1')
  await expect(picked.getByTestId('assign-space')).toBeEnabled()
  await picked.getByTestId('assign-space').selectOption({ label: '사무실' })
  await expect(picked).toContainText('사무실')
  await expect(page.locator('.report')).toContainText('설비 새 설비 1의 소속을 사무실(으)로 정했습니다')

  // 외곽선 안의 AHU-1 은 막힌다.
  await page.getByRole('button', { name: 'AHU-1', exact: true }).first().click()
  await expect(picked.locator('h3')).toHaveText('AHU-1')
  await expect(picked.getByTestId('assign-space')).toBeDisabled()
  await expect(picked.getByTestId('assign-blocked')).toContainText('외곽선 안')

  // 지정한 설비 자리에 물리존(로비)을 그린다.
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '물리존 그리기' }).click()
  for (const [x, y] of [[11, 3], [13, 3], [13, 5], [11, 5]]) await clickFloor(page, x, y)
  await page.keyboard.press('Enter')
  await expect(page.locator('.report')).toContainText('사람 지정 해제: 새 설비 1 사무실 → 새 물리존 1(외곽선 안)')

  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('Control+z')
  await expect(page.locator('.report')).toContainText('설비 새 설비 1의 소속을 사무실(으)로 정했습니다')
  await expect(page.locator('.report')).not.toContainText('사람 지정 해제')
  expect(errors).toEqual([])
})
