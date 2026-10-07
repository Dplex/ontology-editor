import { expect, test, type Download, type Page } from '@playwright/test'

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
  await page.getByRole('button', { name: '의미 내보내기 (Brick TTL)' }).click()
  await page.getByRole('button', { name: '기하 내보내기 (GeoJSON)' }).click()
  await expect.poll(() => saved.length).toBeGreaterThanOrEqual(2)
  if (with3d) {
    const before = saved.length
    await page.getByRole('button', { name: '3D 형상 내보내기 (GLB)' }).click()
    await expect.poll(() => saved.length).toBe(before + 1)
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
  await expect(summary).toContainText('읽지 않는 주어: fso:')
  const checks = page.locator('.checks > ul > li')
  await expect(checks).toHaveCount(5)
  await expect(page.locator('.checks li.bad')).toHaveCount(0)

  // 평면의 기기를 누르면 TTL 의 위치와 GeoJSON 의 소속이 나란히 보인다.
  await page.locator('circle.shape.equipment:not(.unread)').first().click()
  const detail = page.getByRole('complementary', { name: '고른 것' })
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
  await expect(page.getByRole('complementary', { name: '고른 것' })).toContainText('TTL 에 이 id 의 주어가 없습니다')
})

test('GLB·OBJ 도 같이 열면 3D 로 보이고, GeoJSON 과 같은 id·자리인지 재며, 고른 것의 원문이 보인다', async ({ page }, info) => {
  const files = await exported(page, 'mep.ifc', (n) => info.outputPath(n), true)
  expect(files.filter((f) => /\.(glb|obj)$/.test(f))).toHaveLength(2)
  await page.goto('/viewer.html')
  await page.getByLabel('내보낸 파일 고르기').setInputFiles(files)
  // TTL·GeoJSON 다섯 줄 + 3D 파일마다 세 줄.
  await expect(page.locator('.checks > ul > li')).toHaveCount(11)
  await expect(page.locator('.checks li.bad')).toHaveCount(0)

  // 평면에서 기기를 고르고 3D 로 넘어가도 고른 것이 남는다. 오른쪽에 3D 객체와 TTL 원문이 나온다.
  await page.locator('circle.shape.equipment:not(.unread)').first().click()
  await page.getByRole('tab', { name: '3D · GLB' }).click()
  await expect(page.getByRole('img', { name: '3D 형상' }).locator('canvas')).toBeVisible()
  const detail = page.getByRole('complementary', { name: '고른 것' })
  await expect(detail).toContainText('삼각형')
  await expect(detail.locator('pre.source').first()).toContainText(' a brick:')
  // OBJ 는 extras 가 없어 종류 없이 이름(GlobalId)만 있다.
  await page.getByRole('tab', { name: '3D · OBJ' }).click()
  await expect(detail).toContainText('.obj')
  await expect(detail).toContainText('삼각형')
})

test('층별로 구축한 TTL 을 여럿 놓으면 쌓아 읽고, 건물 전체 TTL 을 놓으면 바꾼다 (OE-GEN-11)', async ({ page }, info) => {
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(['src/lib/ifc/fixtures/mep.ifc', 'src/lib/ifc/fixtures/two-rooms.ifc'])
  await expect(page.locator('.appbar h2')).toHaveText('two-rooms.ifc + mep.ifc', { timeout: 30_000 })
  const saved: Promise<string>[] = []
  page.on('download', (d) => saved.push(d.saveAs(info.outputPath(d.suggestedFilename())).then(() => info.outputPath(d.suggestedFilename()))))
  for (const floor of ['1F', '2F']) {
    await page.getByRole('button', { name: `${floor} 구축` }).click()
    await expect.poll(() => saved.length).toBe(floor === '1F' ? 2 : 4)
  }
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

test('벽을 끄고 연 파일의 GeoJSON 을 놓으면 벽 0 이 "없음" 이 아니라 "읽지 않음" 이라고 보인다 (OE-BIM-25)', async ({ page }, info) => {
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
  await page.getByRole('button', { name: '기하 내보내기 (GeoJSON)' }).click()
  await expect.poll(() => saved.length).toBe(2)
  const files = await Promise.all(saved)

  await page.goto('/viewer.html')
  await page.getByLabel('내보낸 파일 고르기').setInputFiles(files)
  await expect(page.locator('.skipped-note')).toContainText('읽지 않음: 벽')
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT })
})
