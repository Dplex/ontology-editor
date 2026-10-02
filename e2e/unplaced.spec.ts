import { existsSync } from 'node:fs'
import { expect, test } from '@playwright/test'

// OE-BIM-07 미배치 목록의 [3D에서 놓기]. 다른 층만 보고 있으면 그 설비의 층으로 바꾼 뒤 바닥을 누르게 한다 — 안 바꾸면 놓을 층의
// 바닥이 3D 에 없다. mep.ifc 는 층이 하나라 이 길을 안 지난다. ifc4Mep 는 좌표 없는 퓨즈가 두 층(00·01)에 있다.
const MEP = 'data/ifc4Mep_IFC4.ifc'

test('ifc4Mep: 00층만 보는 중에 01층 미배치 설비의 [3D에서 놓기] 를 누르면 01층으로 바뀐다', async ({ page }) => {
  test.skip(!existsSync(MEP), `${MEP} 이 없다(npm run fetch:sample)`)
  test.setTimeout(120_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(MEP)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 90_000 })
  const storeyBox = page.getByRole('combobox', { name: '보일 층' })
  const item = page.locator('.unplaced li', { hasText: '01. verdieping' }).first()
  // 01층만 보며 그 설비를 고른 뒤 사람이 00층으로 바꿨다 — 고른 것은 그대로라 "고른 것을 따라가는" 층 바꾸기가 다시 일어나지 않는다.
  await storeyBox.selectOption({ label: '01. verdieping만' })
  await item.getByRole('button').first().click()
  await expect(storeyBox.locator('option:checked')).toHaveText('01. verdieping만')
  await storeyBox.selectOption({ label: '00. Begane grond만' })
  await item.getByRole('button', { name: '3D에서 놓기' }).click()
  await expect(storeyBox.locator('option:checked')).toHaveText('01. verdieping만')
  await expect(item.getByRole('button', { name: '놓기 취소' })).toBeVisible()
  expect(errors).toEqual([])
})
