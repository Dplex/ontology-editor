import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'

// 첫 화면의 data/ 목록에서 시작하는 흐름. e2e 서버는 목록을 붙이지 않는다(등급 측정이 서버를 1분씩 멈춰서, docs/dev/testing.md
// "e2e 는 5175 에 따로 뜬다"). 그래서 `/__data` 를 여기서 흉내 낸다 — 보려는 것은 칩 숫자가 아니라 목록 화면이 하는 일이다.
// 목록·등급·파일 바이트를 data-catalog.ts 와 같은 모양으로 준다.
const FIXTURES = 'src/lib/ifc/fixtures'
const ROOMS = readFileSync(`${FIXTURES}/two-rooms.ifc`)
const MEP = readFileSync(`${FIXTURES}/mep.ifc`)

type Row = { path: string; bytes: Buffer | string; profile: object }

const tiers = [{ key: 'space', label: '공간', have: 1, of: 1, level: 'full', figure: '1', note: '' }]
const base = { schema: 'IFC4', storeys: 1, spaces: 0, devices: 0, conduits: 0, systems: 0, connections: 0, tiers, needsArchitecture: false, needsEquipment: false }
const here = { extent: [2, 1, 12, 8], levels: [{ name: '1F', elevation: 0 }] }
// 짝 판정(profile.ts 의 partnerOf)은 단위 테스트가 본다. 여기서는 짝이 되도록 모양을 맞춰, 짝 링크가 하는 일만 본다.
const arch = { profile: { profile: { ...base, spaces: 3, needsEquipment: true, ...here } } }
const mech = { profile: { profile: { ...base, devices: 5, needsArchitecture: true, ...here } } }

async function serveData(page: Page, rows: Row[]) {
  await page.route('**/__data/**', async (route) => {
    const url = new URL(route.request().url())
    const path = decodeURIComponent(url.pathname.replace(/^\/__data\/?/, ''))
    if (!path) return route.fulfill({ json: rows.map((r) => ({ path: r.path, size: r.bytes.length })) })
    const row = rows.find((r) => r.path === path)
    if (!row) return route.fulfill({ status: 404 })
    if (url.search === '?profile') return route.fulfill({ json: row.profile })
    return route.fulfill({ body: typeof row.bytes === 'string' ? row.bytes : row.bytes, contentType: 'application/octet-stream' })
  })
}

const row = (page: Page, path: string) => page.locator('.data-list tr, tr').filter({ hasText: path }).last()

test('짝 링크를 누르면 건축·설비가 합쳐 열린다', async ({ page }) => {
  await serveData(page, [
    { path: '현장/two-rooms.ifc', bytes: ROOMS, ...arch },
    { path: '현장/mep.ifc', bytes: MEP, ...mech },
  ])
  await page.goto('/')
  const link = page.getByRole('button', { name: '짝 mep.ifc와 합쳐서 열기' })
  await expect(link).toBeVisible()
  await link.click()
  await expect(page.locator('.appbar h2')).toHaveText('two-rooms.ifc + mep.ifc', { timeout: 30_000 })
})

test('둘을 골라 [합쳐서 열기] 를 누르면 고른 순서와 상관없이 방이 있는 쪽이 기준이다', async ({ page }) => {
  await serveData(page, [
    { path: 'a/two-rooms.ifc', bytes: ROOMS, profile: { profile: { ...base, spaces: 3, needsEquipment: true } } },
    { path: 'b/mep.ifc', bytes: MEP, profile: { profile: { ...base, spaces: 1, devices: 5 } } },
  ])
  await page.goto('/')
  await row(page, 'b/mep.ifc').getByRole('checkbox').check()
  await row(page, 'a/two-rooms.ifc').getByRole('checkbox').check()
  await page.getByRole('button', { name: '고른 2개 합쳐서 열기' }).click()
  await expect(page.locator('.appbar h2')).toHaveText('two-rooms.ifc + mep.ifc', { timeout: 30_000 })
})

test('목록 아래쪽의 파일을 열어도 작업 화면은 맨 위(3D)부터 보인다', async ({ page }) => {
  // 목록 가운데서 [열기] 를 누르면 그 스크롤 자리 그대로 열려, 3D 가 화면 위로 밀려나고 요약·검사 표부터 보였다.
  const filler: Row[] = Array.from({ length: 30 }, (_, i) => ({ path: `샘플/${String(i).padStart(2, '0')}.ifc`, bytes: ROOMS, ...arch }))
  await serveData(page, [...filler, { path: '샘플/zz-mep.ifc', bytes: MEP, profile: { profile: { ...base, spaces: 1, devices: 5 } } }])
  await page.goto('/')
  const last = row(page, '샘플/zz-mep.ifc')
  await last.scrollIntoViewIfNeeded()
  expect(await page.evaluate(() => scrollY)).toBeGreaterThan(300)
  await last.getByRole('button', { name: '열기', exact: true }).click()
  await expect(page.locator('.appbar h2')).toHaveText('zz-mep.ifc', { timeout: 30_000 })
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0)
  await expect(page.locator('.viewport canvas')).toBeInViewport()
})

test('열 수 없는 파일은 이유를 보이고, 눌렀을 때 오류가 화면 안에 뜬다', async ({ page }) => {
  // 오류 문구는 목록 뒤에 뜬다. 목록 가운데서 누른 사람에게는 화면 밖이라 아무 일이 없는 것처럼 보였다.
  const why = 'STEP 구문 오류로 열 수 없습니다.'
  const filler: Row[] = Array.from({ length: 30 }, (_, i) => ({ path: `샘플/${String(i).padStart(2, '0')}.ifc`, bytes: ROOMS, ...arch }))
  await serveData(page, [{ path: '깨짐/broken.ifc', bytes: 'ISO-10303-21;\nHEADER;\n', profile: { error: why } }, ...filler])
  await page.goto('/')
  const broken = row(page, '깨짐/broken.ifc')
  await expect(broken.getByText('열 수 없음')).toHaveAttribute('title', why)
  // 오류는 목록 뒤에 뜨므로, 목록 위쪽에서 누르면 화면 밖이다.
  await broken.scrollIntoViewIfNeeded()
  await broken.getByRole('button', { name: '열기', exact: true }).click()
  const error = page.getByRole('alert').filter({ hasText: 'IFC를 읽지 못했습니다' })
  await expect(error).toBeVisible({ timeout: 30_000 })
  await expect(error).toBeInViewport()
})

test('등급 응답의 모양이 달라도 목록이 멈추지 않는다', async ({ page }) => {
  // `{ profile }` 로 감싸지 않은 응답(옛 서버 등)에 목록 렌더가 멈춰, 그 뒤 오류 문구를 보이는 스크롤까지 꼬였다.
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await serveData(page, [{ path: '옛/two-rooms.ifc', bytes: ROOMS, profile: { ...base, spaces: 3 } }])
  await page.goto('/')
  const r = row(page, '옛/two-rooms.ifc')
  await r.getByRole('button', { name: '열기', exact: true }).click()
  await expect(page.locator('.appbar h2')).toHaveText('two-rooms.ifc', { timeout: 30_000 })
  expect(errors).toEqual([])
})
