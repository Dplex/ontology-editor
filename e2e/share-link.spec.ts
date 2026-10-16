import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'

// 위치 표시 옆 [링크 복사]가 만드는 주소(`?open=…&storey=…&select=…`)로 열면 같은 파일·층·고른 것이 열린다(editor/share-link.ts).
// e2e 서버는 data/ 목록을 붙이지 않아서(testing.md) `/__data` 를 data-list.spec.ts 처럼 흉내 낸다.
const MEP = readFileSync('src/lib/ifc/fixtures/mep.ifc')
const AHU = '0MEP$Equip$AHU1$0000'

async function serveData(page: Page) {
  await page.route('**/__data/**', async (route) => {
    const url = new URL(route.request().url())
    const path = decodeURIComponent(url.pathname.replace(/^\/__data\/?/, ''))
    if (path === '현장/mep.ifc' && !url.search) return route.fulfill({ body: MEP, contentType: 'application/octet-stream' })
    // 목록·저장본·프로젝트 같은 나머지는 비어 있다.
    return route.fulfill({ status: path ? 404 : 200, json: path ? {} : [] })
  })
}

test('data/ 에서 연 파일은 [링크 복사] 로 파일·고른 설비를 담은 주소가 나오고, 그 주소로 열면 그 설비가 골라진다', async ({ page, context }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await serveData(page)
  await page.goto(`/?open=${encodeURIComponent('현장/mep.ifc')}`)
  await expect(page.locator('.appbar h2')).toHaveText('mep.ifc', { timeout: 30_000 })

  // 고른 것이 없으면 파일만 담는다.
  const button = page.getByTestId('share-link')
  await expect(button).toBeVisible()
  await expect(button).toHaveAttribute('title', /이 파일을 여는 링크/)

  const at = await page.evaluate((id) => (window as any).__viewer.part(id), AHU)
  await page.mouse.click(at.x, at.y)
  await expect(button).toHaveAttribute('title', /선택 항목/)
  // localhost 는 안전한 주소라 Clipboard API 로 들어간다. 55(http)에서는 다른 길(execCommand)로 들어간다.
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await button.click()
  await expect(page.locator('.key-note')).toContainText('선택 항목까지 여는 링크를 복사했습니다')
  const url = new URL(await page.evaluate(() => navigator.clipboard.readText()))
  expect(url.searchParams.get('open')).toBe('현장/mep.ifc')
  expect(url.searchParams.get('select')).toBe(AHU)

  // 새 탭에서 그 주소로 연다.
  const other = await context.newPage()
  other.on('pageerror', (e) => errors.push(e.message))
  await serveData(other)
  await other.goto(url.pathname + url.search)
  await expect(other.locator('.appbar h2')).toHaveText('mep.ifc', { timeout: 30_000 })
  await expect(other.locator('.picked h3').first()).toContainText('AHU-1')
  expect(errors).toEqual([])
})

test('손으로 고른 파일은 주소로 다시 열 수 없어 [링크 복사] 가 없고, 없는 id 를 담은 링크는 그렇다고 알린다', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('input[type=file]').first().setInputFiles('src/lib/ifc/fixtures/mep.ifc')
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByTestId('share-link')).toHaveCount(0)

  await serveData(page)
  await page.goto(`/?open=${encodeURIComponent('현장/mep.ifc')}&select=NO-SUCH-ID`)
  await expect(page.locator('.appbar h2')).toHaveText('mep.ifc', { timeout: 30_000 })
  await expect(page.locator('.key-note')).toContainText('링크의 NO-SUCH-ID 가 이 파일에 없습니다')
  expect(errors).toEqual([])
})

test('Clipboard API 가 없는 주소(55 의 http)에서도 링크와 GlobalId 가 복사된다', async ({ page, context }) => {
  // 55 처럼 isSecureContext 가 거짓인 곳을 흉내 낸다. 그런 곳에는 navigator.clipboard 가 없다.
  await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true }))
  await serveData(page)
  await page.goto(`/?open=${encodeURIComponent('현장/mep.ifc')}&select=${encodeURIComponent(AHU)}`)
  await expect(page.locator('.picked h3').first()).toContainText('AHU-1', { timeout: 30_000 })
  await page.getByTestId('share-link').click()
  await expect(page.locator('.key-note')).toContainText('선택 항목까지 여는 링크를 복사했습니다')
  // 복사된 것은 Clipboard API 가 있는 다른 탭에서 읽는다.
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const reader = await context.newPage()
  await reader.goto('/')
  expect(await reader.evaluate(() => navigator.clipboard.readText())).toContain(`select=${encodeURIComponent(AHU)}`)
  // 우클릭 메뉴의 GlobalId 복사도 같은 길이다(전에는 http 에서 늘 "복사하지 못했습니다" 였다).
  const at = await page.evaluate((id) => (window as any).__viewer.part(id), AHU)
  await page.mouse.click(at.x, at.y, { button: 'right' })
  await page.locator('.ctx-menu').getByRole('menuitem', { name: /GlobalId/ }).or(page.locator('.ctx-menu button', { hasText: 'GlobalId' })).first().click()
  await expect(page.locator('.key-note')).toContainText('GlobalId 1개를 복사했습니다')
  expect(await reader.evaluate(() => navigator.clipboard.readText())).toBe(AHU)
})
