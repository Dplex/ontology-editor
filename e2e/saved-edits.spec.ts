import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'

// OE-COM-08 Phase 1. 저장은 8084 에 남아 다른 사람도 보고(웹에서 바로 확인), 임시 저장은 이 브라우저에만 남고(웹에 반영 안 됨)
// 목록에서 이어 간다. e2e 서버는 data/ 목록을 붙이지 않아서(data-list.spec.ts 와 같은 까닭) `/__data` 와 저장본을 여기서
// 흉내 낸다 — 저장본 자리는 src/server/saved-edits.ts 와 같은 모양이다(서버 자체는 saved-edits.test.ts 가 잰다).
const MEP = readFileSync('src/lib/ifc/fixtures/mep.ifc')
const PATH = '현장/mep.ifc'
const profile = { profile: { schema: 'IFC4', storeys: 1, spaces: 1, devices: 5, conduits: 0, systems: 0, connections: 0, tiers: [], needsArchitecture: false, needsEquipment: false } }

type Store = Map<string, { file: { savedAt: string }; count: number }>

async function serve(page: Page, store: Store, puts: string[]) {
  await page.route('**/__data/**', async (route) => {
    const req = route.request()
    const url = new URL(req.url())
    const path = decodeURIComponent(url.pathname.replace(/^\/__data\/?/, ''))
    if (path === '__edits') {
      const key = url.searchParams.get('key')
      if (!key) return route.fulfill({ json: [...store].map(([k, v]) => ({ key: k, paths: k.split('|'), count: v.count, savedAt: v.file.savedAt })) })
      if (req.method() === 'PUT') {
        const file = JSON.parse(req.postData() ?? '{}')
        const count = file.equipment.length
        store.set(key, { file, count })
        puts.push(key)
        return route.fulfill({ json: { key, paths: key.split('|'), count, savedAt: file.savedAt } })
      }
      const saved = store.get(key)
      return saved ? route.fulfill({ json: saved.file }) : route.fulfill({ status: 404, json: { error: '저장본이 없습니다' } })
    }
    if (!path) return route.fulfill({ json: [{ path: PATH, size: MEP.length }] })
    if (path !== PATH) return route.fulfill({ status: 404 })
    if (url.search === '?profile') return route.fulfill({ json: profile })
    return route.fulfill({ body: MEP, contentType: 'application/octet-stream' })
  })
}

const listRow = (page: Page) => page.locator('.catalog tr').filter({ hasText: PATH }).last()
const light = (page: Page) => page.locator('.equipment tbody tr', { hasText: 'LIGHT-101-01' }).last().locator('.coord').first()

async function openFromList(page: Page) {
  await listRow(page).getByRole('button', { name: '열기', exact: true }).click()
  await expect(page.locator('.appbar h2')).toHaveText('mep.ifc', { timeout: 30_000 })
}
async function editLight(page: Page, x: string) {
  if (!(await page.locator('.edit-bar').isVisible())) await page.getByRole('button', { name: '편집', exact: true }).click()
  await light(page).fill(x)
  await light(page).press('Enter')
}

test('저장하면 8084 에 남고, 다른 사람이 같은 파일을 열면 그 편집이 얹혀 보인다', async ({ page, browser }) => {
  const store: Store = new Map()
  const puts: string[] = []
  await serve(page, store, puts)
  await page.goto('/')
  await openFromList(page)
  await editLight(page, '7.5')
  await page.locator('.edit-bar').getByRole('button', { name: '편집 저장' }).click()
  await expect.poll(() => puts).toEqual([PATH])
  await expect(page.locator('.edit-bar .save-edits')).toHaveClass(/done/)

  // 다른 사람 = 저장소가 빈 새 브라우저
  const other = await browser.newPage()
  await serve(other, store, puts)
  await other.goto('/')
  await expect(listRow(other)).toContainText('저장 1건')
  await openFromList(other)
  await other.getByRole('button', { name: '편집', exact: true }).click()
  await expect(light(other)).toHaveValue('7.5')
  // 얹은 저장본은 "저장하지 않은 편집" 이 아니다 — 바로 끝내도 묻지 않는다
  await other.getByRole('button', { name: '편집 종료' }).click()
  await expect(other.locator('dialog.exit-edit')).not.toBeVisible()
  await other.close()
})

test('임시 저장은 8084 에 가지 않고, 처음 화면의 목록에서 열어 이어 간다', async ({ page }) => {
  const puts: string[] = []
  await serve(page, new Map(), puts)
  await page.goto('/')
  await openFromList(page)
  await editLight(page, '6.25')
  await page.getByRole('button', { name: '편집 종료' }).click()
  await page.locator('dialog.exit-edit').getByRole('button', { name: '임시 저장', exact: true }).click()
  expect(puts).toEqual([])

  await page.reload()
  const resume = page.locator('.catalog.resume tr', { hasText: 'mep.ifc' })
  await expect(resume).toContainText('임시 저장')
  await resume.getByRole('button', { name: '열어서 이어 하기' }).click()
  await expect(page.locator('.appbar h2')).toHaveText('mep.ifc', { timeout: 30_000 })
  await expect(light(page)).toHaveValue('6.25')
  expect(puts).toEqual([])
})

test('저장 안 함은 8084 저장본까지만 되돌린다', async ({ page }) => {
  const store: Store = new Map()
  const puts: string[] = []
  await serve(page, store, puts)
  await page.goto('/')
  await openFromList(page)
  await editLight(page, '7.5')
  await page.locator('.edit-bar').getByRole('button', { name: '편집 저장' }).click()
  await expect.poll(() => puts.length).toBe(1)

  await page.reload()
  await openFromList(page)
  await editLight(page, '9')
  await page.getByRole('button', { name: '편집 종료' }).click()
  // 저장본 위에서 더 고친 것만 센다
  await expect(page.locator('dialog.exit-edit')).toContainText('1건')
  await page.locator('dialog.exit-edit').getByRole('button', { name: '저장 안 함' }).click()
  await page.getByRole('button', { name: '편집', exact: true }).click()
  await expect(light(page)).toHaveValue('7.5')
})
