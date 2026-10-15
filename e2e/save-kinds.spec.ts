import { writeFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'

// 저장은 역할이 다른 넷이다(OE-HIST-05): 자동 저장(복구용) · [임시 저장](층별 보관본) · 완료 작업·버전 · 편집 파일.
// 저장 자리가 달라도 편집 기록은 같은 편집 파일 형식이라, 한 자리에 남은 기록을 다른 길로 불러올 수 있다.
const MEP = 'src/lib/ifc/fixtures/mep.ifc'

async function open(page: Page) {
  await page.goto('/')
  await page.locator('input[type=file]').first().setInputFiles(MEP)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
}

const row = (page: Page, name: string) => page.locator('.equipment tbody tr', { hasText: name })
const keysOf = (page: Page) => page.evaluate(() => Object.keys(localStorage).filter((k) => /^oe-(autosave|draft):/.test(k)).sort())

test('자동 저장은 임시 저장본·버전을 만들지 않고, [임시 저장] 은 층 보관본만 남기며, 같은 층에 다시 들어가면 이어서 편집된다 [OE-HIST-05#1,2]', async ({ context }) => {
  const page = await context.newPage()
  const writes: string[] = []
  page.on('request', (r) => {
    if (r.method() !== 'GET') writes.push(`${r.method()} ${r.url()}`)
  })
  await open(page)
  await page.getByRole('button', { name: '편집', exact: true }).click()
  const x = row(page, 'AHU-1').locator('.coord').first()
  await x.fill('2')
  await x.press('Enter')
  await page.waitForTimeout(1000)
  // 자동 저장만 있다. 임시 저장본(oe-draft:)도, 서버에 쓴 것(버전·완료 작업)도 없다.
  expect(await keysOf(page)).toEqual(['oe-autosave:mep.ifc'])

  // [임시 저장] 은 그 층의 보관본을 남긴다. DT·온톨로지에 반영하지 않으므로 서버에 버전을 쓰지 않는다.
  await page.locator('.edit-bar').getByRole('button', { name: '임시 저장' }).click()
  await expect.poll(() => keysOf(page)).toContainEqual(expect.stringMatching(/^oe-draft:mep\.ifc@/))
  expect(writes).toEqual([])

  // 새로 열어 같은 층에 들어가면 묻지 않고 이어서 편집된다(OE-WF-02).
  const again = await context.newPage()
  await open(again)
  await expect(again.locator('.draft-bar')).toHaveCount(0)
  await again.getByRole('button', { name: '편집', exact: true }).click()
  await expect(again.locator('.edit-bar')).toContainText('바뀐 것 1건')
  await expect(row(again, 'AHU-1').locator('.coord').first()).toHaveValue('2')
})

test('자동 저장에 남은 기록을 파일로 꺼내 [편집 불러오기] 로 불러올 수 있다 — 저장 자리가 달라도 편집 파일 형식은 같다 [OE-HIST-05#3~]', async ({ context }, info) => {
  const page = await context.newPage()
  await open(page)
  await page.getByRole('button', { name: '편집', exact: true }).click()
  const x = row(page, 'AHU-1').locator('.coord').first()
  await x.fill('2.5')
  await x.press('Enter')
  await page.waitForTimeout(1000)
  const saved = await page.evaluate(() => localStorage.getItem('oe-autosave:mep.ifc'))
  expect(saved).toBeTruthy()
  const path = info.outputPath('autosave.json')
  writeFileSync(path, saved!)

  // 다른 탭: 자동 저장은 [아니오] 로 지우고, 꺼내 둔 파일을 편집 파일로 불러온다.
  const other = await context.newPage()
  await open(other)
  await other.locator('.draft-bar').getByRole('button').last().click()
  await other.locator('.load-edits input').setInputFiles(path)
  await expect(other.locator('.edit-bar')).toContainText('바뀐 것 1건')
  await expect(row(other, 'AHU-1').locator('.coord').first()).toHaveValue('2.5')
})
