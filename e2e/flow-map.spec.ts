import { existsSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { enterEdit, pickEquipment } from './edit-part'

// 흐름 카드: 고른 설비에서 덕트·배관을 건너뛰고 받는 곳·보내는 곳 설비로 건너간다(flow-ladder.ts). 계통은 줄이 아니라 화살표 꼬리표다.
// 계산은 flow-ladder.test.ts 가 보고, 여기서는 칸을 눌러 건너가기·목록 펼치기·편집 뒤 다시 그리기를 본다.
// mep.ifc: AHU-1 → DUCT-01 → AT-101-01(포트 방향) · AT-101-02(SOURCEANDSINK, 방향 모름 — 규칙 방향이 정한다). 둘 다 사무실에 있다.
const MEP = 'src/lib/ifc/fixtures/mep.ifc'
const pick = (page: Page, name: string) =>
  pickEquipment(page, name)
/** 받는 곳·보내는 곳의 줄기(공급 사슬)와 방향 모름 줄. */
const line = (page: Page, key: string) => page.locator(`.flow-map .ladder-row[data-line="${key}"]`)

test('공조기를 고르면 덕트를 건너뛴 디퓨저와 그 방이 보내는 곳으로 보이고, 칸을 눌러 건너간다', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(MEP)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  await pick(page, 'AHU-1')

  // 머리의 한 줄: 무엇을 하는 설비인지.
  await expect(page.getByTestId('flow-summary')).toContainText('공조기 · 디퓨저 2대로 보냅니다(방 1곳)')
  const send = line(page, '보내는 곳:chain')
  await expect(send.locator('.ladder-head')).toHaveText('보내는 곳')
  // 덕트(DUCT-01)는 칸이 되지 않고, 화살표에 거쳐 간 계통 종류가 붙는다.
  await expect(send.locator('.ladder-chip')).toHaveText([/디퓨저 2/, /방 1곳/])
  await expect(send.locator('.ladder-arrow').first()).toContainText('급기')
  await expect(send.locator('.ladder-arrow').first()).toHaveAttribute('title', 'AHU-1 급기 계통')
  await expect(line(page, '받는 곳:chain')).toHaveCount(0)

  // 여러 대 칸은 그 줄 아래에 목록을 펼친다. 층·방 순이고, 누르면 그 설비로 간다.
  await send.getByRole('button', { name: /디퓨저 2/ }).click()
  const list = page.locator('.flow-map').getByTestId('ladder-list')
  await expect(list.locator('li')).toHaveCount(2)
  await expect(list.locator('li').first()).toContainText('사무실')
  await list.getByRole('button', { name: 'AT-101-01' }).click()
  await expect(page.locator('.picked h3')).toHaveText('AT-101-01')

  // 디퓨저에서 보면 공조기가 받는 곳이다. 한 대 칸은 누르는 대로 건너간다.
  await expect(page.getByTestId('flow-summary')).toContainText('공조기 1대에서 받습니다')
  await line(page, '받는 곳:chain').getByRole('button', { name: '공조기 AHU-1' }).click()
  await expect(page.locator('.picked h3')).toHaveText('AHU-1')

  // 방 칸은 한 곳이라 누르면 그 방을 연다.
  await line(page, '보내는 곳:chain').getByRole('button', { name: '방 1곳' }).click()
  await expect(page.locator('.space-picked h3')).toHaveText('사무실')
  expect(errors).toEqual([])
})

test('보기 모드에서는 흐름 카드가 답하고 근거(규칙 방향·직접 연결·경로)는 접혀 있다가 펴면 다른 설비에서도 편 채로 남고, 편집 모드는 펼친 그대로다', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(MEP)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  await pick(page, 'AHU-1')
  const more = page.locator('.picked').getByTestId('picked-more')
  await expect(page.getByTestId('flow-map')).toBeVisible()
  await expect(more).not.toHaveAttribute('open')
  await expect(page.locator('.picked .rule-box')).toBeHidden()
  await expect(page.locator('.picked .neighbors')).toBeHidden()
  await more.locator(':scope > summary').click()
  await expect(page.locator('.picked .neighbors')).toBeVisible()
  // 편 것은 다른 설비를 골라도 남는다 — 하나씩 다시 펴지 않게.
  await pick(page, 'AT-101-01')
  await expect(page.locator('.picked .neighbors')).toBeVisible()

  // 편집 모드에서는 여기서 방향을 정하므로 접지 않는다(감싸는 칸이 없다).
  await enterEdit(page)
  await pick(page, 'AHU-1')
  await expect(page.locator('.picked .picked-more')).toHaveCount(0)
  await expect(page.locator('.picked .neighbors')).toBeVisible()
  expect(errors).toEqual([])
})

