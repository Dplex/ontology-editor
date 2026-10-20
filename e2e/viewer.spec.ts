import { expect, test, type Download, type Page } from '@playwright/test'
import { enterEdit, openDrawer, openFileMenu, toEquipment, toSpace } from './edit-part'

// 내보낸 파일 뷰어(viewer.html). 에디터에서 내려받은 TTL·GeoJSON 을 그대로 다시 열어, 받는 쪽 규칙으로 읽은 것과 두 파일이
// id 로 이어지는지를 본다. 파일을 고르는 길은 사람이 하는 것과 같다(내려받기 → 파일 고르기).

/** 에디터에서 픽스처를 열고 TTL·GeoJSON 을 내려받아 파일 경로를 돌려준다. 폴더 고르기 창은 꺼서 층마다 내려받게 한다. */
async function exported(page: Page, fixture: string, outputPath: (name: string) => string, with3d = false): Promise<string[]> {
  await page.addInitScript(() => {
    delete (window as any).showDirectoryPicker
  })
  await page.goto('/')
  await page.locator('input[type=file]').first().setInputFiles(`src/lib/ifc/fixtures/${fixture}`)
  await expect(page.getByRole('heading', { name: fixture })).toBeVisible({ timeout: 30_000 })
  const saved: Promise<string>[] = []
  const onDownload = (d: Download) => saved.push(d.saveAs(outputPath(d.suggestedFilename())).then(() => outputPath(d.suggestedFilename())))
  page.on('download', onDownload)
  await openFileMenu(page)
  await page.getByRole('button', { name: '의미 내보내기 (Brick TTL)' }).click()
  await openFileMenu(page)
  await page.getByRole('button', { name: '기하 내보내기 (GeoJSON)' }).click()
  await expect.poll(() => saved.length).toBeGreaterThanOrEqual(2)
  if (with3d) {
    const before = saved.length
    await openFileMenu(page)
    await page.getByRole('button', { name: '3D 형상 내보내기 (GLB)' }).click()
    await expect.poll(() => saved.length).toBe(before + 1)
    await openFileMenu(page)
    await page.getByRole('button', { name: '3D 형상 내보내기 (OBJ)' }).click()
    await expect.poll(() => saved.length).toBe(before + 2)
  }
  await page.waitForTimeout(500)
  // 다음 파일을 내보낼 때 이 이름으로 덮어쓰지 않게 뗀다.
  page.off('download', onDownload)
  return Promise.all(saved)
}

test('에디터가 낸 두 파일을 열면 받는 쪽이 읽는 주어·관계가 보이고, 검사가 전부 0 이다', async ({ page }, info) => {
  const files = await exported(page, 'mep.ifc', (n) => info.outputPath(n))
  expect(files.some((f) => f.endsWith('ontology.ttl'))).toBe(true)

  await page.goto('/viewer.html')
  await page.getByLabel('내보낸 파일 고르기').setInputFiles(files)
  const summary = page.getByRole('region', { name: '요약' })
  await expect(summary).toContainText('feeds')
  // 덕트·배관은 TTL 에 있지만 받는 쪽이 읽지 않는다. 따로 센다.
  await expect(summary).toContainText('미사용 엔티티: fso:')
  const checks = page.locator('.checks > ul > li')
  await expect(checks).toHaveCount(5)
  await expect(page.locator('.checks li.bad')).toHaveCount(0)

  // 평면의 기기를 누르면 TTL 의 위치와 GeoJSON 의 소속이 나란히 보인다.
  await page.locator('circle.shape.equipment:not(.unread)').first().click()
  const detail = page.getByRole('complementary', { name: '선택 항목' })
  await expect(detail).toContainText('hasLocation')
  await expect(detail).toContainText('spaceId')
})

test('짝이 아닌 TTL 과 GeoJSON 을 같이 열면 TTL 에 없는 feature 를 센다', async ({ page }, info) => {
  const mep = await exported(page, 'mep.ifc', (n) => info.outputPath(`mep-${n}`))
  const other = await exported(page, 'two-rooms.ifc', (n) => info.outputPath(`rooms-${n}`))
  await page.goto('/viewer.html')
  // two-rooms 의 TTL + mep 의 GeoJSON. 파일 이름이 겹치지 않게 앞에 붙인 것을 뷰어는 확장자로만 가른다.
  await page.getByLabel('내보낸 파일 고르기').setInputFiles([...other.filter((f) => f.endsWith('.ttl')), ...mep.filter((f) => f.endsWith('.geojson'))])
  const bad = page.locator('.checks li.bad').filter({ hasText: 'TTL 에 없는 feature' })
  await expect(bad).toBeVisible()
  // 누르면 그 feature 를 고른다.
  await bad.locator('summary').click()
  await bad.locator('.ids button').first().click()
  await expect(page.getByRole('complementary', { name: '선택 항목' })).toContainText('TTL 에 이 id 의 엔티티가 없습니다')
})

