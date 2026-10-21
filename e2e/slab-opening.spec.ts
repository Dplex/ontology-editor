import { existsSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { enterEdit, toSpace } from './edit-part'

// 슬래브 개구부(OE-ML-03, slab-opening.ts). 계단 패널에 지나는 층 바닥마다 판정과 까닭이 보인다.
// Duplex 건축: Level 2 바닥 슬래브가 계단 자리를 외곽선으로 비워 두었다 → "이미 비어 있음". 계단을 슬래브가 덮는 자리로 옮기면 그 자리를
// 다시 재 "개구부 확정" 이 되고, 되돌리면 돌아온다. 병원 건축은 바닥 슬래브가 없어 "초안" 과 그 까닭이다.
const DUPLEX = 'data/NBU_Duplex/NBU_Duplex-Apt_Arch.ifc'
const CLINIC = 'data/NBU_MedicalClinic/NBU_MedicalClinic_Arch.ifc'
/** Duplex Level 2 의 A204 Bathroom 2(외곽선 4.73㎡). */
const A204 = '0BTBFw6f90Nfh9rP1dlXre'
const viewer = <T,>(page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(([f, a]) => (window as any).__viewer[f as string](...(a as unknown[])), [fn, args] as const) as Promise<T>

async function pickStair(page: Page, file: string, storey: string) {
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(file)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 120_000 })
  await page.getByRole('combobox', { name: '보일 층' }).selectOption({ label: `${storey}` })
  const ids = await viewer<string[]>(page, 'verticals')
  const at = await viewer<{ x: number; y: number }>(page, 'vertical', ids[0])
  await page.mouse.click(at.x, at.y)
  await expect(page.getByTestId('vertical-picked')).toBeVisible()
}

test('Duplex: 원본 계단 자리는 슬래브가 비워 두어 새로 뚫지 않고, 슬래브가 덮는 자리로 옮기면 개구부가 확정되어 겹친 방의 넓이가 줄며, 되돌리면 돌아온다 [OE-ML-03#1] [OE-ML-03#4] [OE-ML-03#5~] [OE-ML-03#6~]', async ({ page }) => {
  test.skip(!existsSync(DUPLEX), `${DUPLEX} 이 없다(npm run fetch:sample)`)
  test.setTimeout(240_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await pickStair(page, DUPLEX, 'Level 1')
  const rows = page.getByTestId('slab-openings').locator('tbody tr')
  // 시작 층(Level 1) 바닥은 뚫지 않는다 — 지나는 층 바닥은 Level 2 하나다.
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText('Level 2 바닥')
  await expect(rows.first()).toContainText('이미 비어 있음')

  await enterEdit(page)
  await page.getByTestId('vertical-picked').locator('.ceiling-lock').getByRole('button', { name: '다중층 뷰에서 편집' }).click()
  await expect(page.getByTestId('multi-banner')).toBeVisible()
  await page.getByLabel('전체 이동 x(m)').fill(process.env.DX ?? '-3')
  await page.getByTestId('vertical-move').getByRole('button', { name: '옮기기' }).click()
  await expect(rows.first()).toContainText('개구부 확정')
  await expect(rows.first()).toContainText('이 자리를 덮고 있어')
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT })

  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('Control+z')
  await expect(rows.first()).toContainText('이미 비어 있음')
  await page.keyboard.press('Control+Shift+z')
  await expect(rows.first()).toContainText('개구부 확정')

  // 옮긴 계단과 겹친 Level 2 의 A204 는 확정 개구부와 겹친 넓이(1.63㎡)만큼 넓이가 준다(check:sample 과 같은 이동).
  await page.evaluate((id) => (window as any).__editor3d.show([id]), A204)
  const cut = page.getByTestId('space-slab-cut')
  await expect(cut).toContainText('외곽선 4.7㎡ − 슬래브 개구부 1.63㎡')
  await expect(page.locator('.space-picked .stats dd').filter({ has: cut }).locator('b')).toHaveText('3.1')
  // 되돌리면 넓이가 같이 돌아온다.
  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('Control+z')
  await page.evaluate((id) => (window as any).__editor3d.show([id]), A204)
  await expect(page.locator('.space-picked')).toBeVisible()
  await expect(cut).toHaveCount(0)
  expect(errors).toEqual([])
})

test('병원 건축: 바닥 슬래브가 없으면 개구부는 초안이고, 확인 전에는 면적에 반영하지 않는다고 까닭을 보인다 [OE-ML-03#2~]', async ({ page }) => {
  test.skip(!existsSync(CLINIC), `${CLINIC} 이 없다(npm run fetch:sample)`)
  test.setTimeout(240_000)
  await pickStair(page, CLINIC, 'First Floor')
  const row = page.getByTestId('slab-openings').locator('tbody tr').first()
  await expect(row).toContainText('Second Floor 바닥')
  await expect(row).toContainText('초안')
  await expect(row).toContainText('바닥 높이(±0.6m)에 슬래브가 없습니다')
  await expect(row).toContainText('확인 전에는 면적에 반영하지 않습니다')
})

