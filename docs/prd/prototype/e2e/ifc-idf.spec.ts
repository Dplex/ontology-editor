import { test, expect } from '@playwright/test'

// IFC(mep.ifc)와 IDF(two-zones.idf)를 같이 열었을 때 — 공조존이 물리존에 겹쳐 맞춰지고, 3D·평면도에서 존 종류 필터가 동작한다.
test('prototype: IFC + IDF together — 3D and plan with zone filter', async ({ page }) => {
  const errors:string[]=[]
  page.on('pageerror',e=>errors.push(e.message))
  await page.goto('/')
  await page.getByLabel('IFC IDF 가져오기',{exact:true}).setInputFiles(['src/lib/ifc/fixtures/mep.ifc','src/lib/idf/fixtures/two-zones.idf'])
  await expect(page.locator('.section-heading').filter({hasText:'사이트 & 층'})).toContainText('mep.ifc',{timeout:60000})
  await expect(page.getByTestId('idf-summary')).toBeVisible()
  await page.getByRole('button',{name:/검토 완료/}).click()
  await page.locator('.floor-card').first().getByRole('button',{name:/→/}).click()
  await expect(page.locator('.studio-canvas')).toBeVisible()
  await page.getByRole('button',{name:/^공조존/}).first().click()
  await page.locator('.object-list button').first().click()
  await expect(page.getByTestId('hvac-detail')).toContainText('담당 물리존')
  await page.waitForTimeout(1500)
  await page.screenshot({path:'.local/proto-ifc-idf-3d.png',fullPage:true})
  await page.getByRole('button',{name:'평면도',exact:true}).click()
  await page.waitForTimeout(500)
  await page.screenshot({path:'.local/proto-ifc-idf-plan.png',fullPage:true})
  await page.getByRole('group',{name:'존 종류별 보기 필터'}).getByRole('button',{name:/^물리존/}).click()
  await page.screenshot({path:'.local/proto-ifc-idf-plan-no-space.png',fullPage:true})
  expect(errors).toEqual([])
})
