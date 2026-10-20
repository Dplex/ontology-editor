import { existsSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { countByLabel, enterEdit, openDrawer, pickEquipment } from './edit-part'

// 종류 지정(OE-EQP-14). 기본은 같은 패밀리 전부이고, [이 설비만] 을 켜면 고른 설비 한 대만 바뀐다. Duplex MEP(gitignore)의
// M_Pendant Light 패밀리는 8대다. 조명은 천장 설비라 천장 편집 모드에서 고친다(OE-OBJ-08).
const DUPLEX = 'data/NBU_Duplex/NBU_Duplex-Apt_Eng-MEP.ifc'

test('[이 설비만] 을 켜고 종류를 고르면 그 설비만 바뀌고 같은 패밀리의 다른 설비는 그대로다 [OE-EQP-14#3]', async ({ page }) => {
  test.skip(!existsSync(DUPLEX), `${DUPLEX} 이 없다(npm run fetch:sample)`)
  test.setTimeout(120_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(DUPLEX)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 90_000 })
  await enterEdit(page)
  // 예전 설비 표의 종류 칸 대신 화면 모델의 TTL 로 센다. 조명은 brick:Luminaire 이고 스프링클러 헤드는 아니다.
  const lights = () => countByLabel(page, /M_Pendant Light/, 'brick:Luminaire')
  const total = await lights()
  expect(total).toBeGreaterThan(1)
  // 고른 조명의 층으로 천장 편집 모드에 들어간 뒤(들어가면 선택이 풀린다) 다시 고른다
  await pickEquipment(page, 'M_Pendant Light', false)
  await page.locator('.appbar h2').click()
  await page.keyboard.press('t')
  await expect(page.getByRole('group', { name: '설비 편집 면' }).getByRole('button', { name: '천장' })).toHaveAttribute('aria-pressed', 'true')
  await pickEquipment(page, 'M_Pendant Light', false)

  const kind = page.locator('.picked .kind-edit')
  await expect(kind).toContainText(`${total}대에 함께 적용됩니다`)
  await kind.getByLabel('이 설비만').check()
  await expect(kind).toContainText('이 설비에만 적용됩니다')
  await kind.locator('select').selectOption({ label: '스프링클러 헤드' })

  await expect.poll(lights).toBe(total - 1)
  await page.locator('.picked').first().screenshot({ path: 'test-results/kind-single.png' })
  await openDrawer(page)
  await expect(page.locator('.report')).toContainText('(한 대만)')

  // 되돌리면 그 한 대만 돌아온다
  await page.locator('.appbar h2').click()
  await page.keyboard.press('Control+z')
  await expect.poll(lights).toBe(total)
  expect(errors).toEqual([])
})
