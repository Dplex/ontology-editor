import { expect, test, type Page } from '@playwright/test'

// 커스텀존(OE-OBJ-01)을 실제 마우스로 그리고, 이름을 고치고, 나누고, 합치고, 지우며 되돌린다. mep.ifc 의 사무실은 0..10 × 0..8 이고
// 디퓨저 둘(AT-101-01 (3,4), AT-101-02 (7,4))과 공조기 AHU-1(1,1)이 그 안에 있다. 조명이 (50,50)에 있어 처음 시점에는 사무실이 작으니, 사무실을 눌러
// 고르고 F 로 시점을 맞춘 뒤 그린다. 바닥 자리는 e2e 모드의 window.__viewer.point 로 묻는다.
const MEP = 'src/lib/ifc/fixtures/mep.ifc'

async function clickFloor(page: Page, x: number, y: number) {
  const at = (await page.evaluate(([px, py]) => (window as any).__viewer.point([px, py, 0]), [x, y])) as { x: number; y: number }
  await page.mouse.click(at.x, at.y)
}

test('커스텀존을 그리면 품는 방·든 설비가 계산되고, 이름·나누기·합치기·지우기가 되돌리기에 쌓이며 리포트에 오른다', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(MEP)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '편집', exact: true }).click()
  await page.locator('.viewport canvas').scrollIntoViewIfNeeded()
  await page.waitForTimeout(200)
  await clickFloor(page, 6, 4)
  await expect(page.locator('.space-picked h3')).toHaveText('사무실')
  await page.keyboard.press('f')
  await page.waitForTimeout(800)
  await page.keyboard.press('Escape')

  // 사무실 대부분(1.5..9.5 × 0.5..7.5)을 덮는 존 — 사무실 바닥의 절반을 넘게 덮어 사무실을 품고, 디퓨저 둘이 안에 든다(AHU-1 은 밖).
  await page.getByRole('button', { name: '커스텀존 그리기' }).click()
  for (const [x, y] of [[1.5, 0.5], [9.5, 0.5], [9.5, 7.5], [1.5, 7.5]]) await clickFloor(page, x, y)
  await page.keyboard.press('Enter')
  const panel = page.locator('.custom-zone-picked')
  await expect(panel.locator('h3')).toHaveText('커스텀존 1')
  await expect(panel.getByTestId('zone-spaces')).toContainText('사무실')
  await expect(panel.getByTestId('zone-equipment')).toContainText('2대')

  // 이름(별명).
  const name = panel.getByTestId('zone-name')
  await name.fill('개발팀')
  await name.press('Enter')
  await expect(panel.locator('h3')).toHaveText('개발팀')

  // x=5 로 나누면 넓은 쪽(1.5..5 가 3.5m, 5..9.5 가 4.5m)이 이름을 이어받고 좁은 쪽이 "개발팀 2" 다. 디퓨저가 하나씩 든다.
  await panel.getByRole('button', { name: '나누기' }).click()
  await clickFloor(page, 5, -1)
  await clickFloor(page, 5, 9)
  await expect(panel.locator('h3')).toHaveText('개발팀')
  await expect(panel.getByTestId('zone-equipment')).toContainText('1대')
  await expect(page.locator('.edit-bar')).toContainText('바뀐 것 2건')

  // 다시 합친다.
  const zones = await panel.locator('select[aria-label="합칠 커스텀존"] option').allTextContents()
  expect(zones).toContain('개발팀 2')
  await panel.locator('select[aria-label="합칠 커스텀존"]').selectOption({ label: '개발팀 2' })
  await expect(panel.getByTestId('zone-equipment')).toContainText('2대')

  // 지우고 Ctrl+Z 로 되돌린다.
  await panel.getByRole('button', { name: '커스텀존 지우기' }).click()
  await expect(panel).toHaveCount(0)
  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('Control+z')
  await expect(page.locator('.overview')).toContainText('커스텀존 1')
  await page.locator('.overview').getByRole('button', { name: '개발팀' }).click()
  await expect(panel.locator('h3')).toHaveText('개발팀')
  expect(errors).toEqual([])
})
