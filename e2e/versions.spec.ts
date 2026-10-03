import { readFileSync } from 'node:fs'
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
  await expect(sum.locator('tr', { hasText: '물리존' })).toContainText('이름으로 1개')
  await expect(sum.locator('tr', { hasText: '설비' })).toContainText('6 → 6')
  // 진행 표시가 남지 않는다(열기와 같은 워커·진행 표시를 쓴다).
  await expect(page.locator('.progress-toast')).toHaveCount(0)

  // 비교하면 R13 이 실측이 된다. GUID 가 남은 4개 · 다른 열쇠로 찾은 2개 / 6개. 요청은 GUID 를 저장하는 내보내기 설정이다.
  await expect(r13).toContainText('4 · 2 / 6')
  await expect(r13).toContainText('내보내기 설정을 바꿔 달라 — IFC GUID를 요소 매개변수에 저장')

  // R13 판정 근거: GUID 유지율과, GUID 가 바뀐 것(지금 이름 · 무엇으로 찾았나 · 이전 GUID). 비교하면 이 목록이 먼저 열린다.
  await expect(sum.locator('tr', { hasText: '설비' })).toContainText('80%')
  await expect(sum.locator('tr', { hasText: '물리존' })).toContainText('0%')
  const rekeyedTab = page.getByRole('tab', { name: /GUID가 바뀐 것/ })
  await expect(rekeyedTab).toHaveAttribute('aria-selected', 'true')
  await expect(rekeyedTab).toContainText('2')
  await expect(page.locator('.version-rows tr', { hasText: 'AHU-1' })).toContainText('이름으로 찾음 · 이전 GUID')

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

// OE-BIM-11 교차 확인. millimetre.ifc 의 `.MILLI.` 를 `$` 로 바꾼 바이트 = 밀리미터 값을 미터로 선언한 판본(2F 가 3000m).
// 파일 하나로는 R6 이 표준이지만, 이전 판본과 같은 이름 층의 높이를 견주면 1000배라 단위 선언이 틀린 것을 안다.
test('이전 판본과 층 높이가 단위 배수로 다르면 경고하고 R6 을 일부로 내린다', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  const wrong = readFileSync('src/lib/ifc/fixtures/millimetre.ifc', 'latin1').replace('IFCSIUNIT(*,.LENGTHUNIT.,.MILLI.,.METRE.)', 'IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.)')
  await page.goto('/')
  await page.locator('input[type=file]').first().setInputFiles({ name: 'wrong-unit.ifc', mimeType: 'application/octet-stream', buffer: Buffer.from(wrong, 'latin1') })
  await expect(page.getByRole('heading', { name: 'wrong-unit.ifc' })).toBeVisible({ timeout: 30_000 })

  await page.getByRole('button', { name: /^요구사항/ }).click()
  const r6 = page.locator('.req-table tr', { hasText: 'R6' })
  await expect(r6).toContainText('길이 단위가 선언되어 있습니다')

  await page.getByRole('button', { name: /판본 비교/ }).click()
  await page.locator('.versions input[type=file]').setInputFiles('src/lib/ifc/fixtures/two-rooms.ifc')
  await expect(page.locator('.versions .edit-notice')).toContainText('이름이 같은 층의 높이가 이전 판본의 1000배입니다(2F 3m → 3000m). 층간 높이로 보면 지금 파일의 길이 단위 선언이')
  await expect(r6).toContainText('이전 판본(two-rooms.ifc)과 같은 이름 층의 높이가 1000배로 다릅니다')
  await expect(r6).toContainText('길이 단위 선언을 좌표·높이에 실제로 쓴 단위에 맞춰 달라')

  // 틀린 쪽은 지금 파일이다. 단위를 제대로 선언한 밀리미터 판본과 견줘도 같은 1000배가 나온다(선언 단위가 아니라 값으로 잰다).
  await page.locator('.versions input[type=file]').setInputFiles('src/lib/ifc/fixtures/millimetre.ifc')
  await expect(page.locator('.versions')).toContainText('이전 판본: millimetre.ifc')
  await expect(page.locator('.versions .edit-notice')).toContainText('이전 판본의 1000배입니다(2F 3m → 3000m)')
  await expect(r6).toContainText('이전 판본(millimetre.ifc)')
  expect(errors).toEqual([])
})
