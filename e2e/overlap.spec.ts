import { expect, test, type Page } from '@playwright/test'
import { coordOf, enterEdit, panClear, pickEquipment } from './edit-part'

// OE-OBJ-10 · OE-OBJ-16. 배관 없는 설비(조명·센서)는 서로 겹쳐 놓지 못한다. 막히면 이유를 띄우고 그 자리에 두지 않는다.
// 새 설비를 조명(LIGHT-101-01) 자리에 놓으려 한다.
const MEP = 'src/lib/ifc/fixtures/mep.ifc'

async function open(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('input[type=file]').first().setInputFiles(MEP)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  await enterEdit(page)
  return errors
}

test('배관 없는 설비를 다른 배관 없는 설비 자리에 놓으면 막히고, 비켜 놓으면 된다', async ({ page }) => {
  // 예전에는 좌표 없는 센서(TEMP-101-01)의 좌표 칸에 조명 좌표를 넣었다. 미배치 설비의 위치 칸은 3D 아래 표와 같이 빠져서(#715),
  // 새 설비(종류 미정 = 배관 없는 설비)를 빈 곳에 더한 뒤 위치 칸으로 조명 자리에 옮긴다.
  const errors = await open(page)
  // 조명은 천장 설비라 위치 칸이 천장 편집 모드(T)에서 열린다. 읽고 바닥·벽 모드로 돌아온다.
  const ceiling = page.getByRole('group', { name: '설비 편집 면' }).getByRole('button', { name: '천장' })
  await page.locator('.appbar h2').click()
  await page.keyboard.press('t')
  await expect(ceiling).toHaveAttribute('aria-pressed', 'true')
  await pickEquipment(page, 'LIGHT-101-01')
  const light = await Promise.all([0, 1, 2].map((i) => coordOf(page, i).inputValue()))
  await page.locator('.appbar h2').click()
  await page.keyboard.press('t')
  await expect(ceiling).toHaveAttribute('aria-pressed', 'false')
  await panClear(page)
  await page.getByRole('button', { name: '설비 더하기' }).click()
  const spot = (await page.evaluate(() => (window as any).__viewer.point([8.5, 6.5, 0]))) as { x: number; y: number }
  await page.mouse.click(spot.x, spot.y)
  await expect(page.locator('.picked h3').first()).toHaveText('새 설비 1')
  const changes = page.getByTestId('changes-link')
  const count = async () => Number(/바뀐 것 (\d+)건/.exec(await changes.innerText())?.[1])
  const added = await count()
  const sensor = page.locator('.position-edit .coord')
  for (const i of [0, 1, 2]) {
    await sensor.nth(i).fill(light[i])
    await sensor.nth(i).press('Enter')
  }
  await expect(page.locator('.edit-notice')).toContainText('이미 오브젝트가 있는 위치입니다')
  expect(await count()).toBe(added)

  // 1m 비켜 놓으면 놓인다.
  const aside = [String(Number(light[0]) + 1), light[1], light[2]]
  for (const i of [0, 1, 2]) {
    await sensor.nth(i).fill(aside[i])
    await sensor.nth(i).press('Enter')
  }
  await expect(sensor.nth(0)).toHaveValue(aside[0])
  // 놓인 설비를 조명 쪽으로 다시 옮기면 막힌다.
  await sensor.nth(0).fill(light[0])
  await sensor.nth(0).press('Enter')
  await expect(page.locator('.edit-notice')).toContainText('이미 오브젝트가 있는 위치입니다')
  await expect(sensor.nth(0)).not.toHaveValue(light[0])
  expect(errors).toEqual([])
})

test('새 설비를 다른 새 설비 자리에 더하면 막히고, 비켜 더하면 된다 (OE-OBJ-16 추가)', async ({ page }) => {
  const errors = await open(page)
  await page.locator('.canvas-wrap > canvas').scrollIntoViewIfNeeded()
  const clickFloor = async (x: number, y: number) => {
    const at = (await page.evaluate(([px, py]) => (window as any).__viewer.point([px, py, 0]), [x, y])) as { x: number; y: number }
    await page.mouse.click(at.x, at.y)
  }
  // 종류를 정하기 전의 새 설비는 배관 없는 설비로 본다(lib/overlap.ts standalone)
  await page.getByRole('button', { name: '설비 더하기' }).click()
  await clickFloor(3, 3)
  await expect(page.getByTestId('changes-link')).toContainText('바뀐 것 1건')
  await page.getByRole('button', { name: '설비 더하기' }).click()
  await clickFloor(3.1, 3)
  await expect(page.locator('.edit-notice')).toContainText('이미 오브젝트가 있는 위치입니다')
  await expect(page.getByTestId('changes-link')).toContainText('바뀐 것 1건')
  await page.getByRole('button', { name: '설비 더하기' }).click()
  await clickFloor(4.5, 3)
  await expect(page.getByTestId('changes-link')).toContainText('바뀐 것 2건')
  expect(errors).toEqual([])
})