test('GLB·OBJ 도 같이 열면 3D 로 보이고, GeoJSON 과 같은 id·자리인지 재며, 고른 것의 원문이 보인다', async ({ page }, info) => {
  const files = await exported(page, 'mep.ifc', (n) => info.outputPath(n), true)
  expect(files.filter((f) => /\.(glb|obj)$/.test(f))).toHaveLength(2)
  await page.goto('/viewer.html')
  await page.getByLabel('내보낸 파일 고르기').setInputFiles(files)
  // TTL·GeoJSON 다섯 줄 + 3D 파일마다 세 줄. kind 를 싣는 GLB 는 종류 어긋남 한 줄이 더 있다.
  await expect(page.locator('.checks > ul > li')).toHaveCount(12)
  await expect(page.locator('.checks li.bad')).toHaveCount(0)

  // 평면에서 기기를 고르고 3D 로 넘어가도 고른 것이 남는다. 오른쪽에 3D 객체와 TTL 원문이 나온다.
  await page.locator('circle.shape.equipment:not(.unread)').first().click()
  await page.getByRole('tab', { name: '3D · GLB' }).click()
  await expect(page.getByRole('img', { name: '3D 형상' }).locator('canvas')).toBeVisible()
  const detail = page.getByRole('complementary', { name: '선택 항목' })
  await expect(detail).toContainText('삼각형')
  await expect(detail.locator('pre.source').first()).toContainText(' a brick:')
  // OBJ 는 extras 가 없어 종류 없이 이름(GlobalId)만 있다.
  await page.getByRole('tab', { name: '3D · OBJ' }).click()
  await expect(detail).toContainText('.obj')
  await expect(detail).toContainText('삼각형')
})

// FBX 는 서버의 Blender 가 만든다(src/server/fbx.ts). e2e 에는 Blender 가 없어서 같은 mep.ifc 로 만들어 둔 src/lib/export/fixtures/mep.fbx 를 놓는다.
test('FBX 를 같이 열면 3D 로 보이고, 사용자 속성으로 종류를 읽어 GeoJSON 과 견주며, 고른 것의 속성이 보인다 (OE-INT-03)', async ({ page }, info) => {
  const files = await exported(page, 'mep.ifc', (n) => info.outputPath(n))
  await page.goto('/viewer.html')
  await page.getByLabel('내보낸 파일 고르기').setInputFiles([...files, 'src/lib/export/fixtures/mep.fbx'])
  await expect(page.getByRole('tab', { name: '3D · FBX' })).toBeVisible()
  // TTL·GeoJSON 다섯 줄 + FBX 네 줄(어디에도 없는 객체·3D 에 없는 형상·자리 어긋남·종류 어긋남).
  await expect(page.locator('.checks > ul > li')).toHaveCount(9)
  await expect(page.locator('.checks li.bad')).toHaveCount(0)
  await expect(page.getByText(/mep\.fbx · 객체 \d+ · 삼각형/)).toBeVisible()

  await page.getByRole('tab', { name: '3D · FBX' }).click()
  await expect(page.getByRole('img', { name: '3D 형상' }).locator('canvas')).toBeVisible()
  await expect(page.getByText('FBX 의 색(계통·벽 종류)은 파일에 든 그대로입니다.')).toBeVisible()
  // 평면에서 기기를 고르고 3D 로 넘어가면 오른쪽에 그 객체의 FBX 사용자 속성이 보인다.
  await page.getByRole('tab', { name: '평면(GeoJSON)' }).click()
  await page.locator('circle.shape.equipment:not(.unread)').first().click()
  await page.getByRole('tab', { name: '3D · FBX' }).click()
  const detail = page.getByRole('complementary', { name: '선택 항목' })
  await expect(detail).toContainText('mep.fbx')
  await expect(detail).toContainText(' · equipment')
  await expect(detail.locator('.props3d')).toContainText('kind = equipment')
  await expect(detail.locator('.props3d')).toContainText('systemId = ')
})

