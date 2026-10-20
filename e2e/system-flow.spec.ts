import { expect, test, type Page } from '@playwright/test'
import { systemChips } from './edit-part'

// 범례에서 고른 계통의 흐름을 3D 에서 달리는 빛으로 보인다(flow-pulse.ts). 방향은 화살표와 같은 차례(포트 → 사람 → 규칙)로 읽고,
// 규칙 방향은 R 로 끄면 빠진다. 방향을 모르는 연결은 그리지 않는다. mep.ifc 의 AHU-1 급기 계통은 포트 방향 2개와 규칙 방향 1개다.
const flow = (page: Page) => page.evaluate(() => (window as any).__viewer.flow()) as Promise<number>

test('계통을 고르면 방향 있는 연결에 흐르는 빛을 깔고, 규칙을 끄거나 선택을 풀면 걷는다', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles('src/lib/ifc/fixtures/mep.ifc')
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  expect(await flow(page)).toBe(0)

  const button = (await systemChips(page)).locator('button', { hasText: 'AHU-1 급기 계통' })
  await button.click()
  await expect.poll(() => flow(page)).toBe(3)
  // 패널은 빛이 방향을 아는 연결에만 있다고 말한다.
  await expect(page.getByTestId('system-flow-note')).toContainText('방향을 아는 연결 3개에만')

  // 규칙 방향을 끄면(R) 규칙으로만 방향을 아는 연결은 빛도 없다. 포트 방향은 남는다.
  await page.locator('.canvas-wrap > canvas').hover()
  await page.keyboard.press('r')
  await expect.poll(() => flow(page)).toBe(2)
  await expect(page.getByTestId('system-flow-note')).toContainText('R 로 켜면')
  await page.keyboard.press('r')
  await expect.poll(() => flow(page)).toBe(3)

  await button.click()
  await expect.poll(() => flow(page)).toBe(0)
  expect(errors).toEqual([])
})
