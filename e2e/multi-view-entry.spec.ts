import { existsSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'

// 다중층 뷰의 세 진입 경로(OE-ML-01). ① 층 고르는 칸 옆 [다중층 뷰에서 편집] ② 계단 패널의 [다중층 뷰에서 편집] ③ 배관 그리기 중 전환.
// 어느 길로 열어도 같은 배관 그리기(층간 배관·분기)와 같은 연결 패널(해제 보정·취소)을 쓰고, 해제한 연결은 화면을 오가도 그대로다.
// Duplex 건축(계단) + HVAC(급수·오수 배관, 연결이 모두 BIM 포트). Level 1(0m) · Level 2(3.1m).
// 급수관 583072 는 1층의 수직관((4.16,-7.91), z -0.18 ~ 2.97)이고 양 끝이 티(포트 연결)다. 1층 변기 582918 이 같은 B 세대 급수 계통이다.
const ARCH = 'data/NBU_Duplex/NBU_Duplex-Apt_Arch.ifc'
const HVAC = 'data/NBU_Duplex/NBU_Duplex-Apt_Eng-HVAC.ifc'
const PIPE = 'Pipe Types:Cold Water:583072'
const viewer = <T,>(page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(([f, a]) => (window as any).__viewer[f as string](...(a as unknown[])), [fn, args] as const) as Promise<T>
const storeyBox = (page: Page) => page.getByRole('combobox', { name: '보일 층' })
const banner = (page: Page) => page.getByTestId('multi-banner')
const toFloor = (page: Page) => page.getByRole('group', { name: '다중층 보기 범위' }).getByRole('button', { name: '층 편집으로' }).click()
const search = (page: Page) => page.getByPlaceholder(/물리존·설비 이름/)
async function pick(page: Page, text: string, name: string) {
  await search(page).fill(text)
  await page.locator('.equipment tbody tr', { hasText: name }).last().getByRole('button', { name, exact: true }).click()
}

test('Duplex 건축+HVAC: 세 진입 경로 모두 같은 배관 그리기·연결 패널을 쓰고, 분기로 해제한 BIM 연결은 층 편집과 오가도 같고 되살아나지 않는다 [OE-ML-01#1,3,4,5,6]', async ({ page }) => {
  test.skip(!existsSync(ARCH) || !existsSync(HVAC), `${ARCH}·${HVAC} 이 없다(npm run fetch:sample)`)
  test.setTimeout(300_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles([ARCH, HVAC])
  await expect(page.locator('.appbar h2')).toContainText('+', { timeout: 180_000 })
  await storeyBox(page).selectOption({ label: 'Level 1만' })
  await page.getByRole('button', { name: '편집', exact: true }).click()

  // ① 층 고르는 칸 옆 버튼 → 지금 층과 위층.
  await page.getByRole('button', { name: '다중층 뷰에서 편집' }).click()
  await expect(banner(page)).toContainText('Level 1 ~ Level 2 (2개 층)')
  await pick(page, '583072', PIPE)
  const picked = page.locator('.picked')
  const active = picked.locator('table.neighbors:not(.released) tbody tr')
  const released = picked.getByTestId('released-connections').locator('tbody tr')
  // 별도 라이저 도구는 없다 — 도구 상자를 끄고, 고른 설비·구간의 패널이 배관 그리기다.
  await expect(page.getByRole('button', { name: '라이저', exact: true })).toHaveCount(0)
  await expect(page.getByTestId('branch-draw')).toBeVisible()
  // 층 편집과 같은 연결 패널: 해제 보정하고 취소한다.
  await expect(active).toHaveCount(2)
  await expect(picked.getByTestId('release-connection')).toHaveCount(2)
  await picked.getByTestId('release-connection').first().click()
  await picked.getByTestId('release-reason').fill('경로 1 확인')
  await picked.getByTestId('release-submit').click()
  await expect(active).toHaveCount(1)
  await expect(released).toHaveCount(1)
  await picked.getByTestId('release-cancel').click()
  await picked.getByTestId('release-reason').fill('경로 1 취소')
  await picked.getByTestId('release-submit').click()
  await expect(active).toHaveCount(2)
  await expect(released).toHaveCount(0)
  await toFloor(page)
  await expect(storeyBox(page).locator('option:checked')).toHaveText('Level 1만')

  // ② 계단 패널의 버튼 → 그 계단의 관통 층. 계단 조각 둘이 함께 칠해진다.
  const stair = (await viewer<string[]>(page, 'verticals'))[0]
  const at = await viewer<{ x: number; y: number }>(page, 'vertical', stair)
  await page.mouse.click(at.x, at.y)
  await page.getByTestId('vertical-picked').locator('.ceiling-lock').getByRole('button', { name: '다중층 뷰에서 편집' }).click()
  await expect(banner(page)).toContainText('Level 1 ~ Level 2 (2개 층)')
  expect(await viewer<string[]>(page, 'verticalSelected')).toHaveLength(2)
  // 같은 연결 패널이 있고, 같은 칸에서 수직관에 분기를 낸다: 1층 바닥 + 1m 에서 B 세대 1층 변기까지.
  await pick(page, '583072', PIPE)
  await expect(picked.getByTestId('release-connection')).toHaveCount(2)
  const branch = page.getByTestId('branch-draw')
  await branch.getByLabel('층간 배관 끝 층').selectOption({ label: 'Level 1' })
  const wc = branch.getByLabel('층간 배관 끝 대상').locator('option', { hasText: '582918' })
  await branch.getByLabel('층간 배관 끝 대상').selectOption(await wc.getAttribute('value'))
  await branch.getByLabel('층간 배관 Flow Type').selectOption('DCW')
  await branch.getByRole('button', { name: '분기 그리기' }).click()
  const bar = page.locator('.draw-bar')
  await bar.getByLabel('작업 층').selectOption({ label: 'Level 1' })
  await bar.getByLabel('층 바닥에서 높이(m)').fill('1')
  await bar.getByLabel('층 바닥에서 높이(m)').press('Tab')
  await bar.getByTestId('branch-at').click()
  await page.keyboard.press('Enter')
  await expect(page.locator('.key-note')).toContainText('DCW 분기를 그렸습니다')
  await expect(page.locator('.key-note')).toContainText('옛 BIM 포트 연결은 해제 보정으로 남김')
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT })

  // 해제한 연결은 목록에서 고른다: 수직관 패널의 "해제한 연결" 줄 → 그 티. 티 패널에도 같은 해제가 같은 사유로 보인다.
  await pick(page, '583072', PIPE)
  await expect(released).toHaveCount(1)
  const entry = (await released.first().locator('.name-cell').innerText()).trim()
  expect(entry).toContain('분기점 넣기')
  const tee = (await released.first().locator('.name-cell button.link').innerText()).trim()
  const log = () => page.getByTestId('release-log').textContent()
  const history = await log()
  expect(history).toContain('연결 해제 보정')
  const activeNow = await active.count()
  await released.first().locator('.name-cell button.link').click()
  await expect(picked.locator('h3')).toHaveText(tee)
  await expect(released).toHaveCount(1)
  await expect(released.first()).toContainText('분기점 넣기')

  // 층 편집으로 돌아가도, 다시 다중층 뷰로 와도 해제 줄·사유·시각·이력이 같고 연결이 되살아나지 않는다(화면 전환은 데이터를 바꾸지 않는다).
  const same = async () => {
    await pick(page, '583072', PIPE)
    await expect(released).toHaveCount(1)
    expect((await released.first().locator('.name-cell').innerText()).trim()).toBe(entry)
    await expect(active).toHaveCount(activeNow)
    await expect(active.filter({ hasText: tee })).toHaveCount(0)
    expect(await log()).toBe(history)
  }
  await toFloor(page)
  await same()
  await page.getByRole('button', { name: '다중층 뷰에서 편집' }).click()
  await expect(banner(page)).toContainText('(2개 층)')
  await same()
  await toFloor(page)
  await same()

  // ③ 층 편집에서 A 세대 1층 변기의 배관 그리기를 시작해 그리던 채로 다중층 뷰로 → 2층 변기까지 층간 배관을 잇는다.
  await pick(page, '582915', 'M_Water Closet - Flush Tank:Private - 6.1 Lpf:Private - 6.1 Lpf:582915')
  const draw = page.getByTestId('pipe-draw')
  await draw.getByLabel('배관 끝 대상').selectOption({ index: 1 })
  await draw.getByLabel('배관 Flow Type').selectOption('DCW')
  await draw.getByRole('button', { name: '꺾임점 찍기' }).click()
  await bar.getByRole('button', { name: '다중층 뷰에서 편집' }).click()
  await expect(banner(page)).toContainText('Level 1 ~ Level 2 (2개 층)')
  const riser = page.getByTestId('riser-draw')
  await riser.getByLabel('층간 배관 끝 층').selectOption({ label: 'Level 2' })
  const up = riser.getByLabel('층간 배관 끝 대상').locator('option', { hasText: '582925' })
  await riser.getByLabel('층간 배관 끝 대상').selectOption(await up.getAttribute('value'))
  await bar.getByLabel('작업 층').selectOption({ label: 'Level 2' })
  await bar.getByLabel('층 바닥에서 높이(m)').fill('0.3')
  await bar.getByLabel('층 바닥에서 높이(m)').press('Tab')
  await bar.getByTestId('riser-plumb').click()
  const over = await viewer<{ x: number; y: number }>(page, 'point', [4.77, -9.67, 3.4])
  await page.mouse.click(over.x, over.y)
  await page.keyboard.press('Enter')
  await expect(page.locator('.key-note')).toContainText('DCW 배관을 그렸습니다: 구간 3개')
  await expect(page.locator('.key-note')).toContainText('2개 층')
  // 같은 연결 패널(BIM 변기의 포트 연결에 해제 보정)과, 같은 배관 편집(그린 오프셋의 높이 바꾸기)을 쓴다.
  await pick(page, '582915', 'M_Water Closet - Flush Tank:Private - 6.1 Lpf:Private - 6.1 Lpf:582915')
  expect(await picked.getByTestId('release-connection').count()).toBeGreaterThan(0)
  await search(page).fill('DCW 배관')
  const drawn = page.locator('.equipment tbody tr', { hasText: /DCW 배관 \d+/ })
  let offset = false
  for (let i = 0; i < (await drawn.count()) && !offset; i++) {
    await drawn.nth(i).locator('button.link').first().click()
    offset = (await page.getByTestId('offset-height').count()) > 0 && (await page.getByTestId('offset-height').getByLabel('오프셋 층').locator('option:checked').innerText()) === 'Level 2'
  }
  expect(offset).toBe(true)
  const form = page.getByTestId('offset-height')
  await form.getByLabel('오프셋 높이(m)').fill('0.5')
  await form.getByLabel('오프셋 높이(m)').press('Tab')
  await form.getByRole('button', { name: '높이 바꾸기' }).click()
  await expect(page.locator('.key-note')).toContainText('높이를 올렸습니다(0.20m)')
  // 층 편집으로 돌아가도 분기로 해제한 연결은 그대로다.
  await toFloor(page)
  await same()
  expect(errors).toEqual([])
})
