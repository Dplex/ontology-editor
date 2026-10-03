import { expect, test, type Page } from '@playwright/test'

// 계통 편집(E8). 고른 설비 패널에서 계통 한 자리를 바꾸고, 범례에서 고른 계통의 종류·유체를 고친다. 리포트에 줄이
// 오르고 Ctrl+Z 로 한 단계씩 돌아온다.
const MEP = 'src/lib/ifc/fixtures/mep.ifc'

async function open(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(MEP)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '편집', exact: true }).click()
  return errors
}

async function undo(page: Page) {
  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('Control+z')
}

test('설비를 계통에서 빼고, 계통 종류·유체를 고치고, 되돌린다', async ({ page }) => {
  const errors = await open(page)
  const row = page.locator('.equipment tbody tr', { hasText: 'DUCT-01' })
  await row.getByRole('button', { name: 'DUCT-01', exact: true }).click()
  const picked = page.locator('.picked')
  await expect(picked.locator('.stats')).toContainText('AHU-1 급기 계통')
  await picked.locator('.system-edit select').selectOption('')
  await expect(picked.locator('.stats')).toContainText('(계통 없음)')
  await expect(page.locator('.report')).toContainText('DUCT-01: 계통 AHU-1 급기 계통 → (계통 없음)')

  // 범례에서 계통을 고르면 종류를 고칠 수 있다. 순환수면 유체 상자가 나온다.
  await page.locator('.legend button', { hasText: 'AHU-1 급기 계통' }).click()
  const system = page.locator('.system-picked')
  await expect(system).toContainText('급기')
  await system.locator('.system-kind-edit select').first().selectOption('hydronic_supply')
  await system.locator('.system-kind-edit select').nth(1).selectOption('chilled')
  await expect(system.locator('.stats')).toContainText('순환수 공급 · 냉수')
  await expect(page.locator('.report')).toContainText('종류 급기 → 순환수 공급 · 냉수')

  await undo(page)
  await expect(page.locator('.report')).toContainText('종류 급기 → 순환수 공급')
  await expect(page.locator('.report')).not.toContainText('냉수')
  await undo(page)
  await expect(page.locator('.report')).not.toContainText('종류 급기')
  await undo(page)
  await expect(page.locator('.report')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('새 계통을 만들어 설비를 넣고, 그 계통을 지우면 설비가 계통 없음이 되며, 되돌리면 차례로 돌아온다', async ({ page }) => {
  const errors = await open(page)
  await page.locator('.equipment tbody tr', { hasText: 'AT-101-01' }).getByRole('button', { name: 'AT-101-01', exact: true }).click()
  const picked = page.locator('.picked')
  await picked.getByRole('button', { name: '새 계통…' }).click()
  const form = picked.locator('.new-system')
  await form.locator('input').fill('2층 급기')
  await form.locator('select').selectOption('supply_air')
  await form.getByRole('button', { name: '만들어 넣기' }).click()
  await expect(picked.locator('.stats')).toContainText('2층 급기')
  const report = page.locator('.report')
  await expect(report).toContainText('계통 2층 급기를 만들었습니다')
  await expect(report).toContainText('AT-101-01: 계통 AHU-1 급기 계통 → 2층 급기')

  await page.locator('.legend button', { hasText: '2층 급기' }).click()
  await page.locator('.system-picked').getByRole('button', { name: '계통 지우기' }).click()
  await expect(page.locator('.legend')).not.toContainText('2층 급기')
  // 만들고 지운 계통은 리포트에 남지 않는다. 설비가 원래 계통을 떠난 것만 남는다.
  await expect(report).not.toContainText('2층 급기')
  await expect(report).toContainText('AT-101-01: 계통 AHU-1 급기 계통 → (계통 없음)')

  await undo(page)
  await expect(page.locator('.legend')).toContainText('2층 급기')
  await undo(page)
  await expect(page.locator('.legend')).not.toContainText('2층 급기')
  await expect(report).toHaveCount(0)
  expect(errors).toEqual([])
})

test('계통 없는 토출구는 패널과 검토 화면에 경고하고, 담당 공조기를 흐름으로 보인다 (OE-EQP-10)', async ({ page }) => {
  const errors = await open(page)
  const row = page.locator('.equipment tbody tr', { hasText: 'AT-101-01' })
  await row.getByRole('button', { name: 'AT-101-01', exact: true }).click()
  const picked = page.locator('.picked')
  // BIM 에서 연 그대로는 계통이 있어 경고가 없다. 담당은 흐름을 거슬러 닿는 공조기다.
  await expect(picked.locator('.stats')).toContainText('AHU-1 급기 계통')
  await expect(picked.locator('.system-missing')).toHaveCount(0)
  await expect(page.locator('.systemless')).toHaveCount(0)
  await expect(picked.locator('.basis')).toContainText('급기 ← AHU-1')

  // 계통을 비우면 패널에 경고, 검토 화면에 목록이 뜬다. 목록에서 누르면 그 토출구로 간다.
  await picked.locator('.system-edit select').selectOption('')
  await expect(picked.locator('.system-missing')).toContainText('디퓨저에 계통이 없습니다')
  const list = page.locator('.systemless')
  await expect(list).toContainText('1대')
  await expect(list).toContainText('AT-101-01')
  await page.getByRole('button', { name: '선택 해제' }).click()
  await list.getByRole('button', { name: 'AT-101-01' }).click()
  await expect(picked.locator('h3')).toHaveText('AT-101-01')

  // 되돌리면 계통이 돌아오고 경고가 사라진다.
  await undo(page)
  await expect(picked.locator('.stats')).toContainText('AHU-1 급기 계통')
  await expect(picked.locator('.system-missing')).toHaveCount(0)
  await expect(page.locator('.systemless')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('BIM 계통의 이름을 고치면 TTL 이름이 바뀌고, 편집 파일로 저장·불러오면 그대로이며, 되돌리면 앞 이름이다 (OE-PIP-09)', async ({ page }, info) => {
  // 2026-10-03 사용자 결정: BIM 이 준 계통도 이름을 고친다.
  const errors = await open(page)
  await page.locator('.legend button', { hasText: 'AHU-1 급기 계통' }).click()
  const system = page.locator('.system-picked')
  const name = system.getByLabel('계통 이름')
  await name.fill('1층 급기')
  await name.press('Enter')
  await expect(system.locator('h3')).toHaveText('1층 급기')
  await expect(system.locator('.system-renamed')).toContainText('BIM 이름 AHU-1 급기 계통')
  await expect(page.locator('.legend')).toContainText('1층 급기')
  await expect(page.locator('.report')).toContainText('계통 이름 AHU-1 급기 계통 → 1층 급기')
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT })

  const ttl = page.waitForEvent('download')
  await page.getByRole('button', { name: '의미 내보내기 (Brick TTL)' }).click()
  const text = Buffer.concat(await (await (await ttl).createReadStream()).toArray()).toString()
  expect(text).toContain('rdfs:label "1층 급기"')
  expect(text).not.toContain('"AHU-1 급기 계통"')

  // 편집 저장 → 다시 열기 → 불러오기.
  const saved = page.waitForEvent('download')
  await name.press('Control+s')
  const file = await saved
  const path = info.outputPath(file.suggestedFilename())
  await file.saveAs(path)
  page.on('dialog', (d) => void d.accept())
  await open(page)
  await page.locator('.load-edits input').setInputFiles(path)
  await expect(page.locator('.legend')).toContainText('1층 급기')

  // 되돌리기는 불러온 편집을 취소하지 않으므로, 새로 고친 것을 되돌려 본다.
  await page.locator('.legend button', { hasText: '1층 급기' }).click()
  await system.getByLabel('계통 이름').fill('잠깐 이름')
  await system.getByLabel('계통 이름').press('Enter')
  await expect(system.locator('h3')).toHaveText('잠깐 이름')
  await undo(page)
  await expect(system.locator('h3')).toHaveText('1층 급기')
  expect(errors).toEqual([])
})
