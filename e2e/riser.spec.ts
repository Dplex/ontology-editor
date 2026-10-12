import { existsSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'

// 층간 배관(라이저·오프셋, OE-ML-12·14·18 · OE-PIP-15). 다중층 뷰에서 설비를 고르면 같은 배관 그리기로 다른 층 설비까지 잇는다.
// 꺾임점마다 작업 높이(층 + 바닥에서 m)를 정하고, 층을 지나는 구간은 [수직으로 찍기] 로 찍는다. 계산은 cross-storey-pipe.test.ts 가 본다.
// Duplex 설비: Level 1(0m) · Level 2(3.1m) · Roof(6m). 1층 라디에이터 536919(0.42,-14.79,0.02) → 바로 옆 2층 라디에이터 557522(0.42,-13.40,3.12).
const DUPLEX = 'data/NBU_Duplex/NBU_Duplex-Apt_Eng-MEP.ifc'
const FROM = 'M_Radiator - Hosted:Readiator - 25:Readiator - 25:536919'
const TO = '557522'
const viewer = <T,>(page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(([f, a]) => (window as any).__viewer[f as string](...(a as unknown[])), [fn, args] as const) as Promise<T>
const drawnRows = (page: Page) => page.locator('.equipment tbody tr', { hasText: /HWS (배관|이음) / })

test('Duplex: 1층 라디에이터에서 수직으로 올라 2층에서 옆으로 옮겨 2층 라디에이터에 잇는다. 범위 밖이면 그리던 점을 둔 채 막고, 넓히면 마친다 [OE-ML-12#1,3,4,6] [OE-ML-14#1] [OE-PIP-15#1~,2~]', async ({ page }) => {
  test.skip(!existsSync(DUPLEX), `${DUPLEX} 이 없다(npm run fetch:sample)`)
  test.setTimeout(180_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(DUPLEX)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 90_000 })
  await page.getByRole('combobox', { name: '보일 층' }).selectOption({ label: 'Level 1만' })
  await page.getByRole('button', { name: '편집', exact: true }).click()
  await page.getByRole('button', { name: '다중층 뷰에서 편집' }).click()
  await expect(page.getByTestId('multi-banner')).toContainText('Level 1 ~ Level 2 (2개 층)')
  // 별도 라이저 도구는 없다 — 고른 설비 패널의 배관 그리기다.
  await expect(page.getByRole('button', { name: /라이저/ })).toHaveCount(0)

  await page.locator('input[type=search]').fill('536919')
  await page.locator('.equipment tbody tr', { hasText: FROM }).last().getByRole('button', { name: FROM, exact: true }).click()
  const panel = page.getByTestId('riser-draw')
  await expect(panel).toBeVisible()
  // 끝 층은 시작 설비의 층이 아닌 첫 층(Level 2)이고, 끝 후보는 그 층 설비를 수평 거리 순으로 보인다.
  await expect(panel.getByLabel('층간 배관 끝 층').locator('option:checked')).toHaveText('Level 2')
  const target = panel.getByLabel('층간 배관 끝 대상').locator('option', { hasText: TO })
  await expect(target).toHaveText('M_Radiator - Hosted #557522 · 수평 1.4m')
  await panel.getByLabel('층간 배관 끝 대상').selectOption(await target.getAttribute('value'))
  await panel.getByLabel('층간 배관 Flow Type').selectOption('HWS')
  await panel.getByRole('button', { name: '경로 찍기' }).click()

  // 작업 높이: Level 2 바닥에서 0.3m = z 3.40m. [수직으로 찍기] 는 라디에이터 바로 위에 찍는다.
  const bar = page.locator('.draw-bar')
  await bar.getByLabel('작업 층').selectOption({ label: 'Level 2' })
  await bar.getByLabel('층 바닥에서 높이(m)').fill('0.3')
  await bar.getByLabel('층 바닥에서 높이(m)').press('Tab')
  await expect(bar).toContainText('z 3.40m')
  await bar.getByTestId('riser-plumb').click()
  await expect(bar).toContainText('꺾임점 1개')
  // 2층에서 옆으로: 2층 라디에이터 바로 위 (0.42, -13.40) 를 같은 높이에 찍는다.
  const at = await viewer<{ x: number; y: number }>(page, 'point', [0.42, -13.4, 3.4])
  await page.mouse.click(at.x, at.y)
  await expect(bar).toContainText('꺾임점 2개')
  expect(await viewer(page, 'verticalMarks')).toMatchObject({ preview: 1 })
  if (process.env.SHOT_DRAW) await page.screenshot({ path: process.env.SHOT_DRAW })

  // 보기 범위를 1층만으로 줄이면 2층 끝 대상이 밖이다. 막고 그리던 점은 그대로 둔다.
  const range = page.getByRole('group', { name: '다중층 보기 범위' })
  await range.getByRole('combobox', { name: '다중층 끝 층' }).selectOption({ label: 'Level 1' })
  await page.keyboard.press('Enter')
  await expect(page.locator('.key-note')).toContainText('의 층(Level 2)이 보기 범위 밖입니다. 보기 범위를 넓힌 뒤 완료합니다')
  await expect(bar).toContainText('꺾임점 2개')
  await expect(drawnRows(page)).toHaveCount(0)
  // 넓히면 이어서 마친다. 수직 구간 · 수평 구간 · 2층 라디에이터로 내려가는 구간, 꺾인 자리 둘에 이음쇠.
  await range.getByRole('combobox', { name: '다중층 끝 층' }).selectOption({ label: 'Level 2' })
  await page.keyboard.press('Enter')
  await expect(page.locator('.key-note')).toContainText('HWS 배관을 그렸습니다: 구간 3개 · 이음쇠 2개')
  await expect(page.locator('.key-note')).toContainText('2개 층')
  await expect(bar).toHaveCount(0)
  expect(await viewer(page, 'verticalMarks')).toMatchObject({ preview: 0 })
  await page.locator('input[type=search]').fill('HWS')
  await expect(drawnRows(page)).toHaveCount(5)
  if (process.env.SHOT) await page.locator('.viewport').screenshot({ path: process.env.SHOT })

  // 되돌리기 한 번에 층간 배관 전체가 빠진다.
  await page.locator('.edit-bar').click({ position: { x: 2, y: 2 } })
  await page.keyboard.press('Control+z')
  await expect(drawnRows(page)).toHaveCount(0)

  // 비스듬히 층을 지나면 막는다: 1층 라디에이터에서 곧장 2층 높이의 다른 자리를 찍으면 수직이 아니다.
  await page.locator('input[type=search]').fill('536919')
  await page.locator('.equipment tbody tr', { hasText: FROM }).last().getByRole('button', { name: FROM, exact: true }).click()
  await panel.getByLabel('층간 배관 끝 대상').selectOption(await target.getAttribute('value'))
  await panel.getByRole('button', { name: '경로 찍기' }).click()
  await bar.getByLabel('작업 층').selectOption({ label: 'Level 2' })
  const slant = await viewer<{ x: number; y: number }>(page, 'point', [0.42, -13.4, 3.12])
  await page.mouse.click(slant.x, slant.y)
  await page.keyboard.press('Enter')
  await expect(page.locator('.key-note')).toContainText('1번째 구간이 층 바닥을 비스듬히 지납니다')
  // 취소하면 남는 것이 없다.
  await page.keyboard.press('Escape')
  await expect(bar).toHaveCount(0)
  await expect(page.locator('.key-note')).toContainText('배관 그리기를 취소했습니다. 아무것도 남기지 않았습니다')
  await page.locator('input[type=search]').fill('HWS')
  await expect(drawnRows(page)).toHaveCount(0)
  expect(errors).toEqual([])
})

test('Duplex: 그린 라이저의 1층 1.5m 자리에 분기점을 넣어 1층 설비로 분기하고, 층 편집 화면에서도 같은 분기점이 보이며, 되돌리면 라이저가 하나로 돌아온다 [OE-ML-13#1~,5~] [OE-PIP-15#4~]', async ({ page }) => {
  test.skip(!existsSync(DUPLEX), `${DUPLEX} 이 없다(npm run fetch:sample)`)
  test.setTimeout(180_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(DUPLEX)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 90_000 })
  await page.getByRole('combobox', { name: '보일 층' }).selectOption({ label: 'Level 1만' })
  await page.getByRole('button', { name: '편집', exact: true }).click()
  await page.getByRole('button', { name: '다중층 뷰에서 편집' }).click()
  const bar = page.locator('.draw-bar')

  // 주 배관: 1층 라디에이터 → 수직으로 2층 바닥 + 0.3m → 2층 라디에이터(첫 시험과 같다).
  await page.locator('input[type=search]').fill('536919')
  await page.locator('.equipment tbody tr', { hasText: FROM }).last().getByRole('button', { name: FROM, exact: true }).click()
  const riser = page.getByTestId('riser-draw')
  const target = riser.getByLabel('층간 배관 끝 대상').locator('option', { hasText: TO })
  await riser.getByLabel('층간 배관 끝 대상').selectOption(await target.getAttribute('value'))
  await riser.getByLabel('층간 배관 Flow Type').selectOption('HWS')
  await riser.getByRole('button', { name: '경로 찍기' }).click()
  await bar.getByLabel('작업 층').selectOption({ label: 'Level 2' })
  await bar.getByLabel('층 바닥에서 높이(m)').fill('0.3')
  await bar.getByLabel('층 바닥에서 높이(m)').press('Tab')
  await bar.getByTestId('riser-plumb').click()
  const at = await viewer<{ x: number; y: number }>(page, 'point', [0.42, -13.4, 3.4])
  await page.mouse.click(at.x, at.y)
  await page.keyboard.press('Enter')
  await expect(page.locator('.key-note')).toContainText('HWS 배관을 그렸습니다: 구간 3개 · 이음쇠 2개')

  // 라이저 구간(HWS 배관 1)을 고르면 같은 칸이 분기 그리기가 된다. 끝은 1층 라디에이터 557620(2.57,-8.81,0.30).
  await page.locator('input[type=search]').fill('HWS 배관 1')
  await page.locator('.equipment tbody tr', { hasText: 'HWS 배관 1' }).first().getByRole('button', { name: 'HWS 배관 1', exact: true }).click()
  const branch = page.getByTestId('branch-draw')
  await expect(branch).toBeVisible()
  await branch.getByLabel('층간 배관 끝 층').selectOption({ label: 'Level 1' })
  const other = branch.getByLabel('층간 배관 끝 대상').locator('option', { hasText: '557620' })
  await branch.getByLabel('층간 배관 끝 대상').selectOption(await other.getAttribute('value'))
  await branch.getByRole('button', { name: '분기 그리기' }).click()
  await expect(bar).toContainText('첫 점은 분기 자리')
  // 작업 높이 Level 1 + 1.5m 에서 라이저 위에 분기 자리를 찍는다.
  await bar.getByLabel('작업 층').selectOption({ label: 'Level 1' })
  await bar.getByLabel('층 바닥에서 높이(m)').fill('1.5')
  await bar.getByLabel('층 바닥에서 높이(m)').press('Tab')
  await bar.getByTestId('branch-at').click()
  await expect(bar).toContainText('분기 자리 + 꺾임점 0개')
  // 1.5m 높이에서 옆으로 두 번 꺾어 라디에이터 바로 위로 간다. 마지막은 라디에이터로 내려가는 구간이다.
  for (const [x, y] of [[0.42, -8.81], [2.57, -8.81]]) {
    const p = await viewer<{ x: number; y: number }>(page, 'point', [x, y, 1.5])
    await page.mouse.click(p.x, p.y)
  }
  await expect(bar).toContainText('분기 자리 + 꺾임점 2개')
  await page.keyboard.press('Enter')
  await expect(page.locator('.key-note')).toContainText('HWS 분기를 그렸습니다: 분기점 HWS 분기 6을 넣어 HWS 배관 1을 나눴습니다 · 구간 3개')
  // F: 고른 라이저 구간의 연결망(라이저·분기)에 시점을 맞춘다.
  await page.keyboard.press('f')
  await expect.poll(() => viewer<{ flying: boolean }>(page, 'motion').then((m) => m.flying)).toBe(false)
  await page.locator('input[type=search]').fill('HWS')
  // 라이저 다섯 조각 + 분기점 + 나눈 뒤 구간 + 분기 구간 셋·이음쇠 둘.
  await expect(page.locator('.equipment tbody tr', { hasText: /HWS (배관|이음|분기) / })).toHaveCount(12)
  if (process.env.SHOT_BRANCH) await page.locator('.viewport').screenshot({ path: process.env.SHOT_BRANCH })

  // 층 편집 화면(1층)에도 같은 분기점이 있다 — 1.5m 높이라 1층의 이음쇠다.
  await page.getByRole('button', { name: '층 편집으로' }).first().click()
  await page.locator('input[type=search]').fill('HWS 분기')
  await expect(page.locator('.equipment tbody tr', { hasText: 'HWS 분기 6' })).toHaveCount(1)

  // 되돌리기 한 번에 분기점·뒤 구간·분기가 빠진다(라이저 다섯 조각만 남는다).
  await page.locator('.edit-bar').click({ position: { x: 2, y: 2 } })
  await page.keyboard.press('Control+z')
  await page.locator('input[type=search]').fill('HWS')
  await expect(page.locator('.equipment tbody tr', { hasText: 'HWS 분기' })).toHaveCount(0)
  expect(errors).toEqual([])
})
