import { expect, test } from '@playwright/test'

// 흐름 경로(OE-ML-16). 고른 기기에서 확정한 방향만 따라 닿는 원천·말단을 경로와 함께 나열한다. mep.ifc: AHU-1 → DUCT-01 → AT-101-01·02(포트 방향).
test('원천이 여럿이면 모두 경로와 함께 보이고, 대체 경로는 갈래 수로, 순환은 따로 알린다 [OE-ML-16#3]', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('input[type=file]').first().setInputFiles('src/lib/ifc/fixtures/mep.ifc')
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '편집', exact: true }).click()
  const pickRow = (name: string) => page.locator('.equipment tbody tr', { hasText: name }).getByRole('button', { name, exact: true })
  const routes = page.getByTestId('trace-routes')
  const neighbor = (name: string) => page.locator('.picked .neighbors tr', { hasText: name })
  const connect = async (other: string) => {
    await page.locator('.picked').getByRole('button', { name: '연결하기', exact: true }).click()
    await pickRow(other).click()
    await expect(neighbor(other)).toContainText('직접 이음')
  }

  // 디퓨저 하나: 원천은 공조기 하나다(덕트 1개 경유). 기기를 고르면 흐름 지도가 먼저 답하고 경로 목록은 접혀 있다.
  await pickRow('AT-101-01').click()
  await expect(routes).not.toHaveAttribute('open')
  await routes.locator('summary').click()
  await expect(routes.locator('li[data-kind=source]')).toHaveCount(1)
  await expect(routes.locator('li[data-kind=source]')).toContainText('AHU-1 덕트·배관 1개')
  await expect(page.getByTestId('trace-cycle')).toHaveCount(0)

  // 옆 디퓨저에서도 받게 한다(AT-101-02 → AT-101-01). 원천이 둘이 되고, 공조기에는 두 갈래(덕트로 바로 · 옆 디퓨저를 거쳐)로 닿는다.
  await connect('AT-101-02')
  await neighbor('AT-101-02').getByTestId('flow-in').click()
  await page.getByTestId('flow-apply').click()
  await expect(routes.locator('li[data-kind=source]')).toHaveCount(2)
  await expect(routes.locator('li[data-kind=source]', { hasText: 'AT-101-02' })).toContainText('덕트·배관 0개')
  await expect(routes.locator('li[data-kind=source]', { hasText: 'AHU-1' })).toContainText('2갈래(대체 경로)')
  if (process.env.SHOT_ROUTES) await routes.screenshot({ path: `${process.env.SHOT_ROUTES}-sources.png` })

  // 디퓨저에서 공조기로 되돌아가는 방향을 하나 더하면 순환이다. 추적은 끝나고 순환을 알린다.
  await connect('AHU-1')
  await neighbor('AHU-1').getByTestId('flow-out').click()
  // 규칙 방향(공조기 → 디퓨저)과 반대라 사유를 적는다.
  await page.getByTestId('flow-reason').fill('시험: 환기 덕트로 되돌아감')
  await page.getByTestId('flow-apply').click()
  await expect(page.getByTestId('trace-cycle')).toContainText('순환이 있습니다')
  await expect(page.getByTestId('trace-cycle')).toContainText('AHU-1')
  await expect(page.getByTestId('trace-cycle')).toContainText('AT-101-01')
  // 고리 위의 기기는 원천·말단으로 정하지 않고 "순환 위" 로 경로와 함께 보인다.
  await expect(routes.locator('li[data-kind=looped]')).toHaveCount(2)
  await expect(routes.locator('li[data-kind=source]')).toHaveCount(0)
  if (process.env.SHOT_ROUTES) await routes.screenshot({ path: `${process.env.SHOT_ROUTES}-cycle.png` })
  // 경로의 기기를 누르면 그 기기를 고른다.
  await routes.getByRole('button', { name: 'AT-101-02' }).first().click()
  await expect(page.locator('.picked h3')).toHaveText('AT-101-02')
  expect(errors).toEqual([])
})
