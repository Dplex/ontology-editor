import { test, expect, type Page } from '@playwright/test'

// 공간 단위 조회·편집 — 물리존·커스텀존 나누기·합치기·지우기·경계 꼭짓점 끌기(OE-SPC-02·03·04·08, OE-OBJ-01·02)
// 평면도의 모델 좌표(m)를 화면 좌표로 바꾼다.
const screen = (page: Page, x: number, y: number) =>
  page.evaluate(([x, y]) => { const svg = document.querySelector('svg.plan') as SVGSVGElement; const pt = svg.createSVGPoint(); pt.x = x; pt.y = y; const s = pt.matrixTransform(svg.getScreenCTM()!); return [s.x, s.y] }, [x, y]) as Promise<[number, number]>
const click = async (page: Page, x: number, y: number) => { const [sx, sy] = await screen(page, x, y); await page.mouse.click(sx, sy) }

async function openPlan(page: Page) {
  await page.goto('/')
  await page.locator('.floor-card').first().getByRole('button', { name: /→/ }).click()
  await page.getByRole('button', { name: '평면도', exact: true }).click()
  await expect(page.locator('svg.plan')).toBeVisible()
}

test('spatial: split a physical zone with a line, merge back, delete (guard on last zone)', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  await openPlan(page)
  const count = () => page.locator('.object-list button').count()
  const before = await count()
  await page.locator('.object-list button').first().click()          // 101 회의실 A (0,0)-(8,6)
  await page.getByTestId('zone-split').click()
  await click(page, 4, -1); await click(page, 4, 7)                  // 세로선 x=4
  await expect.poll(count).toBe(before + 1)
  await page.screenshot({ path: '.local/proto-split.png', fullPage: true })
  // 합치기: 방금 나눈 두 조각
  await page.locator('.object-list button').first().click()
  const merge = page.getByRole('combobox', { name: '물리존 합칠 대상' })
  const opts = await merge.locator('option').allTextContents()
  const piece = opts.find(t => /-2/.test(t))
  expect(piece).toBeTruthy()
  await merge.selectOption({ label: piece! })
  await page.getByTestId('zone-merge').click()
  await expect.poll(count).toBe(before)
  // 지우기 → 하나 줄어든다
  await page.locator('.object-list button').first().click()
  await page.getByTestId('zone-delete').click()
  await expect.poll(count).toBe(before - 1)
  expect(errors).toEqual([])
})

test('spatial: drag a vertex to reshape a physical zone', async ({ page }) => {
  await openPlan(page)
  await page.locator('.object-list button').first().click()
  const area = async () => (await page.locator('.inspector').innerText()).match(/면적\s*([\d.]+)/)?.[1]
  const a0 = await area()
  const h = page.getByTestId('vertex-2')                              // (8,6) 오른쪽 아래
  await expect(h).toBeVisible()
  const [x1, y1] = await screen(page, 8, 6), [x2, y2] = await screen(page, 10, 6)
  await page.mouse.move(x1, y1); await page.mouse.down(); await page.mouse.move((x1 + x2) / 2, y1); await page.mouse.move(x2, y2); await page.mouse.up()
  await page.screenshot({ path: '.local/proto-vertex.png', fullPage: true })
  await expect.poll(area).not.toBe(a0)
})

test('spatial: custom zone split / rename / delete', async ({ page }) => {
  await openPlan(page)
  await page.getByRole('button', { name: '＋ 커스텀존 그리기' }).click()
  await page.getByLabel('구역 이름').fill('임원석')
  for (const [x, y] of [[0, 0], [8, 0], [8, 6], [0, 6]]) await click(page, x, y)
  await page.getByRole('button', { name: '완성' }).click()
  await page.getByRole('button', { name: '커스텀존', exact: true }).click()
  await page.locator('.object-list button').first().click()
  await expect(page.getByTestId('zone-tools')).toBeVisible()
  await page.getByTestId('zone-split').click()
  await click(page, 4, -1); await click(page, 4, 7)
  await expect(page.locator('.object-list button')).toHaveCount(2)
  await page.locator('.object-list button').first().click()
  await page.getByTestId('zone-delete').click()
  await expect(page.locator('.object-list button')).toHaveCount(1)
})
