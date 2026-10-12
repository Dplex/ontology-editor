import { existsSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'

// 다중층 뷰의 수직 관통 오브젝트 편집(OE-ML-07 전체 이동 · OE-ML-09 삭제). 병원 건축의 계단(1층 → 2층)을 계단 패널의 [다중층 뷰에서 편집]
// 으로 열어 옮기고, V-03 을 보고, 되돌리고, 지우기 확인·취소·지우기를 하고, 편집 파일로 저장해 다시 연 BIM 에 얹는다.
const CLINIC = 'data/NBU_MedicalClinic/NBU_MedicalClinic_Arch.ifc'
const storeyBox = (page: Page) => page.getByRole('combobox', { name: '보일 층' })
const viewer = <T,>(page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(([f, a]) => (window as any).__viewer[f as string](...(a as unknown[])), [fn, args] as const) as Promise<T>
const coords = async (page: Page, testId: string) =>
  ((await page.getByTestId(testId).textContent()) ?? '').match(/-?\d+\.\d+/g)!.map(Number)

async function openClinic(page: Page) {
  await page.locator('.drop input[type=file]').setInputFiles(CLINIC)
  await expect(page.locator('.appbar h2')).toHaveText('NBU_MedicalClinic_Arch.ifc', { timeout: 120_000 })
}

/** 1층에서 계단 하나를 3D 로 고르고 그 계단의 [다중층 뷰에서 편집] 으로 들어간다. 고른 계단 id 를 돌려준다. */
async function enterWithStair(page: Page, index = 0): Promise<string> {
  await storeyBox(page).selectOption({ label: 'First Floor만' })
  const ids = await viewer<string[]>(page, 'verticals')
  const at = await viewer<{ x: number; y: number }>(page, 'vertical', ids[index])
  await page.mouse.click(at.x, at.y)
  const panel = page.getByTestId('vertical-picked')
  await panel.locator('.ceiling-lock').getByRole('button', { name: '다중층 뷰에서 편집' }).click()
  await expect(page.getByTestId('multi-banner')).toContainText('First Floor ~ Second Floor')
  return ids[index].split('@')[0]
}

test('병원 건축: 다중층 뷰에서 계단을 통째로 옮기면 두 층이 같이 가고 V-03 을 알리며, 되돌리기·지우기 확인·취소가 맞고, 편집 파일로 다시 얹힌다', async ({ page }, info) => {
  test.skip(!existsSync(CLINIC), `${CLINIC} 이 없다(npm run fetch:sample)`)
  test.setTimeout(240_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await openClinic(page)
  await page.getByRole('button', { name: '편집', exact: true }).click()
  const parent = await enterWithStair(page)
  const panel = page.getByTestId('vertical-picked')
  const undo = page.locator('.edit-bar .undo')

  // 1층 조각(진입)과 2층 조각(종료)의 좌표. 2층 조각은 패널의 관통 층에서 고른다(다중층 뷰라 층은 그대로다).
  const entry0 = await coords(page, 'vertical-entry')
  await panel.getByTestId('vertical-storeys').getByRole('button', { name: 'Second Floor' }).click()
  const exit0 = await coords(page, 'vertical-exit')
  await expect(page.getByTestId('multi-banner')).toBeVisible()
  await expect(page.getByTestId('vertical-v03')).toHaveCount(0)

  // Δx 1m → 두 층 조각이 같이 1m 간다. 높이는 그대로. V-03(1층 벽·계단실 경계).
  await page.getByLabel('전체 이동 x(m)').fill('1')
  await page.getByTestId('vertical-move').getByRole('button', { name: '옮기기' }).click()
  const exit1 = await coords(page, 'vertical-exit')
  expect(exit1.map((v, i) => +(v - exit0[i]).toFixed(2))).toEqual([1, 0, 0])
  await panel.getByTestId('vertical-storeys').getByRole('button', { name: 'First Floor' }).click()
  const entry1 = await coords(page, 'vertical-entry')
  expect(entry1.map((v, i) => +(v - entry0[i]).toFixed(2))).toEqual([1, 0, 0])
  await expect(page.getByTestId('vertical-v03')).toContainText('V-03 First Floor')
  await expect(page.getByTestId('vertical-v03')).toContainText('벽과')
  await expect(undo).toBeEnabled()
  await expect(page.locator('.edit-bar')).toContainText('바뀐 것 1건')
  await expect(page.locator('.report')).toContainText('1.00, 0.00 m 옮겼습니다(모든 층, GeoJSON)')

  // 방향키는 10cm. 되돌리기 두 번이면 처음 자리, V-03 도 사라진다.
  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('ArrowRight')
  await expect.poll(async () => (await coords(page, 'vertical-entry')).join()).not.toBe(entry1.join())
  await page.keyboard.press('Control+z')
  await page.keyboard.press('Control+z')
  await expect.poll(async () => (await coords(page, 'vertical-entry')).join()).toBe(entry0.join())
  await expect(page.getByTestId('vertical-v03')).toHaveCount(0)
  await expect(page.locator('.edit-bar')).toContainText('바뀐 것 0건')

  // 지우기: Delete 는 영향을 보이고 묻는다. 취소하면 그대로다.
  await page.keyboard.press('Delete')
  const ask = page.getByTestId('vertical-delete-ask')
  await expect(ask).toContainText('영향 층: First Floor · Second Floor (2개 조각이 빠집니다)')
  await expect(ask).toContainText('STAIR ↔ STAIR 연결이 빠지고')
  await ask.getByRole('button', { name: '취소' }).click()
  await expect(ask).toHaveCount(0)
  await expect(undo).toBeDisabled()
  expect(await viewer<string[]>(page, 'verticals')).toHaveLength(6)
  // 옮긴 뒤 지우면 편집은 지움 하나다.
  await page.getByLabel('전체 이동 y(m)').fill('-0.5')
  await page.getByTestId('vertical-move').getByRole('button', { name: '옮기기' }).click()
  await page.keyboard.press('Delete')
  await ask.getByRole('button', { name: '지우기' }).click()
  await expect(panel).toHaveCount(0)
  expect(await viewer<string[]>(page, 'verticals')).toHaveLength(4)
  expect((await viewer<string[]>(page, 'verticals')).some((id) => id.startsWith(`${parent}@`))).toBe(false)
  await expect(page.locator('.report')).toContainText('지웠습니다(모든 층, GeoJSON)')
  // 되돌리기 한 번이면 두 층 조각이 함께 돌아온다.
  await page.keyboard.press('Control+z')
  expect(await viewer<string[]>(page, 'verticals')).toHaveLength(6)
  await page.keyboard.press('Control+Shift+z')
  expect(await viewer<string[]>(page, 'verticals')).toHaveLength(4)

  // 남은 계단 하나를 Δx 0.5 옮긴다(저장·복원에서 옮긴 자리를 본다). 다중층 뷰에서는 위층 바닥·설비가 아래층 조각을 가릴 수 있어
  // 조각마다 눌러 보아 골라지는 것을 쓴다.
  const others = (await viewer<string[]>(page, 'verticals')).filter((id) => !id.startsWith(`${parent}@`))
  for (const id of others) {
    const at = await viewer<{ x: number; y: number }>(page, 'vertical', id)
    await page.mouse.click(at.x, at.y)
    if (await panel.isVisible()) break
    await page.keyboard.press('Escape')
  }
  await expect(panel).toBeVisible()
  const parent2 = (await viewer<string[]>(page, 'verticalSelected'))[0].split('@')[0]
  await page.getByLabel('전체 이동 x(m)').fill('0.5')
  await page.getByTestId('vertical-move').getByRole('button', { name: '옮기기' }).click()
  const toFirst = panel.getByTestId('vertical-storeys').getByRole('button', { name: 'First Floor' })
  if (await toFirst.count()) await toFirst.click()
  const moved = await coords(page, 'vertical-entry')

  // 층 편집으로 나가 저장(Ctrl+S) → 같은 BIM 을 다시 열고 불러오면 지운 계단은 없고 옮긴 계단은 옮긴 자리다.
  await page.getByRole('group', { name: '다중층 보기 범위' }).getByRole('button', { name: '층 편집으로' }).click()
  await expect(page.locator('.edit-bar')).toContainText('바뀐 것 2건')
  const download = page.waitForEvent('download')
  await page.keyboard.press('Control+s')
  const path = info.outputPath('clinic.edits.json')
  await (await download).saveAs(path)
  page.on('dialog', (d) => void d.accept())
  await openClinic(page)
  await expect(page.locator('.edit-bar')).toContainText('바뀐 것 0건', { timeout: 30_000 })
  await storeyBox(page).selectOption({ label: 'First Floor만' })
  expect(await viewer<string[]>(page, 'verticals')).toHaveLength(3)
  await page.locator('.load-edits input').setInputFiles(path)
  await expect(page.locator('.edit-file-note')).toContainText('편집 2개를 적용했습니다')
  const after = await viewer<string[]>(page, 'verticals')
  expect(after).toHaveLength(2)
  const back = after.find((id) => id.startsWith(`${parent2}@`))!
  // 불러오기 칸은 페이지 아래라 화면이 내려가 있다. 3D 를 다시 보이고 누른다.
  await page.locator('.viewport canvas').scrollIntoViewIfNeeded()
  const at3 = await viewer<{ x: number; y: number }>(page, 'vertical', back)
  await page.mouse.click(at3.x, at3.y)
  expect(await coords(page, 'vertical-entry')).toEqual(moved)
  await expect(page.locator('.report')).toContainText('지웠습니다(모든 층, GeoJSON)')
  expect(errors).toEqual([])
})
