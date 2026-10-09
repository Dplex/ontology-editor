import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

// 수동 공조존(OE-ZON-01·02). 편집 화면의 "공조존" 에서 담당 물리존을 골라 만들거나 경계를 그려 만들고, 담당 설비를 고르면 TTL 에서 그 설비가
// 공조존을 feeds 한다(계통도의 서비스 영역). mep.ifc 의 1F 사무실은 (0..10 × 0..8)이다.
const MEP = 'src/lib/ifc/fixtures/mep.ifc'

async function ttlOf(page: Page, out: string): Promise<string> {
  const [d] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '의미 내보내기 (Brick TTL)' }).click()])
  await d.saveAs(out)
  return readFileSync(out, 'utf8')
}

test('담당 물리존을 골라 공조존을 만들고 담당 설비를 고르면 TTL 에 HVAC_Zone 과 feeds 가 나가며, 경계를 그려 나눠 만들 수 있다', async ({ page }, info) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.addInitScript(() => {
    delete (window as any).showDirectoryPicker
  })
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(MEP)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '편집', exact: true }).click()

  const fold = page.getByTestId('hvac-zones')
  const head = fold.locator('.fold-head')
  if ((await head.getAttribute('aria-expanded')) !== 'true') await head.click()
  await expect(fold).toContainText('이 층에 만든 공조존이 없습니다')
  // ZON-01 담당 물리존을 골라 만든다.
  await fold.getByLabel('사무실').check()
  await fold.getByRole('button', { name: '고른 물리존으로 만들기' }).click()
  const zone = fold.locator('.zone-list li[data-zone]')
  await expect(zone).toHaveCount(1)
  await expect(zone).toContainText('담당 물리존 사무실')
  await fold.getByLabel('공조존 1 담당 설비 더하기').selectOption({ label: 'AHU-1 · 공조기' })
  await expect(zone).toContainText('AHU-1 ×')
  await expect(page.locator('.report')).toContainText('공조존 공조존 1을 만들었습니다')

  const ttl = await ttlOf(page, info.outputPath('zone.ttl'))
  const zoneId = await zone.getAttribute('data-zone')
  expect(ttl).toContain('a brick:HVAC_Zone')
  expect(ttl).toMatch(/rdfs:label "AHU-1"[\s\S]*?brick:feeds [^;]*/)
  expect(ttl.split('\n\n').find((b) => b.includes('rdfs:label "AHU-1"'))).toContain(zoneId!.replace(/\$/g, '\\$'))

  // ZON-02 경계를 그려 사무실을 나눈다. 두 존이 모두 사무실을 담당한다.
  for (const half of [[[0.2, 0.2], [5, 0.2], [5, 7.8], [0.2, 7.8]], [[5, 0.2], [9.8, 0.2], [9.8, 7.8], [5, 7.8]]] as const) {
    await fold.getByRole('button', { name: '경계를 그려 만들기' }).click()
    await page.locator('.viewport canvas').scrollIntoViewIfNeeded()
    for (const [x, y] of half) {
      const at = await page.evaluate(([px, py]) => (window as any).__viewer.point([px, py, 0]), [x, y])
      await page.mouse.click(at.x, at.y)
    }
    await page.keyboard.press('Enter')
  }
  await expect(zone).toHaveCount(3)
  await expect(zone.nth(1)).toContainText(/담당 물리존 사무실 \d+%/)
  await expect(zone.nth(2)).toContainText(/담당 물리존 사무실 \d+%/)

  // 지우고 Ctrl+Z 로 되돌린다.
  await zone.nth(2).getByRole('button', { name: '지우기' }).click()
  await expect(zone).toHaveCount(2)
  await page.locator('.edit-bar').click({ position: { x: 2, y: 2 } })
  await page.keyboard.press('Control+z')
  await expect(zone).toHaveCount(3)
  expect(errors).toEqual([])
})

test('공조존 검증이 공백·중복·설비 미지정을 보이고, 담당 물리존을 빼고 더하면 바로 다시 잰다 (OE-ZON-05 · OE-ZON-04)', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(MEP)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '편집', exact: true }).click()
  const fold = page.getByTestId('hvac-zones')
  const checks = fold.getByTestId('zone-checks')
  await expect(checks).toContainText('공조존이 아직 없는 층은 Z-01 을 세지 않습니다: 1F')

  await fold.getByLabel('사무실').check()
  await fold.getByRole('button', { name: '고른 물리존으로 만들기' }).click()
  await expect(checks.locator('li', { hasText: 'Z-04' })).toContainText('1개 — 공조존 1')
  await expect(checks.locator('li', { hasText: 'Z-01' })).toContainText('없음')
  // 경계를 그려 사무실 일부를 덮으면 공조존 1 과 같은 영역을 담당한다(Z-02).
  await fold.getByRole('button', { name: '경계를 그려 만들기' }).click()
  await page.locator('.viewport canvas').scrollIntoViewIfNeeded()
  for (const [x, y] of [[1, 1], [4, 1], [4, 4], [1, 4]]) {
    const at = await page.evaluate(([px, py]) => (window as any).__viewer.point([px, py, 0]), [x, y])
    await page.mouse.click(at.x, at.y)
  }
  await page.keyboard.press('Enter')
  await expect(checks.locator('li', { hasText: 'Z-02' })).toContainText('공조존 1 · 공조존 2')
  await fold.getByLabel('공조존 1 담당 설비 더하기').selectOption({ label: 'AHU-1 · 공조기' })
  await expect(checks.locator('li', { hasText: 'Z-04' })).toContainText('1개 — 공조존 2')
  await expect(checks.locator('li', { hasText: 'Z-05' })).toContainText('1개 — 공조존 2')

  // 공조존 1 에서 사무실을 빼려 하면 하나는 남겨야 해서 막는다.
  const first = fold.locator('.zone-list li[data-zone]').first()
  await first.getByRole('button', { name: '사무실 ×' }).click()
  await expect(page.locator('.key-note')).toContainText('담당 물리존을 하나 이상 남기세요')
  expect(errors).toEqual([])
})