test('층별로 구축한 TTL 을 여럿 놓으면 쌓아 읽고, 건물 전체 TTL 을 놓으면 바꾼다 (OE-GEN-11)', async ({ page }, info) => {
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(['src/lib/ifc/fixtures/mep.ifc', 'src/lib/ifc/fixtures/two-rooms.ifc'])
  await expect(page.locator('.appbar h2')).toHaveText('two-rooms.ifc + mep.ifc', { timeout: 30_000 })
  const saved: Promise<string>[] = []
  page.on('download', (d) => saved.push(d.saveAs(info.outputPath(d.suggestedFilename())).then(() => info.outputPath(d.suggestedFilename()))))
  // 층별 [구축] 은 기준 · 검증 드로어의 층별 요약 칸에 있다(#715). 누르면 드로어가 닫힐 수 있어 층마다 연다.
  for (const floor of ['1F', '2F']) {
    await openDrawer(page)
    const head = page.getByRole('button', { name: /층별 요약/ })
    if ((await head.getAttribute('aria-expanded')) === 'false') await head.click()
    await page.getByRole('button', { name: `${floor} 구축` }).click()
    await expect.poll(() => saved.length).toBe(floor === '1F' ? 2 : 4)
  }
  await openFileMenu(page)
  await page.getByRole('button', { name: '의미 내보내기 (Brick TTL)' }).click()
  await expect.poll(() => saved.length).toBe(5)
  const files = await Promise.all(saved)
  const pick = (re: RegExp) => files.filter((f) => re.test(f))

  await page.goto('/viewer.html')
  const input = page.getByLabel('내보낸 파일 고르기')
  const heading = page.getByRole('heading', { name: /^TTL/ })
  // 건물 전체 TTL 을 먼저 놓았어도 층 파일을 놓으면 층 파일부터 쌓는다 — 전체와 층을 섞어 합치면 같은 줄이 겹친다.
  await input.setInputFiles(pick(/ontology\.ttl$/))
  await expect(heading).toContainText('ontology.ttl')
  await input.setInputFiles(pick(/floor-1F\.(ttl|geojson)$/))
  await expect(heading).toContainText('floor-1F.ttl')
  // 2층 파일을 더 놓으면 쌓인다. 두 층의 방이 다 TTL 주어로 이어져 검사가 전부 0 이다.
  await input.setInputFiles(pick(/floor-2F\.(ttl|geojson)$/))
  await expect(heading).toContainText('층 파일 2개 합침')
  await expect(page.locator('.checks li.bad')).toHaveCount(0)
  // 건물 전체 TTL 을 놓으면 층 파일 대신 그것이다.
  await input.setInputFiles(pick(/ontology\.ttl$/))
  await expect(heading).toContainText('ontology.ttl')
  await expect(page.locator('.checks li.bad')).toHaveCount(0)
})

test('벽을 끄고 연 파일의 GeoJSON 을 놓으면 벽 0 이 "없음" 이 아니라 "읽지 않음" 이라고 보인다 (OE-BIM-25) [OE-BIM-25#1~]', async ({ page }, info) => {
  await page.addInitScript(() => {
    delete (window as any).showDirectoryPicker
  })
  await page.goto('/')
  // 첫 화면의 "읽을 것" 에서 벽을 끄고 연다.
  await page.locator('fieldset.read-option.features').first().getByLabel('벽').uncheck()
  await page.locator('input[type=file]').first().setInputFiles('src/lib/ifc/fixtures/two-rooms.ifc')
  await expect(page.getByRole('heading', { name: 'two-rooms.ifc' })).toBeVisible({ timeout: 30_000 })
  const saved: Promise<string>[] = []
  page.on('download', (d) => saved.push(d.saveAs(info.outputPath(d.suggestedFilename())).then(() => info.outputPath(d.suggestedFilename()))))
  await openFileMenu(page)
  await page.getByRole('button', { name: '기하 내보내기 (GeoJSON)' }).click()
  await expect.poll(() => saved.length).toBe(2)
  const files = await Promise.all(saved)

  await page.goto('/viewer.html')
  await page.getByLabel('내보낸 파일 고르기').setInputFiles(files)
  await expect(page.locator('.skipped-note')).toContainText('읽지 않음: 벽')
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT })
})

