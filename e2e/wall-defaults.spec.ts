import { expect, test, type Page } from '@playwright/test'

// 새 벽 두께(OE-SPC-12)와 문·창 스냅 거리(OE-SPC-13). [벽·문·창] 을 켜면 개요 패널에 설정이 뜬다. mep.ifc 에는 벽이 없어서 새 벽
// 두께는 사이트 기본값 → 0.2m 다. 그은 벽(두께를 아는 BIM 벽이 아니다)은 세지 않으므로 둘째 벽도 같은 두께다.
const MEP = 'src/lib/ifc/fixtures/mep.ifc'

async function clickFloor(page: Page, x: number, y: number) {
  // 설정 칸을 채우면 페이지가 그쪽으로 스크롤된다. 3D 가 화면 밖에 걸친 채 좌표를 재면 바닥이 아닌 곳을 누른다.
  await page.locator('.viewport canvas').scrollIntoViewIfNeeded()
  const at = (await page.evaluate(([px, py]) => (window as any).__viewer.point([px, py, 0]), [x, y])) as { x: number; y: number }
  await page.mouse.click(at.x, at.y)
}

test('사이트 기본 두께로 새 벽을 긋고, 스냅 거리를 줄이면 벽에서 먼 문은 "벽 가까이 놓아 주세요" 로 막힌다', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(MEP)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '편집', exact: true }).click()
  await page.locator('.viewport canvas').scrollIntoViewIfNeeded()
  await page.waitForTimeout(200)

  const settings = page.getByTestId('element-settings')
  await expect(settings).toHaveCount(0)
  await page.getByRole('button', { name: '벽·문·창' }).click()
  await expect(settings).toBeVisible()
  await expect(settings.getByTestId('wall-thickness-here')).toContainText('0.2m(기본값)')
  await settings.getByTestId('site-wall-thickness').fill('0.15')
  await settings.getByTestId('site-wall-thickness').press('Enter')
  await expect(settings.getByTestId('wall-thickness-here')).toContainText('0.15m(사이트 기본값)')

  await page.getByRole('button', { name: '벽 긋기' }).click()
  // 사무실(0..10 × 0..8) 안의 칸막이. 건물 가장자리에 그으면 외벽으로 판정돼 잠긴다(OE-EXT-02).
  await clickFloor(page, 5, 1)
  await clickFloor(page, 5, 7)
  const panel = page.locator('.element-picked')
  await expect(panel.locator('h3')).toHaveText('새 벽')
  await expect(panel.getByTestId('wall-thickness')).toHaveValue('0.15')
  await expect(page.locator('.key-note')).toContainText('두께 0.15m(사이트 기본값)')

  // 스냅 거리 0.2m: 벽 중심에서 0.5m(면에서 0.425m) 떨어진 자리(4.5, 4)는 막히고, 0.6m 로 되돌리면 붙는다.
  await page.keyboard.press('Escape')
  await settings.getByTestId('opening-snap').fill('0.2')
  await settings.getByTestId('opening-snap').press('Enter')
  await page.getByRole('button', { name: '문 놓기' }).click()
  await clickFloor(page, 4.5, 4)
  await expect(page.locator('.key-note')).toContainText('벽 가까이 놓아 주세요(벽에서 0.2m 안에만 놓습니다)')
  await page.keyboard.press('Escape')
  await settings.getByTestId('opening-snap').fill('0.6')
  await settings.getByTestId('opening-snap').press('Enter')
  await page.getByRole('button', { name: '문 놓기' }).click()
  await clickFloor(page, 4.5, 4)
  await expect(panel.locator('h3')).toHaveText('새 문')

  // 설정은 이 브라우저에 남는다.
  await page.reload()
  await page.locator('.drop input[type=file]').setInputFiles(MEP)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '편집', exact: true }).click()
  await page.getByRole('button', { name: '벽·문·창' }).click()
  await expect(settings.getByTestId('site-wall-thickness')).toHaveValue('0.15')
  expect(errors).toEqual([])
})
