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

  // 보기 모드에서는 방을 골라도 손잡이가 없다. 대신 오른쪽 패널에 그 방이 뜬다(고치는 칸과 안내는 없다).
  await rooms.first().click()
  await expect(plan.locator('.handle')).toHaveCount(0)
  await expect(page.locator('.space-picked')).toBeVisible()
  await expect(page.locator('.space-picked .hint')).toHaveCount(0)

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

test('평면도를 보는 동안 한 편집이 바로 그려지고, 층을 옮긴 설비를 따라 층이 바뀐다', async ({ page }) => {
  // 편집은 모델을 그 자리에서 고친다. 같은 층 객체를 넘기면 평면도가 다시 그리지 않아, 방향키로 옮긴 설비의 점이
  // 예전 자리에 남았고(성수에서 찾았다), PageUp 으로 위층에 옮긴 설비는 화면에서 사라졌다.
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(['src/lib/ifc/fixtures/mep.ifc', FIXTURE])
  await expect(page.locator('.appbar h2')).toHaveText('two-rooms.ifc + mep.ifc', { timeout: 30_000 })
  await page.getByRole('button', { name: '편집', exact: true }).click()
  await page.locator('.equipment tbody tr', { hasText: 'AHU-1' }).getByRole('button', { name: 'AHU-1', exact: true }).click()
  await page.getByRole('combobox', { name: '보일 층' }).selectOption({ label: '1F만' })
  await page.getByRole('group', { name: '보기' }).getByRole('button', { name: '평면도' }).click()
  const dot = page.locator('svg.floor-plan circle.chosen')
  const cx = async () => Number(await dot.getAttribute('cx'))
  const cy = async () => Number(await dot.getAttribute('cy'))
  const [x0, y0] = [await cx(), await cy()]
  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('Shift+ArrowRight')
  await expect.poll(async () => Math.hypot((await cx()) - x0, (await cy()) - y0)).toBeCloseTo(1, 1)

  await page.keyboard.press('PageUp')
  await expect(page.getByRole('combobox', { name: '보일 층' }).locator('option:checked')).toHaveText('2F만')
  await expect(page.getByRole('img', { name: '2F 평면도' }).locator('circle.chosen')).toHaveCount(1)
})

test('설비를 고른 채 평면도의 방을 누르면 패널이 그 방으로 바뀐다', async ({ page }) => {
  // 평면도가 고른 방을 제 안에만 들고 있어서, 방에 테두리만 뜨고 패널은 앞서 고른 설비 그대로였다(성수에서 찾았다).
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(['src/lib/ifc/fixtures/mep.ifc', FIXTURE])
  await expect(page.locator('.appbar h2')).toHaveText('two-rooms.ifc + mep.ifc', { timeout: 30_000 })
  await page.locator('.equipment tbody tr', { hasText: 'AHU-1' }).getByRole('button', { name: 'AHU-1', exact: true }).click()
  await expect(page.locator('.picked h3')).toHaveText('AHU-1')
  await page.getByRole('combobox', { name: '보일 층' }).selectOption({ label: '1F만' })
  await page.getByRole('group', { name: '보기' }).getByRole('button', { name: '평면도' }).click()
  const room = page.getByRole('img', { name: '1F 평면도' }).locator('.spaces polygon').first()
  await room.click({ force: true })
  await expect(page.locator('.space-picked')).toBeVisible()
  await expect(page.locator('svg.floor-plan circle.chosen')).toHaveCount(0)
  // 3D 로 돌아가도 같은 방이 골라져 있다.
  await page.getByRole('group', { name: '보기' }).getByRole('button', { name: '3D' }).click()
  await expect(page.locator('.space-picked')).toBeVisible()
})
