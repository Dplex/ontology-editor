import { existsSync, readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { enterEdit, leaveMultiView, openMultiView, pickEquipment, toEquipment, toSpace } from './edit-part'

// 저장이 작업에 묶이는 것(OE-HIST-03 AC3·4, OE-PIP-15 AC7·8). 층 편집과 다중층 세션은 다른 작업 id 로 8084 에 저장되고, 다중층에 들어가서
// 나올 때까지의 저장은 층·모드가 달라도 한 작업이다. 들어가기 전 저장·나올 때 저장이 실패하면 화면을 옮기지 않고 편집을 남긴다.
// e2e 서버는 data/ 목록을 붙이지 않아서 `/__data` 를 여기서 흉내 낸다(saved-edits.spec.ts 와 같은 까닭). 서버가 작업을 어떻게 적는지는
// saved-edits.test.ts 가 잰다 — 여기서는 화면이 무엇을 언제 보내는지 본다.
// Duplex 건축 + HVAC. Level 1 변기 582915·582918 · Level 2 변기 582925 는 배관과 BIM 포트로 이어져 있어 연결 해제 보정이 한 번의 편집이다.
const ARCH = 'NBU_Duplex/NBU_Duplex-Apt_Arch.ifc'
const HVAC = 'NBU_Duplex/NBU_Duplex-Apt_Eng-HVAC.ifc'
const WC1 = 'M_Water Closet - Flush Tank:Private - 6.1 Lpf:Private - 6.1 Lpf:582915'
const WC2 = 'M_Water Closet - Flush Tank:Private - 6.1 Lpf:Private - 6.1 Lpf:582925'
const WC3 = 'M_Water Closet - Flush Tank:Private - 6.1 Lpf:Private - 6.1 Lpf:582918'
const profile = { profile: { schema: 'IFC2X3', storeys: 3, spaces: 10, devices: 10, conduits: 0, systems: 0, connections: 0, tiers: [], needsArchitecture: false, needsEquipment: false } }

type Put = { work: string; kind: string; storeys: string[] }

async function serve(page: Page, puts: Put[], fail: { on: boolean }) {
  const files = new Map([ARCH, HVAC].map((p) => [p, existsSync(`data/${p}`) ? readFileSync(`data/${p}`) : Buffer.alloc(0)]))
  let saved: unknown = null
  await page.route('**/__data/**', async (route) => {
    const req = route.request()
    const url = new URL(req.url())
    const path = decodeURIComponent(url.pathname.replace(/^\/__data\/?/, ''))
    if (path === '__edits') {
      const key = url.searchParams.get('key')
      if (!key) return route.fulfill({ json: [] })
      if (req.method() === 'PUT') {
        if (fail.on) return route.fulfill({ status: 500, json: { error: '디스크가 찼습니다' } })
        saved = JSON.parse(req.postData() ?? '{}')
        puts.push({ work: url.searchParams.get('work') ?? '', kind: url.searchParams.get('kind') ?? '', storeys: (url.searchParams.get('storeys') ?? '').split(',').filter(Boolean) })
        return route.fulfill({ json: { key, paths: key.split('|'), count: 1, savedAt: new Date().toISOString(), work: url.searchParams.get('work') } })
      }
      return saved ? route.fulfill({ json: saved }) : route.fulfill({ status: 404, json: { error: '저장본이 없습니다' } })
    }
    if (!path) return route.fulfill({ json: [...files].map(([p, b]) => ({ path: p, size: b.length })) })
    const body = files.get(path)
    if (!body) return route.fulfill({ status: 404 })
    if (url.search === '?profile') return route.fulfill({ json: profile })
    return route.fulfill({ body, contentType: 'application/octet-stream' })
  })
}

const banner = (page: Page) => page.getByTestId('multi-banner')
const toFloor = (page: Page) => leaveMultiView(page)
const undo = (page: Page) => page.getByRole('navigation', { name: '도구 레일' }).getByRole('button', { name: /실행취소/ })
const saveButton = (page: Page) => page.locator('.edit-bar').getByRole('button', { name: '편집 저장' })
/** 그 설비의 BIM 포트 연결 하나를 해제 보정한다 — 편집 하나. */
async function release(page: Page, text: string, name: string, reason: string) {
  await pickEquipment(page, name)
  const picked = page.locator('.picked')
  // 패널이 고른 설비로 바뀐 뒤에 센다. 바뀌기 전에 세면 앞에 고른 설비의 해제 수를 읽는다.
  await expect(picked.locator('h3').first()).toContainText(text)
  const released = picked.getByTestId('released-connections').locator('tbody tr')
  const before = await released.count()
  await picked.getByTestId('release-connection').first().click()
  await picked.getByTestId('release-reason').fill(reason)
  await picked.getByTestId('release-submit').click()
  await expect(released).toHaveCount(before + 1)
}

test('층 편집과 다중층 세션은 다른 작업으로 저장되고, 세션 안의 여러 층·모드·저장은 한 작업이며, 세션의 되돌리기는 앞 작업을 되돌리지 않는다 [OE-HIST-03#3] [OE-PIP-15#8~] [OE-PIP-15#7~]', async ({ page }) => {
  test.skip(!existsSync(`data/${ARCH}`) || !existsSync(`data/${HVAC}`), `data/${ARCH}·${HVAC} 이 없다(npm run fetch:sample)`)
  test.setTimeout(300_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  const puts: Put[] = []
  await serve(page, puts, { on: false })
  await page.goto('/')
  await page.getByRole('checkbox', { name: `${ARCH} 같이 열기` }).check()
  await page.getByRole('checkbox', { name: `${HVAC} 같이 열기` }).check()
  await page.getByRole('button', { name: '고른 2개 합쳐서 열기' }).click()
  await expect(page.locator('.appbar h2')).toContainText('+', { timeout: 180_000 })
  await page.getByRole('combobox', { name: '보일 층' }).selectOption({ label: 'Level 1' })
  await enterEdit(page)

  // 층 편집(Level 1)에서 하나 고치고 다중층으로 → 들어가기 전에 층 작업으로 저장된다. 되돌리기 이력은 비워져 세션에서 앞 작업을 못 되돌린다.
  await release(page, '582915', WC1, '층 편집에서 해제')
  await expect(undo(page)).toBeEnabled()
  await openMultiView(page, { from: 'Level 1', to: 'Level 2' })
  await expect(banner(page)).toContainText('Level 1 ~ Level 2 (2개 층)')
  await expect.poll(() => puts.length).toBe(1)
  expect(puts[0].kind).toBe('floor')
  expect(puts[0].storeys).toHaveLength(1)
  const level1 = puts[0].storeys[0]
  await expect(undo(page)).toBeDisabled()

  // 세션에서 Level 2 를 고쳐 중간에 저장하고, 공간 모드로 갔다 와서 Level 1 을 또 고친 뒤 나온다 → 둘 다 같은 다중층 작업이다.
  await release(page, '582925', WC2, '다중층에서 2층 해제')
  await saveButton(page).click()
  await expect.poll(() => puts.length).toBe(2)
  expect(puts[1].kind).toBe('multi')
  expect(puts[1].storeys).toHaveLength(1)
  expect(puts[1].storeys).not.toContain(level1)
  await toSpace(page)
  await toEquipment(page)
  await release(page, '582915', WC1, '다중층에서 1층 해제')
  // 세션 안의 되돌리기는 세션의 편집만 — 한 번 되돌리고 다시 한다.
  await undo(page).click()
  await page.getByRole('navigation', { name: '도구 레일' }).getByRole('button', { name: /다시실행/ }).click()
  await toFloor(page)
  await expect(banner(page)).toHaveCount(0)
  await expect.poll(() => puts.length).toBe(3)
  expect(puts[2]).toEqual({ work: puts[1].work, kind: 'multi', storeys: [level1] })
  expect(puts[1].work).not.toBe(puts[0].work)
  await expect(undo(page)).toBeDisabled()

  // 다시 층 편집에서 고쳐 저장하면 새 층 작업이다. 다음 다중층은 별도 세션이고, 고친 것 없이 나오면 아무것도 저장하지 않는다.
  await release(page, '582918', WC3, '다시 층 편집에서 해제')
  await saveButton(page).click()
  await expect.poll(() => puts.length).toBe(4)
  expect(puts[3].kind).toBe('floor')
  expect(new Set(puts.map((p) => p.work)).size).toBe(3)
  await openMultiView(page, { from: 'Level 1', to: 'Level 2' })
  await expect(banner(page)).toBeVisible()
  await toFloor(page)
  await expect(banner(page)).toHaveCount(0)
  expect(puts).toHaveLength(4)
  expect(errors).toEqual([])
})

test('들어가기 전 저장이 실패하면 층 편집에 남고, 나올 때 저장이 실패하면 다중층에 남으며, 둘 다 편집은 그대로다 [OE-HIST-03#4~] [OE-PIP-15#8~]', async ({ page }) => {
  test.skip(!existsSync(`data/${ARCH}`) || !existsSync(`data/${HVAC}`), `data/${ARCH}·${HVAC} 이 없다(npm run fetch:sample)`)
  test.setTimeout(300_000)
  const puts: Put[] = []
  const fail = { on: true }
  await serve(page, puts, fail)
  await page.goto('/')
  await page.getByRole('checkbox', { name: `${ARCH} 같이 열기` }).check()
  await page.getByRole('checkbox', { name: `${HVAC} 같이 열기` }).check()
  await page.getByRole('button', { name: '고른 2개 합쳐서 열기' }).click()
  await expect(page.locator('.appbar h2')).toContainText('+', { timeout: 180_000 })
  await page.getByRole('combobox', { name: '보일 층' }).selectOption({ label: 'Level 1' })
  await enterEdit(page)
  const released = page.locator('.picked').getByTestId('released-connections').locator('tbody tr')

  await release(page, '582915', WC1, '층 편집에서 해제')
  await openMultiView(page, { from: 'Level 1', to: 'Level 2' })
  await expect(page.locator('.key-note')).toContainText('층 편집을 서버에 저장하지 못해 다중층 뷰로 가지 않았습니다')
  await expect(banner(page)).toHaveCount(0)
  await expect(released).toHaveCount(1)
  await expect(undo(page)).toBeEnabled()
  expect(puts).toEqual([])

  fail.on = false
  await openMultiView(page, { from: 'Level 1', to: 'Level 2' })
  await expect(banner(page)).toBeVisible()
  await expect.poll(() => puts.length).toBe(1)
  await release(page, '582925', WC2, '다중층에서 2층 해제')
  fail.on = true
  await toFloor(page)
  await expect(page.locator('.key-note')).toContainText('다중층 작업을 서버에 저장하지 못해 다중층 뷰에 남았습니다')
  await expect(banner(page)).toBeVisible()
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT })
  await expect(released).toHaveCount(1)
  await expect(undo(page)).toBeEnabled()

  fail.on = false
  await toFloor(page)
  await expect(banner(page)).toHaveCount(0)
  await expect.poll(() => puts.length).toBe(2)
  expect(puts[1].kind).toBe('multi')
})
