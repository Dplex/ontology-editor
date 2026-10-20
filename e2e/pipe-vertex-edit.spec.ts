import { expect, test } from '@playwright/test'
import { coordOf, countByLabel, enterEdit, pickEquipment } from './edit-part'

// 배관 꼭짓점 넣기·지우기(OE-PIP-10). mep.ifc 에서 AHU-1(1,1,3.2) → 꺾임 (7,1,3.2) → AT-101-02(7,4,2.7) 로 SA 덕트를 그린 뒤, 구간에 꼭짓점을
// 넣고 옮겨 꺾고, 꺾임 엘보를 지워 두 구간을 합친다.
const MEP = 'src/lib/ifc/fixtures/mep.ifc'

test('구간 가운데에 꼭짓점을 넣어 옮겨 꺾고, 꺾임 엘보를 지워 두 구간을 합치며, 차례로 되돌린다 [OE-PIP-10#2]', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(MEP)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  await enterEdit(page)
  const pick = (name: string) => pickEquipment(page, name)
  await pick('AHU-1')
  const panel = page.getByTestId('pipe-draw')
  await panel.getByLabel('배관 끝 대상').selectOption({ label: 'AT-101-02 · 6.7m' })
  await panel.getByLabel('배관 Flow Type').selectOption('SA')
  await panel.getByRole('button', { name: '꺾임점 찍기' }).click()
  await page.locator('.canvas-wrap > canvas').scrollIntoViewIfNeeded()
  const at = await page.evaluate(() => (window as any).__viewer.point([7, 1, 3.2]))
  await page.mouse.click(at.x, at.y)
  await page.keyboard.press('Enter')
  await expect(page.locator('.key-note')).toContainText('SA 배관을 그렸습니다: 구간 2개 · 이음쇠 1개')
  // 그린 구간 · 이음쇠 수는 화면 모델(TTL)에서 센다(예전 설비 표의 줄 수).
  const rows = () => countByLabel(page, /^SA (덕트|이음) /)
  await expect.poll(rows).toBe(3)

  // 첫 구간(SA 덕트 1, (1,1) → (7,1))에 꼭짓점을 넣는다. 넣은 엘보가 골라지고 (4,1) 에 있다.
  await pick('SA 덕트 1')
  const vertex = page.getByTestId('pipe-vertex')
  await vertex.getByRole('button', { name: '가운데에 꼭짓점 넣기' }).click()
  await expect(page.locator('.key-note')).toContainText('가운데에 꼭짓점')
  await expect.poll(rows).toBe(5)
  const elbowName = (await page.locator('.picked h3').innerText()).trim()
  expect(elbowName).toMatch(/^SA 이음 \d+$/)
  await expect(coordOf(page, 0)).toHaveValue('4')
  // 넣은 꼭짓점을 옮겨 꺾는다(y 1 → 2). 양쪽 구간이 늘어나 따라온다.
  const y = coordOf(page, 1)
  await y.fill('2')
  await y.press('Enter')
  await expect(page.getByTestId('last-edit')).toContainText('옮김 (배관 2개 따라옴)')
  if (process.env.SHOT_VERTEX) {
    await page.locator('body').click({ position: { x: 5, y: 5 } })
    await pick(elbowName)
    await page.keyboard.press('f')
    await page.waitForTimeout(1500)
    await page.locator('.viewport').screenshot({ path: process.env.SHOT_VERTEX })
  }

  // 처음 그린 꺾임 엘보((7,1))를 지우면 양쪽 구간이 하나로 합쳐진다.
  await pick('SA 이음 2')
  await page.getByTestId('pipe-vertex').getByRole('button', { name: '꼭짓점 지우기' }).click()
  await expect(page.locator('.key-note')).toContainText('하나로 합쳤습니다')
  await expect.poll(rows).toBe(3)
  // 설비에 붙은 끝 구간은 꼭짓점을 넣을 수 있어도, 이음쇠가 없는 공조기에는 꼭짓점 단추가 없다.
  await pick('AHU-1')
  await expect(page.getByTestId('pipe-vertex')).toHaveCount(0)

  // 지우기 · 옮기기 · 넣기를 차례로 되돌리면 처음 그린 세 조각이다.
  await page.locator('.appbar h2').click()
  await page.keyboard.press('Control+z')
  await expect.poll(rows).toBe(5)
  await page.keyboard.press('Control+z')
  await page.keyboard.press('Control+z')
  await expect.poll(rows).toBe(3)
  expect(errors).toEqual([])
})
