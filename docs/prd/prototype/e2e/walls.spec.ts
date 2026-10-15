import { test, expect } from '@playwright/test'

// 벽·바닥(물리존 면)·천장이 보이는 샘플 — two-rooms.ifc(벽 4·방 3) + 방 위에 맞춘 IDF.
test('prototype: walls, floor and ceiling layers', async ({ page }) => {
  const errors:string[]=[]
  page.on('pageerror',e=>errors.push(e.message))
  await page.goto('/')
  await page.getByLabel('IFC IDF 가져오기',{exact:true}).setInputFiles(['.local/prototype-sample-import/two-rooms.ifc','.local/prototype-sample-import/two-rooms-zones.idf'])
  await expect(page.locator('.section-heading').filter({hasText:'사이트 & 층'})).toContainText('two-rooms',{timeout:60000})
  await expect(page.getByTestId('idf-summary')).toBeVisible()
  await page.getByRole('button',{name:/검토 완료/}).click()
  await page.locator('.floor-card').first().getByRole('button',{name:/→/}).click()
  await expect(page.locator('.studio-canvas')).toBeVisible()
  await page.getByLabel('천장 높이(m)').fill('2.7')
  await page.getByLabel('천장 높이(m)').press('Enter')
  await page.getByLabel('천장 높이(m)').blur()
  await page.waitForTimeout(1500)
  await page.screenshot({path:'.local/proto-walls-3d.png',fullPage:true})
  await page.getByRole('button',{name:'평면도',exact:true}).click()
  await page.waitForTimeout(500)
  await page.screenshot({path:'.local/proto-walls-plan.png',fullPage:true})
  expect(errors).toEqual([])
})