test('공조존 경계를 다시 그리면 넓이와 담당 물리존 몫이 바뀌고, Ctrl+Z 로 돌아온다 (OE-ZON-04)', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(MEP)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '편집', exact: true }).click()
  const fold = page.getByTestId('hvac-zones')
  await fold.getByLabel('사무실').check()
  await fold.getByRole('button', { name: '고른 물리존으로 만들기' }).click()
  const zone = fold.locator('.zone-list li[data-zone]').first()
  await expect(zone).toContainText('80.0㎡')

  await zone.getByRole('button', { name: '경계 다시 그리기' }).click()
  await expect(page.locator('.key-note')).toContainText('공조존 1의 새 경계를 바닥에 찍습니다')
  await page.locator('.viewport canvas').scrollIntoViewIfNeeded()
  for (const [x, y] of [[0, 0], [5, 0], [5, 8], [0, 8]]) {
    const at = await page.evaluate(([px, py]) => (window as any).__viewer.point([px, py, 0]), [x, y])
    await page.mouse.click(at.x, at.y)
  }
  await page.keyboard.press('Enter')
  await expect(page.locator('.key-note')).toContainText('공조존 1의 경계를 다시 그렸습니다')
  await expect(zone).toContainText('40.0㎡')
  await expect(zone.getByRole('button', { name: '사무실 50% ×' })).toBeVisible()

  await page.locator('.edit-bar').click({ position: { x: 2, y: 2 } })
  await page.keyboard.press('Control+z')
  await expect(zone).toContainText('80.0㎡')
  await expect(zone.getByRole('button', { name: '사무실 ×' })).toBeVisible()
  expect(errors).toEqual([])
})

test('담당 설비의 흐름이 닿는 물리존이 후보로 보이고, 담당에 말단이 없으면 경고하며, 후보를 더하면 경고가 사라진다 (OE-MAP-02)', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(MEP)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '편집', exact: true }).click()
  const floor = async (x: number, y: number) => {
    const at = await page.evaluate(([px, py]) => (window as any).__viewer.point([px, py, 0]), [x, y])
    await page.mouse.click(at.x, at.y)
  }
  // 사무실을 x=2 에서 나눈다. 공조기(1,1)가 든 왼쪽 조각이 사무실-2 이고, 디퓨저 둘(x 3·7)은 사무실에 남는다.
  await page.locator('.viewport canvas').scrollIntoViewIfNeeded()
  await floor(9.6, 7.6)
  const room = page.locator('.space-picked')
  await room.getByRole('button', { name: '나누기' }).click()
  await floor(2, 0.5)
  await floor(2, 7.5)
  await expect(page.locator('.report')).toContainText('사무실-2')

  const fold = page.getByTestId('hvac-zones')
  await fold.getByLabel('사무실-2', { exact: true }).check()
  await fold.getByRole('button', { name: '고른 물리존으로 만들기' }).click()
  await fold.getByLabel('공조존 1 담당 설비 더하기').selectOption({ label: 'AHU-1 · 공조기' })
  // 포트가 말한 방향으로 닿는 디퓨저는 AT-101-01(사무실)뿐이다. AT-101-02 는 확정 전 규칙 방향이라 후보가 아니지만, 같은 사무실이다.
  const flow = fold.getByTestId('zone-flow-공조존 1')
  await expect(flow).toContainText('흐름이 닿는 물리존')
  const checks = fold.getByTestId('zone-checks')
  await expect(checks.locator('li', { hasText: '연결' })).toContainText('공조존 1 — 담당 물리존에 말단 없음(말단: 사무실)')
  await flow.getByRole('button', { name: '+ 사무실' }).click()
  await expect(flow).toContainText('사무실 ✓')
  await expect(checks.locator('li', { hasText: '연결' })).toContainText('없음')
  expect(errors).toEqual([])
})

