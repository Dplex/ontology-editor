import { expect, test } from '@playwright/test'

// 평면도 탭. 층 하나를 위에서 그리고, 편집 모드에서 방 꼭짓점을 끌면 3D 에서 놓는 것과 같은 길(dropVertex)로 경계를 고친다.
const FIXTURE = 'src/lib/ifc/fixtures/two-rooms.ifc'

test('평면도 탭은 고른 층을 위에서 그리고, 편집 모드에서 꼭짓점을 끌면 넓이가 바뀐다', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type=file]').first().setInputFiles(FIXTURE)
  await expect(page.getByRole('heading', { name: 'two-rooms.ifc' })).toBeVisible({ timeout: 30_000 })

  await page.getByRole('group', { name: '보기' }).getByRole('button', { name: '평면도' }).click()
  // 층을 고르기 전에는 그리지 않는다.
  await expect(page.locator('.plan-empty')).toBeVisible()
  await page.getByRole('combobox', { name: '보일 층' }).selectOption({ label: '1F만' })
  const plan = page.getByRole('img', { name: '1F 평면도' })
  await expect(plan).toBeVisible()
  const rooms = plan.locator('.spaces polygon')
  expect(await rooms.count()).toBeGreaterThan(0)

  // 보기 모드에서는 방을 골라도 손잡이가 없다.
  await rooms.first().click()
  await expect(plan.locator('.handle')).toHaveCount(0)

  await page.getByRole('button', { name: '편집', exact: true }).click()
  await expect(plan.locator('.handle').first()).toBeVisible()
  const handle = plan.locator('.handle').nth(1)
  // 가운데로 스크롤한다. 위쪽에 붙으면 편집 막대(sticky)가 손잡이를 덮는다.
  await handle.evaluate((el) => el.scrollIntoView({ block: 'center' }))
  const box = (await handle.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2, { steps: 5 })
  await page.mouse.up()

  // 넓이가 바뀐 것이 리포트에 남는다.
  await expect(page.locator('.report')).toContainText('㎡ →')

  // 탭을 바꿔도 고른 층은 그대로다.
  await page.getByRole('group', { name: '보기' }).getByRole('button', { name: '3D' }).click()
  await expect(page.getByRole('combobox', { name: '보일 층' })).not.toHaveValue('')
})
