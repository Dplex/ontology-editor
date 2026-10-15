import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { toSpace } from './edit-part'

// BIM 에서 받은 추가 공간 오브젝트(가구). 임포트가 IfcFurniture 를 오브젝트로 세우고(id 는 GlobalId), 연 때 있던 것이라 편집 수에 들지 않는다.
// 사람이 고치거나 지운 것만 편집 파일의 `bimObjects` 로 남아(edit-file.ts), 탭을 닫았다가 같은 파일을 다시 열어 이어서 하면 고친 크기는
// 그대로, 지운 것은 지운 채로 돌아온다. furniture.ifc 는 two-rooms.ifc 의 1F 회의실 (2..6, 1..4) 에 책상(바닥)과 상부장(1.4m 위)을 더했다.
const FIXTURE = 'e2e/fixtures/furniture.ifc'
const DESK = '0PoC$Furn$Desk$0000000'
const CABINET = '0PoC$Furn$Cabinet$0000'

const objects = (page: Page) => page.evaluate(() => (window as any).__viewer.objects()) as Promise<string[]>
const objectAt = (page: Page, id: string) => page.evaluate((x) => (window as any).__viewer.object(x), id) as Promise<{ x: number; y: number }>
const objectBox = (page: Page, id: string) => page.evaluate((x) => (window as any).__viewer.objectBox(x), id) as Promise<{ min: number[]; max: number[] }>

async function open(page: Page) {
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(FIXTURE)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
}
async function toEdit(page: Page) {
  await page.getByRole('button', { name: '편집', exact: true }).click()
  await toSpace(page)
  await page.getByRole('combobox', { name: '보일 층' }).selectOption({ label: '1F만' })
  await page.locator('.canvas-wrap > canvas').scrollIntoViewIfNeeded()
  await page.waitForTimeout(400)
}
/** GeoJSON 1F 를 내려받아 추가 공간 오브젝트만. */
async function exportObjects(page: Page, path: string) {
  const download = page.waitForEvent('download', (d) => d.suggestedFilename() === 'floor-1F.geojson')
  await page.getByRole('button', { name: '기하 내보내기 (GeoJSON)' }).click()
  await (await download).saveAs(path)
  const features = JSON.parse(readFileSync(path, 'utf8')).features as { id: string; properties: Record<string, unknown> }[]
  return features.filter((f) => f.properties.kind === 'spaceObject')
}

test('BIM 가구는 편집 수에 들지 않고, 고친 크기와 지운 것만 임시 저장본에 남아 다시 열어 이어서 하면 그대로다', async ({ context }, info) => {
  await context.addInitScript(() => {
    delete (window as any).showDirectoryPicker
  })
  const first = await context.newPage()
  const errors: string[] = []
  first.on('pageerror', (e) => errors.push(e.message))
  await open(first)
  await toEdit(first)

  // 연 때 두 개가 있고, 상부장은 바닥에서 1.4m 떠 있다(3D 는 y 가 위다). 편집이 아니라 바뀐 것이 없다.
  expect((await objects(first)).sort()).toEqual([CABINET, DESK].sort())
  expect((await objectBox(first, CABINET)).min[1]).toBeCloseTo(1.4, 2)
  expect((await objectBox(first, DESK)).min[1]).toBeCloseTo(0, 2)
  await expect(first.locator('.edit-bar')).toContainText('바뀐 것 0건')
  const opened = await exportObjects(first, info.outputPath('opened-1F.geojson'))
  expect(opened.map((f) => [f.id, f.properties.source, f.properties.base, f.properties.item]).sort()).toEqual(
    [
      [CABINET, 'bim', 1.4, 'cabinet'],
      [DESK, 'bim', 0, 'desk'],
    ].sort(),
  )

  // 책상 가로를 1.6m 로 키운다
  const panel = first.locator('.object-picked')
  const desk = await objectAt(first, DESK)
  await first.mouse.click(desk.x, desk.y)
  await expect(panel.locator('h3')).toHaveText('Desk:Office Desk')
  await panel.getByTestId('object-size-0').fill('1.6')
  await panel.getByTestId('object-size-0').press('Enter')
  await expect(first.locator('.edit-bar')).toContainText('바뀐 것 1건')

  // 상부장을 골라 지운다
  await first.locator('body').click({ position: { x: 5, y: 5 } })
  const cabinet = await objectAt(first, CABINET)
  await first.mouse.click(cabinet.x, cabinet.y)
  await expect(panel.locator('h3')).toHaveText('Cabinet:Upper')
  await first.keyboard.press('Delete')
  await expect.poll(() => objects(first)).toEqual([DESK])
  await expect(first.locator('.edit-bar')).toContainText('바뀐 것 2건')
  await expect(first.locator('.report, .changes').filter({ hasText: 'BIM 오브젝트 Cabinet:Upper — 지움' }).first()).toBeAttached()

  const before = await exportObjects(first, info.outputPath('before-1F.geojson'))
  expect(before.map((f) => [f.id, f.properties.size])).toEqual([[DESK, [1.6, 0.6, 0.75]]])
  // 자동 저장은 편집이 멈추고 잠시 뒤에 한다.
  await first.waitForTimeout(1000)
  expect(errors).toEqual([])
  await first.close()

  // 같은 파일을 다시 열면 임포트는 두 개를 다시 세우고, [예] 가 고친 크기와 지운 것을 얹는다.
  const second = await context.newPage()
  second.on('pageerror', (e) => errors.push(e.message))
  await open(second)
  const bar = second.locator('.draft-bar')
  await bar.getByRole('button', { name: '예', exact: true }).click()
  await expect(bar).toHaveCount(0)
  const after = await exportObjects(second, info.outputPath('after-1F.geojson'))
  expect(after).toEqual(before)
  await toEdit(second)
  expect(await objects(second)).toEqual([DESK])
  await expect(second.locator('.edit-bar')).toContainText('바뀐 것 2건')
  expect(errors).toEqual([])
})