test('설비 패널에서 담당 공조존을 더하고 빼며, 흐름이 닿는 물리존으로 새 공조존을 만든다 (OE-ZON-01)', async ({ page }) => {
  const AHU = '0MEP$Equip$AHU1$0000'
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(MEP)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '편집', exact: true }).click()
  const pickAhu = async () => {
    await page.locator('.viewport canvas').scrollIntoViewIfNeeded()
    const at = await page.evaluate((id) => (window as any).__viewer.part(id), AHU)
    await page.mouse.click(at.x, at.y)
    await expect(page.locator('.picked h3')).toHaveText('AHU-1')
  }
  await pickAhu()
  const panel = page.getByTestId('served-zones')
  await expect(panel).toContainText('담당 공조존 0')
  await panel.getByRole('button', { name: '흐름이 닿는 물리존으로 새 공조존 (사무실)' }).click()
  await expect(page.locator('.key-note')).toContainText('담당 물리존은 AHU-1의 흐름이 닿는 사무실입니다')
  await expect(panel.getByRole('button', { name: '공조존 1 ×' })).toBeVisible()
  const fold = page.getByTestId('hvac-zones')
  await expect(fold.locator('.zone-list li[data-zone]').first()).toContainText('AHU-1 ×')

  // 경계를 그려 공조존 2 를 만들고, 공조기 패널에서 담당으로 더한다.
  await fold.getByRole('button', { name: '경계를 그려 만들기' }).click()
  await page.locator('.viewport canvas').scrollIntoViewIfNeeded()
  await expect(page.locator('.key-note')).toContainText('공조존 경계를 그립니다')
  for (const [x, y] of [[1, 1], [4, 1], [4, 4], [1, 4]]) {
    const at = await page.evaluate(([px, py]) => (window as any).__viewer.point([px, py, 0]), [x, y])
    await page.mouse.click(at.x, at.y)
  }
  await page.keyboard.press('Enter')
  await expect(fold.locator('.zone-list li[data-zone]')).toHaveCount(2)
  await pickAhu()
  await panel.getByLabel('담당할 공조존 더하기').selectOption({ label: '공조존 2' })
  await expect(panel).toContainText('담당 공조존 2')
  await expect(fold.locator('.zone-list li[data-zone]').nth(1)).toContainText('AHU-1 ×')
  // 공조존 1 에서 빼면 공조존 목록의 담당 설비에서도 빠진다.
  await panel.getByRole('button', { name: '공조존 1 ×' }).click()
  await expect(panel).toContainText('담당 공조존 1')
  await expect(fold.locator('.zone-list li[data-zone]').first()).not.toContainText('AHU-1 ×')
  expect(errors).toEqual([])
})

test('실내기를 담당 공조존 밖으로 옮기면 다시 지정하라는 안내와 Z-06 이 뜬다 (OE-EQP-08)', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(MEP)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '편집', exact: true }).click()
  const row = page.locator('.equipment tbody tr', { hasText: 'AHU-1' })
  await row.getByRole('button', { name: 'AHU-1', exact: true }).click()
  // 픽스처에 실내기가 없어 공조기를 시스템에어컨 실내기로 바꿔 쓴다. 덕트가 붙어 있다.
  await page.locator('.kind-edit select').selectOption('indoor_unit')
  const panel = page.getByTestId('served-zones')
  await panel.getByRole('button', { name: '흐름이 닿는 물리존으로 새 공조존 (사무실)' }).click()
  const checks = page.getByTestId('hvac-zones').getByTestId('zone-checks')
  await expect(checks.locator('li', { hasText: 'Z-06' })).toContainText('없음')

  // 사무실(0..10) 밖으로 옮긴다.
  const x = row.locator('.coord').first()
  await x.fill('11')
  await x.press('Enter')
  await expect(page.locator('.edit-notice')).toContainText('실내기를 옮겼습니다. 담당 공조존을 다시 지정하세요(Z-06: AHU-1 — 물리존 밖에 있고 공조존 1 담당)')
  await expect(checks.locator('li', { hasText: 'Z-06' })).toContainText('1개 — AHU-1 — 물리존 밖에 있고 공조존 1 담당')
  expect(errors).toEqual([])
})

test('물리존 하나를 공조존 둘이 담당하면 물리존 패널에 둘 다 보인다 (OE-MAP-03)', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(MEP)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '편집', exact: true }).click()
  const fold = page.getByTestId('hvac-zones')
  for (let i = 0; i < 2; i++) {
    await fold.getByLabel('사무실').check()
    await fold.getByRole('button', { name: '고른 물리존으로 만들기' }).click()
  }
  await expect(fold.locator('.zone-list li[data-zone]')).toHaveCount(2)
  await page.locator('.viewport canvas').scrollIntoViewIfNeeded()
  const at = await page.evaluate(() => (window as any).__viewer.point([9.6, 7.6, 0]))
  await page.mouse.click(at.x, at.y)
  const zones = page.locator('.space-picked').getByTestId('space-zones')
  await expect(zones).toContainText('공조존 1')
  await expect(zones).toContainText('공조존 2')
  await expect(zones).toContainText('편집')
  expect(errors).toEqual([])
})
