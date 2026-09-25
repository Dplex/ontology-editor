import { expect, test } from '@playwright/test'

// 판본 비교(PRD #6, 요구사항 R13). mep-v2.ifc 는 mep.ifc 를 다시 내보낸 판본이다 — 사무실·공조기 GUID 가 바뀌고,
// 토출구 하나가 2m 옮겨지고, 센서가 빠지고, 토출구 하나가 더해졌다.
test('이전 판본을 열면 바뀐 것을 보이고, R13 을 잰다', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('input[type=file]').first().setInputFiles('src/lib/ifc/fixtures/mep-v2.ifc')
  await expect(page.getByRole('heading', { name: 'mep-v2.ifc' })).toBeVisible({ timeout: 30_000 })

  // 비교 전에는 R13 을 잴 수 없다.
  await page.getByRole('button', { name: /^요구사항/ }).click()
  const r13 = page.locator('.req-table tr', { hasText: 'R13' })
  await expect(r13).toContainText('잴 수 없음')

  await page.getByRole('button', { name: /판본 비교/ }).click()
  await page.locator('.versions input[type=file]').setInputFiles('src/lib/ifc/fixtures/mep.ifc')
  const sum = page.locator('.version-sum')
  await expect(sum.locator('tr', { hasText: '물리존' })).toContainText('이름 1')
  await expect(sum.locator('tr', { hasText: '설비' })).toContainText('6 → 6')
  // 진행 표시가 남지 않는다(열기와 같은 워커·진행 표시를 쓴다).
  await expect(page.locator('.progress-toast')).toHaveCount(0)

  // 비교하면 R13 이 실측이 된다. GUID 가 남은 4개 · 다른 열쇠로 찾은 2개 / 6개.
  await expect(r13).toContainText('4 · 2 / 6')

  // 목록에서 고르면 3D 와 오른쪽 패널에 뜬다.
  await page.getByRole('tab', { name: /옮겨진 설비/ }).click()
  const moved = page.locator('.version-rows tr', { hasText: 'AT-101-02' })
  await expect(moved).toContainText('2.00 m')
  await moved.getByRole('button').click()
  await expect(page.locator('.picked h3')).toHaveText('AT-101-02')

  await page.getByRole('tab', { name: /없어진 설비/ }).click()
  await expect(page.locator('.version-rows')).toContainText('TEMP-101-01')
  await page.getByRole('tab', { name: /새 설비/ }).click()
  await expect(page.locator('.version-rows')).toContainText('AT-101-03')
  expect(errors).toEqual([])
})
