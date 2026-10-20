import { existsSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { pickEquipment, enterEdit, toEquipment } from './edit-part'

// 사람이 더한 설비의 3D 모양(ADR-0059). [같은 모양으로 더하기] 는 원본 형상을, [설비 더하기] 뒤 종류를 정하면 같은 종류 BIM 설비의 형상을
// 빌린다. 형상 크기는 __viewer.size(형상 상자, 형상 없는 설비는 0.4m 상자)로 견준다.
// Duplex 1층 라디에이터 536919(0.42,-14.79,0.02). 놓을 자리는 같은 방의 빈 바닥이다.
const DUPLEX = 'data/NBU_Duplex/NBU_Duplex-Apt_Eng-MEP.ifc'
const RADIATOR = 'M_Radiator - Hosted:Readiator - 25:Readiator - 25:536919'
const viewer = <T,>(page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(([f, a]) => (window as any).__viewer[f as string](...(a as unknown[])), [fn, args] as const) as Promise<T>
const ids = (page: Page) => viewer<Record<string, number[]>>(page, 'centers').then((c) => Object.keys(c))
async function clickFloor(page: Page, x: number, y: number, z = 0) {
  const at = await viewer<{ x: number; y: number }>(page, 'point', [x, y, z])
  await page.mouse.click(at.x, at.y)
}

test('Duplex: 라디에이터를 [같은 모양으로 더하기] 하면 원본 형상으로 놓이고, [설비 더하기] 한 설비는 종류를 정하면 같은 종류의 형상을 따르며, 되돌리면 상자로 돌아온다', async ({ page }) => {
  test.skip(!existsSync(DUPLEX), `${DUPLEX} 이 없다(npm run fetch:sample)`)
  test.setTimeout(180_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(DUPLEX)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 90_000 })
  await page.getByRole('combobox', { name: '보일 층' }).selectOption({ label: 'Level 1' })
  await enterEdit(page)
  await toEquipment(page)

  await page.locator('input[type=search]').fill('536919')
  await pickEquipment(page, RADIATOR)
  // 라디에이터는 사전에 종류가 없다. 이 한 대에만 종류를 정해 둔다 — 사람이 정한 종류도 같은 종류로 친다.
  await expect(page.locator('.kind-edit select')).toHaveValue('')
  const kind = 'heat_pump'
  await page.locator('.kind-edit').getByLabel('이 설비만').check()
  await page.locator('.kind-edit select').selectOption(kind)
  const before = new Set(await ids(page))
  const centers = await viewer<Record<string, number[]>>(page, 'centers')
  // 원본: 라디에이터 자리 2m 안 1층 바닥 가까이에서 형상이 가장 큰 것(둘레의 이음쇠·배관보다 크다).
  const near = Object.keys(centers).filter((id) => Math.hypot(centers[id][0] - 420, centers[id][1] + 14790) < 2000 && centers[id][2] < 1000)
  const sizes = await Promise.all(near.map((id) => viewer<number[]>(page, 'size', id)))
  const srcSize = sizes.reduce((a, b) => (b[0] * b[1] * b[2] > a[0] * a[1] * a[2] ? b : a))
  expect(srcSize).not.toEqual([0.4, 0.4, 0.4])

  // 복제: 원본과 같은 크기의 형상이 새 자리에 선다.
  await page.getByTestId('duplicate').click()
  await clickFloor(page, 0.42, -12.6)
  await expect(page.locator('.picked h3').first()).toContainText('복제')
  const copyId = (await ids(page)).find((id) => !before.has(id))!
  expect(copyId).toBeTruthy()
  expect(await viewer<number[]>(page, 'size', copyId)).toEqual(srcSize)
  await expect(page.getByTestId('borrowed-shape')).toContainText('복제한 원본')
  await expect(page.locator('.kind-edit select')).toHaveValue(kind)

  // Ctrl+D 로 한 번 더 — 단축키도 같은 길이다. Esc 로 취소하면 아무것도 안 생긴다.
  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await page.locator('input[type=search]').fill('536919')
  await pickEquipment(page, RADIATOR)
  await page.locator('body').press('Control+d')
  await expect(page.getByText(/같은 모양의 설비를 놓을 자리를 3D에서 클릭하세요/).first()).toBeVisible()
  await page.keyboard.press('Escape')
  expect((await ids(page)).length).toBe(before.size + 1)

  // [설비 더하기]: 종류를 정하기 전에는 상자, 라디에이터와 같은 종류로 정하면 라디에이터 형상, 되돌리면 상자.
  await page.locator('.tool-palette').getByRole('button', { name: '설비 더하기' }).click()
  await clickFloor(page, 2.0, -12.6)
  const newId = (await ids(page)).find((id) => !before.has(id) && id !== copyId)!
  expect(await viewer<number[]>(page, 'size', newId)).toEqual([0.4, 0.4, 0.4])
  await expect(page.getByTestId('borrowed-shape')).toContainText('종류를 정하면')
  await page.locator('.kind-edit select').selectOption(kind)
  await expect.poll(() => viewer<number[]>(page, 'size', newId)).toEqual(srcSize)
  await expect(page.getByTestId('borrowed-shape')).toContainText('같은 종류의 BIM 설비')
  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('Control+z')
  await expect.poll(() => viewer<number[]>(page, 'size', newId)).toEqual([0.4, 0.4, 0.4])
  await page.keyboard.press('Control+Shift+z')
  await expect.poll(() => viewer<number[]>(page, 'size', newId)).toEqual(srcSize)
  await page.screenshot({ path: test.info().outputPath('shapes.png') })
  expect(errors).toEqual([])
})
