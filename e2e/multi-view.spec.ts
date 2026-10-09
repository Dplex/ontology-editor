import { existsSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'

// 다중층 뷰(OE-ML-01 의 보기 부분). 여러 층을 함께 보고, 수직 관통 오브젝트는 고르면 모든 층 조각이 같이 칠해진다. 들어가는 길은
// ① 층 고르는 칸 옆 [다중층 뷰에서 편집](지금 층과 위층) ② 계단 패널의 [다중층 뷰에서 편집](관통 층). 보기 범위는 오브젝트 데이터와 따로이고,
// 다중층 뷰의 편집은 수직 관통 오브젝트 옮기기·지우기뿐이다(vertical-edit.spec.ts). 다른 편집 키·도구 상자는 끈다. 병원 건축: 층 4개(TOF Footing · First · Second · Roof), 계단 3개는 1층 → 2층.
const CLINIC = 'data/NBU_MedicalClinic/NBU_MedicalClinic_Arch.ifc'
const storeyBox = (page: Page) => page.getByRole('combobox', { name: '보일 층' })
const tab = (page: Page, name: '3D' | '평면도') => page.getByRole('group', { name: '보기' }).getByRole('button', { name })
const viewer = <T,>(page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(([f, a]) => (window as any).__viewer[f as string](...(a as unknown[])), [fn, args] as const) as Promise<T>

test('병원 건축: 다중층 뷰는 범위의 층을 함께 그리고, 계단은 모든 층 조각이 한 오브젝트로 칠해지며, 다른 편집은 막고 층 편집으로 돌아간다 [OE-ML-01#1~,7~,8~]', async ({ page }) => {
  test.skip(!existsSync(CLINIC), `${CLINIC} 이 없다(npm run fetch:sample)`)
  test.setTimeout(180_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(CLINIC)
  await expect(page.locator('.appbar h2')).toHaveText('NBU_MedicalClinic_Arch.ifc', { timeout: 120_000 })
  await storeyBox(page).selectOption({ label: 'First Floor만' })
  await page.getByRole('button', { name: '편집', exact: true }).click()
  await expect(page.locator('.tool-palette')).toBeVisible()
  expect(await viewer<string[]>(page, 'verticals')).toHaveLength(3)

  // ① 층 고르는 칸 옆 버튼: 지금 층(1층)과 위층(2층). 계단 조각이 두 층 다 보인다(1층 형상·진입 3, 2층 종료 3).
  await page.getByRole('button', { name: '다중층 뷰에서 편집' }).click()
  const range = page.getByRole('group', { name: '다중층 보기 범위' })
  await expect(range.getByRole('combobox', { name: '다중층 시작 층' }).locator('option:checked')).toHaveText('First Floor')
  await expect(range.getByRole('combobox', { name: '다중층 끝 층' }).locator('option:checked')).toHaveText('Second Floor')
  await expect(page.getByTestId('multi-banner')).toContainText('First Floor ~ Second Floor (2개 층) · 바닥 높이 0.00 ~ 4.57 m')
  await expect(storeyBox(page)).toHaveCount(0)
  expect(await viewer<string[]>(page, 'verticals')).toHaveLength(6)
  // 진입 → 종료를 잇는 점선 3개(양 끝 층이 다 보일 때만).
  expect(await viewer(page, 'verticalMarks')).toMatchObject({ entry: 3, exit: 3, rise: 3 })
  // 도구 상자가 없고 평면도는 층 하나라 못 고른다.
  await expect(page.locator('.tool-palette')).toHaveCount(0)
  await expect(tab(page, '평면도')).toBeDisabled()

  // 계단 하나를 고르면 1층·2층 조각이 같이 칠해진다.
  const ids = await viewer<string[]>(page, 'verticals')
  const first = ids[0]
  const parent = first.split('@')[0]
  const at = await viewer<{ x: number; y: number }>(page, 'vertical', first)
  await page.mouse.click(at.x, at.y)
  const panel = page.getByTestId('vertical-picked')
  await expect(panel).toBeVisible()
  await expect(panel.locator('.ceiling-lock')).toContainText('관통 층 2개 조각을 함께 칠했습니다')
  const lit = await viewer<string[]>(page, 'verticalSelected')
  expect(lit).toHaveLength(2)
  expect(lit.every((id) => id.startsWith(`${parent}@`))).toBe(true)
  // 수직 관통 오브젝트 말고의 편집 키(Insert: 꼭짓점 넣기)는 막고 알린다. 데이터(되돌리기 이력)는 그대로다.
  await page.keyboard.press('Insert')
  await expect(page.locator('.edit-notice')).toContainText('다중층 뷰에서는 수직 관통 오브젝트와 층간 배관만 다룹니다')
  await expect(page.locator('.edit-bar .undo')).toBeDisabled()

  // 범위를 [전체] 로 넓혀도 오브젝트는 그대로다(보기 범위와 관통 구간은 따로).
  await range.getByRole('button', { name: '전체' }).click()
  await expect(page.getByTestId('multi-banner')).toContainText('(4개 층)')
  expect(await viewer<string[]>(page, 'verticals')).toHaveLength(6)
  await expect(panel.getByTestId('vertical-storeys')).toContainText('First Floor → Second Floor')
  // 범위를 2층 하나만 남기면(시작=끝) 1층 조각은 안 보인다.
  await range.getByRole('combobox', { name: '다중층 시작 층' }).selectOption({ label: 'Second Floor' })
  await range.getByRole('combobox', { name: '다중층 끝 층' }).selectOption({ label: 'Second Floor' })
  expect(await viewer<string[]>(page, 'verticals')).toHaveLength(3)

  // [층 편집으로]: 들어오기 전의 1층으로 돌아가고 도구 상자가 돌아온다. 고른 계단 조각(1층)은 남고 그 조각 하나만 칠한다.
  await range.getByRole('button', { name: '층 편집으로' }).click()
  await expect(storeyBox(page).locator('option:checked')).toHaveText('First Floor만')
  await expect(page.locator('.tool-palette')).toBeVisible()
  await expect(page.getByTestId('multi-banner')).toHaveCount(0)
  await expect(tab(page, '평면도')).toBeEnabled()
  expect(await viewer<string[]>(page, 'verticalSelected')).toEqual([first])

  // ② 계단 패널의 [다중층 뷰에서 편집]: 그 계단의 관통 층(1층~2층)으로 열고 같은 계단을 칠한다.
  await panel.locator('.ceiling-lock').getByRole('button', { name: '다중층 뷰에서 편집' }).click()
  await expect(page.getByTestId('multi-banner')).toContainText('First Floor ~ Second Floor (2개 층)')
  expect(await viewer<string[]>(page, 'verticalSelected')).toHaveLength(2)
  await page.getByRole('group', { name: '다중층 보기 범위' }).getByRole('button', { name: '층 편집으로' }).click()
  await expect(storeyBox(page).locator('option:checked')).toHaveText('First Floor만')
  expect(errors).toEqual([])
})
