import { existsSync } from 'node:fs'
import { expect, test } from '@playwright/test'

// OE-BIM-07 미배치 설비 놓기. 다른 층을 보고 있으면 그 설비의 층으로 바꾼 뒤 바닥을 누르게 한다 — 안 바꾸면 놓을 층의
// 바닥이 3D 에 없다. mep.ifc 는 층이 하나라 이 길을 안 지난다. ifc4Mep 는 좌표 없는 퓨즈가 두 층(00·01)에 있다.
const MEP = 'data/ifc4Mep_IFC4.ifc'

test('ifc4Mep: 모든 층을 보는 중에 01층 미배치 설비를 팔레트에서 누르면 01층으로 바뀐다', async ({ page }) => {
  test.skip(!existsSync(MEP), `${MEP} 이 없다(npm run fetch:sample)`)
  test.setTimeout(120_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(MEP)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 90_000 })
  const storeyBox = page.getByRole('combobox', { name: '보일 층' })
  // 놓기는 편집 팔레트의 미배치 목록에서 한다(OE-EQP-02). 한 층만 보면 그 층 것만 보여서, 모든 층을 보며 다른 층 것을 누른다.
  await page.getByRole('button', { name: '편집', exact: true }).click()
  await storeyBox.selectOption({ label: '모든 층' })
  await page.getByRole('button', { name: /미배치 \d+대/ }).click()
  const target = page.getByRole('list', { name: '미배치 설비' }).locator('button[title^="01. verdieping"]').first()
  await target.click()
  await expect(storeyBox.locator('option:checked')).toHaveText('01. verdieping만')
  await expect(target).toHaveAttribute('aria-pressed', 'true')
  expect(errors).toEqual([])
})
