import { expect, test } from '@playwright/test'
import { openFileMenu, openDrawer } from './edit-part'

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

  await openFileMenu(page)
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
  await openFileMenu(page)
  await page.getByRole('button', { name: '기하 내보내기 (GeoJSON)' }).click()
  await expect.poll(() => names.slice().sort()).toEqual(['floor-1F.geojson', 'floor-2F.geojson'])
})

test('TTL 은 한 파일로 내려받는다', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type=file]').setInputFiles(FIXTURE)
  await expect(page.getByRole('heading', { name: 'two-rooms.ifc' })).toBeVisible({ timeout: 30_000 })
  const download = page.waitForEvent('download')
  await openFileMenu(page)
  await page.getByRole('button', { name: '의미 내보내기 (Brick TTL)' }).click()
  expect((await download).suggestedFilename()).toBe('ontology.ttl')
})

test('3D 형상은 GLB·OBJ 한 파일로 내려받고, 요소 이름이 GlobalId 다', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type=file]').setInputFiles('src/lib/ifc/fixtures/mep.ifc')
  await expect(page.getByRole('heading', { name: 'mep.ifc' })).toBeVisible({ timeout: 30_000 })

  const glb = page.waitForEvent('download')
  await openFileMenu(page)
  await page.getByRole('button', { name: '3D 형상 내보내기 (GLB)' }).click()
  const glbFile = await glb
  expect(glbFile.suggestedFilename()).toBe('mep.glb')
  const bytes = await (await glbFile.createReadStream()).toArray()
  expect(Buffer.concat(bytes).subarray(0, 4).toString()).toBe('glTF')

  const obj = page.waitForEvent('download')
  await openFileMenu(page)
  await page.getByRole('button', { name: '3D 형상 내보내기 (OBJ)' }).click()
  const objFile = await obj
  expect(objFile.suggestedFilename()).toBe('mep.obj')
  const text = Buffer.concat(await (await objFile.createReadStream()).toArray()).toString()
  expect(text).toMatch(/^o \S+/m)
  expect(text).toMatch(/^v /m)
})

// FBX 는 서버의 Blender 가 GLB 를 바꾼다(src/server/fbx.ts). 변환 자체는 src/server/fbx.test.ts 가 실제 Blender 로 재고,
// 여기서는 화면이 GLB 를 보내고 받은 것을 .fbx 로 내려받는지·서버가 없거나 실패할 때 무엇을 보이는지를 본다.
test('FBX 는 GLB 를 서버에 보내 받은 파일을 내려받는다 (OE-INT-03)', async ({ page }) => {
  let sent: Buffer | null = null
  await page.route('**/__data/__fbx', async (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { enabled: true, version: '4.5.14' } })
    sent = route.request().postDataBuffer()
    await route.fulfill({ body: Buffer.from('Kaydara FBX Binary  \0\x1a\0'), contentType: 'application/octet-stream' })
  })
  await page.goto('/')
  await page.locator('input[type=file]').setInputFiles('src/lib/ifc/fixtures/mep.ifc')
  await expect(page.getByRole('heading', { name: 'mep.ifc' })).toBeVisible({ timeout: 30_000 })

  const fbx = page.waitForEvent('download')
  await openFileMenu(page)
  await page.getByRole('button', { name: '3D 형상 내보내기 (FBX)' }).click()
  const file = await fbx
  expect(file.suggestedFilename()).toBe('mep.fbx')
  expect(Buffer.concat(await (await file.createReadStream()).toArray()).subarray(0, 18).toString()).toBe('Kaydara FBX Binary')
  expect(sent!.subarray(0, 4).toString()).toBe('glTF')
})

test('FBX 변환 서버가 없으면 단추를 막고 까닭을 보이며, 변환이 실패하면 서버가 준 까닭을 알린다 (OE-INT-03)', async ({ page }) => {
  // e2e 는 data/ 서버를 붙이지 않는다(vite.config.ts). 가로채지 않으면 서버가 없는 화면이다.
  await page.goto('/')
  await page.locator('input[type=file]').setInputFiles('src/lib/ifc/fixtures/mep.ifc')
  await expect(page.getByRole('heading', { name: 'mep.ifc' })).toBeVisible({ timeout: 30_000 })
  await openFileMenu(page)
  const button = page.getByRole('button', { name: '3D 형상 내보내기 (FBX)' })
  await expect(button).toBeDisabled()
  await expect(button).toHaveAttribute('title', /서버/)

  await page.route('**/__data/__fbx', (route) =>
    route.request().method() === 'GET'
      ? route.fulfill({ json: { enabled: true, version: '4.5.14' } })
      : route.fulfill({ status: 500, json: { error: 'FBX 로 바꾸지 못했습니다: 시험용 실패' } }),
  )
  await page.reload()
  await page.locator('input[type=file]').setInputFiles('src/lib/ifc/fixtures/mep.ifc')
  await expect(page.getByRole('heading', { name: 'mep.ifc' })).toBeVisible({ timeout: 30_000 })
  await openFileMenu(page)
  await page.getByRole('button', { name: '3D 형상 내보내기 (FBX)' }).click()
  await expect(page.getByText('FBX 로 바꾸지 못했습니다: 시험용 실패')).toBeVisible()
  // 실패해도 단추가 다시 풀린다.
  await openFileMenu(page)
  await expect(page.getByRole('button', { name: '3D 형상 내보내기 (FBX)' })).toBeEnabled()
})

test('층별 요약의 [구축] 은 그 층의 TTL·GeoJSON 한 쌍만 받는다 (OE-GEN-11)', async ({ page }) => {
  // 두 층 fixture 에 설비 파일을 합쳤다. 1F 를 구축하면 1F 의 방·설비만 TTL 주어로 들고, 2F 방은 없다.
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(['src/lib/ifc/fixtures/mep.ifc', FIXTURE])
  await expect(page.locator('.appbar h2')).toHaveText('two-rooms.ifc + mep.ifc', { timeout: 30_000 })
  const files = new Map<string, string>()
  page.on('download', async (d) => files.set(d.suggestedFilename(), Buffer.concat(await (await d.createReadStream()).toArray()).toString()))
  // 층별 요약은 기준 · 검증 패널에 있다.
  await openDrawer(page)
  const head = page.getByRole('button', { name: /층별 요약/ })
  if ((await head.getAttribute('aria-expanded')) === 'false') await head.click()
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
