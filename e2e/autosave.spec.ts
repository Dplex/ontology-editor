import { expect, test, type Page } from '@playwright/test'

// 편집은 브라우저에 자동으로 남는다. 창이 죽어도 같은 IFC 를 다시 열면 이어서 할 수 있다.
const MEP = 'src/lib/ifc/fixtures/mep.ifc'

async function open(page: Page) {
  await page.goto('/')
  await page.locator('input[type=file]').first().setInputFiles(MEP)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
}

const row = (page: Page, name: string) => page.locator('.equipment tbody tr', { hasText: name })

test('편집이 자동으로 남고, 같은 파일을 다시 열면 "자동 저장된 내용을 반영하시겠습니까?" 를 묻고 [예] 면 그대로, [아니오] 면 지워 다시 묻지 않는다 [OE-HIST-04#1,2,3~]', async ({ context }) => {
  const first = await context.newPage()
  await open(first)
  await first.getByRole('button', { name: '편집', exact: true }).click()
  const x = row(first, 'AHU-1').locator('.coord').first()
  await x.fill('2')
  await x.press('Enter')
  await expect(first.locator('.edit-bar')).toContainText('바뀐 것 1건')
  // 자동 저장은 편집이 멈추고 잠시 뒤에 한다.
  await first.waitForTimeout(1000)

  // 창이 죽은 것처럼 새 탭에서 같은 파일을 연다(같은 브라우저 저장소).
  const second = await context.newPage()
  await open(second)
  const bar = second.locator('.draft-bar')
  await expect(bar).toContainText('자동 저장된 내용을 반영하시겠습니까?')
  await expect(bar).toContainText('편집 1건')
  // 열었다고 기록이 지워지지 않는다. [예] 를 누르면 편집 모드로 돌아와 그 편집이 다시 얹힌다.
  await bar.getByRole('button', { name: '예', exact: true }).click()
  await expect(bar).toHaveCount(0)
  await expect(second.locator('.edit-bar')).toContainText('바뀐 것 1건')
  await expect(row(second, 'AHU-1').locator('.coord').first()).toHaveValue('2')

  // [아니오] 면 다음에 열 때는 묻지 않는다.
  const third = await context.newPage()
  await open(third)
  await third.locator('.draft-bar').getByRole('button', { name: '아니오', exact: true }).click()
  const fourth = await context.newPage()
  await open(fourth)
  await expect(fourth.locator('.appbar h2')).toBeVisible()
  await fourth.waitForTimeout(300)
  await expect(fourth.locator('.draft-bar')).toHaveCount(0)
})

// 건축·설비를 합쳐 연 것(OE-BIM-22#2). 같은 두 파일을 다시 열면 고른 순서가 달라도 같은 조합이라 편집·출처·검토 상태(규칙 방향 확정)가
// 이어진다. 한쪽 파일만 열면 다른 조합이다 — 그 조합의 편집을 원본 없이 얹지 않는다(보정만 남은 채로 이어 하지 않는다).
const ROOMS = 'src/lib/ifc/fixtures/two-rooms.ifc'

