import { expect, test } from '@playwright/test'

// 방 종류 일괄 수정(OE-SPC-17). 같은 공간명의 방은 층이 달라도 한 번에 같은 종류가 되고, 되돌리기 한 번에 돌아온다.
// two-rooms.ifc 의 1F 복도(102)와 2F 창고(201)의 공간명을 성수처럼 약어 `S.T` 로 바꿔 두 층에 같은 이름을 만든다.
const FIXTURE = 'src/lib/ifc/fixtures/two-rooms.ifc'

test('같은 공간명의 방을 표에서 한 번에 같은 종류로 바꾸고, 리포트에 남으며, Ctrl+Z 한 번에 돌아온다 [OE-SPC-17#2]', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(FIXTURE)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '편집', exact: true }).click()

  for (const n of ['102', '201']) {
    const name = page.getByLabel(`${n} 이름`)
    await name.fill('S.T')
    await name.press('Enter')
  }
  const kind = (n: string) => page.getByLabel(`${n} 종류`)
  // 이름 사전은 S.T 를 모른다. 201 은 OmniClass 코드로 창고다.
  await expect(kind('102').locator('option:checked')).toHaveText('모름')
  await expect(kind('201').locator('option:checked')).toHaveText('창고')

  await kind('102').selectOption({ label: '계단실' })
  await expect(kind('102')).toHaveValue('staircase')
  await expect(kind('201')).toHaveValue('staircase')
  // 회의실은 이름이 달라 그대로다.
  await expect(kind('101').locator('option:checked')).toHaveText('회의실')
  const report = page.locator('.report')
  await expect(report).toContainText('공간명 S.T 1개: 방 종류 모름 → 계단실')
  await expect(report).toContainText('공간명 S.T 1개: 방 종류 창고 → 계단실')

  // 되돌리기 한 번에 둘 다 돌아온다.
  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('Control+z')
  await expect(kind('102').locator('option:checked')).toHaveText('모름')
  await expect(kind('201').locator('option:checked')).toHaveText('창고')

  // [이름으로 정하기] 는 사람이 정한 것을 거둔다.
  await page.keyboard.press('Control+Shift+z')
  await expect(kind('201')).toHaveValue('staircase')
  await kind('201').selectOption({ label: '이름으로 정하기' })
  await expect(kind('102').locator('option:checked')).toHaveText('모름')
  await expect(kind('201').locator('option:checked')).toHaveText('창고')
  expect(errors).toEqual([])
})
