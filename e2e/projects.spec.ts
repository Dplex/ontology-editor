import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { coordOf, pickEquipment, xOf } from './edit-part'
import { createDataCatalog } from '../src/server/data-catalog'

// 프로젝트 목록·[새 프로젝트]·층 선택(OE-UI-01~03, OE-WF-06, src/server/projects.ts). publish.spec.ts 처럼 진짜 data-catalog 를 임시 폴더에
// 띄우고 `/__data/__…` 를 그리로 넘긴다. IFC 는 그 폴더의 파일을 그대로 내준다 — [새 프로젝트]가 올린 파일(uploads/)까지 서버에 남는지 본다.
// 요약(profile)만 흉내 낸다. 재는 일이 무거워 e2e 서버를 멈추게 한다(docs/dev/testing.md).
const MEP = readFileSync('src/lib/ifc/fixtures/mep.ifc')
const MEP_PATH = 'src/lib/ifc/fixtures/mep.ifc'
const profile = { profile: { schema: 'IFC4', storeys: 1, spaces: 1, devices: 5, conduits: 0, systems: 0, connections: 0, tiers: [], needsArchitecture: false, needsEquipment: false } }

let root: string
let server: Server
let base: string
test.beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'projects-e2e-'))
  mkdirSync(join(root, '현장'))
  writeFileSync(join(root, '현장/mep.ifc'), MEP)
  const catalog = createDataCatalog(root)
  server = createServer((req, res) => catalog(req, res))
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const addr = server.address()
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`
})
test.beforeEach(() => {
  for (const d of ['.projects', '.drafts', '.locks', '.layouts', 'uploads']) rmSync(join(root, d), { recursive: true, force: true })
})
test.afterAll(() => {
  server.close()
  rmSync(root, { recursive: true, force: true })
})

async function serve(page: Page) {
  // 등급 게이트를 낮춰 mep.ifc 도 구축하게 한다(publish.spec.ts 와 같은 자리).
  await page.addInitScript(() => localStorage.setItem('oe.gradeLines', JSON.stringify({ 0: 0.85, 1: 0.5, 2: 0.5, 3: 0, 4: 0.5 })))
  await page.route('**/__data/**', async (route) => {
    const url = new URL(route.request().url())
    const path = decodeURIComponent(url.pathname.replace(/^\/__data\/?/, ''))
    if (path.startsWith('__') || !path) {
      const r = await fetch(`${base}/${path}?${url.searchParams}`, { method: route.request().method(), headers: route.request().headers(), body: route.request().postDataBuffer() ?? undefined })
      return route.fulfill({ status: r.status, headers: Object.fromEntries(r.headers), body: Buffer.from(await r.arrayBuffer()) })
    }
    if (url.search === '?profile') return route.fulfill({ json: profile })
    const file = resolve(root, path)
    if (!file.startsWith(root + sep)) return route.fulfill({ status: 404 })
    try {
      return route.fulfill({ body: readFileSync(file), contentType: 'application/octet-stream' })
    } catch {
      return route.fulfill({ status: 404 })
    }
  })
}
// 조명의 x 는 3D 형상 가운데로 읽는다(xOf). 보기 모드에서도 읽힌다(예전 설비 표의 좌표 칸, #715 에서 빠졌다).
const lightX = (page: Page) => xOf(page, 'LIGHT-101-01')
async function editLight(page: Page, x: string) {
  const on = page.getByRole('group', { name: '설비 편집 면' }).getByRole('button', { name: '천장' })
  if ((await on.getAttribute('aria-pressed')) !== 'true') {
    await page.locator('body').click({ position: { x: 5, y: 5 } })
    await page.keyboard.press('t')
  }
  await pickEquipment(page, 'LIGHT-101-01')
  await coordOf(page, 0).fill(x)
  await coordOf(page, 0).press('Enter')
}
async function newProject(page: Page, name: string) {
  const list = page.getByRole('region', { name: '프로젝트' })
  await list.getByRole('button', { name: '새 프로젝트' }).click()
  const form = page.getByRole('form', { name: '새 프로젝트' })
  await form.getByLabel('프로젝트 이름').fill(name)
  await form.getByLabel('사이트 이름').fill('SR 캠퍼스')
  await form.getByLabel('IFC 파일').setInputFiles(MEP_PATH)
  await form.getByRole('button', { name: '만들기' }).click()
  await expect(page.locator('.appbar h2')).toHaveText('mep.ifc', { timeout: 30_000 })
}

test('[새 프로젝트]는 이름·사이트·IFC 올리기만 있고, 만들면 초기 구축 에디터가 열린다. 다시 누르면 시작 화면 없이 이전 편집이 보인다. 같은 IFC 로 만든 다른 프로젝트와 섞이지 않는다 [OE-UI-02#1,2,4] [OE-WF-06#1,2] [OE-UI-03#1,5] [OE-UI-01#2]', async ({ page, browser }) => {
  test.setTimeout(120_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await serve(page)
  await page.goto('/')
  const list = page.getByRole('region', { name: '프로젝트' })
  await expect(list).toContainText('프로젝트가 없습니다')
  // 사람을 고르기 전에는 못 만들고, 마우스를 올리면 까닭이 보인다(OE-UI-03 AC5).
  const create = list.getByRole('button', { name: '새 프로젝트' })
  await expect(create).toBeDisabled()
  await expect(create).toHaveAttribute('title', '사용자를 먼저 고르세요')
  await page.getByLabel('사용자').selectOption('편집자')
  await create.click()
  // 시작 화면: 이름·사이트·IFC 올리기뿐이다. 다 넣기 전에는 [만들기]가 꺼져 있고 무엇이 빠졌는지 보인다.
  const form = page.getByRole('form', { name: '새 프로젝트' })
  await expect(form.getByRole('textbox')).toHaveCount(2)
  await expect(form.getByRole('button', { name: '만들기' })).toBeDisabled()
  await expect(form.getByRole('button', { name: '만들기' })).toHaveAttribute('title', /프로젝트 이름 · 사이트 이름 · IFC 파일/)
  await form.getByRole('button', { name: '취소' }).click()
  await newProject(page, '본관 구축')
  await expect(page.getByTestId('edit-kind')).toHaveText('초기 구축')
  await editLight(page, '7.5')
  await page.locator('.edit-bar').getByRole('button', { name: '임시 저장' }).click()
  // 올린 IFC 는 서버의 data/uploads 에 남는다.
  const projects = (await (await fetch(`${base}/__projects`)).json()) as { id: string; key: string; paths: string[]; summary?: unknown }[]
  expect(projects).toHaveLength(1)
  expect(projects[0].paths[0]).toMatch(/^uploads\/\d{8}-\d{6}-mep\.ifc$/)
  await expect.poll(async () => ((await (await fetch(`${base}/__projects`)).json()) as { summary?: unknown }[])[0].summary).toBeTruthy()
  // 편집을 끝내 층 잠금을 푼다(편집 중인 층은 다른 사람이 열지 못한다, OE-COM-05).
  await page.getByRole('button', { name: '편집 종료' }).click()

  // 다른 사람이 목록을 열면: 구축 전 · 건물·층 수 · 임시 저장 1/1. 펼치면 건물별 줄.
  const other = await browser.newPage()
  await serve(other)
  await other.addInitScript(() => localStorage.setItem('oe.user', '관리자'))
  await other.goto('/')
  const row = other.getByTestId('project-row').filter({ hasText: '본관 구축' })
  await expect(row).toContainText('SR 캠퍼스')
  await expect(row).toContainText('구축 전')
  await expect(row.getByTestId('project-progress')).toHaveText(/건물 1 · 층 1 · 임시 저장 1\/1/)
  await expect(row).toContainText('임시 저장 · 편집자')
  await row.getByRole('button', { name: '본관 구축 건물별 보기' }).click()
  await expect(other.getByTestId('building-row')).toHaveCount(1)
  await expect(other.getByTestId('building-row')).toContainText('임시 저장 1/1')
  if (process.env.SHOT) await other.getByRole('region', { name: '프로젝트' }).screenshot({ path: process.env.SHOT })
  // 누르면 시작 화면 없이 에디터가 열리고 임시 저장한 편집이 얹혀 있다.
  await row.getByRole('button', { name: '열기' }).click()
  await expect(other.locator('.appbar h2')).toHaveText('mep.ifc', { timeout: 30_000 })
  await expect(other.getByTestId('edit-kind')).toHaveText('초기 구축')
  await expect.poll(() => lightX(other)).toBe('7.5')
  await other.getByRole('button', { name: '편집 종료' }).click()
  await other.close()

  // 같은 IFC 로 프로젝트를 하나 더 만들면 앞 프로젝트의 임시 저장본이 얹히지 않는다(OE-UI-02 AC4). 앞 프로젝트를 고친 같은 창이라
  // 이 브라우저에 남은 임시 저장본도 섞이지 않는지 본다.
  await page.goto('/')
  await newProject(page, '본관 다시')
  await expect.poll(() => lightX(page)).not.toBeNull()
  expect(await lightX(page)).not.toBe('7.5')
  await page.getByRole('button', { name: '편집 종료' }).click()

  // 주소로 바로 연다(DT 없이 에디터 URL, OE-UI-01 AC2).
  const direct = await browser.newPage()
  await serve(direct)
  await direct.addInitScript(() => localStorage.setItem('oe.user', '편집자'))
  await direct.goto(`/?project=${projects[0].id}`)
  await expect(direct.locator('.appbar h2')).toHaveText('mep.ifc', { timeout: 30_000 })
  await expect(direct.getByTestId('edit-kind')).toHaveText('초기 구축')
  await expect.poll(() => lightX(direct)).toBe('7.5')
  await direct.close()
  expect(errors).toEqual([])
})

test('구축을 마친 프로젝트는 층 선택 화면을 거쳐 운영 편집으로 열리고, 층별 [초기 구축] 은 없다. 임시 저장본이 있는 층은 표시된다 [OE-UI-02#3] [OE-UI-03#4] [OE-UI-03#2~]', async ({ page }) => {
  test.setTimeout(120_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await serve(page)
  await page.addInitScript(() => localStorage.setItem('oe.user', '편집자'))
  await page.goto('/')
  await newProject(page, '구축 끝')
  await editLight(page, '7.5')
  await page.locator('.edit-bar').getByRole('button', { name: '구축하기' }).click()
  await page.locator('dialog.publish-dialog').getByRole('button', { name: '임시 저장 후 구축' }).click()
  await expect(page.locator('.key-note')).toContainText('v1 으로 구축했습니다', { timeout: 30_000 })
  // 운영 편집에서 한 번 더 고쳐 임시 저장한다.
  await editLight(page, '8')
  await page.locator('.edit-bar').getByRole('button', { name: '임시 저장' }).click()
  await expect.poll(async () => ((await (await fetch(`${base}/__projects`)).json()) as { drafts: unknown[] }[])[0].drafts.length).toBe(1)

  await page.goto('/')
  const row = page.getByTestId('project-row').filter({ hasText: '구축 끝' })
  await expect(row).toContainText('구축 완료 · v1')
  await expect(row.getByTestId('project-progress')).toHaveText(/임시 저장본 1개 층/)
  await row.getByRole('button', { name: '열기' }).click()
  // 층 선택 화면: 건물별 묶음, 층은 건물 이름과 함께, [운영 편집] 만 있다. 에디터는 아직 열리지 않았다.
  const group = page.getByTestId('storey-group')
  await expect(group).toHaveCount(1)
  await expect(group.locator('h3')).toContainText('1개 층 · 임시 저장본 1개 층')
  const storey = group.getByTestId('storey-row')
  await expect(storey).toHaveCount(1)
  await expect(storey.locator('.name')).toHaveText(/\S+ 1F$/)
  await expect(storey).toContainText('임시 저장본')
  await expect(page.getByRole('region', { name: '프로젝트' }).getByRole('button', { name: '초기 구축' })).toHaveCount(0)
  await expect(page.locator('.appbar')).toHaveCount(0)
  if (process.env.SHOT_STOREYS) await page.getByRole('region', { name: '프로젝트' }).screenshot({ path: process.env.SHOT_STOREYS })
  await storey.getByRole('button', { name: '운영 편집' }).click()
  await expect(page.locator('.appbar h2')).toHaveText('mep.ifc', { timeout: 30_000 })
  await expect(page.getByTestId('edit-kind')).toHaveText('운영 편집')
  // 반영본 번호는 안내 바에 있다(#715). 이 층은 임시 저장본이 있어 안내 바가 그것을 먼저 말한다.
  await expect(page.getByTestId('info-bar')).toContainText('임시 저장본에서 이어서 편집 중')
  await expect.poll(() => lightX(page)).toBe('8')
  expect(errors).toEqual([])
})
