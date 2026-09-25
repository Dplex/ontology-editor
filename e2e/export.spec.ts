import { expect, test } from '@playwright/test'

// GeoJSON 은 층마다 한 파일이다. 연달아 내려받으면 크롬이 "여러 파일 다운로드"를 묻고, 거절하면 둘째 파일부터
// 조용히 빠진다. 폴더를 고를 수 있으면 한 폴더에 쓰고, 못 하면 내려받는다. 두 길을 다 본다.
const FIXTURE = 'src/lib/ifc/fixtures/two-rooms.ifc'

test('폴더를 고를 수 있으면 층마다 한 파일씩 그 폴더에 쓴다', async ({ page }) => {
  // 폴더 고르기 창은 자동으로 누를 수 없어서, 쓴 파일을 기록하는 가짜로 바꾼다.
  await page.addInitScript(() => {
    const written: Record<string, string> = {}
    ;(window as any).__written = written
    ;(window as any).showDirectoryPicker = async () => ({
      getFileHandle: async (name: string) => ({
        createWritable: async () => {
          let text = ''
          return { write: async (t: string) => void (text += t), close: async () => void (written[name] = text) }
        },
      }),
    })
  })
  await page.goto('/')
  await page.locator('input[type=file]').setInputFiles(FIXTURE)
  await expect(page.getByRole('heading', { name: 'two-rooms.ifc' })).toBeVisible({ timeout: 30_000 })

  await page.getByRole('button', { name: '기하 내보내기 (GeoJSON)' }).click()
  await expect.poll(() => page.evaluate(() => Object.keys((window as any).__written).sort())).toEqual(['floor-1F.geojson', 'floor-2F.geojson'])
  const first = await page.evaluate(() => JSON.parse((window as any).__written['floor-1F.geojson']))
  expect(first.type).toBe('FeatureCollection')
  expect(first.features.some((f: any) => f.properties.kind === 'space')).toBe(true)
})

test('폴더를 고를 수 없으면 층마다 내려받는다', async ({ page }) => {
  await page.addInitScript(() => {
    delete (window as any).showDirectoryPicker
  })
  await page.goto('/')
  await page.locator('input[type=file]').setInputFiles(FIXTURE)
  await expect(page.getByRole('heading', { name: 'two-rooms.ifc' })).toBeVisible({ timeout: 30_000 })

  const names: string[] = []
  page.on('download', (d) => names.push(d.suggestedFilename()))
  await page.getByRole('button', { name: '기하 내보내기 (GeoJSON)' }).click()
  await expect.poll(() => names.slice().sort()).toEqual(['floor-1F.geojson', 'floor-2F.geojson'])
})

test('TTL 은 한 파일로 내려받는다', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type=file]').setInputFiles(FIXTURE)
  await expect(page.getByRole('heading', { name: 'two-rooms.ifc' })).toBeVisible({ timeout: 30_000 })
  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: '의미 내보내기 (Brick TTL)' }).click()
  expect((await download).suggestedFilename()).toBe('ontology.ttl')
})
