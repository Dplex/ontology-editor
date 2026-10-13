import { expect, test, type Page } from '@playwright/test'
import { toEquipment, toSpace } from './edit-part'

// 치수 표시(OE-UI-08). mep.ifc 에는 벽이 없어 둘을 긋는다: x=10.1 과 x=13 의 세로 벽(길이 8m). 계산은 dimensions.test.ts 가 본다.
const MEP = 'src/lib/ifc/fixtures/mep.ifc'
async function clickFloor(page: Page, x: number, y: number) {
  const at = (await page.evaluate(([px, py]) => (window as any).__viewer.point([px, py, 0]), [x, y])) as { x: number; y: number }
  await page.mouse.click(at.x, at.y)
}

test('벽을 고르면 길이·두께·가까운 벽까지 거리가 3D 칩과 평면도 치수선으로 보이고, 길이를 바꾸거나 옮기면 함께 바뀐다 [OE-UI-08#1]', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(MEP)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '편집', exact: true }).click()
  await page.locator('.canvas-wrap > canvas').scrollIntoViewIfNeeded()
  await toSpace(page)
  await page.getByRole('button', { name: '벽·문·창' }).click()
  for (const x of [10.1, 13]) {
    await page.getByRole('button', { name: '벽 긋기' }).click()
    await clickFloor(page, x, 0)
    await clickFloor(page, x, 8)
  }
  const chip = page.getByTestId('dim-chip')
  await expect(chip).toContainText('길이 8.00m')
  await expect(chip).toContainText(/가까운 벽\(.+\)까지 2\.\d\dm/)
  if (process.env.SHOT) {
    await page.locator('.appbar h2').click()
    await page.keyboard.press('Home')
    await page.waitForTimeout(500)
    await page.locator('.viewport').screenshot({ path: process.env.SHOT })
  }
  // 길이를 바꾸면 치수가 함께 바뀐다. 건물 밖에 그은 벽이라 외벽으로 잠겨 있어 내벽으로 바꾼 뒤 고친다.
  await page.getByRole('combobox', { name: '외벽' }).selectOption({ label: '내벽' })
  const length = page.locator('.element-picked').getByTestId('wall-length')
  await length.fill('6')
  await length.press('Enter')
  await expect(chip).toContainText('길이 6.00m')
  // 옮기면(벽은 방향키로 옮긴다) 가까운 벽까지 거리가 함께 바뀐다. 방향키는 화면 기준이라 한쪽은 벽 방향일 수 있어 ←·↑ 둘 다 누른다.
  const gap = async () => Number((await chip.textContent())!.match(/까지 ([\d.]+)m/)![1])
  const before = await gap()
  await page.locator('.appbar h2').click()
  await page.keyboard.press('ArrowLeft')
  await page.keyboard.press('ArrowUp')
  await expect.poll(gap).not.toBe(before)
  // 평면도에도 치수선.
  await page.getByRole('group', { name: '보기' }).getByRole('button', { name: '평면도' }).click()
  await expect(page.getByTestId('plan-dims')).toContainText('6.00m')
  if (process.env.SHOT_PLAN) {
    await page.waitForTimeout(500)
    await page.locator('svg.floor-plan').screenshot({ path: process.env.SHOT_PLAN })
  }
  expect(errors).toEqual([])
})
