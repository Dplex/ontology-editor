import { expect, test, type Page } from '@playwright/test'

// 외벽 편집(OE-OBJ-04)을 실제 마우스로 한다 — 외벽을 긋고, 문을 뚫고, 두께·높이·외벽 여부를 고치고, 설비를 바깥 면에 붙인다.
// mep.ifc 의 사무실은 0..10 × 0..8 이다. 그 동쪽 변 바로 바깥(x=10.1)에 벽을 그으면 동쪽이 건물 밖이라 외벽으로 계산된다.
// (남쪽 변은 카메라가 건물 전체를 잡을 때 왼쪽 도구 팔레트 밑에 깔린다 — AHU 가 (50,50)에 있어서다.)
// 바닥 자리는 e2e 모드에서만 열리는 window.__viewer.point 로 묻는다(viewer.ts).
const MEP = 'src/lib/ifc/fixtures/mep.ifc'

async function clickFloor(page: Page, x: number, y: number, z = 0) {
  const at = (await page.evaluate(([px, py, pz]) => (window as any).__viewer.point([px, py, pz]), [x, y, z])) as { x: number; y: number }
  await page.mouse.click(at.x, at.y)
}

const row = (page: Page, name: string) => page.locator('.equipment tbody tr', { hasText: name }).last()

test('외벽을 긋고 문을 뚫고 크기·외벽 여부를 고치며, 설비를 바깥 면에 붙이면 방 소속이 없어지고 Ctrl+Z 로 돌아온다', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(MEP)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '편집', exact: true }).click()
  await page.locator('.viewport canvas').scrollIntoViewIfNeeded()
  await page.waitForTimeout(200)

  // 외벽 긋기 — IsExternal 이 없으니 건물 바깥에 닿는지로 계산된다.
  await page.getByRole('button', { name: '벽·문·창' }).click()
  await page.getByRole('button', { name: '벽 긋기' }).click()
  await clickFloor(page, 10.1, 0.5)
  await clickFloor(page, 10.1, 7.5)
  const panel = page.locator('.element-picked')
  await expect(panel.locator('h3')).toHaveText('새 벽')
  await expect(panel.getByTestId('wall-external')).toHaveText('외벽')
  await expect(panel.getByTestId('wall-external-select')).toHaveValue('true')

  // 외벽에 문을 뚫는다.
  await page.getByRole('button', { name: '문 놓기' }).click()
  await clickFloor(page, 10.1, 6)
  await expect(panel.locator('h3')).toHaveText('새 문')
  await expect(panel).toContainText('외벽에 뚫림')

  // 벽을 다시 골라 두께·높이(크기 y·z)와 외벽 여부를 고친다. 세워 그린 벽(바닥 판 위 1.2m)의 윗면을 누른다.
  await clickFloor(page, 10.1, 2, 1.3)
  await expect(panel.locator('h3')).toHaveText('새 벽')
  const thickness = panel.getByTestId('wall-thickness')
  await thickness.fill('0.3')
  await thickness.press('Enter')
  await expect(panel.locator('.stats')).toContainText('두께 0.30m')
  const height = panel.getByTestId('wall-height')
  await expect(height).toHaveValue('')
  await height.fill('2.8')
  await height.press('Enter')
  // 편집 줄에 마지막 편집 이름이 뜬다(되돌리기 단위).
  await expect(page.getByText('새 벽 높이 2.80m')).toBeVisible()
  await panel.getByTestId('wall-external-select').selectOption('false')
  await expect(panel.getByTestId('wall-external')).toHaveText('내벽')
  await expect(panel.locator('.src.edit').first()).toBeVisible()
  await panel.getByTestId('wall-external-select').selectOption('true')
  await expect(panel.getByTestId('wall-external')).toHaveText('외벽')

  // 설비를 외벽 바깥 면에 붙인다. 벽·문·창 층을 끄고 표에서 AHU-1 을 고른다.
  await page.getByRole('button', { name: '벽·문·창' }).click()
  await row(page, 'AHU-1').getByRole('button', { name: 'AHU-1', exact: true }).click()
  await page.locator('.viewport canvas').scrollIntoViewIfNeeded()
  await page.waitForTimeout(200)
  const picked = page.locator('.picked').first()
  await picked.getByRole('button', { name: '벽에 붙이기' }).click()
  await clickFloor(page, 10.6, 3)
  await expect(page.locator('.key-note, .notice, .toast').first()).toContainText('새 벽에 붙였습니다')
  await expect(picked).toContainText('새 벽에 붙음')
  await expect(picked).toContainText('소속 방 없음')

  // 되돌리면 붙기 전으로 — 벽에서 떨어지고 원래 소속으로.
  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('Control+z')
  await expect(picked).not.toContainText('붙음')
  expect(errors).toEqual([])
})
