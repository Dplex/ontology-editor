import { existsSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { openDrawer, toEquipment } from './edit-part'

// 외곽선 없는 물리존 채우기(OE-MAN-03). Duplex 건축은 Hallway 둘의 바닥 다각형이 없다(MEP 와 합치면 빌려온다). 검토 화면의 목록에서
// 하나를 누르면 그 층 3D 에서 점을 찍어 외곽선을 그리고, 같은 물리존에 외곽선이 생겨 목록에서 빠진다. 경고는 막지 않는다.
const ARCH = 'data/NBU_Duplex/NBU_Duplex-Apt_Arch.ifc'
/** Hallway 가 있는 Level 2 의 바닥 높이(m). 그리기·놓기는 이 높이의 바닥을 누른다. */
const LEVEL2 = 3.1

test('검토 화면의 "외곽선 없는 물리존" 에서 골라 그리면 같은 물리존에 외곽선이 생기고 목록에서 빠지며, Ctrl+Z 로 돌아온다 [OE-MAN-03#1] [OE-BIM-03#1]', async ({ page }) => {
  test.skip(!existsSync(ARCH), `${ARCH} 이 없다(npm run fetch:sample)`)
  test.setTimeout(120_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(ARCH)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 90_000 })

  await openDrawer(page)
  const list = page.getByTestId('outlineless')
  await expect(list).toContainText('2개')
  // 드로어의 이 칸은 접혀서 시작한다.
  if ((await list.locator('.fold-head').getAttribute('aria-expanded')) !== 'true') await list.locator('.fold-head').click()
  await expect(list.locator('li').first()).toContainText('BIM 면적 7.8㎡')
  // 물리존 수는 층 현황의 [물리존] 칸 숫자로 잰다(물리존 표는 #715 에서 빠졌다). 그리기에 들어가면 그 층을 본다.
  const spaces = async () => Number((await page.getByTestId('floor-status').getByRole('group', { name: '층 현황 종류' }).getByRole('button', { name: /물리존/ }).locator('b').innerText()).replace(/,/g, ''))
  await list.getByRole('button', { name: 'Hallway' }).first().click()
  await expect(page.getByRole('button', { name: '편집 종료' })).toBeVisible()
  const before = await spaces()

  // 층 바닥에 2 × 2 사각형을 찍고 Enter 로 닫는다.
  await page.locator('.canvas-wrap > canvas').scrollIntoViewIfNeeded()
  const z = LEVEL2
  for (const [x, y] of [[0, 0], [2, 0], [2, 2], [0, 2]]) {
    const at = await page.evaluate(([px, py, pz]) => (window as any).__viewer.point([px, py, pz]), [x, y, z])
    await page.mouse.click(at.x, at.y)
  }
  await page.keyboard.press('Enter')
  await expect(list).toContainText('1개')
  expect(await spaces()).toBe(before)
  // BIM 면적 7.8㎡ 와 그린 4㎡ 가 달라 경고한다(막지 않는다).
  await expect(page.locator('.edit-notice')).toContainText('BIM 면적 7.8㎡')

  await page.locator('.appbar h2').click()
  await page.keyboard.press('Control+z')
  await expect(list).toContainText('2개')
  expect(errors).toEqual([])
})

test('외곽선 없는 물리존에 외곽선을 그리면 그 안의 설비가 그 물리존에 소속되고, 바뀐 내용에 "(층까지만) → 물리존" 으로 남는다 [OE-MAN-03#3]', async ({ page }) => {
  test.skip(!existsSync(ARCH), `${ARCH} 이 없다(npm run fetch:sample)`)
  test.setTimeout(120_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(ARCH)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 90_000 })
  await openDrawer(page)
  const list = page.getByTestId('outlineless')
  if ((await list.locator('.fold-head').getAttribute('aria-expanded')) !== 'true') await list.locator('.fold-head').click()
  // Hallway 를 고르면 그 층의 편집으로 간다. 그리기는 일단 그만두고, 2층 방들 사이 빈 바닥(7, -9)에 설비를 하나 놓는다 — 어느 방에도 들지 않는다.
  await list.getByRole('button', { name: 'Hallway' }).first().click()
  await expect(page.getByRole('button', { name: '편집 종료' })).toBeVisible()
  await page.keyboard.press('Escape')
  await page.locator('.canvas-wrap > canvas').scrollIntoViewIfNeeded()
  const z = LEVEL2
  const floor = (x: number, y: number) => page.evaluate(([px, py, pz]) => (window as any).__viewer.point([px, py, pz]), [x, y, z]) as Promise<{ x: number; y: number }>
  await toEquipment(page)
  await page.getByRole('button', { name: '설비 더하기' }).click()
  const at = await floor(7, -9)
  await page.mouse.click(at.x, at.y)
  const picked = page.locator('.picked')
  await expect(picked.locator('h3')).toHaveText('새 설비 1')
  await expect(picked).toContainText('소속 방 없음')

  // 그 자리를 둘러 Hallway 의 외곽선을 그린다.
  await page.keyboard.press('Escape')
  await openDrawer(page)
  await list.getByRole('button', { name: 'Hallway' }).first().click()
  await page.locator('.canvas-wrap > canvas').scrollIntoViewIfNeeded()
  const z2 = LEVEL2
  for (const [x, y] of [[6.4, -9.6], [7.6, -9.6], [7.6, -8.4], [6.4, -8.4]]) {
    const p = (await page.evaluate(([px, py, pz]) => (window as any).__viewer.point([px, py, pz]), [x, y, z2])) as { x: number; y: number }
    await page.mouse.click(p.x, p.y)
  }
  await expect(page.locator('.draw-bar')).toContainText('4개')
  await page.keyboard.press('Enter')
  await expect(list).toContainText('1개')
  await expect(page.locator('.report')).toContainText('새 설비 1: (Level 2 층까지만) → Hallway')
  await expect(page.locator('.report')).toContainText('Hallway 0.0㎡ → 1.4㎡')
  expect(errors).toEqual([])
})
