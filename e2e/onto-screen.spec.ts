import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

// [온톨로지] 칸의 "지금 화면 (반영 전)"(ADR-0050). 문서 챗봇 창(scripts/docs-chat.js)은 8084 빌드에만 끼워 넣어서, 여기서는 dev 화면에
// 직접 끼우고 /__ask·/__ask/screen 을 page.route 로 흉내 낸다. 창은 편집 화면이 만든 TTL(window.__oe.screen)을 올리고 그 토큰으로 묻는다.
const MEP = 'src/lib/ifc/fixtures/mep.ifc'

async function open(page: Page, published: { source: string; title: string; version: number }[] = []) {
  const errors: string[] = []
  const uploads: { url: string; body: string }[] = []
  const questions: { question: string; source?: string }[] = []
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
  await page.getByRole('button', { name: '편집', exact: true }).click()
  const name = page.getByLabel('101 이름')
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
