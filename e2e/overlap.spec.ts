import { expect, test, type Page } from '@playwright/test'

// OE-OBJ-10 · OE-OBJ-16. 배관 없는 설비(조명·센서)는 서로 겹쳐 놓지 못한다. 막히면 이유를 띄우고 그 자리에 두지 않는다.
// mep.ifc 의 온도센서(TEMP-101-01)는 좌표가 없다(일부러 비웠다). 조명(LIGHT-101-01) 자리에 놓으려 한다.
const MEP = 'src/lib/ifc/fixtures/mep.ifc'

async function open(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('input[type=file]').first().setInputFiles(MEP)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '편집', exact: true }).click()
  return errors
}

const row = (page: Page, name: string) => page.locator('.equipment tbody tr', { hasText: name })

test('배관 없는 설비를 다른 배관 없는 설비 자리에 놓으면 막히고, 비켜 놓으면 된다', async ({ page }) => {
  const errors = await open(page)
  const light = await Promise.all([0, 1, 2].map((i) => row(page, 'LIGHT-101-01').locator('.coord').nth(i).inputValue()))
  const sensor = row(page, 'TEMP-101-01').locator('.coord')
  for (const i of [0, 1, 2]) {
    await sensor.nth(i).fill(light[i])
    await sensor.nth(i).press('Enter')
  }
  await expect(page.locator('.edit-notice')).toContainText('이미 오브젝트가 있는 위치입니다')
  await expect(page.locator('.edit-bar')).toContainText('바뀐 것 0건')

  // 1m 비켜 놓으면 놓인다. 좌표가 없던 설비라 세 칸을 다 넣어야 놓인다.
  const aside = [String(Number(light[0]) + 1), light[1], light[2]]
  for (const i of [0, 1, 2]) {
    await sensor.nth(i).fill(aside[i])
    await sensor.nth(i).press('Enter')
  }
  await expect(page.locator('.edit-bar')).toContainText('바뀐 것 1건')
  // 놓인 센서를 방향키처럼 조명 쪽으로 다시 옮기면 막힌다.
  await sensor.nth(0).fill(light[0])
  await sensor.nth(0).press('Enter')
  await expect(page.locator('.edit-notice')).toContainText('이미 오브젝트가 있는 위치입니다')
  await expect(sensor.nth(0)).not.toHaveValue(light[0])
  expect(errors).toEqual([])
})
