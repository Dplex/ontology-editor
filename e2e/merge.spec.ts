import { readFileSync } from 'node:fs'
import { expect, test, type Locator, type Page } from '@playwright/test'

// 건축·설비가 다른 IFC 를 합치는 길. 예전에는 하나를 열고 도구막대의 [덧붙이기] 를 찾아야 했고, 둘을 같이 끌어다 놓으면
// 첫 파일만 열리고 나머지는 조용히 버려졌다. 틀리기 쉬운 곳은 셋이다 — 고른 순서에 따라 결과가 달라지는 것, IDF 를 IFC
// 보다 먼저 얹어 방을 못 찾는 것, 편집한 뒤 합쳐서 편집이 기록에서 사라지는 것.
const MEP = 'src/lib/ifc/fixtures/mep.ifc'
const ROOMS = 'src/lib/ifc/fixtures/two-rooms.ifc'
const PROXY = 'src/lib/ifc/fixtures/proxy.ifc'
const IDF = 'src/lib/idf/fixtures/two-zones.idf'

function watchErrors(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  return errors
}

const tile = (page: Page, label: string) => page.locator('.tiles li', { hasText: label }).locator('b')

/** 파일 여럿을 끌어다 놓는다. 브라우저가 실제로 받는 DataTransfer 를 만든다. */
async function dropFiles(page: Page, target: Locator, paths: string[]) {
  const files = paths.map((p) => ({ name: p.split('/').pop()!, text: readFileSync(p, 'latin1') }))
  const dataTransfer = await page.evaluateHandle((list) => {
    const dt = new DataTransfer()
    for (const f of list) dt.items.add(new File([Uint8Array.from(f.text, (c) => c.charCodeAt(0))], f.name))
    return dt
  }, files)
  await target.dispatchEvent('drop', { dataTransfer })
}

test('건축·설비를 같이 고르면 하나로 합쳐 열리고, 고른 순서를 바꿔도 결과가 같다', async ({ page }) => {
  const errors = watchErrors(page)
  const seen: string[][] = []
  for (const order of [[MEP, ROOMS], [ROOMS, MEP]]) {
    await page.goto('/')
    await page.locator('.drop input[type=file]').setInputFiles(order)
    // 이름이 같아야 자동 저장 열쇠도 같다. 따로따로 덧붙인 것과도 같은 이름이다(smoke.spec).
    await expect(page.locator('.appbar h2')).toHaveText('two-rooms.ifc + mep.ifc', { timeout: 30_000 })
    seen.push(await Promise.all(['층', '물리존', '기기', '연결'].map((l) => tile(page, l).innerText())))
  }
  expect(seen[0]).toEqual(['2', '4', '5', seen[0][3]])
  expect(seen[1]).toEqual(seen[0])
  expect(errors).toEqual([])
})

test('둘을 같이 끌어다 놓아도 둘째 파일을 버리지 않는다', async ({ page }) => {
  const errors = watchErrors(page)
  await page.goto('/')
  await dropFiles(page, page.locator('section.drop'), [ROOMS, MEP])
  await expect(page.locator('.appbar h2')).toHaveText('two-rooms.ifc + mep.ifc', { timeout: 30_000 })
  await expect(tile(page, '물리존')).toHaveText('4')
  expect(errors).toEqual([])
})

test('IDF 를 IFC 보다 먼저 골라도 IFC 를 연 뒤에 얹어 방을 찾는다', async ({ page }) => {
  const errors = watchErrors(page)
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles([IDF, MEP])
  await expect(page.locator('.appbar h2')).toHaveText('mep.ifc + two-zones.idf', { timeout: 30_000 })
  // IDF 를 먼저 열었다면 층을 IDF 바닥 높이로 새로 세우고, 나중에 온 IFC 방은 공조존에 하나도 안 든다.
  await expect(page.locator('.tiles li', { hasText: '공조존' })).toContainText('존에 든 방 1/1')
  expect(errors).toEqual([])
})

test('방이 없는 설비 파일을 열면 요약 칸에서 바로 건축 파일을 덧붙이고, 합친 뒤에는 권하지 않는다', async ({ page }) => {
  const errors = watchErrors(page)
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(PROXY)
  await expect(page.locator('.appbar h2')).toHaveText('proxy.ifc', { timeout: 30_000 })
  const hint = page.locator('.pair-hint')
  await expect(hint).toContainText('방이 없는 설비 파일입니다')
  await hint.locator('input[type=file]').setInputFiles(ROOMS)
  await expect(page.locator('.appbar h2')).toHaveText('two-rooms.ifc + proxy.ifc', { timeout: 30_000 })
  await expect(hint).toHaveCount(0)
  expect(errors).toEqual([])
})

test('편집한 뒤에 덧붙여도 편집이 합친 모델에 그대로 남는다 — 이름·좌표·계통', async ({ page }) => {
  const errors = watchErrors(page)
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(MEP)
  await expect(page.locator('.appbar h2')).toHaveText('mep.ifc', { timeout: 30_000 })
  await page.keyboard.press('e')
  const name = page.locator('.rows input').first()
  await name.fill('대회의실')
  await name.press('Enter')
  // 공조기를 옮기고 계통에서 뺀다. 합친 모델에서 소속·규칙 방향을 다시 재야 하는 편집이다.
  await page.locator('.equipment tbody tr', { hasText: 'AHU-1' }).getByRole('button', { name: 'AHU-1', exact: true }).click()
  const picked = page.locator('.picked')
  const x = picked.locator('.position-edit .coord').first()
  await x.fill('2.5')
  await x.press('Enter')
  await picked.locator('.system-edit select').selectOption('')
  await expect(page.locator('.edit-bar')).toContainText('바뀐 것 3건')

  const append = page.locator('.appbar label.append')
  await expect(append).not.toHaveClass(/disabled/)
  await append.locator('input').setInputFiles(ROOMS)
  await expect(page.locator('.appbar h2')).toHaveText('two-rooms.ifc + mep.ifc', { timeout: 30_000 })
  await expect(tile(page, '물리존')).toHaveText('4')
  // 편집이 합친 모델에 다시 얹혔다. 되돌리기 이력만 끊긴다.
  await expect(page.locator('.edit-bar')).toContainText('바뀐 것 3건')
  const report = page.locator('.report')
  await expect(report).toContainText('대회의실')
  await expect(report).toContainText('AHU-1: 계통')
  await expect(page.locator('.edit-file-note')).toContainText('덧붙이기 전에 한 편집')
  await page.locator('.equipment tbody tr', { hasText: 'AHU-1' }).getByRole('button', { name: 'AHU-1', exact: true }).click()
  await expect(picked.locator('.position-edit .coord').first()).toHaveValue('2.5')
  await expect(picked.locator('.stats')).toContainText('(계통 없음)')
  expect(errors).toEqual([])
})