// 만드는 동안의 개구부 미리보기(OE-ML-06 AC5). 만든 뒤 패널과 같은 판정을 초안 형상으로 미리 재고, 찍는 동안은 커서를, 돌리면 각도를 따라 다시 잰다.
async function startStair(page: Page, file: string, storey: string) {
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(file)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 120_000 })
  await enterEdit(page)
  await page.getByRole('combobox', { name: '보일 층' }).selectOption({ label: `${storey}` })
  await toSpace(page)
  await page.locator('.tool-palette').getByRole('button', { name: '계단·샤프트' }).click()
  await page.getByTestId('vertical-create-start').click()
}
const at = (page: Page, x: number, y: number) => viewer<{ x: number; y: number }>(page, 'point', [x, y, 0])

test('Duplex: 계단을 만드는 동안 위층 바닥 개구부가 커서·회전을 따라 다시 재지고, 만든 뒤 패널과 같은 판정이다 [OE-ML-06#5]', async ({ page }) => {
  test.skip(!existsSync(DUPLEX), `${DUPLEX} 이 없다(npm run fetch:sample)`)
  test.setTimeout(240_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await startStair(page, DUPLEX, 'Level 1')
  const rows = page.getByTestId('vertical-create-openings').locator('tbody tr')
  // 찍기 전, 커서를 따라 잰다 — 슬래브가 비워 둔 쪽은 새로 뚫지 않고, 덮는 쪽은 확정이다.
  let p = await at(page, 5, 5)
  await page.mouse.move(p.x, p.y)
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText('Level 2 바닥')
  await expect(rows.first()).toContainText('이미 비어 있음 — 면적 그대로')
  p = await at(page, 5, -5)
  await page.mouse.move(p.x, p.y)
  await expect(rows.first()).toContainText('개구부 확정')
  await expect(rows.first()).toContainText('슬래브 5.17㎡ 를 뚫음')
  await page.mouse.click(p.x, p.y)
  // 돌리면 다시 잰다. 45° 는 건물 안이라 만들 수 있다.
  await page.getByLabel('만들 회전각(°)').fill('45')
  await page.getByLabel('만들 회전각(°)').press('Enter')
  await expect(rows.first()).toContainText('슬래브 6.65㎡ 를 뚫음')
  await expect(page.getByTestId('vertical-create-block')).toHaveCount(0)
  // 3D: 계단 형상·진입·종료에 위층 바닥의 개구부 점선 하나가 더해진다.
  await expect.poll(async () => (await viewer<{ preview: number }>(page, 'verticalMarks')).preview).toBe(4)
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT })

  await page.getByTestId('vertical-create').getByRole('button', { name: '만들기', exact: true }).click()
  const made = page.getByTestId('slab-openings').locator('tbody tr')
  await expect(made).toHaveCount(1)
  await expect(made.first()).toContainText('Level 2 바닥')
  await expect(made.first()).toContainText('개구부 확정')
  await expect(made.first()).toContainText('덮은 넓이 6.65㎡')
  expect(errors).toEqual([])
})

test('병원 건축: 바닥 슬래브가 없으면 만드는 동안의 개구부는 초안이고 면적에 반영하지 않는다고 보인다 [OE-ML-06#5]', async ({ page }) => {
  test.skip(!existsSync(CLINIC), `${CLINIC} 이 없다(npm run fetch:sample)`)
  test.setTimeout(240_000)
  await startStair(page, CLINIC, 'First Floor')
  const p = await at(page, -28.5, 20.2)
  await page.mouse.click(p.x, p.y)
  const row = page.getByTestId('vertical-create-openings').locator('tbody tr').first()
  await expect(row).toContainText('Second Floor 바닥')
  await expect(row).toContainText('초안')
  await expect(row.getByTestId('vertical-create-opening-impact')).toHaveText('확인 전 — 면적에 반영하지 않음')
  await expect(row).toHaveAttribute('title', /바닥 높이\(±0\.6m\)에 슬래브가 없습니다/)
  // 취소하면 미리보기도 남지 않는다.
  await page.getByTestId('vertical-create').getByRole('button', { name: '취소' }).click()
  await expect(page.getByTestId('vertical-create-openings')).toHaveCount(0)
  await expect.poll(async () => (await viewer<{ preview: number }>(page, 'verticalMarks')).preview).toBe(0)
})
