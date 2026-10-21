import { expect, test } from '@playwright/test'
import { enterEdit, pickSpace } from './edit-part'

// 방 종류 일괄 수정(OE-SPC-17). 같은 공간명의 방은 층이 달라도 한 번에 같은 종류가 되고, 되돌리기 한 번에 돌아온다.
// two-rooms.ifc 의 1F 복도(102)와 2F 창고(201)의 공간명을 성수처럼 약어 `S.T` 로 바꿔 두 층에 같은 이름을 만든다.
const FIXTURE = 'src/lib/ifc/fixtures/two-rooms.ifc'

test('같은 공간명의 방을 한 번에 같은 종류로 바꾸고, 리포트에 남으며, Ctrl+Z 한 번에 돌아온다 [OE-SPC-17#2]', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(FIXTURE)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  await enterEdit(page)

  // 물리존 표가 빠져서(#715) 방 번호로 층 현황에서 골라 선택 카드의 이름 · 종류 칸을 고친다. 201 은 2F 라 모든 층으로 넓혀 찾는다.
  // 고른 방이 선택 카드에 뜰 때까지 기다린다. 201 은 모든 층으로 넓힌 뒤 눌러서, 바로 치면 아직 102 카드의 칸에 들어간다(이미 S.T 라 아무것도 안 바뀐다).
  const pick = async (n: string) => {
    await pickSpace(page, n)
    await expect(page.getByTestId('space-number')).toHaveValue(n)
  }
  for (const n of ['102', '201']) {
    await pick(n)
    const name = page.locator('.space-name input')
    await name.fill('S.T')
    await name.press('Enter')
  }
  const select = page.getByTestId('space-kind')
  const kindOf = async (n: string) => {
    await pick(n)
    return select
  }
  // 이름 사전은 S.T 를 모른다. 201 은 OmniClass 코드로 창고다.
  await expect(await kindOf('102')).toHaveValue('__name')
  await expect(select.locator('option:checked')).toContainText('모름')
  await expect(await kindOf('201')).toHaveValue('__name')
  await expect(select.locator('option:checked')).toContainText('창고')
  await expect(page.getByTestId('space-kind-group')).toContainText('공간명이 같은 방 2개(모든 층)에 함께 적용됩니다')

  await (await kindOf('102')).selectOption({ label: '계단실' })
  await expect(select).toHaveValue('staircase')
  await expect(await kindOf('201')).toHaveValue('staircase')
  // 회의실은 이름이 달라 그대로다.
  await expect(await kindOf('101')).toHaveValue('__name')
  await expect(select.locator('option:checked')).toContainText('회의실')
  const report = page.locator('.report')
  await expect(report).toContainText('공간명 S.T 1개: 방 종류 모름 → 계단실')
  await expect(report).toContainText('공간명 S.T 1개: 방 종류 창고 → 계단실')

  // 되돌리기 한 번에 둘 다 돌아온다.
  await page.locator('.appbar h2').click()
  await page.keyboard.press('Control+z')
  await expect(await kindOf('102')).toHaveValue('__name')
  await expect(await kindOf('201')).toHaveValue('__name')

  // [이름으로 정하기] 는 사람이 정한 것을 거둔다.
  await page.locator('.appbar h2').click()
  await page.keyboard.press('Control+Shift+z')
  await expect(await kindOf('201')).toHaveValue('staircase')
  await select.selectOption({ index: 0 })
  await expect(select).toHaveValue('__name')
  await expect(select.locator('option:checked')).toContainText('창고')
  await expect(await kindOf('102')).toHaveValue('__name')
  expect(errors).toEqual([])
})
