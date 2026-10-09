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

test('병원 건축: 다중층 뷰에서 계단의 한 층 조각만 고친다 — 꼭짓점 손잡이·이 층만 옮기기·종료 지점 좌표, 설비는 끌리지 않고, 편집 파일로 다시 얹힌다', async ({ page }, info) => {
  test.skip(!existsSync(CLINIC), `${CLINIC} 이 없다(npm run fetch:sample)`)
  test.setTimeout(240_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await openClinic(page)
  await page.getByRole('button', { name: '편집', exact: true }).click()
  await enterWithStair(page)
  const panel = page.getByTestId('vertical-picked')
  const part = page.getByTestId('vertical-part-edit')
  await expect(part).toContainText('First Floor 조각만')

  // 1층 조각의 꼭짓점 손잡이를 끌면 그 층 형상만 바뀐다(이력 하나, 리포트에 "층별 모양").
  const handles = await viewer<{ x: number; y: number }[]>(page, 'handles')
  expect(handles.length).toBeGreaterThanOrEqual(3)
  // 첫 꼭짓점을 형상 가운데에서 바깥쪽으로 15px 끈다(형상이 커진다). 화면에서 계단은 30px 남짓이라 많이 끌면 변이 엇갈려 거절된다.
  const h = handles[0]
  const c = { x: handles.reduce((a, p) => a + p.x, 0) / handles.length, y: handles.reduce((a, p) => a + p.y, 0) / handles.length }
  const len = Math.hypot(h.x - c.x, h.y - c.y)
  const to = { x: h.x + ((h.x - c.x) / len) * 15, y: h.y + ((h.y - c.y) / len) * 15 }
  await page.mouse.move(h.x, h.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 10 })
  await page.mouse.up()
  await expect(page.locator('.edit-bar')).toContainText('바뀐 것 1건')
  await expect(page.locator('.report')).toContainText('층별 모양을 고쳤습니다(First Floor, GeoJSON)')
  const moved = await viewer<{ x: number; y: number }[]>(page, 'handles')
  expect(Math.hypot(moved[0].x - h.x, moved[0].y - h.y)).toBeGreaterThan(10)
  // 많이 끌어 변이 엇갈리면 되돌리고 알린다.
  await page.mouse.move(moved[0].x, moved[0].y)
  await page.mouse.down()
  await page.mouse.move(c.x + (c.x - moved[0].x) * 2, c.y + (c.y - moved[0].y) * 2, { steps: 10 })
  await page.mouse.up()
  await expect(page.locator('.edit-notice')).toContainText('변이 서로 교차하는 형상이라')
  expect(await viewer(page, 'handles')).toEqual(moved)
  await expect(page.locator('.edit-bar')).toContainText('바뀐 것 1건')

  // 이 층 조각만 옮기기: 진입 지점이 같이 가고, 2층 종료 지점은 그대로다.
  const entry0 = await coords(page, 'vertical-entry')
  await page.getByLabel('이 층 조각 이동 y(m)').fill('0.5')
  await part.getByRole('button', { name: '옮기기' }).click()
  const entry1 = await coords(page, 'vertical-entry')
  expect(+(entry1[1] - entry0[1]).toFixed(2)).toBe(0.5)
  await panel.getByTestId('vertical-storeys').getByRole('button', { name: 'Second Floor' }).click()
  await expect(part).toContainText('Second Floor 조각만')
  await expect(part).toContainText('이 층은 형상 없이 지점만 있습니다')
  const exit0 = await coords(page, 'vertical-exit')
  // 2층 종료 지점 x 를 칸으로 바꾼다. 높이는 그대로다.
  const exitX = page.getByLabel('종료 지점 x(m)')
  await exitX.fill(String((exit0[0] + 0.8).toFixed(2)))
  await exitX.press('Enter')
  await expect.poll(async () => (await coords(page, 'vertical-exit'))[0]).toBeCloseTo(exit0[0] + 0.8, 2)
  expect((await coords(page, 'vertical-exit'))[2]).toBe(exit0[2])
  await expect(page.locator('.report')).toContainText('층별 모양을 고쳤습니다(First Floor · Second Floor, GeoJSON)')
  const exit1 = await coords(page, 'vertical-exit')

  // 숫자가 아닌 칸은 적용하지 않는다.
  await exitX.fill('')
  await exitX.press('Enter')
  await expect(page.locator('.edit-notice')).toContainText('좌표는 숫자로 넣습니다')
  expect(await coords(page, 'vertical-exit')).toEqual(exit1)
  // 다중층 뷰에서 설비는 고르고 보기만 한다 — 좌표·지우기 칸 대신 안내가 뜬다.
  await page.locator('input[type=search]').fill('Mirror')
  await page.locator('.equipment tbody tr', { hasText: 'Mirror' }).first().getByRole('button').first().click()
  await expect(page.locator('.picked .ceiling-lock').first()).toContainText('다중층 뷰에서는 수직 관통 오브젝트만 옮기거나 지웁니다')
  await expect(page.locator('.position-edit')).toHaveCount(0)
  await expect(page.locator('.picked .danger-zone')).toHaveCount(0)
  await page.locator('.viewport canvas').scrollIntoViewIfNeeded()

  // 저장 → 다시 열기 → 불러오기: 종료 지점이 고친 자리다.
  await page.getByRole('group', { name: '다중층 보기 범위' }).getByRole('button', { name: '층 편집으로' }).click()
  const download = page.waitForEvent('download')
  await page.keyboard.press('Control+s')
  const path = info.outputPath('clinic-parts.edits.json')
  await (await download).saveAs(path)
  page.on('dialog', (d) => void d.accept())
  await openClinic(page)
  await expect(page.locator('.edit-bar')).toContainText('바뀐 것 0건', { timeout: 30_000 })
  await page.locator('.load-edits input').setInputFiles(path)
  await expect(page.locator('.edit-file-note')).toContainText('편집 1개를 적용했습니다')
  await expect(page.locator('.report')).toContainText('층별 모양을 고쳤습니다(First Floor · Second Floor, GeoJSON)')
  await page.locator('.viewport canvas').scrollIntoViewIfNeeded()
  // 2층 종료 지점은 2층 설비에 가려질 수 있어, 1층 조각을 고르고 패널의 관통 층에서 2층으로 간다.
  await storeyBox(page).selectOption({ label: 'First Floor만' })
  for (const id of await viewer<string[]>(page, 'verticals')) {
    const at = await viewer<{ x: number; y: number }>(page, 'vertical', id)
    await page.mouse.click(at.x, at.y)
    if (!(await panel.isVisible())) continue
    await panel.getByTestId('vertical-storeys').getByRole('button', { name: 'Second Floor' }).click()
    if ((await coords(page, 'vertical-exit'))[0] === exit1[0]) break
    await storeyBox(page).selectOption({ label: 'First Floor만' })
  }
  expect(await coords(page, 'vertical-exit')).toEqual(exit1)
  expect(errors).toEqual([])
})
