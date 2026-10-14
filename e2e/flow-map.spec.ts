import { existsSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'

// 흐름 지도: 고른 기기에서 덕트·배관을 건너뛰고 기기에서 기기로 건너간다(flow-ladder.ts). 계산은 flow-ladder.test.ts 가 보고,
// 여기서는 칸을 눌러 건너가기·목록 펼치기·편집 뒤 다시 그리기를 본다.
// mep.ifc: AHU-1 → DUCT-01 → AT-101-01(포트 방향) · AT-101-02(SOURCEANDSINK, 방향 모름 — 규칙 방향이 정한다). 둘 다 사무실에 있다.
const MEP = 'src/lib/ifc/fixtures/mep.ifc'
const pick = (page: Page, name: string) =>
  page.locator('.equipment tbody tr', { hasText: name }).last().getByRole('button', { name, exact: true }).click()

test('공조기를 고르면 덕트를 건너뛴 디퓨저와 그 방이 한 줄로 보이고, 칸을 눌러 건너간다', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(MEP)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  await pick(page, 'AHU-1')

  // 머리의 한 줄: 무엇을 하는 설비인지.
  await expect(page.getByTestId('flow-summary')).toContainText('공조기 · 디퓨저 2대로 보냅니다(방 1곳)')
  const chain = page.getByTestId('supply-chain')
  await expect(chain.locator('.ladder-me')).toHaveText('공조기 · 이 설비')
  // 덕트(DUCT-01)는 칸이 되지 않는다.
  await expect(chain.locator('.ladder-chip')).toHaveText([/디퓨저 2/, /방 1곳/])

  // 여러 대 칸은 목록을 펼친다. 층·방 순이고, 누르면 그 설비로 간다.
  await chain.getByRole('button', { name: /디퓨저 2/ }).click()
  const list = chain.getByTestId('ladder-list')
  await expect(list.locator('li')).toHaveCount(2)
  await expect(list.locator('li').first()).toContainText('사무실')
  await list.getByRole('button', { name: 'AT-101-01' }).click()
  await expect(page.locator('.picked h3')).toHaveText('AT-101-01')

  // 디퓨저에서 보면 공조기가 위 칸이다. 한 대 칸은 누르는 대로 건너간다.
  await expect(page.getByTestId('flow-summary')).toContainText('공조기 1대에서 받습니다')
  await page.getByTestId('supply-chain').getByRole('button', { name: '공조기 AHU-1' }).click()
  await expect(page.locator('.picked h3')).toHaveText('AHU-1')

  // 방 칸은 한 곳이라 누르면 그 방을 연다.
  await page.getByTestId('supply-chain').getByRole('button', { name: '방 1곳' }).click()
  await expect(page.locator('.space-picked h3')).toHaveText('사무실')
  expect(errors).toEqual([])
})

test('방향을 모르는 연결은 방향 모름 칸으로 따로 보이고, 방향을 정하면 사다리로 들어오며 되돌리면 돌아간다', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(MEP)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '편집', exact: true }).click()
  await pick(page, 'AHU-1')
  // 규칙 방향을 끄면 확정한 방향(포트·사람·확정한 규칙)만 남는다. 포트가 방향을 말하지 않고 규칙도 확정 전인 AT-101-02 는 방향 모름이다.
  await page.locator('.rule-toggle input').uncheck()
  const row = page.locator('.by-system li', { hasText: 'AHU-1 급기 계통' })
  await expect(row.locator('.ladder-chip.down')).toHaveText('디퓨저 AT-101-01')
  await expect(row.locator('.ladder-line.unknown')).toContainText('디퓨저 AT-101-02')

  // 덕트에서 AT-101-02 쪽으로 방향을 정한다(OE-PIP-04). 공조기 사다리의 다음 단계에 둘이 같이 든다.
  await pick(page, 'DUCT-01')
  const terminal = page.locator('.picked .neighbors tr', { hasText: 'AT-101-02' })
  await terminal.getByTestId('flow-out').click()
  await page.getByTestId('flow-apply').click()
  await pick(page, 'AHU-1')
  await expect(row.locator('.ladder-chip.down')).toHaveText(/디퓨저 2/)
  await expect(row.locator('.ladder-line.unknown')).toHaveCount(0)

  await page.keyboard.press('Control+z')
  await expect(row.locator('.ladder-line.unknown')).toContainText('디퓨저 AT-101-02')
  expect(errors).toEqual([])
})

// 실제 BIM(병원 HVAC, gitignore)에서 공조기 ↔ VAV ↔ 냉동기를 건너간다. 냉수 공급·환수가 둘 다 공조기에 붙어 계통을 섞으면 고리가 되는 파일이다.
const CLINIC = 'data/NBU_MedicalClinic/NBU_MedicalClinic_Eng-HVAC.ifc'
test('병원 공조기에서 VAV·냉동기로, VAV 에서 냉동기까지 공급 사슬이 이어진다', async ({ page }) => {
  test.skip(!existsSync(CLINIC), `${CLINIC} 이 없다(npm run fetch:sample)`)
  test.setTimeout(120_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(CLINIC)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 90_000 })
  const search = async (tag: string) => {
    await page.locator('input[type=search]').fill(tag)
    await page.locator('.equipment tbody tr', { hasText: tag }).first().getByRole('button').first().click()
  }

  await search('621849')
  const chain = page.getByTestId('supply-chain')
  // 냉동기 → [공조기] → VAV 54 → 디퓨저 143. 환기 그릴은 공급 사슬이 아니라 환기 계통 줄에 있다.
  await expect(chain.locator('.ladder-chip.up')).toHaveText(['냉동기 #725669'])
  await expect(chain.locator('.ladder-chip.down').first()).toHaveText(/VAV 54/)
  await expect(page.locator('.by-system li', { hasText: '환기' }).locator('.ladder-chip.up')).toHaveText(/그릴 110/)
  // 냉수 환수 줄에서는 냉동기가 아래 칸이다. 계통을 가르니 고리가 아니다.
  await expect(page.locator('.by-system li', { hasText: '순환수 환수' }).locator('.ladder-chip.down')).toHaveText('냉동기 #725669')

  // VAV 하나를 펼쳐 고른다.
  await chain.getByRole('button', { name: /VAV 54/ }).click()
  await expect(chain.getByTestId('ladder-list').locator('li')).toHaveCount(40)
  await chain.getByTestId('ladder-list').getByRole('button', { name: '#603608' }).click()
  await expect(page.locator('.picked h3')).toContainText('603608')
  await expect(page.getByTestId('supply-chain').locator('.ladder-chip.up')).toHaveText(['냉동기 #725669', '공조기 #621849'])
  await expect(page.getByTestId('flow-summary')).toContainText('공조기 1대에서 받아 디퓨저 4대로 보냅니다')

  // 냉동기로 건너가면 공조기 둘 아래로 VAV 115대가 이어진다.
  await page.getByTestId('supply-chain').getByRole('button', { name: '냉동기 #725669' }).click()
  await expect(page.locator('.picked h3')).toContainText('725669')
  await expect(page.getByTestId('supply-chain').locator('.ladder-chip.down')).toHaveText([/공조기 2/, /VAV 115/, /디퓨저 234/])
  await expect(page.getByTestId('supply-chain').locator('.ladder-chip.room')).toHaveText(/방 \d+곳/)
  expect(errors).toEqual([])
})
