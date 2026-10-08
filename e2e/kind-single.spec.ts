import { existsSync } from 'node:fs'
import { expect, test } from '@playwright/test'

// 종류 지정(OE-EQP-14). 기본은 같은 패밀리 전부이고, [이 설비만] 을 켜면 고른 설비 한 대만 바뀐다. Duplex MEP(gitignore)의
// M_Pendant Light 패밀리는 8대다. 조명은 천장 설비라 천장 편집 모드에서 고친다(OE-OBJ-08).
const DUPLEX = 'data/NBU_Duplex/NBU_Duplex-Apt_Eng-MEP.ifc'

test('[이 설비만] 을 켜고 종류를 고르면 그 설비만 바뀌고 같은 패밀리의 다른 설비는 그대로다', async ({ page }) => {
  test.skip(!existsSync(DUPLEX), `${DUPLEX} 이 없다(npm run fetch:sample)`)
  test.setTimeout(120_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(DUPLEX)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 90_000 })
  await page.getByRole('button', { name: '편집', exact: true }).click()
  const list = page.getByRole('button', { name: /설비 위치와 소속/ })
  if ((await list.getAttribute('aria-expanded')) === 'false') await list.click()
  await page.getByRole('textbox', { name: /물리존·설비 이름/ }).or(page.locator('.edit-filter input[type=search]')).first().fill('M_Pendant Light')
  const lights = page.locator('.equipment tbody tr').filter({ hasText: 'M_Pendant Light' })
  await expect(lights.first()).toBeVisible()
  const total = await lights.count()
  expect(total).toBeGreaterThan(1)
  // 고른 조명의 층으로 천장 편집 모드에 들어간 뒤(들어가면 선택이 풀린다) 다시 고른다
  await lights.first().getByRole('button').first().click()
  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('t')
  await expect(page.getByRole('group', { name: '설비 편집 면' }).getByRole('button', { name: '천장' })).toHaveAttribute('aria-pressed', 'true')
  await lights.first().getByRole('button').first().click()

  const kind = page.locator('.picked .kind-edit')
  await expect(kind).toContainText(`${total}대에 함께 적용됩니다`)
  await kind.getByLabel('이 설비만').check()
  await expect(kind).toContainText('이 설비에만 적용됩니다')
  await kind.locator('select').selectOption({ label: '스프링클러 헤드' })

  await expect(lights.filter({ hasText: '스프링클러 헤드' })).toHaveCount(1)
  await expect(lights.filter({ hasText: '조명' })).toHaveCount(total - 1)
  await expect(page.locator('.report')).toContainText('(한 대만)')
  await page.locator('.picked').first().screenshot({ path: 'test-results/kind-single.png' })

  // 되돌리면 그 한 대만 돌아온다
  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('Control+z')
  await expect(lights.filter({ hasText: '조명' })).toHaveCount(total)
  expect(errors).toEqual([])
})
