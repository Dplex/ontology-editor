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

test('3D 형상은 GLB·OBJ 한 파일로 내려받고, 요소 이름이 GlobalId 다', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type=file]').setInputFiles('src/lib/ifc/fixtures/mep.ifc')
  await expect(page.getByRole('heading', { name: 'mep.ifc' })).toBeVisible({ timeout: 30_000 })

  const glb = page.waitForEvent('download')
  await page.getByRole('button', { name: '3D 형상 내보내기 (GLB)' }).click()
  const glbFile = await glb
  expect(glbFile.suggestedFilename()).toBe('mep.glb')
  const bytes = await (await glbFile.createReadStream()).toArray()
  expect(Buffer.concat(bytes).subarray(0, 4).toString()).toBe('glTF')

  const obj = page.waitForEvent('download')
  await page.getByRole('button', { name: '3D 형상 내보내기 (OBJ)' }).click()
  const objFile = await obj
  expect(objFile.suggestedFilename()).toBe('mep.obj')
  const text = Buffer.concat(await (await objFile.createReadStream()).toArray()).toString()
  expect(text).toMatch(/^o \S+/m)
  expect(text).toMatch(/^v /m)
})

test('층별 요약의 [구축] 은 그 층의 TTL·GeoJSON 한 쌍만 받는다 (OE-GEN-11)', async ({ page }) => {
  // 두 층 fixture 에 설비 파일을 합쳤다. 1F 를 구축하면 1F 의 방·설비만 TTL 주어로 들고, 2F 방은 없다.
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(['src/lib/ifc/fixtures/mep.ifc', FIXTURE])
  await expect(page.locator('.appbar h2')).toHaveText('two-rooms.ifc + mep.ifc', { timeout: 30_000 })
  const files = new Map<string, string>()
  page.on('download', async (d) => files.set(d.suggestedFilename(), Buffer.concat(await (await d.createReadStream()).toArray()).toString()))
  await page.locator('.storeys tbody tr', { hasText: '1F' }).getByRole('button', { name: '1F 구축' }).click()
  await expect.poll(() => [...files.keys()].sort()).toEqual(['floor-1F.geojson', 'floor-1F.ttl'])
  const ttl = files.get('floor-1F.ttl')!
  expect(ttl).toContain('a brick:Floor')
  expect(ttl.match(/a brick:Floor/g)).toHaveLength(1)
  expect(ttl).toContain('"AHU-1"')
  const geo = JSON.parse(files.get('floor-1F.geojson')!)
  expect(geo.features.every((f: { properties: { storeyId?: string } }) => !f.properties.storeyId || f.properties.storeyId === geo.features[0].properties.storeyId)).toBe(true)
  await expect(page.locator('.storeys tbody tr', { hasText: '1F' }).getByRole('button', { name: '1F 구축' })).toHaveClass(/done/)
})
