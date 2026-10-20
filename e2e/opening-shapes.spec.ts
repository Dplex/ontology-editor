import { existsSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { toSpace, enterEdit } from './edit-part'

// 문·창의 모양(OE-OBJ-07). 3D 는 벽에 문·창 자리를 뚫고(opening-cut.ts) 문틀·문짝·유리를 세우며, 평면도는 벽을 비운 칸과 문짝·유리 선의
// 도면 기호로 그린다. Duplex 건축(gitignore): 문 14 · 창 24, Level 1 에 문 6 · 창 4 · 지붕에 천창 2.
const DUPLEX = 'data/NBU_Duplex/NBU_Duplex-Apt_Arch.ifc'

test('Duplex 건축: 평면도에 그 층 문·창이 도면 기호로 다 그려지고, 누르면 그 문·창이 골라진다 (OE-OBJ-07)', async ({ page }) => {
  test.skip(!existsSync(DUPLEX), `${DUPLEX} 이 없다(npm run fetch:sample)`)
  test.setTimeout(120_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.evaluate(() => localStorage.setItem('oe-read-openings', '1'))
  await page.reload()
  await page.locator('.drop input[type=file]').setInputFiles(DUPLEX)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 90_000 })
  await enterEdit(page)
  await toSpace(page)
  await page.getByRole('button', { name: '벽·문·창' }).click()
  await page.locator('.viewport').getByRole('button', { name: '평면도', exact: true }).click()

  const plan = page.locator('svg.floor-plan')
  await expect(plan.locator('[data-opening].door')).toHaveCount(6)
  await expect(plan.locator('[data-opening].window')).toHaveCount(4)
  // 문·창 칸이 벽 두께를 다 덮는다 — 벽 외곽선에서 잰 폭이라 문 형상 두께(0.18~0.48m)와 상관없다.
  const sizes = await plan.locator('[data-opening] .gap').evaluateAll((els) => els.map((e) => (e as SVGGraphicsElement).getBBox()).map((b) => Math.min(b.width, b.height)))
  for (const s of sizes) expect(s).toBeGreaterThan(0.05)

  const window = plan.locator('[data-opening].window').first()
  const id = await window.getAttribute('data-opening')
  await window.click()
  await expect(page.locator('.element-picked h3')).toContainText('M_Fixed')
  await expect(plan.locator(`[data-opening="${id}"]`)).toHaveClass(/chosen/)
  expect(errors).toEqual([])
})
