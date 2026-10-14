import { existsSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'

// 슬래브 개구부(OE-ML-03, slab-opening.ts). 계단 패널에 지나는 층 바닥마다 판정과 까닭이 보인다.
// Duplex 건축: Level 2 바닥 슬래브가 계단 자리를 외곽선으로 비워 두었다 → "이미 비어 있음". 계단을 슬래브가 덮는 자리로 옮기면 그 자리를
// 다시 재 "개구부 확정" 이 되고, 되돌리면 돌아온다. 병원 건축은 바닥 슬래브가 없어 "초안" 과 그 까닭이다.
const DUPLEX = 'data/NBU_Duplex/NBU_Duplex-Apt_Arch.ifc'
const CLINIC = 'data/NBU_MedicalClinic/NBU_MedicalClinic_Arch.ifc'
const viewer = <T,>(page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(([f, a]) => (window as any).__viewer[f as string](...(a as unknown[])), [fn, args] as const) as Promise<T>

async function pickStair(page: Page, file: string, storey: string) {
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(file)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 120_000 })
  await page.getByRole('combobox', { name: '보일 층' }).selectOption({ label: `${storey}만` })
  const ids = await viewer<string[]>(page, 'verticals')
  const at = await viewer<{ x: number; y: number }>(page, 'vertical', ids[0])
  await page.mouse.click(at.x, at.y)
  await expect(page.getByTestId('vertical-picked')).toBeVisible()
}

test('Duplex: 원본 계단 자리는 슬래브가 비워 두어 새로 뚫지 않고, 슬래브가 덮는 자리로 옮기면 개구부가 확정되며, 되돌리면 돌아온다 [OE-ML-03#1] [OE-ML-03#5~] [OE-ML-03#6~]', async ({ page }) => {
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

  await page.getByRole('button', { name: '편집', exact: true }).click()
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
