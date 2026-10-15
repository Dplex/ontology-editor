import { existsSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'

// 공간 보기(App.vue 의 enterSpaceView, lib/space-view.ts). 보기 필터의 공간 칸에서 방을 고르면 그 방으로 가서 그 방 바닥을 채우고,
// 방 안 설비와 그 방 말단에 바람을 대는 공기 원천만 3D 에 남긴다. 화면 상태라 편집은 0건이다.
const MEP = 'src/lib/ifc/fixtures/mep.ifc'
const ROOMS = 'src/lib/ifc/fixtures/two-rooms.ifc'
const CLINIC = ['data/NBU_MedicalClinic/NBU_MedicalClinic_Arch.ifc', 'data/NBU_MedicalClinic/NBU_MedicalClinic_Eng-HVAC.ifc']
const viewer = <T,>(page: Page, fn: string) => page.evaluate((f) => (window as any).__viewer[f](), fn) as Promise<T>
const shown = (page: Page) => viewer<{ hidden: number; parts: number }>(page, 'shown')
const focus = (page: Page) => viewer<{ id: string | null; fill: boolean; slab: number }>(page, 'spaceFocus')

async function open(page: Page, files: string | string[]) {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.setViewportSize({ width: 1500, height: 900 })
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(files)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 120_000 })
  // 여러 파일은 하나를 먼저 열고 나머지를 합친다. 합치면 고른 것이 풀리니 합친 이름이 뜰 때까지 기다린다.
  if (Array.isArray(files)) await expect(page.locator('.appbar h2')).toContainText(' + ', { timeout: 120_000 })
  return errors
}

test('층의 방을 골라 그 방만 보고, 다른 방 바닥을 누르면 그 방으로 옮겨 가며, Esc 로 층 전체로 돌아온다', async ({ page }) => {
  const errors = await open(page, ROOMS)
  await page.getByTestId('filter-toggle').click()
  const spaces = page.getByTestId('filter-spaces')
  // 연 층(1F)의 방 둘. 방번호 순이다.
  await expect(spaces.locator('.space-facet')).toHaveText([/101\s*회의실/, /102\s*복도/])
  expect((await shown(page)).hidden).toBe(0)

  await spaces.locator('.space-facet', { hasText: '복도' }).click()
  await expect(page.getByTestId('space-chip')).toContainText('복도')
  await expect(page.locator('.space-picked h3')).toContainText('복도')
  const corridor = await focus(page)
  expect(corridor.fill).toBe(true)
  expect(corridor.slab).toBeLessThanOrEqual(0.08)

  // 회의실 바닥(2..6, 1..4)을 누르면 공간 보기가 회의실로 옮겨 간다. 복도에 다가선 시점에서는 회의실이 패널 밑이라 패널을 닫고 층 전체로 본다.
  await page.getByTestId('filter-toggle').click()
  const canvas = page.locator('.canvas-wrap > canvas').first()
  await canvas.scrollIntoViewIfNeeded()
  await page.keyboard.press('0')
  await page.waitForTimeout(800)
  const at = await page.evaluate(() => (window as any).__viewer.point([4, 2.5, 0.1]))
  await page.mouse.click(at.x, at.y)
  await expect(page.getByTestId('space-chip')).toContainText('회의실')
  expect((await focus(page)).id).not.toBe(corridor.id)

  // Esc 한 번은 방 고르기를, 한 번 더는 공간 보기를 푼다.
  await page.keyboard.press('Escape')
  await expect(page.locator('.space-picked')).toHaveCount(0)
  await expect(page.getByTestId('space-chip')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByTestId('space-chip')).toHaveCount(0)
  expect((await focus(page)).fill).toBe(false)
  expect((await shown(page)).hidden).toBe(0)
  expect(errors).toEqual([])
})

test('방 안 설비만 남기고, 방 패널의 [공간 보기] 로도 켜고 끈다', async ({ page }) => {
  const errors = await open(page, MEP)
  await page.getByTestId('filter-toggle').click()
  await page.getByTestId('filter-spaces').locator('.space-facet', { hasText: '사무실' }).click()
  const inside = Number(((await page.locator('.space-picked').textContent()) ?? '').match(/기기 (\d+)대/)?.[1])
  const s = await shown(page)
  expect(s.hidden).toBeGreaterThan(0)
  expect(s.parts - s.hidden).toBeGreaterThanOrEqual(inside)
  const toggle = page.getByTestId('space-view-toggle')
  await expect(toggle).toHaveText('층 전체 보기')
  await toggle.click()
  await expect(page.getByTestId('space-chip')).toHaveCount(0)
  expect((await shown(page)).hidden).toBe(0)
  await toggle.click()
  await expect(page.getByTestId('space-chip')).toContainText('사무실')
  expect(errors).toEqual([])
})

test('병원 1층: 화장실을 고르면 바람을 대는 공기 원천(다른 층 공조기·지붕 팬)이 패널에 나오고, 층을 바꾸면 공간 보기가 풀린다', async ({ page }) => {
  test.skip(!CLINIC.every(existsSync), '병원 BIM 이 없다(npm run fetch:sample)')
  test.setTimeout(240_000)
  const errors = await open(page, CLINIC)
  await page.getByRole('combobox', { name: '보일 층' }).selectOption({ label: 'First Floor만' })
  await page.getByTestId('filter-toggle').click()
  const spaces = page.getByTestId('filter-spaces')
  await expect(spaces.locator('.space-facet')).toHaveCount(154)
  await spaces.locator('.space-facet', { hasText: '1A09 W. TOILET' }).click()
  const src = page.getByTestId('space-sources')
  await expect(src.locator('li')).toHaveCount(2)
  await expect(src).toContainText('공조기 · 급기 1 · Second Floor')
  await expect(src).toContainText('팬 · 급기 0 · 환기 1 · Roof')
  const s = await shown(page)
  expect(s.parts - s.hidden).toBeLessThan(20)

  await page.getByRole('combobox', { name: '보일 층' }).selectOption({ label: 'Second Floor만' })
  await expect(page.getByTestId('space-chip')).toHaveCount(0)
  expect((await focus(page)).fill).toBe(false)
  expect(errors).toEqual([])
})
