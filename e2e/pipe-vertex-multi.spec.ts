import { existsSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { countByLabel, enterEdit, leaveMultiView, openMultiView, pickEquipment } from './edit-part'

// 다중층 뷰에서도 층 편집과 같은 배관 편집 도구(OE-PIP-10 AC1). 층을 넘는 수직 구간은 층 편집 화면에서 잠기고(OE-ML-05), 다중층 뷰에서는
// 같은 패널로 꼭짓점을 넣고 옮기고 지운다. Duplex 설비: 1층 라디에이터 536919 에서 2층 0.3m 로 올라 옆의 2층 라디에이터 557522 에 잇는
// 층간 배관을 riser.spec.ts 와 같이 그린 뒤, 그 수직 구간(z 0.02 → 3.40, Level 1 → Level 2)을 고친다.
const DUPLEX = 'data/NBU_Duplex/NBU_Duplex-Apt_Eng-MEP.ifc'
const FROM = 'M_Radiator - Hosted:Readiator - 25:Readiator - 25:536919'
const viewer = <T,>(page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(([f, a]) => (window as any).__viewer[f as string](...(a as unknown[])), [fn, args] as const) as Promise<T>
// 그린 배관 구간 · 이음쇠 수. 예전 설비 표의 줄 수 대신 화면 모델(TTL)에서 센다(#715 에서 표가 빠졌다).
const hws = (page: Page) => countByLabel(page, /^HWS (배관|이음) /)
async function pick(page: Page, name: string) {
  await pickEquipment(page, name)
  await expect(page.locator('.picked h3')).toHaveText(name)
}

test('다중층 뷰에서 층을 넘는 수직 구간에 꼭짓점을 넣어 옮겨 꺾고 지워 합치며, 층 편집을 오가도 같고 차례로 되돌린다 [OE-PIP-10#1] [OE-PIP-15#3]', async ({ page }) => {
  test.skip(!existsSync(DUPLEX), `${DUPLEX} 이 없다(npm run fetch:sample)`)
  test.setTimeout(180_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(DUPLEX)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 90_000 })
  await page.getByRole('combobox', { name: '보일 층' }).selectOption({ label: 'Level 1' })
  await enterEdit(page)
  await openMultiView(page, { from: 'Level 1', to: 'Level 2' })
  await expect(page.getByTestId('multi-banner')).toContainText('Level 1 ~ Level 2 (2개 층)')

  // 층간 배관: 1층 라디에이터 → 수직으로 2층 0.3m → 2층 라디에이터 위 → 2층 라디에이터.
  await pick(page, FROM)
  const panel = page.getByTestId('riser-draw')
  const target = panel.getByLabel('층간 배관 끝 대상').locator('option', { hasText: '557522' })
  await panel.getByLabel('층간 배관 끝 대상').selectOption(await target.getAttribute('value'))
  await panel.getByLabel('층간 배관 Flow Type').selectOption('HWS')
  await panel.getByRole('button', { name: '경로 찍기' }).click()
  const bar = page.locator('.draw-bar')
  await bar.getByLabel('작업 층').selectOption({ label: 'Level 2' })
  await bar.getByLabel('층 바닥에서 높이(m)').fill('0.3')
  await bar.getByLabel('층 바닥에서 높이(m)').press('Tab')
  await bar.getByTestId('riser-plumb').click()
  const at = await viewer<{ x: number; y: number }>(page, 'point', [0.42, -13.4, 3.4])
  await page.mouse.click(at.x, at.y)
  await page.keyboard.press('Enter')
  await expect(page.locator('.key-note')).toContainText('HWS 배관을 그렸습니다: 구간 3개 · 이음쇠 2개')
  await expect.poll(() => hws(page)).toBe(5)

  // 수직 구간을 고르면 층 편집과 같은 패널이다: 꼭짓점 넣기, 끝 대상 바꾸기, 지우기. 층 편집 전용인 배관 그리기·층 옮기기는 없다.
  await pick(page, 'HWS 배관 1')
  const picked = page.locator('.picked')
  await expect(picked.locator('.ceiling-lock')).toHaveCount(0)
  await expect(picked.getByTestId('retarget')).toBeVisible()
  await expect(picked.getByTestId('pipe-draw')).toHaveCount(0)
  await expect(picked.locator('.storey-move')).toHaveCount(0)
  await picked.getByTestId('pipe-vertex').getByRole('button', { name: '가운데에 꼭짓점 넣기' }).click()
  await expect(page.locator('.key-note')).toContainText('가운데에 꼭짓점')
  await expect.poll(() => hws(page)).toBe(7)
  const elbow = (await picked.locator('h3').innerText()).trim()
  expect(elbow).toMatch(/^HWS 이음 \d+$/)
  // 넣은 꼭짓점은 수직 구간의 가운데(z 1.71)다. x 를 0.5m 옮겨 꺾으면 위아래 구간이 늘어나 따라온다.
  const coords = picked.locator('.position-edit input.coord')
  await expect(coords.nth(2)).toHaveValue('1.71')
  await coords.nth(0).fill('0.92')
  await coords.nth(0).press('Enter')
  await expect(page.getByTestId('last-edit')).toContainText('옮김 (배관 2개 따라옴)')
  // 방향키도 층 편집처럼 옮긴다(10cm, cm 로 맞춘다). 아래에서 되돌릴 때 이 한 번이 더 있다.
  await page.locator('.appbar h2').click()
  await page.keyboard.press('ArrowUp')
  await expect(coords.nth(1)).toHaveValue('-14.69')
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT })

  // 층 편집으로 갔다 와도 같은 꼭짓점·좌표다. 넣은 꼭짓점 아래 구간(HWS 배관 1)은 이제 1층 안이라 층 편집에서 고치고, 위 구간(새로 생긴
  // HWS 배관 7 — 그린 조각과 번호를 같이 센다)은 층을 넘어 잠기고 다중층 뷰로 안내한다.
  await leaveMultiView(page)
  await pick(page, 'HWS 배관 1')
  await expect(picked.locator('.ceiling-lock')).toHaveCount(0)
  await pick(page, 'HWS 배관 7')
  await expect(picked.locator('.ceiling-lock')).toContainText('다른 층으로 이어진 덕트·배관 구간')
  await page.getByRole('button', { name: '다중층 뷰에서 편집' }).first().click()
  await expect(page.getByTestId('multi-banner')).toBeVisible()
  await pick(page, elbow)
  await expect(coords.nth(0)).toHaveValue('0.92')
  await expect(coords.nth(1)).toHaveValue('-14.69')
  await expect.poll(() => hws(page)).toBe(7)

  // 그 꼭짓점을 지우면 위아래 구간이 하나로 곧게 합쳐진다.
  await picked.getByTestId('pipe-vertex').getByRole('button', { name: '꼭짓점 지우기' }).click()
  await expect(page.locator('.key-note')).toContainText('하나로 합쳤습니다')
  await expect.poll(() => hws(page)).toBe(5)

  // 지우기 · 방향키 · 옮기기 · 넣기를 차례로 되돌리면 그린 다섯 조각이다(층 편집을 오간 것은 되돌리기에 없다).
  await page.locator('.appbar h2').click()
  await page.keyboard.press('Control+z')
  await expect.poll(() => hws(page)).toBe(7)
  await page.keyboard.press('Control+z')
  await page.keyboard.press('Control+z')
  await page.keyboard.press('Control+z')
  await expect.poll(() => hws(page)).toBe(5)
  expect(errors).toEqual([])
})
