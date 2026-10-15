import { test, expect } from '@playwright/test'

// 규칙 경고 W-01~03(OE-P3-01~04) · 시스템 로그·알림·배너(OE-COM-04, OE-WF-15·16, OE-GEN-05, OE-XPRD-01·02)
test('warnings: W-01 threshold and W-02 toggle change targets', async ({ page }) => {
  await page.goto('/')
  await page.locator('.floor-card').first().getByRole('button', { name: /→/ }).click()
  const w = page.getByTestId('warnings')
  await expect(w).toBeVisible()
  await expect(page.getByTestId('w01')).toContainText('0')
  await page.getByLabel('최소 면적(㎡)').fill('60')                 // 48~56㎡ 방이 걸린다
  const n = Number((await page.getByTestId('w01').locator('span').innerText()).trim())
  expect(n).toBeGreaterThan(0)
  await expect(page.getByTestId('w02').locator('span')).toHaveText(/\d+/)
  await page.getByLabel('W-02 켜기').uncheck()
  await expect(page.getByTestId('w02').locator('span')).toHaveText('0')
})

test('log: apply writes a committed log line, bell shows notice, other-user banner appears', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  await page.goto('/')
  await page.locator('.floor-card').first().getByRole('button', { name: /→/ }).click()
  await page.locator('.object-list button').first().click()
  await page.getByRole('textbox', { name: '선택 이름' }).fill('로그 시험실')
  await page.getByRole('button', { name: '속성 적용' }).click()
  await page.getByRole('button', { name: '임시 저장', exact: true }).click()
  await page.getByRole('button', { name: '반영하기' }).click()
  const dl = page.waitForEvent('download')
  await page.getByRole('button', { name: '데모 반영 & 내보내기' }).click(); await dl
  await expect(page.getByTestId('bell-count')).toHaveText('1')
  await page.getByTestId('bell').click()
  await expect(page.getByTestId('notif-pop')).toContainText('레이아웃 변경 반영')
  await page.getByTestId('nav-log').click()
  const log = page.getByTestId('log-page')
  await expect(log).toContainText('반영'); await expect(log).toContainText('확정 저장')
  await expect(log).toContainText('임시 저장'); await expect(log).toContainText('복구용 기록')
  // 다른 사용자 반영 시뮬레이션 → 에디터에 배너, [새로고침] 으로 사라진다
  await page.getByRole('button', { name: /레이아웃 에디터/ }).click()
  await expect(page.getByTestId('layout-banner')).toHaveCount(0)
  await page.getByTestId('sim-other-editor').click()
  await expect(page.getByTestId('layout-banner')).toContainText('바뀌었습니다')
  await page.screenshot({ path: '.local/proto-log.png', fullPage: true })
  await page.getByTestId('layout-banner').getByRole('button',{name:'새로고침'}).click()
  await expect(page.getByTestId('layout-banner')).toHaveCount(0)
  expect(errors).toEqual([])
})
