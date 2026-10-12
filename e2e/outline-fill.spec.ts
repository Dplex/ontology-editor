import { existsSync } from 'node:fs'
import { expect, test } from '@playwright/test'

// 외곽선 없는 물리존 채우기(OE-MAN-03). Duplex 건축은 Hallway 둘의 바닥 다각형이 없다(MEP 와 합치면 빌려온다). 검토 화면의 목록에서
// 하나를 누르면 그 층 3D 에서 점을 찍어 외곽선을 그리고, 같은 물리존에 외곽선이 생겨 목록에서 빠진다. 경고는 막지 않는다.
const ARCH = 'data/NBU_Duplex/NBU_Duplex-Apt_Arch.ifc'

test('검토 화면의 "외곽선 없는 물리존" 에서 골라 그리면 같은 물리존에 외곽선이 생기고 목록에서 빠지며, Ctrl+Z 로 돌아온다 [OE-MAN-03#1]', async ({ page }) => {
  test.skip(!existsSync(ARCH), `${ARCH} 이 없다(npm run fetch:sample)`)
  test.setTimeout(120_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(ARCH)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 90_000 })

  const list = page.getByTestId('outlineless')
  await expect(list).toContainText('2개')
  await expect(list.locator('li').first()).toContainText('BIM 면적 7.8㎡')
  const spaces = async () => Number((await page.locator('.fold-head', { hasText: '물리존 이름·경계' }).innerText()).match(/(\d+)개/)?.[1])
  await list.getByRole('button', { name: 'Hallway' }).first().click()
  await expect(page.getByRole('button', { name: '편집', exact: true })).toHaveAttribute('aria-pressed', 'true')
  const before = await spaces()

  // 층 바닥에 2 × 2 사각형을 찍고 Enter 로 닫는다.
  await page.locator('.viewport canvas').scrollIntoViewIfNeeded()
  const z = await page.evaluate(() => (window as any).__viewer.placeHeight?.() ?? 0)
  for (const [x, y] of [[0, 0], [2, 0], [2, 2], [0, 2]]) {
    const at = await page.evaluate(([px, py, pz]) => (window as any).__viewer.point([px, py, pz]), [x, y, z])
    await page.mouse.click(at.x, at.y)
  }
  await page.keyboard.press('Enter')
  await expect(list).toContainText('1개')
  expect(await spaces()).toBe(before)
  // BIM 면적 7.8㎡ 와 그린 4㎡ 가 달라 경고한다(막지 않는다).
  await expect(page.locator('.edit-notice')).toContainText('BIM 면적 7.8㎡')

  await page.locator('.edit-bar').click({ position: { x: 2, y: 2 } })
  await page.keyboard.press('Control+z')
  await expect(list).toContainText('2개')
  expect(errors).toEqual([])
})