test('사람이 그린 룸과 놓은 추가 공간 오브젝트가 GeoJSON 에 나가고 뷰어 평면에 그려진다. TTL 에는 없다 (#45 · #51)', async ({ page }, info) => {
  const point = (x: number, y: number) => page.evaluate(([px, py]) => (window as any).__viewer.point([px, py, 0]), [x, y]) as Promise<{ x: number; y: number }>
  const clickAt = async (x: number, y: number) => {
    const at = await point(x, y)
    await page.mouse.click(at.x, at.y)
  }
  await page.addInitScript(() => {
    delete (window as any).showDirectoryPicker
  })
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles('src/lib/ifc/fixtures/two-rooms.ifc')
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  await enterEdit(page)
  await page.getByRole('combobox', { name: '보일 층' }).selectOption({ label: '1F' })
  await page.locator('.canvas-wrap > canvas').scrollIntoViewIfNeeded()
  await page.waitForTimeout(400)
  // 회의실(2..6, 1..4) 안에 룸 하나, 그 옆에 책상 하나
  await toSpace(page)
  await page.getByRole('button', { name: '룸 그리기' }).click()
  await clickAt(2.5, 1.5)
  await clickAt(4, 3)
  await expect(page.locator('.room-picked h3')).toHaveText('룸 1')
  await page.keyboard.press('Escape')
  await toSpace(page)
  await page.locator('button.objects-toggle').click()
  await page.locator('.object-library').getByRole('button', { name: '책상', exact: true }).click()
  await clickAt(5, 2)
  await expect(page.locator('.object-picked h3')).toHaveText('책상 1')

  const saved: Promise<string>[] = []
  page.on('download', (d) => saved.push(d.saveAs(info.outputPath(d.suggestedFilename())).then(() => info.outputPath(d.suggestedFilename()))))
  await openFileMenu(page)
  await page.getByRole('button', { name: '의미 내보내기 (Brick TTL)' }).click()
  await openFileMenu(page)
  await page.getByRole('button', { name: '기하 내보내기 (GeoJSON)' }).click()
  await expect.poll(() => saved.length).toBeGreaterThanOrEqual(2)
  await page.waitForTimeout(500)
  const files = await Promise.all(saved)
  const { readFileSync } = await import('node:fs')
  const floor = JSON.parse(readFileSync(files.find((f) => f.endsWith('floor-1F.geojson'))!, 'utf8'))
  const kinds = floor.features.map((f: { properties: { kind: string } }) => f.properties.kind)
  expect(kinds).toContain('room')
  expect(kinds).toContain('spaceObject')
  const desk = floor.features.find((f: { properties: { kind: string } }) => f.properties.kind === 'spaceObject')
  expect(desk.properties).toMatchObject({ name: '책상 1', item: 'desk', itemName: '책상' })
  const ttl = readFileSync(files.find((f) => f.endsWith('.ttl'))!, 'utf8')
  expect(ttl).not.toContain('책상 1')
  expect(ttl).not.toContain('룸 1')

  await page.goto('/viewer.html')
  await page.getByLabel('내보낸 파일 고르기').setInputFiles(files)
  await expect(page.locator('path.shape.room')).toHaveCount(1)
  await expect(page.locator('path.shape.spaceObject')).toHaveCount(1)
  // 두 kind 는 TTL 에 주어가 없어도 검사가 문제로 세지 않는다(ADR-0023).
  await expect(page.locator('.checks li.bad')).toHaveCount(0)
  await page.locator('svg:has(path.shape.room)').screenshot({ path: info.outputPath('rooms-objects-viewer.png') })
})

test('챗봇의 [3D] 링크(?key=…&v=…&select=…)로 열면 서버의 그 반영본 TTL·GeoJSON 을 읽고 그 요소를 고른다 (ADR-0050)', async ({ page }, info) => {
  const files = await exported(page, 'mep.ifc', (n) => info.outputPath(n))
  const { readFileSync } = await import('node:fs')
  const byName = new Map(files.map((f) => [f.split(/[\/]/).pop()!, f]))
  const published = [...byName.keys()].map((n) => (n.endsWith('.geojson') ? `geojson/${n}` : n))
  const asked: string[] = []
  await page.route('**/__data/__layouts?**', (route) => {
    const q = new URL(route.request().url()).searchParams
    asked.push(q.toString())
    expect(q.get('key')).toBe('현장/mep.ifc')
    if (!q.get('file')) return route.fulfill({ json: { current: 3, versions: [{ version: 3, files: [...published, 'model.glb', 'edits.json'] }] } })
    const f = byName.get(q.get('file')!.split('/').pop()!)
    return f ? route.fulfill({ body: readFileSync(f) }) : route.fulfill({ status: 404 })
  })
  await page.goto(`/viewer.html?key=${encodeURIComponent('현장/mep.ifc')}&v=3&select=${encodeURIComponent('0MEP$Equip$AHU1$0000')}`)
  await expect(page.getByTestId('published')).toHaveText('서버의 반영본 v3 · 현장/mep.ifc')
  await expect(page.getByRole('complementary', { name: '선택 항목' })).toContainText('AHU-1')
  // GLB 는 &3d=1 일 때만 받는다(크다). edits.json 처럼 뷰어가 읽지 않는 것도 받지 않는다.
  expect(asked.some((q) => q.includes('model.glb') || q.includes('edits.json'))).toBe(false)
  await expect(page.locator('.checks li.bad')).toHaveCount(0)
})
