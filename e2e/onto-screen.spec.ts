import { expect, test, type Page } from '@playwright/test'
import { enterEdit, pickEquipment, pickSpace } from './edit-part'
import { existsSync, readFileSync } from 'node:fs'
// @ts-expect-error — 의존성 없는 node 모듈(.mjs)이라 타입이 없다
import { parseSubjects, viewLine } from '../scripts/onto-view.mjs'

// [온톨로지] 칸의 "지금 화면 (반영 전)"(ADR-0050). 문서 챗봇 창(scripts/docs-chat.js)은 8084 빌드에만 끼워 넣어서, 여기서는 dev 화면에
// 직접 끼우고 /__ask·/__ask/screen 을 page.route 로 흉내 낸다. 창은 편집 화면이 만든 TTL(window.__oe.screen)을 올리고 그 토큰으로 묻는다.
const MEP = 'src/lib/ifc/fixtures/mep.ifc'

async function open(page: Page, published: { source: string; title: string; version: number }[] = []) {
  const errors: string[] = []
  const uploads: { url: string; body: string }[] = []
  const questions: { question: string; source?: string; view?: Record<string, unknown> }[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.route('**/__ask', async (r) => {
    if (r.request().method() === 'GET') return r.fulfill({ json: { enabled: true, sources: published } })
    const b = r.request().postDataJSON()
    questions.push(b)
    await r.fulfill({ contentType: 'application/x-ndjson', body: `${JSON.stringify({ type: 'text', text: `반영 전 화면 기준: ${b.source}` })}\n${JSON.stringify({ type: 'done', ms: 5 })}\n` })
  })
  await page.route('**/__ask/screen**', async (r) => {
    uploads.push({ url: r.request().url(), body: r.request().postData() ?? '' })
    const token = new URL(r.request().url()).searchParams.get('token')
    await r.fulfill({ json: { source: `screen-${token}`, bytes: (r.request().postData() ?? '').length } })
  })
  await page.goto('/')
  await page.addScriptTag({ content: readFileSync('scripts/docs-chat.js', 'utf8') })
  return { errors, uploads, questions }
}

async function askOnto(page: Page, q: string) {
  await page.keyboard.press('Alt+Shift+K')
  const chat = page.locator('#docs-chat')
  await chat.getByRole('button', { name: '온톨로지' }).click()
  await chat.locator('textarea').fill(q)
  await chat.locator('textarea').press('Enter')
  return chat
}

test('반영본이 없어도 "지금 화면 (반영 전)" 으로 묻고, 화면의 TTL 을 한 번 올린 뒤 그 토큰으로 묻는다 — 같은 화면이면 다시 올리지 않는다', async ({ page }) => {
  const { errors, uploads, questions } = await open(page)
  await page.locator('.drop input[type=file]').setInputFiles(MEP)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  const chat = await askOnto(page, '1F 에 있는 설비 뭐야?')
  await expect(chat.locator('select')).toHaveValue('__screen__')
  await expect(chat.locator('.msg.bot').last()).toContainText('반영 전 화면 기준: screen-')
  expect(uploads).toHaveLength(1)
  expect(new URL(uploads[0].url).searchParams.get('title')).toBe('mep.ifc')
  expect(uploads[0].body).toContain('AHU-1')
  expect(questions[0].source).toMatch(/^screen-[a-z0-9]{24}$/)
  expect(new URL(uploads[0].url).searchParams.get('token')).toBe(questions[0].source!.slice('screen-'.length))

  await chat.locator('textarea').fill('AHU-1 은 어디 있어?')
  await chat.locator('textarea').press('Enter')
  await expect(chat.locator('.msg.bot')).toHaveCount(2)
  expect(uploads).toHaveLength(1)
  expect(questions[1].source).toBe(questions[0].source)
  await chat.screenshot({ path: 'test-results/onto-screen.png' })
  expect(errors).toEqual([])
})

test('화면을 고치면 다음 질문 전에 다시 올린다', async ({ page }) => {
  const { errors, uploads } = await open(page)
  await page.locator('.drop input[type=file]').setInputFiles(MEP)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  const chat = await askOnto(page, '물리존 몇 개야?')
  await expect(chat.locator('.msg.bot').last()).toContainText('screen-')
  await chat.getByRole('button', { name: '✕' }).click()
  await enterEdit(page)
  await pickSpace(page, '사무실')
  const name = page.locator('.space-name input')
  await name.fill('대회의실')
  await name.press('Enter')
  await page.keyboard.press('Alt+Shift+K')
  await chat.locator('textarea').fill('대회의실 있어?')
  await chat.locator('textarea').press('Enter')
  await expect(chat.locator('.msg.bot')).toHaveCount(2)
  expect(uploads).toHaveLength(2)
  expect(uploads[1].body).toContain('대회의실')
  expect(errors).toEqual([])
})

test('반영본이 있으면 반영본이 먼저 골라지고, 화면 기준은 고를 때만 올린다', async ({ page }) => {
  const { errors, uploads, questions } = await open(page, [{ source: '0123456789ab', title: 'mep.ifc', version: 2 }])
  await page.locator('.drop input[type=file]').setInputFiles(MEP)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  const chat = await askOnto(page, 'AHU-1 은 어디 있어?')
  await expect(chat.locator('select')).toHaveValue('0123456789ab')
  await expect(chat.locator('.msg.bot').last()).toContainText('0123456789ab')
  expect(uploads).toHaveLength(0)
  expect(questions[0].source).toBe('0123456789ab')
  await expect(chat.locator('select option').first()).toHaveText('지금 화면 (반영 전)')
  expect(errors).toEqual([])
})

test('질문에 지금 화면(평면도·편집·고른 설비)을 id 로 싣고, 서버가 그 id 를 올린 TTL 에서 찾아 [지금 화면] 줄을 만든다', async ({ page }) => {
  const { errors, uploads, questions } = await open(page)
  await page.locator('.drop input[type=file]').setInputFiles(MEP)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  await enterEdit(page)
  await pickEquipment(page, 'AHU-1')
  await page.getByRole('group', { name: '보기' }).getByRole('button', { name: '평면도' }).click()
  const chat = await askOnto(page, '이거 어느 방에 있어?')
  await expect(chat.locator('.msg.bot').last()).toContainText('screen-')

  const view = questions[0].view!
  expect(view).toMatchObject({ mode: 'plan', editing: true, part: 'equipment' })
  expect(view.selected).toHaveLength(1)
  // 서버(serve.mjs 의 context)가 하는 그대로 — 올린 화면 TTL 의 주어로 거른다. 고른 설비·보는 층이 하나도 빠지지 않아야 한다.
  const line = viewLine(view, parseSubjects(uploads[0].body))
  expect(line).toContain('- 보기: 2D 평면도 · 편집 모드(설비)')
  // mep.ifc 는 층이 하나라 층 보기가 없다(모든 층). 층 하나를 보는 줄은 scripts/onto-view.test.ts 가 본다.
  expect(line).toContain('- 보는 층: 모든 층')
  expect(line).toContain('- 선택 항목: ex:0MEP\\$Equip\\$AHU1\\$0000 (brick:Air_Handling_Unit)')
  expect(line).not.toContain('없는 id')
  expect(errors).toEqual([])
})

test('Duplex: 한 층만 보면 그 층 id 가 [지금 화면] 의 보는 층이 된다', async ({ page }) => {
  const DUPLEX = 'data/NBU_Duplex/NBU_Duplex-Apt_Arch.ifc'
  test.skip(!existsSync(DUPLEX), 'Duplex 가 없다(npm run fetch:sample)')
  const { errors, uploads, questions } = await open(page)
  await page.locator('.drop input[type=file]').setInputFiles(DUPLEX)
  await expect(page.locator('.appbar h2')).toHaveText('NBU_Duplex-Apt_Arch.ifc', { timeout: 90_000 })
  const box = page.getByRole('combobox', { name: '보일 층' })
  const options = await box.locator('option').evaluateAll((els) => els.map((e) => [(e as HTMLOptionElement).value, e.textContent ?? '']))
  const [value] = options.filter(([v]) => v).at(-1)!
  await box.selectOption(value)
  const chat = await askOnto(page, '이 층에 방 몇 개야?')
  await expect(chat.locator('.msg.bot').last()).toContainText('screen-')

  const view = questions[0].view!
  expect(view).toMatchObject({ mode: '3d', editing: false, storey: expect.any(String) })
  const line = viewLine(view, parseSubjects(uploads[0].body))
  expect(line).toContain(`- 보는 층: ex:${view.storey} (brick:Floor)`)
  expect(line).not.toContain('없는 id')
  expect(errors).toEqual([])
})
