import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { createDataCatalog } from '../src/server/data-catalog'

// [구축하기]·[반영하기]·버전 히스토리·되돌리기(OE-WF-10~13·18·19, OE-GEN-05, ADR-0037). e2e 서버는 data/ 목록을 붙이지 않아서 목록·IFC 는
// 흉내 내고, 반영·사람·로그 요청(/__data/__layouts·__users·__log·__edits)은 진짜 src/server/data-catalog.ts 를 임시 폴더에 띄워 넘긴다 — 화면이 올린
// 파일이 서버에 그대로 남는지, 역할 검사가 서버에서도 걸리는지까지 본다.
const MEP = readFileSync('src/lib/ifc/fixtures/mep.ifc')
const PATH = '현장/mep.ifc'
const profile = { profile: { schema: 'IFC4', storeys: 1, spaces: 1, devices: 5, conduits: 0, systems: 0, connections: 0, tiers: [], needsArchitecture: false, needsEquipment: false } }

let root: string
let server: Server
let base: string
test.beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'publish-e2e-'))
  mkdirSync(join(root, '현장'))
  writeFileSync(join(root, PATH), MEP)
  const catalog = createDataCatalog(root)
  server = createServer((req, res) => catalog(req, res))
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const addr = server.address()
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`
})
// 시험마다 반영 버전·로그를 비운다 — 한 작업자에서 시험이 이어 돌면 앞 시험의 v1~v3 이 남는다.
test.beforeEach(() => {
  rmSync(join(root, '.layouts'), { recursive: true, force: true })
  rmSync(join(root, '.log.jsonl'), { force: true })
})
test.afterAll(() => {
  server.close()
  rmSync(root, { recursive: true, force: true })
})

async function serve(page: Page) {
  await page.route('**/__data/**', async (route) => {
    const url = new URL(route.request().url())
    const path = decodeURIComponent(url.pathname.replace(/^\/__data\/?/, ''))
    if (path.startsWith('__')) return route.fulfill({ response: await route.fetch({ url: `${base}/${path}?${url.searchParams}` }) })
    if (!path) return route.fulfill({ json: [{ path: PATH, size: MEP.length }] })
    if (path !== PATH) return route.fulfill({ status: 404 })
    if (url.search === '?profile') return route.fulfill({ json: profile })
    return route.fulfill({ body: MEP, contentType: 'application/octet-stream' })
  })
}
const light = (page: Page) => page.locator('.equipment tbody tr', { hasText: 'LIGHT-101-01' }).last().locator('.coord').first()
async function editLight(page: Page, x: string) {
  const on = page.getByRole('group', { name: '설비 편집 면' }).getByRole('button', { name: '천장' })
  if ((await on.getAttribute('aria-pressed')) !== 'true') {
    await page.locator('body').click({ position: { x: 5, y: 5 } })
    await page.keyboard.press('t')
  }
  await light(page).fill(x)
  await light(page).press('Enter')
}
const fromServer = async (q: Record<string, string>) => (await fetch(`${base}/__layouts?${new URLSearchParams({ key: PATH, ...q })}`)).text()

test('구축하기는 서버에 v1 을 만들고, 반영하기는 v2, 되돌리기는 v1 을 v3 으로 다시 반영한다. 버전마다 반영자·대상 층·파일이 남는다 [OE-GEN-05#1] [OE-WF-10#2] [OE-WF-11#1~] [OE-WF-13#1~] [OE-WF-18#1] [OE-WF-19#1] [OE-GEN-09#1]', async ({ page }) => {
  test.setTimeout(120_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await serve(page)
  await page.goto('/')
  await page.locator('.catalog tr').filter({ hasText: PATH }).last().getByRole('button', { name: '열기', exact: true }).click()
  await expect(page.locator('.appbar h2')).toHaveText('mep.ifc', { timeout: 30_000 })
  // 사람을 고른다(data/.users.json 의 기본 목록).
  await page.getByLabel('사용자').selectOption('편집자')
  await page.getByRole('button', { name: '편집', exact: true }).click()
  const bar = page.locator('.edit-bar')
  // 아직 반영한 버전이 없어 [구축하기] 다.
  await expect(bar.getByRole('button', { name: '구축하기' })).toBeVisible()
  await editLight(page, '7.5')

  // 확인 창: [취소] 하면 아무것도 반영하지 않는다.
  await bar.getByRole('button', { name: '구축하기' }).click()
  const dialog = page.locator('dialog.publish-dialog')
  await dialog.getByRole('button', { name: '취소' }).click()
  await expect(dialog).not.toBeVisible()
  expect(JSON.parse(await fromServer({}))).toEqual({ current: null, versions: [] })
  // 다시 열어 대상 층·바뀐 것·반영자.
  await bar.getByRole('button', { name: '구축하기' }).click()
  await expect(dialog.getByRole('heading')).toHaveText('구축하기 — v1')
  await expect(dialog.getByTestId('publish-summary')).toContainText('대상 층: 1F')
  await expect(dialog.getByTestId('publish-summary')).toContainText('편집 1건')
  await expect(dialog.getByTestId('publisher')).toHaveText('반영자 편집자')
  if (process.env.SHOT_DIALOG) await page.screenshot({ path: process.env.SHOT_DIALOG })
  await dialog.getByRole('button', { name: '구축하기' }).click()
  await expect(page.locator('.key-note')).toContainText('v1 으로 구축했습니다(1F)', { timeout: 30_000 })
  await expect(dialog).not.toBeVisible()
  // 이제 [반영하기] 다.
  await expect(bar.getByRole('button', { name: '반영하기' })).toBeVisible()
  const meta = JSON.parse(await fromServer({}))
  expect(meta.current).toBe(1)
  expect(meta.versions[0]).toMatchObject({ version: 1, by: '편집자', floors: ['1F'], kind: 'publish', summary: { edits: 1 } })
  expect(meta.versions[0].files).toEqual(expect.arrayContaining(['ontology.ttl', 'edits.json', 'tree.json', 'report.json', 'model.glb']))
  expect(meta.versions[0].files.some((f: string) => f.startsWith('geojson/'))).toBe(true)
  const v1ttl = await fromServer({ v: '1', file: 'ontology.ttl' })
  expect(v1ttl).toContain('brick:')
  expect(JSON.parse(await fromServer({ v: '1', file: 'edits.json' })).equipment).toHaveLength(1)
  // 버전에서 리포트를 연다(OE-GEN-09).
  await expect(page.getByTestId('versions').getByRole('link', { name: 'report.json' })).toHaveCount(1)
  expect(JSON.parse(await fromServer({ v: '1', file: 'report.json' }))).toMatchObject({ edits: 1 })

  // 다시 고치고 반영하면 v2.
  await editLight(page, '8')
  await bar.getByRole('button', { name: '반영하기' }).click()
  await expect(dialog.getByRole('heading')).toHaveText('반영하기 — v2')
  await dialog.getByRole('button', { name: '반영하기' }).click()
  await expect(page.locator('.key-note')).toContainText('v2 으로 반영했습니다', { timeout: 30_000 })

  // 버전 히스토리: 지금은 v2. v1 을 되돌리면 v3 이 되고 v1 의 파일과 같다.
  const versions = page.getByTestId('versions')
  await expect(versions.locator('tbody tr')).toHaveCount(2)
  await expect(versions.locator('tr.current')).toContainText('v2')
  const v1row = versions.locator('tbody tr', { hasText: 'v1' })
  await v1row.getByRole('button', { name: '되돌리기' }).click()
  await v1row.getByRole('button', { name: 'v1 다시 반영' }).click()
  await expect(page.locator('.key-note')).toContainText('v1 의 레이아웃을 v3 으로 다시 반영했습니다')
  await expect(versions.locator('tr.current')).toContainText('v1 되돌리기')
  expect(await fromServer({ v: '3', file: 'ontology.ttl' })).toBe(v1ttl)
  if (process.env.SHOT) {
    await versions.scrollIntoViewIfNeeded()
    await page.screenshot({ path: process.env.SHOT })
  }
  // 시스템 로그: 편집 시작·반영 둘·되돌리기가 그 사람으로 남는다.
  await page.getByTestId('activity').locator('summary').click()
  await expect(page.getByTestId('activity')).toContainText('레이아웃 되돌리기 v3 · 편집자')
  const log = JSON.parse(await (await fetch(`${base}/__log?key=${encodeURIComponent(PATH)}`)).text()) as { type: string; user: string }[]
  expect(log.map((e) => e.type)).toEqual(['rollback', 'publish', 'publish', 'edit-start'])
  expect(errors).toEqual([])
})

test('보기 전용(Viewer)은 편집에 들어가지 못하고, 서버도 저장·반영을 받지 않는다 [OE-COM-01#2]', async ({ page }) => {
  await serve(page)
  await page.goto('/')
  await page.locator('.catalog tr').filter({ hasText: PATH }).last().getByRole('button', { name: '열기', exact: true }).click()
  await expect(page.locator('.appbar h2')).toHaveText('mep.ifc', { timeout: 30_000 })
  await page.getByLabel('사용자').selectOption('보기 전용')
  const edit = page.getByRole('group', { name: '화면 모드' }).getByRole('button', { name: '편집' })
  await expect(edit).toBeDisabled()
  await expect(edit).toHaveAttribute('title', '보기 전용은(는) 보기 전용(Viewer)이라 편집에 들어가지 않습니다')
  if (process.env.SHOT_VIEWER) await page.locator('.appbar').screenshot({ path: process.env.SHOT_VIEWER })
  // E 키로도 들어가지 않는다.
  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('e')
  await expect(page.locator('.edit-bar')).toHaveCount(0)
  // 화면을 거치지 않고 보내도 서버가 막는다.
  const r = await fetch(`${base}/__layouts?${new URLSearchParams({ key: PATH, rollback: '1' })}`, { method: 'POST', headers: { 'X-OE-User': encodeURIComponent('보기 전용') }, body: '{}' })
  expect(r.status).toBe(403)
})

test('다른 사람이 반영해도 화면은 그대로이고 배너가 뜨며, [새로고침] 하면 새 레이아웃이 얹히고 배너가 사라진다. 알림에 반영이 쌓인다 [OE-WF-14#1] [OE-WF-15#1] [OE-WF-16#1~] [OE-WF-17#1~]', async ({ page, browser }) => {
  test.setTimeout(120_000)
  const open = async (p: Page, who: string) => {
    await serve(p)
    await p.goto('/')
    await p.locator('.catalog tr').filter({ hasText: PATH }).last().getByRole('button', { name: '열기', exact: true }).click()
    await expect(p.locator('.appbar h2')).toHaveText('mep.ifc', { timeout: 30_000 })
    await p.getByLabel('사용자').selectOption(who)
    await p.getByRole('button', { name: '편집', exact: true }).click()
  }
  // B 가 먼저 열어 둔다(아직 반영한 버전이 없다).
  const other = await browser.newPage()
  await open(other, '관리자')
  const before = await light(other).inputValue()
  expect(before).not.toBe('7.5')
  // A 가 고쳐서 구축(v1).
  await open(page, '편집자')
  await editLight(page, '7.5')
  await page.locator('.edit-bar').getByRole('button', { name: '구축하기' }).click()
  await page.locator('dialog.publish-dialog').getByRole('button', { name: '구축하기' }).click()
  await expect(page.locator('.key-note')).toContainText('v1 으로 구축했습니다', { timeout: 30_000 })
  // 반영한 사람에게는 배너가 없다.
  await expect(page.getByTestId('layout-banner')).toHaveCount(0)

  // B: 창으로 돌아오면(또는 30초마다) 서버를 보고 배너를 띄운다. 화면은 그대로다.
  await other.evaluate(() => window.dispatchEvent(new Event('focus')))
  const banner = other.getByTestId('layout-banner')
  await expect(banner).toContainText('새 레이아웃이 적용되었습니다(v1 · 편집자 · 1F). 새로고침하면 반영됩니다.')
  await expect(light(other)).toHaveValue(before)
  await expect(other.getByTestId('notice-count')).toHaveText('1')
  if (process.env.SHOT_BANNER) await other.locator('.appbar').screenshot({ path: process.env.SHOT_BANNER })
  await other.getByRole('button', { name: '알림' }).click()
  await expect(other.getByTestId('notice-list')).toContainText('레이아웃 변경 반영 · v1 · 1F · 편집자')
  if (process.env.SHOT_NOTICE) await other.locator('.appbar').screenshot({ path: process.env.SHOT_NOTICE })
  await other.getByRole('button', { name: '알림' }).click()
  // [새로고침]: 다시 열어 v1 을 얹는다.
  await banner.getByRole('button', { name: '새로고침' }).click()
  await expect(banner).toHaveCount(0, { timeout: 30_000 })
  await expect(light(other)).toHaveValue('7.5')
  await expect(other.getByTestId('notice-count')).toHaveCount(0)
  await other.close()
})
