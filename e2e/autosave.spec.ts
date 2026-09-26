import { expect, test, type Page } from '@playwright/test'

// 편집은 브라우저에 자동으로 남는다. 창이 죽어도 같은 IFC 를 다시 열면 이어서 할 수 있다.
const MEP = 'src/lib/ifc/fixtures/mep.ifc'

async function open(page: Page) {
  await page.goto('/')
  await page.locator('input[type=file]').first().setInputFiles(MEP)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
}

const row = (page: Page, name: string) => page.locator('.equipment tbody tr', { hasText: name })

test('편집이 자동으로 남고, 같은 파일을 다시 열면 이어서 할 수 있다', async ({ context }) => {
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
  await expect(bar).toContainText('편집 1건')
  // 열었다고 기록이 지워지지 않는다. 이어서 하기를 누르면 편집 모드로 돌아와 그 편집이 다시 얹힌다.
  await bar.getByRole('button', { name: '이어서 하기' }).click()
  await expect(bar).toHaveCount(0)
  await expect(second.locator('.edit-bar')).toContainText('바뀐 것 1건')
  await expect(row(second, 'AHU-1').locator('.coord').first()).toHaveValue('2')

  // 버리면 다음에 열 때는 묻지 않는다.
  const third = await context.newPage()
  await open(third)
  await third.locator('.draft-bar').getByRole('button', { name: '버리기' }).click()
  const fourth = await context.newPage()
  await open(fourth)
  await expect(fourth.locator('.appbar h2')).toBeVisible()
  await fourth.waitForTimeout(300)
  await expect(fourth.locator('.draft-bar')).toHaveCount(0)
})
