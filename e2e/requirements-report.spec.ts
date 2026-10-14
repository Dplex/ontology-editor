import { expect, test } from '@playwright/test'

// 요구사항 보고서(OE-BIM-17). R 마다 충족 / 검사 · 대상이 보이고, 해당 없음·잴 수 없음은 미충족(없음·일부)과 따로 센다. R25(설비 태그)가 권장에 한 줄로 있다.
test('요구사항 칸이 해당 없음·잴 수 없음을 미충족과 따로 세고, R25 설비 태그 줄에 고객사 요청이 붙는다 [OE-BIM-17#1] [OE-REQ-05#1] [OE-REQ-05#2]', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('input[type=file]').first().setInputFiles('src/lib/ifc/fixtures/mep.ifc')
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  const fold = page.getByRole('button', { name: /^요구사항/ })
  // 설비 픽스처라 문·창(R4)이 해당 없음이고, 파일 하나로는 R12·R13 을 잴 수 없다. 둘 다 "없음·일부" 에 섞이지 않는다.
  await expect(fold).toContainText('필수 11개: 표준 6 · 없음·일부 2 · 해당 없음 1 · 측정 불가 2')
  await fold.click()
  await expect(page.locator('.req-table thead')).toContainText('충족 / 검사 · 대상')
  const r25 = page.locator('.req-table tr', { hasText: 'R25' })
  await expect(r25).toContainText('설비 태그(BAS 매핑 키)')
  await expect(r25).toContainText('없음')
  await expect(r25).toContainText('0 / 5')
  await expect(r25.locator('.req-ask')).toHaveText('설비 태그에 BAS 식별자를 넣어 달라(Mark, 설비마다 다른 값)')
  expect(errors).toEqual([])
})
