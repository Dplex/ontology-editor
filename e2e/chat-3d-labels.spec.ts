import { existsSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'

// 3D 위 설비 라벨(V4, lib/equipment-labels.ts)과 온톨로지 챗 답 → 편집 화면 3D(R4, ADR-0063).
// 챗 창(scripts/docs-chat.js)은 dist 에 끼워 넣는 부속이라 개발 서버에는 없다 — 여기서 직접 끼우고, /__ask 는 가짜 응답이다.
// Duplex 1층 라디에이터 536919 의 GlobalId 는 300Pty59r6xB$nuduvUeBQ 다(TTL 로는 ex:300Pty59r6xB\$nuduvUeBQ).
const DUPLEX = 'data/NBU_Duplex/NBU_Duplex-Apt_Eng-MEP.ifc'
const RADIATOR = '300Pty59r6xB$nuduvUeBQ'

async function openDuplex(page: Page) {
  await page.setViewportSize({ width: 1500, height: 900 })
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(DUPLEX)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 90_000 })
}

test('Duplex: 층 하나를 볼 때 [라벨] 을 켜면 설비마다 이름과 소속·종류 배지가 겹치지 않게 뜨고, 누르면 고르며, 모든 층이면 끈다', async ({ page }) => {
  test.skip(!existsSync(DUPLEX), `${DUPLEX} 이 없다(npm run fetch:sample)`)
  test.setTimeout(120_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await openDuplex(page)
  const toggle = page.getByRole('button', { name: '라벨', exact: true })
  await page.getByRole('combobox', { name: '보일 층' }).selectOption({ label: '모든 층' })
  await expect(toggle).toBeDisabled()
  await page.getByRole('combobox', { name: '보일 층' }).selectOption({ label: 'Level 1만' })
  await toggle.click()
  const labels = page.getByTestId('eq-labels').locator('.eq-label')
  await expect(labels.first()).toBeVisible()
  const n = await labels.count()
  expect(n).toBeGreaterThan(3)
  expect(n).toBeLessThanOrEqual(40)
  // 라벨마다 배지 둘(소속·종류). 서로 겹치지 않는다.
  expect(await labels.first().locator('.eq-badge').count()).toBe(2)
  const boxes = await labels.evaluateAll((els) => els.map((el) => el.getBoundingClientRect()).map((r) => [r.left, r.top, r.right, r.bottom]))
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const [a, b] = [boxes[i], boxes[j]]
      expect(a[0] < b[2] - 0.5 && a[2] > b[0] + 0.5 && a[1] < b[3] - 0.5 && a[3] > b[1] + 0.5, `라벨 ${i}·${j} 겹침`).toBe(false)
    }
  // 누르면 그 설비를 고른다(패널 제목이 라벨 이름의 설비).
  const first = labels.first()
  const id = await first.getAttribute('data-id')
  await first.click()
  await expect(page.locator(`.eq-label.chosen[data-id="${id}"]`)).toHaveCount(1)
  await page.screenshot({ path: test.info().outputPath('labels.png') })
  // 모든 층으로 가면 라벨이 걷힌다.
  await page.getByRole('combobox', { name: '보일 층' }).selectOption({ label: '모든 층' })
  await expect(page.getByTestId('eq-labels')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('Duplex: [온톨로지] 답의 ex: id 로 편집 화면 3D 가 그 설비를 고르고 "3D 동작" 칩을 남기며, 없는 id 는 세기만 하고, [여기]·[다시 보기] 가 같은 길이다 (ADR-0063)', async ({ page }) => {
  test.skip(!existsSync(DUPLEX), `${DUPLEX} 이 없다(npm run fetch:sample)`)
  test.setTimeout(120_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  const asked: string[] = []
  await page.route('**/__ask', async (route) => {
    const req = route.request()
    if (req.method() === 'GET') return route.fulfill({ json: { enabled: true, sources: [{ source: 'duplex', title: 'Duplex', key: 'k', version: 1 }] } })
    asked.push(req.postData() ?? '')
    const text = `1층 라디에이터는 \`ex:300Pty59r6xB\\$nuduvUeBQ\` 입니다. 비교로 \`ex:NOPE_404\` 는 없습니다.`
    return route.fulfill({ contentType: 'application/x-ndjson', body: JSON.stringify({ type: 'text', text }) + '\n' })
  })
  await openDuplex(page)
  await page.getByRole('combobox', { name: '보일 층' }).selectOption({ label: 'Level 2만' })
  await page.addScriptTag({ path: 'scripts/docs-chat.js' })
  await page.keyboard.press('Alt+Shift+K')
  const chat = page.locator('#docs-chat')
  await chat.getByRole('button', { name: '온톨로지' }).click()
  await chat.locator('textarea').fill('1층 라디에이터는 어디야?')
  await chat.locator('textarea').press('Enter')
  const chip = chat.locator('.act')
  await expect(chip).toContainText('3D 동작 · 설비 1')
  await expect(chip).toContainText('BIM 에 없는 id 1')
  expect(asked).toHaveLength(1)
  // 서버로 가는 것은 질문·앞선 대화·고른 건물과 지금 화면(view)이다. 지금 화면은 id 와 정해진 값뿐이고 이름은 없다(ADR-0050 "보는 화면").
  const sent = JSON.parse(asked[0])
  expect(Object.keys(sent).sort()).toEqual(['history', 'question', 'source', 'view'])
  expect(sent.view).toMatchObject({ mode: '3d', storey: expect.any(String), selected: [] })
  expect(JSON.stringify(sent.view)).not.toContain('Level')
  // 고른 것이 라디에이터이고, 층이 1층으로 따라갔다.
  await expect(page.getByRole('combobox', { name: '보일 층' })).toHaveValue(/.+/)
  await expect(page.locator('.picked h3').first()).toContainText('536919')
  // 답의 id 옆에 [여기]·[3D].
  await expect(chat.locator('a[data-a="here"]')).toHaveCount(2)
  await expect(chat.locator('a', { hasText: '3D' })).toHaveCount(2)
  // 다른 것을 고른 뒤 [다시 보기] 면 다시 라디에이터다. 없는 id 의 [여기] 는 대상이 없다는 칩이다.
  // 창 안의 Esc 는 창을 닫으니, 바깥을 누른 뒤 Esc 로 고른 것을 푼다.
  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('Escape')
  await expect(page.locator('.picked h3').filter({ hasText: '536919' })).toHaveCount(0)
  await chip.getByRole('link', { name: '다시 보기' }).click()
  await expect(page.locator('.picked h3').first()).toContainText('536919')
  await chat.locator('a[data-a="here"][data-id="NOPE_404"]').click()
  await expect(chat.locator('.act.none')).toContainText('대상이 없습니다')
  await page.screenshot({ path: test.info().outputPath('chat-3d.png') })
  expect(errors).toEqual([])
})
