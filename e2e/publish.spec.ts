import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { createDataCatalog } from '../src/server/data-catalog'

// [구축하기]·[반영하기]·버전 히스토리·되돌리기(OE-WF-10~13·18·19, OE-GEN-05, src/server/layouts.ts). e2e 서버는 data/ 목록을 붙이지 않아서 목록·IFC 는
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
  rmSync(join(root, '.drafts'), { recursive: true, force: true })
  rmSync(join(root, '.locks'), { recursive: true, force: true })
})
test.afterAll(() => {
  server.close()
  rmSync(root, { recursive: true, force: true })
})

/** mep.ifc 는 기기 5대 중 소속 4대(80%)라 수용 기준선(게이트 누적 등급 0~3, 등급 2 ≥ 85%) 미달이다. 반영을 재는 시험은 통과선을 낮춰 둔다(화면의 설정과 같은 자리). */
async function serve(page: Page, gate = false, ifc: Buffer = MEP) {
  if (!gate) await page.addInitScript(() => localStorage.setItem('oe.gradeLines', JSON.stringify({ 0: 0.85, 1: 0.5, 2: 0.5, 3: 0, 4: 0.5 })))
  await page.route('**/__data/**', async (route) => {
    const url = new URL(route.request().url())
    const path = decodeURIComponent(url.pathname.replace(/^\/__data\/?/, ''))
    if (path.startsWith('__')) return route.fulfill({ response: await route.fetch({ url: `${base}/${path}?${url.searchParams}` }) })
    if (!path) return route.fulfill({ json: [{ path: PATH, size: MEP.length }] })
    if (path !== PATH) return route.fulfill({ status: 404 })
    if (url.search === '?profile') return route.fulfill({ json: profile })
    return route.fulfill({ body: ifc, contentType: 'application/octet-stream' })
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

test('구축하기는 서버에 v1 을 만들고, 반영하기는 v2, 되돌리기는 v1 을 v3 으로 다시 반영한다. 버전마다 반영자·대상 층·파일이 남는다 [OE-GEN-05#1] [OE-WF-10#2] [OE-WF-11#1~] [OE-WF-13#1~] [OE-WF-18#1] [OE-WF-19#1] [OE-GEN-09#1] [OE-SYNC-04#1~] [OE-SYNC-05#1] [OE-SYNC-03#1~]', async ({ page }) => {
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
  // 구축하면 그 버전의 결과 리포트가 열린다(OE-SYNC-04): 여섯 항목과 그 밖. 조명은 방 밖으로 나가 "소속이 없어진 설비" 에 새로 들었다.
  const report = page.getByTestId('version-report')
  await expect(report).toContainText('v1 반영 결과 리포트')
  await expect(report.locator('.report-section')).toHaveCount(7)
  for (const label of ['소속이 바뀐 설비', '물리존 생성·삭제·분할·병합·이름', '공조존 매핑 변경·미매핑 경고', '소속이 없어진 설비', '사람 지정이 풀린 설비', '배관·연결 변경'])
    await expect(report).toContainText(label)
  await expect(report.locator('.report-section[data-kind="unassigned"] li')).toHaveText(/^새로 LIGHT-101-01: 사무실 → /)
  // 공간 계층(탐색기 트리 대신).
  await report.getByTestId('space-tree').locator('summary').click()
  await expect(report.getByTestId('space-tree')).toContainText('1F 1개 — 사무실')

  // 다시 고치고 반영하면 v2.
  await editLight(page, '8')
  await bar.getByRole('button', { name: '반영하기' }).click()
  await expect(dialog.getByRole('heading')).toHaveText('반영하기 — v2')
  await dialog.getByRole('button', { name: '반영하기' }).click()
  await expect(page.locator('.key-note')).toContainText('v2 으로 반영했습니다', { timeout: 30_000 })
  // v2 리포트: 같은 줄이지만 v1 에도 있었으니 새로가 아니다.
  await expect(report).toContainText('v2 반영 결과 리포트')
  await expect(report.locator('.report-section[data-kind="unassigned"] li')).not.toContainText('새로')
  if (process.env.SHOT_REPORT) {
    await report.evaluate((el) => el.scrollIntoView({ block: 'start' }))
    await page.evaluate(() => window.scrollBy(0, -230))
    await page.screenshot({ path: process.env.SHOT_REPORT, fullPage: false })
  }

  // 버전 히스토리: 지금은 v2. v1 을 되돌리면 v3 이 되고 v1 의 파일과 같다.
  const versions = page.getByTestId('versions')
  await expect(versions.locator('tbody tr')).toHaveCount(2)
  await expect(versions.locator('tr.current')).toContainText('v2')
  const v1row = versions.locator('tbody tr', { hasText: 'v1' })
  // 리포트의 [되돌리기] 는 직전 버전(v1)을 골라 둔 되돌리기 확인으로 간다(OE-SYNC-05).
  await report.getByRole('button', { name: '되돌리기 (v1)' }).click()
  await v1row.getByRole('button', { name: 'v1 다시 반영' }).click()
  await expect(page.locator('.key-note')).toContainText('v1 의 레이아웃을 v3 으로 다시 반영했습니다')
  await expect(versions.locator('tr.current')).toContainText('v1 되돌리기')
  expect(await fromServer({ v: '3', file: 'ontology.ttl' })).toBe(v1ttl)
  if (process.env.SHOT) {
    await versions.scrollIntoViewIfNeeded()
    await page.screenshot({ path: process.env.SHOT })
  }
  // 시스템 로그: 편집 시작·반영 둘·되돌리기가 그 사람으로 남는다. [OE-COM-04#1]
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
  const open = async (p: Page, who: string, edit = true) => {
    await serve(p)
    await p.goto('/')
    await p.locator('.catalog tr').filter({ hasText: PATH }).last().getByRole('button', { name: '열기', exact: true }).click()
    await expect(p.locator('.appbar h2')).toHaveText('mep.ifc', { timeout: 30_000 })
    await p.getByLabel('사용자').selectOption(who)
    if (edit) await p.getByRole('button', { name: '편집', exact: true }).click()
  }
  // B 가 먼저 보기로 열어 둔다(아직 반영한 버전이 없다). 편집에 들어가면 층을 잠가 A 가 못 고친다(src/server/floor-state.ts).
  const other = await browser.newPage()
  await open(other, '관리자', false)
  // A 가 고쳐서 구축(v1)하고 편집을 끝낸다.
  await open(page, '편집자')
  const before = await light(page).inputValue()
  expect(before).not.toBe('7.5')
  await editLight(page, '7.5')
  await page.locator('.edit-bar').getByRole('button', { name: '구축하기' }).click()
  await page.locator('dialog.publish-dialog').getByRole('button', { name: '구축하기' }).click()
  await expect(page.locator('.key-note')).toContainText('v1 으로 구축했습니다', { timeout: 30_000 })
  // 반영한 사람에게는 배너가 없다.
  await expect(page.getByTestId('layout-banner')).toHaveCount(0)
  await page.locator('.edit-bar').getByRole('button', { name: '편집 종료' }).click()
  await other.getByRole('button', { name: '편집', exact: true }).click()

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

test('임시 저장본은 서버에 층마다 하나라 다른 사람이 이어 편집하고, 편집 중인 층은 잠기며, 폐기하면 반영된 레이아웃으로 돌아간다 [OE-WF-01#2] [OE-WF-02#1] [OE-WF-04#1~] [OE-WF-05#1] [OE-COM-03#1] [OE-COM-03#2] [OE-COM-03#3] [OE-COM-05#1~] [OE-COM-06#1] [OE-COM-08#3]', async ({ page, browser }) => {
  test.setTimeout(120_000)
  const open = async (p: Page, who: string, edit = true) => {
    await serve(p)
    await p.goto('/')
    await p.locator('.catalog tr').filter({ hasText: PATH }).last().getByRole('button', { name: '열기', exact: true }).click()
    await expect(p.locator('.appbar h2')).toHaveText('mep.ifc', { timeout: 30_000 })
    await p.getByLabel('사용자').selectOption(who)
    if (edit) await p.getByRole('button', { name: '편집', exact: true }).click()
  }
  // A: 고치고 [임시 저장] → 서버에 1F 조각. 반영하지 않았으니 버전은 없다.
  await open(page, '편집자')
  const before = await light(page).inputValue()
  await editLight(page, '7.5')
  await page.locator('.edit-bar').getByRole('button', { name: '임시 저장' }).click()
  // mep.ifc 의 1F 층 id.
  await expect.poll(async () => Object.keys(JSON.parse(await (await fetch(`${base}/__drafts?key=${encodeURIComponent(PATH)}`)).text()))).toEqual(['0MEP$Storey$1F$00000'])
  expect(JSON.parse(await fromServer({}))).toEqual({ current: null, versions: [] })

  // B: A 가 편집 중이라 같은 층에 못 들어간다.
  const other = await browser.newPage()
  await open(other, '관리자')
  await expect(other.locator('.edit-notice')).toContainText(/편집자님이 .+ 편집 중입니다/)
  if (process.env.SHOT_LOCK) await other.screenshot({ path: process.env.SHOT_LOCK })
  await expect(other.locator('.edit-bar')).toHaveCount(0)

  // A 가 편집을 끝내면(임시 저장 뒤라 묻지 않는다) 잠금이 풀리고 B 가 들어가 A 의 임시 저장본을 이어 편집한다.
  await page.locator('.edit-bar').getByRole('button', { name: '편집 종료' }).click()
  await expect(page.locator('.edit-bar')).toHaveCount(0)
  await other.getByRole('button', { name: '편집', exact: true }).click()
  await expect(other.locator('.edit-bar')).toBeVisible()
  await expect(light(other)).toHaveValue('7.5')
  if (process.env.SHOT_DRAFT) await other.locator('.edit-bar').screenshot({ path: process.env.SHOT_DRAFT })

  // B: [임시 저장본 폐기] → 한 번 더 묻고 → 반영된 레이아웃(아직 없으니 BIM)으로. 서버의 그 층 조각도 지워진다.
  const bar = other.locator('.edit-bar')
  await bar.getByRole('button', { name: '임시 저장본 폐기' }).click()
  await bar.getByRole('button', { name: '폐기', exact: true }).click()
  await expect(light(other)).toHaveValue(before)
  await expect(bar.getByRole('button', { name: '임시 저장본 폐기' })).toHaveCount(0)
  await expect.poll(async () => Object.keys(JSON.parse(await (await fetch(`${base}/__drafts?key=${encodeURIComponent(PATH)}`)).text())).filter((k) => k !== '*')).toEqual([])
  await other.close()
})

test('반영된 온톨로지가 없으면 [초기 구축] 만, 있으면 [운영 편집] 만 켜지고, 편집 막대에 그 모드가 보인다. 주소로 바로 연다 [OE-UI-02#1] [OE-UI-02#2] [OE-UI-03#1] [OE-UI-01#2~]', async ({ page, browser }) => {
  test.setTimeout(120_000)
  await serve(page)
  await page.goto('/')
  const row = page.locator('.catalog tr').filter({ hasText: PATH }).last()
  await expect(row.getByRole('button', { name: '초기 구축' })).toBeEnabled()
  await expect(row.getByRole('button', { name: '운영 편집' })).toBeDisabled()
  await expect(row.getByRole('button', { name: '운영 편집' })).toHaveAttribute('title', '반영된 온톨로지가 없습니다. 초기 구축으로 먼저 만듭니다')
  await row.getByRole('button', { name: '초기 구축' }).click()
  await expect(page.locator('.appbar h2')).toHaveText('mep.ifc', { timeout: 30_000 })
  await page.getByLabel('사용자').selectOption('편집자')
  await page.getByRole('button', { name: '편집', exact: true }).click()
  await expect(page.getByTestId('edit-kind')).toHaveText('초기 구축')
  await editLight(page, '7.5')
  await page.locator('.edit-bar').getByRole('button', { name: '구축하기' }).click()
  await page.locator('dialog.publish-dialog').getByRole('button', { name: '구축하기' }).click()
  await expect(page.locator('.key-note')).toContainText('v1 으로 구축했습니다', { timeout: 30_000 })
  await expect(page.getByTestId('edit-kind')).toHaveText('운영 편집 · v1')
  // 운영 편집의 편집 막대: [임시 저장]·[미리보기]·[반영하기]·[편집 종료] [OE-UI-04#1]
  for (const name of ['임시 저장', '미리보기', '반영하기', '편집 종료']) await expect(page.locator('.edit-bar').getByRole('button', { name, exact: true })).toBeVisible()
  // 페이지 끝까지 내려도 [임시 저장]·[반영하기] 가 화면 안에 있다 — 편집 막대는 위에 붙는 도구막대의 둘째 줄이다 [OE-COM-08#1]
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(200)
  for (const name of ['임시 저장', '반영하기']) await expect(page.locator('.edit-bar').getByRole('button', { name, exact: true })).toBeInViewport()
  await page.locator('.edit-bar').getByRole('button', { name: '편집 종료' }).click()

  // 다른 사람이 목록을 보면 이제 [운영 편집] 만 켜져 있다.
  const other = await browser.newPage()
  await serve(other)
  await other.goto('/')
  const row2 = other.locator('.catalog tr').filter({ hasText: PATH }).last()
  await expect(row2).toContainText('반영 v1')
  await expect(row2.getByRole('button', { name: '초기 구축' })).toBeDisabled()
  if (process.env.SHOT_MODE) await row2.screenshot({ path: process.env.SHOT_MODE })
  await other.close()

  // 주소로 바로 열고 편집에 들어간다(DT 의 [레이아웃 에디터] 가 넘길 자리). 반영된 v1 이 얹혀 있다.
  const third = await browser.newPage()
  await serve(third)
  await third.addInitScript(() => localStorage.setItem('oe.user', '관리자'))
  await third.goto(`/?open=${encodeURIComponent(PATH)}&mode=edit`)
  await expect(third.locator('.appbar h2')).toHaveText('mep.ifc', { timeout: 30_000 })
  await expect(third.getByTestId('edit-kind')).toHaveText('운영 편집 · v1')
  await expect(light(third)).toHaveValue('7.5')
  await third.close()
})

test('수용 기준선(게이트 등급 0~3) 미달이면 [구축하기] 가 꺼지고 재제출 항목이 보이며, 통과선을 바꾸면 판정만 바뀐다 [OE-BIM-21#1] [OE-GEN-02#1]', async ({ page }) => {
  await serve(page, true)
  await page.goto('/')
  await page.locator('.catalog tr').filter({ hasText: PATH }).last().getByRole('button', { name: '열기', exact: true }).click()
  await expect(page.locator('.appbar h2')).toHaveText('mep.ifc', { timeout: 30_000 })
  const banner = page.getByTestId('grade-banner')
  await expect(banner).toContainText('게이트(등급 0~3) 미달')
  await expect(banner).toContainText('재제출: 등급 1 설비 목록 80.0% · 등급 2 설비 소속 80.0%')
  await page.getByLabel('사용자').selectOption('편집자')
  await page.getByRole('button', { name: '편집', exact: true }).click()
  const build = page.locator('.edit-bar').getByRole('button', { name: '구축하기' })
  await expect(build).toBeDisabled()
  await expect(build).toHaveAttribute('title', /수용 기준선\(게이트 등급 0~3\) 미달이라 구축하지 않습니다/)
  // 등급 판정 표: 게이트 줄의 재제출 항목과 목표선의 두 수치.
  await banner.getByRole('button', { name: '등급 판정 보기' }).click()
  const table = page.getByTestId('grade-table')
  await expect(table.locator('.grade-rows li')).toHaveCount(5)
  await expect(table.locator('.grade-rows li').nth(2)).toContainText('재제출: R12·R1')
  if (process.env.SHOT_GRADE) await page.screenshot({ path: process.env.SHOT_GRADE })
  // 통과선을 80% 로 낮추면 판정만 바뀌어 [구축하기] 가 켜진다.
  for (const g of [1, 2]) {
    await table.getByLabel(`등급 ${g} 통과선(%)`).fill('80')
    await table.getByLabel(`등급 ${g} 통과선(%)`).press('Tab')
  }
  await expect(banner).toContainText('게이트(등급 0~3) 통과')
  await expect(build).toBeEnabled()
  // 권장 요구사항이 빠져 있어도 막지 않는다 — mep.ifc 는 권장 줄 중 "없음" 이 있는데 [구축하기] 가 켜져 있다.
  await page.getByRole('button', { name: /^요구사항/ }).click()
  const recommended = page.locator('.req-table tbody').filter({ has: page.locator('th', { hasText: /^권장/ }) })
  await expect(recommended.locator('.req-state.missing').first()).toBeVisible()
  await expect(build).toBeEnabled()
})

test('미리보기는 반영 전 변경 요약과 소속이 바뀔 설비를 보이고, 누르면 그 설비를 고르며, 확인 창의 수치와 [미리보기] 가 같다 [OE-WF-07#1~] [OE-WF-08#1~] [OE-WF-09#1] [OE-WF-11#1] [OE-WF-12#1] [OE-P3-01#1~] [OE-MAP-01#2~]', async ({ page }) => {
  await serve(page)
  await page.goto('/')
  await page.locator('.catalog tr').filter({ hasText: PATH }).last().getByRole('button', { name: '열기', exact: true }).click()
  await expect(page.locator('.appbar h2')).toHaveText('mep.ifc', { timeout: 30_000 })
  await page.getByLabel('사용자').selectOption('편집자')
  await page.getByRole('button', { name: '편집', exact: true }).click()
  await editLight(page, '12')
  const bar = page.locator('.edit-bar')
  await bar.getByRole('button', { name: '미리보기' }).click()
  const preview = page.getByTestId('preview')
  const summary = await preview.getByTestId('preview-summary').innerText()
  expect(summary).toContain('소속 변경 설비 1')
  expect(summary).toContain('분할 0')
  await expect(preview.getByTestId('preview-impact')).toContainText('LIGHT-101-01 · 사무실 →')
  if (process.env.SHOT_PREVIEW) await page.screenshot({ path: process.env.SHOT_PREVIEW })
  // 규칙 경고(막지 않음): 사무실 80㎡ 라 W-01 은 기본(2㎡)에서 없고, 최소 면적을 100㎡ 로 올리면 걸린다.
  const rulesBox = preview.getByTestId('preview-rules')
  await expect(rulesBox.locator('li[data-rule="W-01"]')).toHaveCount(0)
  await rulesBox.getByLabel('W-01 최소 면적(㎡)').fill('100')
  await rulesBox.getByLabel('W-01 최소 면적(㎡)').press('Tab')
  await expect(rulesBox.locator('li[data-rule="W-01"]')).toContainText('물리존 면적이 100㎡ 미만: 1개')
  if (process.env.SHOT_RULES) await page.locator('[data-testid="preview"]').screenshot({ path: process.env.SHOT_RULES })
  // 목록을 누르면 그 설비가 골라진다.
  await preview.getByRole('button', { name: 'LIGHT-101-01' }).click()
  await expect(page.locator('.picked h3').first()).toContainText('LIGHT-101-01')
  // 미리보기는 반영하지 않는다.
  expect(JSON.parse(await fromServer({}))).toEqual({ current: null, versions: [] })
  await preview.getByRole('button', { name: '닫기' }).click()

  // 확인 창: 미리보기와 같은 요약, [미리보기] 를 누르면 창을 닫고 미리보기로.
  await bar.getByRole('button', { name: '구축하기' }).click()
  const dialog = page.locator('dialog.publish-dialog')
  await expect(dialog.getByTestId('publish-summary')).toContainText(`변경 요약: ${summary}`)
  await dialog.getByRole('button', { name: '미리보기' }).click()
  await expect(dialog).not.toBeVisible()
  await expect(preview).toBeVisible()
})

test('물리존 공간명을 고쳐 반영하면 그 버전의 공간 계층(탐색기 트리 대신)·TTL·GeoJSON 의 이름이 에디터의 공간명과 같고, 앞 버전은 옛 이름 그대로다 [OE-SPC-05#1]', async ({ page }) => {
  test.setTimeout(120_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await serve(page)
  await page.goto('/')
  await page.locator('.catalog tr').filter({ hasText: PATH }).last().getByRole('button', { name: '열기', exact: true }).click()
  await expect(page.locator('.appbar h2')).toHaveText('mep.ifc', { timeout: 30_000 })
  await page.getByLabel('사용자').selectOption('편집자')
  await page.getByRole('button', { name: '편집', exact: true }).click()
  const bar = page.locator('.edit-bar')
  const dialog = page.locator('dialog.publish-dialog')
  // v1 은 BIM 이름(사무실) 그대로.
  await editLight(page, '7.5')
  await bar.getByRole('button', { name: '구축하기' }).click()
  await dialog.getByRole('button', { name: '구축하기' }).click()
  await expect(page.locator('.key-note')).toContainText('v1 으로 구축했습니다', { timeout: 30_000 })

  // 사무실 바닥을 골라 공간명을 고친다.
  await page.locator('.canvas-wrap > canvas').scrollIntoViewIfNeeded()
  const at = (await page.evaluate(() => (window as any).__viewer.point([5, 4, 0.1]))) as { x: number; y: number }
  await page.mouse.click(at.x, at.y)
  const panel = page.locator('.space-picked')
  await expect(panel.locator('h3')).toHaveText('사무실')
  const name = panel.locator('.space-name input')
  await name.fill('대회의실')
  await name.press('Enter')
  await expect(panel.locator('h3')).toHaveText('대회의실')
  await bar.getByRole('button', { name: '반영하기' }).click()
  await dialog.getByRole('button', { name: '반영하기' }).click()
  await expect(page.locator('.key-note')).toContainText('v2 으로 반영했습니다', { timeout: 30_000 })

  // 반영한 공간 계층의 이름 = 에디터의 공간명. 화면의 계층도 같다.
  type Tree = { storeys: { spaces: { id: string; longName: string | null }[] }[] }
  const tree1 = JSON.parse(await fromServer({ v: '1', file: 'tree.json' })) as Tree
  const tree2 = JSON.parse(await fromServer({ v: '2', file: 'tree.json' })) as Tree
  expect(tree2.storeys[0].spaces.map((s) => s.longName)).toEqual(['대회의실'])
  await page.getByTestId('version-report').getByTestId('space-tree').locator('summary').click()
  await expect(page.getByTestId('version-report').getByTestId('space-tree')).toContainText('1F 1개 — 대회의실')
  // 같은 방(id 그대로)이라 탐색기가 이름만 바꿔 단다. 이상 알림이 읽는 TTL·GeoJSON 의 이름도 같다.
  expect(tree2.storeys[0].spaces[0].id).toBe(tree1.storeys[0].spaces[0].id)
  expect(await fromServer({ v: '2', file: 'ontology.ttl' })).toContain('rdfs:label "대회의실"')
  const meta = JSON.parse(await fromServer({}))
  const geo = meta.versions.find((x: { version: number }) => x.version === 2).files.find((f: string) => f.startsWith('geojson/'))
  expect(await fromServer({ v: '2', file: geo })).toContain('"longName":"대회의실"')
  // 앞 버전은 그때 이름 그대로다.
  expect(tree1.storeys[0].spaces.map((s) => s.longName)).toEqual(['사무실'])
  expect(errors).toEqual([])
})

test('이름 없는 층이 있으면 등급 0 이 층 이름으로 미달이라 [구축하기] 가 막히고, 층별 요약에서 이름을 넣으면 풀린다. 이름은 되돌리기·TTL 에 남는다', async ({ page }) => {
  test.setTimeout(120_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  // 1F 의 이름을 비운 mep.ifc. 비율로는 등급 0 이 통과(외곽선 1/1)라, 막는 이유가 층 이름이어야 한다.
  await serve(page, false, Buffer.from(MEP.toString('latin1').replace("IFCBUILDINGSTOREY('0MEP$Storey$1F$00000',$,'1F'", "IFCBUILDINGSTOREY('0MEP$Storey$1F$00000',$,''"), 'latin1'))
  await page.goto('/')
  await page.locator('.catalog tr').filter({ hasText: PATH }).last().getByRole('button', { name: '열기', exact: true }).click()
  await expect(page.locator('.appbar h2')).toHaveText('mep.ifc', { timeout: 30_000 })
  const banner = page.getByTestId('grade-banner')
  await expect(banner).toContainText('재제출: 등급 0 공간 골격 층 이름 0/1(이름 없는 층 1개)')
  await page.getByLabel('사용자').selectOption('편집자')
  await page.getByRole('button', { name: '편집', exact: true }).click()
  const build = page.locator('.edit-bar').getByRole('button', { name: '구축하기' })
  await expect(build).toBeDisabled()
  await expect(build).toHaveAttribute('title', /등급 0 공간 골격 층 이름 0\/1\(이름 없는 층 1개\).*층 이름은 \[층별 요약\] 에서 넣을 수 있습니다/)

  // 층별 요약에서 이름을 넣는다.
  await page.getByRole('button', { name: '이름 없는 층 층 이름 넣기' }).click()
  const input = page.getByLabel('이름 없는 층 층 이름')
  if (process.env.SHOT_BEFORE) {
    await input.fill('기초')
    await page.locator('.storey-name-cell').first().locator('xpath=ancestor::table').screenshot({ path: process.env.SHOT_BEFORE })
  }
  await input.fill('1F')
  await input.press('Enter')
  await expect(page.locator('.storey-name-cell').first()).toContainText('1F')
  await expect(page.getByTestId('storey-name-line')).toContainText('층 이름 (없음) → 1F')
  await expect(banner).toContainText('게이트(등급 0~3) 통과')
  await expect(build).toBeEnabled()

  // 되돌리기 한 번에 이름 없는 층으로 돌아가 다시 막힌다. 다시 하면 풀린다.
  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('Control+z')
  await expect(page.locator('.storey-name-cell').first()).toContainText('이름 없음')
  await expect(build).toBeDisabled()
  await page.keyboard.press('Control+Shift+z')
  await expect(build).toBeEnabled()

  // 구축하면 TTL 의 층 이름이 넣은 이름이다.
  await build.click()
  await page.locator('dialog.publish-dialog').getByRole('button', { name: '구축하기' }).click()
  await expect(page.locator('.key-note')).toContainText('v1 으로 구축했습니다', { timeout: 30_000 })
  expect(await fromServer({ v: '1', file: 'ontology.ttl' })).toMatch(/rdfs:label "1F"/)
  expect(JSON.parse(await fromServer({ v: '1', file: 'edits.json' })).storeyNames).toEqual([{ storeyId: expect.any(String), name: '1F' }])
  expect(errors).toEqual([])
})