test('건축·설비를 합쳐 연 편집은 같은 두 파일을 다시 열면 순서가 달라도 편집·출처·확정 상태가 이어지고, 한쪽만 열면 묻지 않는다 [OE-BIM-22#2~]', async ({ context }) => {
  const openPair = async (files: string[]) => {
    const page = await context.newPage()
    await page.goto('/')
    await page.locator('.drop input[type=file]').setInputFiles(files)
    await expect(page.locator('.appbar h2')).toHaveText('two-rooms.ifc + mep.ifc', { timeout: 30_000 })
    return page
  }
  const first = await openPair([MEP, ROOMS])
  await first.getByRole('button', { name: '편집', exact: true }).click()
  // 편집: 방 이름(BIM 값을 사람이 고침) · 설비 종류(출처 사람) · 계통의 규칙 방향 확정(검토 상태).
  const name = first.locator('.rows input').first()
  await name.fill('대회의실')
  await name.press('Enter')
  await row(first, 'AHU-1').getByRole('button', { name: 'AHU-1', exact: true }).click()
  await first.locator('.picked').getByRole('combobox', { name: '종류' }).first().selectOption({ label: '팬' })
  const rules = first.locator('.rule-systems')
  const ruleFold = first.locator('.fold-head', { hasText: '규칙 방향 확정 (계통별)' }).first()
  if ((await ruleFold.getAttribute('aria-expanded')) !== 'true') await ruleFold.click()
  await rules.locator('tbody tr').first().getByRole('button', { name: '확정', exact: true }).click()
  await expect(rules.locator('tbody tr', { hasText: '확정함' })).toHaveCount(1)
  await expect(first.locator('.edit-bar')).toContainText('바뀐 것 3건')
  await first.waitForTimeout(1000)

  // 같은 두 파일을 반대 순서로 연다.
  const second = await openPair([ROOMS, MEP])
  const bar = second.locator('.draft-bar')
  await expect(bar).toContainText('편집 3건')
  // 첫 단추가 되살리기다(이름은 OE-HIST-04 에서 [예] 로 바뀐다).
  await bar.getByRole('button').first().click()
  await expect(second.locator('.edit-bar')).toContainText('바뀐 것 3건')
  await expect(second.locator('.report')).toContainText('대회의실')
  await row(second, 'AHU-1').getByRole('button', { name: 'AHU-1', exact: true }).click()
  const kind = second.locator('.picked dl.facts > div').filter({ hasText: '종류' }).first()
  await expect(kind.locator('.src').first()).toHaveText('사람')
  const ruleFold2 = second.locator('.fold-head', { hasText: '규칙 방향 확정 (계통별)' }).first()
  if ((await ruleFold2.getAttribute('aria-expanded')) !== 'true') await ruleFold2.click()
  await expect(second.locator('.rule-systems tbody tr', { hasText: '확정함' })).toHaveCount(1)

  // 설비 파일만 열면 다른 조합이다. 두 파일을 합친 편집을 얹자고 묻지 않는다.
  const third = await context.newPage()
  await open(third)
  await expect(third.locator('.appbar h2')).toHaveText('mep.ifc')
  await third.waitForTimeout(300)
  await expect(third.locator('.draft-bar')).toHaveCount(0)
  await expect(third.getByText('대회의실')).toHaveCount(0)
})

test('[아니오] 면 자동 저장을 지우고, 편집 모드에 들어가면 그 층의 임시 저장본으로 열린다 [OE-HIST-04#3~]', async ({ context }) => {
  const first = await context.newPage()
  await open(first)
  await first.getByRole('button', { name: '편집', exact: true }).click()
  const x = () => row(first, 'AHU-1').locator('.coord').first()
  await x().fill('2')
  await x().press('Enter')
  // 임시 저장본(x=2)을 남기고 더 고친다(x=3). 자동 저장은 x=3 이다.
  await first.locator('.edit-bar').getByRole('button', { name: '임시 저장' }).click()
  await x().fill('3')
  await x().press('Enter')
  await first.waitForTimeout(1000)

  const second = await context.newPage()
  await open(second)
  await second.locator('.draft-bar').getByRole('button', { name: '아니오', exact: true }).click()
  await second.getByRole('button', { name: '편집', exact: true }).click()
  await expect(row(second, 'AHU-1').locator('.coord').first()).toHaveValue('2')
})

test('자동 저장은 이 브라우저의 복구용 기록 하나뿐이고 임시 저장본·버전을 만들지 않으며, 편집이 남은 채 탭을 닫으면 묻는다 [OE-HIST-04#4,5]', async ({ context }) => {
  const page = await context.newPage()
  const writes: string[] = []
  page.on('request', (r) => {
    if (r.method() !== 'GET') writes.push(`${r.method()} ${r.url()}`)
  })
  const asked: string[] = []
  page.on('dialog', (d) => {
    asked.push(d.type())
    void d.accept()
  })
  await open(page)
  await page.getByRole('button', { name: '편집', exact: true }).click()
  const x = row(page, 'AHU-1').locator('.coord').first()
  await x.fill('2')
  await x.press('Enter')
  await page.waitForTimeout(1000)
  // 편집 기록은 복구용 자동 저장 하나다. 층 임시 저장본(oe-draft:)은 [임시 저장] 을 눌렀을 때만 생긴다.
  const keys = await page.evaluate(() => Object.keys(localStorage).filter((k) => /^oe-(autosave|draft):/.test(k)))
  expect(keys).toEqual(['oe-autosave:mep.ifc'])
  // 서버에 아무것도 쓰지 않는다(임시 저장본·버전·완료 작업 없음).
  expect(writes).toEqual([])
  await page.close({ runBeforeUnload: true })
  await expect.poll(() => asked).toEqual(['beforeunload'])

  // 편집이 없으면 닫을 때 묻지 않는다.
  const clean = await context.newPage()
  await open(clean)
  await clean.locator('.draft-bar').getByRole('button', { name: '아니오', exact: true }).click()
  const cleanAsked: string[] = []
  clean.on('dialog', (d) => {
    cleanAsked.push(d.type())
    void d.accept()
  })
  await clean.close({ runBeforeUnload: true })
  await new Promise((r) => setTimeout(r, 300))
  expect(cleanAsked).toEqual([])
})
