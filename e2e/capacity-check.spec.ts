import { expect, test } from '@playwright/test'

// 용량 검증 Z-03(OE-ZON-05)과 그 입력값(OE-ZON-06). mep.ifc 의 1F 사무실(0..10 × 0..8)에 공조기 AHU-1 이 있고, 정격 풍량이
// DT_Capacity.NominalAirFlowRate 1.6667 m³/s(= 6,000 CMH)다. 사무실에는 설계 풍량이 없다.
const MEP = 'src/lib/ifc/fixtures/mep.ifc'
const AHU = '0MEP$Equip$AHU1$0000'

test('설계 풍량이 없으면 판정 불가, 사람이 넣으면 출처가 편집이 되고 Z-03 을 다시 판정하며, 되돌리면 판정 불가로 돌아온다 [OE-ZON-05#1~] [OE-ZON-06#5]', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(MEP)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '편집', exact: true }).click()

  // 공조기 패널: BIM 의 정격 풍량을 CMH 로 보이고 고칠 칸이 없다(OE-ZON-06#3).
  await page.locator('.canvas-wrap > canvas').scrollIntoViewIfNeeded()
  const at = await page.evaluate((id) => (window as any).__viewer.part(id), AHU)
  await page.mouse.click(at.x, at.y)
  await expect(page.locator('.picked h3')).toHaveText('AHU-1')
  const rated = page.getByTestId('rated-airflow')
  await expect(rated).toContainText('정격 풍량 6,000 CMH')
  await expect(rated.locator('.src')).toHaveText('BIM')
  await expect(rated.getByLabel('정격 풍량(CMH)')).toHaveCount(0)

  // 사무실로 공조존을 만들고 AHU-1 을 담당으로 고른다. 사무실에 설계 풍량이 없어 판정 불가다 — 경고로 칠하지 않는다.
  const fold = page.getByTestId('hvac-zones')
  const head = fold.locator('.fold-head')
  if ((await head.getAttribute('aria-expanded')) !== 'true') await head.click()
  await fold.getByLabel('사무실').check()
  await fold.getByRole('button', { name: '고른 물리존으로 만들기' }).click()
  await fold.getByLabel('공조존 1 담당 설비 더하기').selectOption({ label: 'AHU-1 · 공조기' })
  const checks = fold.getByTestId('zone-checks')
  const undetermined = checks.locator('li', { hasText: '용량 판정 불가' })
  const warn = checks.locator('li', { hasText: '정격 풍량이 담당 공조존의 설계 풍량 합보다 작은 설비' })
  await expect(undetermined).toContainText('AHU-1 — 공조존 1 설계 풍량 없음: 사무실')
  await expect(undetermined).not.toHaveClass(/warn/)
  await expect(warn).toContainText('없음')
  const zoneAir = fold.getByTestId('zone-airflow-공조존 1')
  await expect(zoneAir).toContainText('판정 불가 — 설계 풍량 없음: 사무실')

  // 공조존에 냉방 5,000 · 난방 7,000 을 넣으면 큰 값(난방)으로 판정해 경고가 뜬다(6,000 < 7,000).
  await zoneAir.getByLabel('공조존 1 냉방 설계 풍량(CMH)').fill('5000')
  await zoneAir.getByLabel('공조존 1 냉방 설계 풍량(CMH)').press('Enter')
  await expect(warn).toContainText('없음')
  await zoneAir.getByLabel('공조존 1 난방 설계 풍량(CMH)').fill('7000')
  await zoneAir.getByLabel('공조존 1 난방 설계 풍량(CMH)').press('Enter')
  await expect(zoneAir).toContainText('7,000 CMH(난방)')
  await expect(warn).toHaveClass(/warn/)
  await expect(warn).toContainText('AHU-1 정격 6,000 CMH < 공조존 1 설계 7,000 CMH(난방 기준)')
  await expect(undetermined).toContainText('없음')
  // 반영 결과 리포트에도 같은 경고가 실린다.
  await expect(page.getByTestId('report-zone-checks')).toContainText('AHU-1 정격 6,000 CMH < 공조존 1 설계 7,000 CMH(난방 기준)')

  // 되돌리면 판정 불가로 돌아온다.
  await page.locator('.edit-bar').click({ position: { x: 2, y: 2 } })
  await page.keyboard.press('Control+z')
  await page.keyboard.press('Control+z')
  await expect(undetermined).toContainText('AHU-1 — 공조존 1 설계 풍량 없음: 사무실')

  // 물리존 패널에서 방 단위로 넣어도 같다. 출처가 편집이다.
  await page.locator('.canvas-wrap > canvas').scrollIntoViewIfNeeded()
  const floor = await page.evaluate(() => (window as any).__viewer.point([6, 4, 0]))
  await page.mouse.click(floor.x, floor.y)
  await expect(page.locator('.space-picked h3')).toHaveText('사무실')
  const spaceAir = page.getByTestId('space-airflow')
  await spaceAir.getByLabel('냉방 설계 풍량(CMH)').fill('6500')
  await spaceAir.getByLabel('냉방 설계 풍량(CMH)').press('Enter')
  await expect(spaceAir.locator('.src')).toHaveText('사람')
  await expect(zoneAir).toContainText('6,500 CMH(냉방, 담당 물리존 합)')
  await expect(warn).toContainText('AHU-1 정격 6,000 CMH < 공조존 1 설계 6,500 CMH(냉방 기준)')
  // 0 은 값이 아니라 빈칸이다 — 지운 것과 같다.
  await spaceAir.getByLabel('냉방 설계 풍량(CMH)').fill('0')
  await spaceAir.getByLabel('냉방 설계 풍량(CMH)').press('Enter')
  await expect(undetermined).toContainText('AHU-1 — 공조존 1 설계 풍량 없음: 사무실')
  expect(errors).toEqual([])
})

test('방에 넣은 설계 풍량만 바꿔도 저장 안 한 편집으로 잡히고, 임시 저장 뒤 다시 열면 남아 있다 (OE-ZON-06 · OE-WF-01)', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(MEP)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '편집', exact: true }).click()
  await page.locator('.canvas-wrap > canvas').scrollIntoViewIfNeeded()
  const pickOffice = async () => {
    const floor = await page.evaluate(() => (window as any).__viewer.point([6, 4, 0]))
    await page.mouse.click(floor.x, floor.y)
    await expect(page.locator('.space-picked h3')).toHaveText('사무실')
  }
  await pickOffice()
  const cooling = page.getByTestId('space-airflow').getByLabel('냉방 설계 풍량(CMH)')
  await cooling.fill('6500')
  await cooling.press('Enter')
  await page.getByRole('button', { name: '편집 종료' }).click()
  const ask = page.locator('dialog.exit-edit')
  await expect(ask).toBeVisible()
  await ask.getByRole('button', { name: '임시 저장 후 종료' }).click()

  await page.reload()
  await page.locator('.drop input[type=file]').setInputFiles(MEP)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: '편집', exact: true }).click()
  await page.locator('.canvas-wrap > canvas').scrollIntoViewIfNeeded()
  await pickOffice()
  await expect(page.getByTestId('space-airflow').getByLabel('냉방 설계 풍량(CMH)')).toHaveValue('6500')
  expect(errors).toEqual([])
})