test('방향을 모르는 연결은 방향 모름 줄로 따로 보이고, 방향을 정하면 보내는 곳으로 들어오며 되돌리면 돌아간다', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(MEP)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  await enterEdit(page)
  await pick(page, 'AHU-1')
  // 규칙 방향을 끄면 확정한 방향(포트·사람·확정한 규칙)만 남는다. 포트가 방향을 말하지 않고 규칙도 확정 전인 AT-101-02 는 방향 모름이다.
  await page.locator('.rule-toggle input').uncheck()
  const send = line(page, '보내는 곳:chain')
  const loose = line(page, '방향 모름')
  await expect(send.locator('.ladder-chip')).toHaveText(['디퓨저 AT-101-01', /방 1곳/])
  await expect(loose.locator('.ladder-chip')).toHaveText(['디퓨저 AT-101-02'])
  await expect(loose.locator('.ladder-tag')).toHaveText('급기')
  // 디퓨저 쪽에서 보면 받는 곳이 비고, 그 까닭(방향만 모른다)과 후보를 한 줄로 적는다.
  await pick(page, 'AT-101-02')
  await expect(page.getByTestId('flow-gap')).toHaveText('받는 곳: 덕트 방향이 정해지지 않았습니다. 방향 모름 줄에 받는 곳 후보가 있습니다(공조기 1).')
  await pick(page, 'AHU-1')

  // 덕트에서 AT-101-02 쪽으로 방향을 정한다(OE-PIP-04). 공조기의 보내는 곳에 둘이 같이 든다.
  await pick(page, 'DUCT-01')
  const terminal = page.locator('.picked .neighbors tr', { hasText: 'AT-101-02' })
  await terminal.getByTestId('flow-out').click()
  await page.getByTestId('flow-apply').click()
  await pick(page, 'AHU-1')
  await expect(send.locator('.ladder-chip').first()).toHaveText(/디퓨저 2/)
  await expect(loose).toHaveCount(0)

  await page.keyboard.press('Control+z')
  await expect(loose.locator('.ladder-chip')).toHaveText(['디퓨저 AT-101-02'])
  expect(errors).toEqual([])
})

// 실제 BIM(병원 HVAC, gitignore)에서 공조기 ↔ VAV ↔ 냉동기를 건너간다. 냉수 공급·환수가 둘 다 공조기에 붙어, 계통마다 줄을 두면
// 냉동기가 받는 곳과 보내는 곳에 두 번 나오는 파일이다.
const CLINIC = 'data/NBU_MedicalClinic/NBU_MedicalClinic_Eng-HVAC.ifc'
test('병원 공조기에서 VAV·냉동기로 건너가고, 공급·환수 두 관으로 붙은 냉동기는 한 번만 보인다', async ({ page }) => {
  test.skip(!existsSync(CLINIC), `${CLINIC} 이 없다(npm run fetch:sample)`)
  test.setTimeout(120_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(CLINIC)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 90_000 })
  const search = async (tag: string) => {
    await pickEquipment(page, tag, false)
  }

  await search('621849')
  // 받는 곳: 냉동기(순환수 공급·환수를 한 화살표로) · 그릴 110(환기). 보내는 곳: VAV 54 → 디퓨저 143.
  const receive = line(page, '받는 곳:chain')
  await expect(receive.locator('.ladder-chip')).toHaveText(['냉동기 #725669'])
  await expect(receive.locator('.ladder-arrow')).toContainText('순환수 공급·환수')
  await expect(page.locator('.flow-map .ladder-chip', { hasText: '냉동기 #725669' })).toHaveCount(1)
  await expect(page.locator('.flow-map .ladder-row', { hasText: '그릴 110' }).locator('.ladder-arrow')).toContainText('환기')
  const send = line(page, '보내는 곳:chain')
  await expect(send.locator('.ladder-chip')).toHaveText([/VAV 54/, /디퓨저 143/, /방 \d+곳/])

  // VAV 하나를 펼쳐 고른다.
  await send.getByRole('button', { name: /VAV 54/ }).click()
  const list = page.locator('.flow-map').getByTestId('ladder-list')
  await expect(list.locator('li')).toHaveCount(40)
  await list.getByRole('button', { name: '#603608' }).click()
  await expect(page.locator('.picked h3')).toContainText('603608')
  // VAV 의 받는 곳은 계통을 넘어 냉동기까지 이어진다.
  await expect(line(page, '받는 곳:chain').locator('.ladder-chip')).toHaveText(['냉동기 #725669', '공조기 #621849'])
  await expect(page.getByTestId('flow-summary')).toContainText('공조기 1대에서 받아 디퓨저 4대로 보냅니다')

  // 냉동기로 건너가면 공조기 둘 아래로 VAV 115대가 이어진다.
  await line(page, '받는 곳:chain').getByRole('button', { name: '냉동기 #725669' }).click()
  await expect(page.locator('.picked h3')).toContainText('725669')
  await expect(line(page, '받는 곳:chain')).toHaveCount(0)
  await expect(line(page, '보내는 곳:chain').locator('.ladder-chip')).toHaveText([/공조기 2/, /VAV 115/, /디퓨저 234/, /방 \d+곳/])
  expect(errors).toEqual([])
})
