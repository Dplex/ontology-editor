import { expect, test } from '@playwright/test'

// 엘리베이터·에스컬레이터는 수직 관통 오브젝트라 층 편집 화면에서는 고르고 보기만 한다(OE-EQP-07 · OE-ML-05). 끌어도 움직이지 않고,
// 지우기·좌표 칸이 없으며, [다중층 뷰에서 편집] 을 안내한다. 종류는 고칠 수 있다(이름 사전이 잘못 읽은 것을 풀 길).
const MEP = 'src/lib/ifc/fixtures/mep.ifc'
const AHU = '0MEP$Equip$AHU1$0000'

test('엘리베이터는 층 편집 화면에서 옮기거나 지우지 못하고 다중층 뷰를 안내하며, 종류를 바꾸면 다시 고칠 수 있다 [OE-EQP-07#1] [OE-ML-05#1~]', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(MEP)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '편집', exact: true }).click()
  const row = page.locator('.equipment tbody tr', { hasText: 'AHU-1' })
  await row.getByRole('button', { name: 'AHU-1', exact: true }).click()
  const kind = page.locator('.kind-edit select')
  await kind.selectOption('elevator')

  // 잠긴다: 안내와 다중층 뷰 자리(아직 없어 누를 수 없음), 좌표·지우기 칸이 없다. 종류 칸은 남는다.
  const lock = page.locator('.ceiling-lock')
  await expect(lock).toContainText('수직 관통 오브젝트라 층 편집 화면에서는 옮기거나 지우지 않습니다')
  await expect(lock.getByRole('button', { name: '다중층 뷰에서 편집' })).toBeDisabled()
  await expect(page.locator('.position-edit')).toHaveCount(0)
  await expect(page.locator('.danger-zone')).toHaveCount(0)
  await expect(kind).toHaveValue('elevator')

  // 3D 에서 끌어도 그대로다.
  const x = row.locator('.coord').first()
  const before = await x.inputValue()
  await page.locator('.viewport canvas').scrollIntoViewIfNeeded()
  const at = await page.evaluate((id) => (window as any).__viewer.part(id), AHU)
  await page.mouse.move(at.x, at.y)
  await page.mouse.down()
  await page.mouse.move(at.x + 80, at.y + 20, { steps: 6 })
  await page.mouse.up()
  await expect(x).toHaveValue(before)
  // Delete 도 막힌다.
  await page.keyboard.press('Delete')
  await expect(row).toHaveCount(1)

  // 종류를 공조기로 되돌리면 다시 고칠 수 있다.
  await kind.selectOption('ahu')
  await expect(lock).toHaveCount(0)
  await expect(page.locator('.position-edit')).toBeVisible()
  expect(errors).toEqual([])
})
