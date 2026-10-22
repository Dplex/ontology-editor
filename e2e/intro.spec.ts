import { expect, test, type Page } from '@playwright/test'

// 첫 화면 인트로(src/editor/intro.ts · public/intro/). 주소가 #intro 일 때만 뜬다. e2e 서버는 /__data 를 붙이지 않아 여기서 장면을 흉내 낸다(intro.ts 와 같은 모양).
// 층 둘, 물리존 하나씩, 기기 셋(소속 찾은 것 둘·못 찾은 것 하나). 가이드의 랩으로 띄우면 화면의 숫자가 이 장면에서 센 값인지 본다.
const room = [[0, 0], [10, 0], [10, 8], [0, 8], [0, 0]]
const wall = [[0, 0], [10, 0], [10, 0.2], [0, 0.2], [0, 0]]
const scene = {
  name: 'tiny',
  building: 'Tiny',
  title: '작은 건물',
  files: ['a.ifc', 'b.ifc'],
  bakedAt: '2026-10-21T00:00:00Z',
  counts: { storeys: 2, spaces: 2, drawn: 2, devices: 3, placed: 3, indoor: 3, located: 2 },
  tiers: [
    { key: 'space', label: '공간', have: 2, of: 2, level: 'full' },
    { key: 'location', label: '소속', have: 2, of: 3, level: 'partial' },
  ],
  systems: 1,
  connections: 2,
  storeys: [
    { name: '1F', elevation: 0, height: 4, spaces: [{ kind: null, ring: room }], walls: [{ h: 4, ring: wall }], devices: [[2, 2, 3, 1], [5, 5, 3, 1]], conduits: [[1, 1, 3.5, 9, 1, 3.5]] },
    { name: '2F', elevation: 4, height: 4, spaces: [{ kind: null, ring: room }], walls: [{ h: 4, ring: wall }], devices: [[3, 3, 7, 0]], conduits: [] },
  ],
}

async function serveIntro(page: Page, list: object[]) {
  await page.route('**/__data/__intro**', (route) => {
    const name = new URL(route.request().url()).searchParams.get('name')
    if (!name) return route.fulfill({ json: list })
    return name === scene.name ? route.fulfill({ json: scene }) : route.fulfill({ status: 404 })
  })
}

test('주소가 #intro 면 인트로가 뜨고, 큰 숫자·판정 기준 없이 건물만 서고 [층 정보] 는 층별 개수만 단다. 닫으면 주소가 / 로 돌아가고, 첫 화면의 [인트로 보기] 로 다시 연다', async ({ page }) => {
  // 소프트웨어 GL 에서는 kit 의 후처리가 무거워 조립 연출이 늦게 끝난다. 손을 놓으면 그리지 않게 한 뒤로(public/intro/index.html 의 "부하")
  // 혼자 13초, 병렬에서도 1분 안이다.
  test.setTimeout(90_000)
  await serveIntro(page, [{ name: 'tiny', building: 'Tiny', files: scene.files, bakedAt: scene.bakedAt }])
  // 그냥 / 로 들어오면 에디터 첫 화면이다.
  await page.goto('/')
  await expect(page.getByText('인트로 보기')).toBeVisible()
  const overlay = page.locator('.intro')
  await expect(overlay).toHaveCount(0)
  await page.goto('/#intro')
  await expect(overlay).toBeVisible()
  const lab = page.frameLocator('.intro iframe')
  // kit 은 WebGL·후처리 셰이더를 다 만든 뒤에야 첫 줄을 그린다. 소프트웨어 GL 인 e2e 브라우저에서는 몇 초 걸린다.
  await expect(lab.locator('.lab-title')).toContainText('작은 건물', { timeout: 20_000 })
  // 큰 숫자·[IfcSpace 빼기]·"산출 기준" 은 가이드의 랩에만 있다(아래 소속 판정 랩 시험).
  await expect(lab.locator('.lab-modes button[data-k="explode"]')).toBeVisible()
  await expect(lab.locator('.lab-big')).toHaveCount(0)
  await expect(lab.locator('button[data-k="break"]')).toHaveCount(0)
  await expect(lab.locator('.lab-how')).toBeHidden()
  // [층 정보] 를 켜면 층마다 무엇이 몇 개 들었나만 단다. 판정 결과(소속된 기기 몇 대)는 없고, 0 인 것은 빠진다.
  await lab.getByRole('button', { name: /층 정보/ }).click()
  await expect(lab.locator('.lab-lab', { hasText: '1F' }).locator('small')).toHaveText('물리존 1 · 설비 2 · 관로 1')
  await expect(lab.locator('.lab-lab', { hasText: '2F' }).locator('small')).toHaveText('물리존 1 · 설비 1')

  // 조립이 끝나면 들어가기 패널이 뜨고, 오른쪽 제목 칸은 패널 바로 아래로 옮긴다. 이 서버에는 사람 목록이 없어 고를 것 없이 들어간다.
  const panel = page.getByRole('complementary', { name: '에디터에 들어가기' })
  await expect(panel).toBeVisible({ timeout: 30_000 })
  await expect(lab.locator('.lab-side')).toHaveClass(/below/)
  const [p, t] = [await panel.boundingBox(), await lab.locator('.lab-side').boundingBox()]
  expect(t!.y).toBeGreaterThan(p!.y + p!.height)
  await expect(panel).toContainText('사람 목록 없음')
  await panel.getByRole('button', { name: '에디터 열기' }).click()
  await expect(overlay).toHaveCount(0)
  expect(new URL(page.url()).hash).toBe('')
  // 닫은 뒤 새로고침해도 다시 뜨지 않는다(주소에 #intro 가 없다).
  await page.reload()
  await expect(page.getByText('인트로 보기')).toBeVisible()
  await expect(overlay).toHaveCount(0)
  await page.getByText('인트로 보기').click()
  await expect(overlay).toBeVisible()
  expect(new URL(page.url()).hash).toBe('#intro')
  await page.keyboard.press('Escape')
  await expect(overlay).toHaveCount(0)
  expect(new URL(page.url()).hash).toBe('')
})

test('들어가기 패널에서 사람을 고르면(↑↓·클릭) API 를 부르지 않고 그 사람으로 에디터에 들어가며, 고르기 전에는 [계속하기] 가 막혀 있다', async ({ page }) => {
  test.setTimeout(90_000)
  await serveIntro(page, [{ name: 'tiny', building: 'Tiny', files: scene.files, bakedAt: scene.bakedAt }])
  await page.route('**/__data/__users', (route) =>
    route.fulfill({ json: [{ name: '편집자', role: 'admin' }, { name: '관리자', role: 'super_admin' }, { name: '보기 전용', role: 'viewer' }] }),
  )
  // 들어갈 때 서버에 보내는 것이 없다. 패널이 뜬 뒤의 /__data 요청을 센다.
  const calls: string[] = []
  await page.goto('/#intro')
  const panel = page.getByRole('complementary', { name: '에디터에 들어가기' })
  await expect(panel).toBeVisible({ timeout: 60_000 })
  page.on('request', (r) => r.url().includes('/__data/') && r.method() !== 'GET' && calls.push(r.url()))
  await expect(panel).toContainText('연결됨')
  await expect(panel.getByRole('button', { name: '사람을 골라 주세요' })).toBeDisabled()
  // 아래 화살표는 첫 사람부터, 한 번 더 누르면 다음 사람이다.
  await panel.press('ArrowDown')
  await panel.press('ArrowDown')
  await expect(panel.getByRole('radio', { name: /관리자/ })).toHaveAttribute('aria-checked', 'true')
  await panel.getByRole('radio', { name: /편집자/ }).click()
  await expect(panel.getByRole('radio', { name: /편집자/ })).toHaveAttribute('aria-checked', 'true')
  // 이름 뒤 조사는 받침에 맞춘다(편집자로 · 보기 전용으로).
  await expect(panel.getByRole('button', { name: '편집자로 계속하기' })).toBeEnabled()
  await panel.press('Enter')
  await expect(page.locator('.intro')).toHaveCount(0)
  expect(calls).toEqual([])
  // 고른 사람은 에디터의 사용자 칸과 같은 값(oe.user)이다. 사용자 칸은 프로젝트 서버가 있을 때만 보여, 여기서는 남은 값으로 본다.
  expect(await page.evaluate(() => localStorage.getItem('oe.user'))).toBe('편집자')
})

test('구운 장면이 없으면 #intro 여도 인트로가 없고 링크도 없다', async ({ page }) => {
  await serveIntro(page, [])
  await page.goto('/#intro')
  await expect(page.locator('h1')).toBeVisible()
  await expect(page.locator('.intro')).toHaveCount(0)
  await expect(page.getByText('인트로 다시 보기')).toHaveCount(0)
})

test.describe('앞머리', () => {
  // e2e 는 움직임 줄이기(reducedMotion)로 돈다. 그 설정이면 앞머리를 건너뛰므로(index.html) 여기서만 끈다.
  test.use({ contextOptions: { reducedMotion: 'no-preference' } })

  test('장면 이름과 같은 동네 지도가 있으면 "Ontology-Editor" 앞머리가 먼저 뜨고, [건너뛰기] 로 층 조립 장면으로 넘어간다', async ({ page }) => {
    // 성수 지도(public/intro/city/seongsu.json)는 커밋된 파일이라 장면 이름만 seongsu 로 바꿔 흉내 낸다.
    test.setTimeout(120_000)
    const seongsu = { ...scene, name: 'seongsu' }
    await page.route('**/__data/__intro**', (route) => {
      const name = new URL(route.request().url()).searchParams.get('name')
      return route.fulfill({ json: name ? seongsu : [{ name: 'seongsu', building: 'Tiny', files: scene.files, bakedAt: scene.bakedAt }] })
    })
    await page.goto('/intro/index.html?name=seongsu')
    // 병렬 실행에서는 장면·지도(592KB)를 받는 데 몇 초 걸린다.
    await expect(page.locator('.pro-word')).toHaveText('Ontology-Editor', { timeout: 20_000 })
    await expect(page.locator('.pro-credit')).toContainText('OpenStreetMap')
    // 소프트웨어 GL 에서는 8천 동을 그리는 프레임이 느려 비행을 다 기다리지 않는다.
    await page.locator('.pro-skip').dispatchEvent('click')
    await expect(page.locator('.pro')).toHaveCount(0, { timeout: 60_000 })
    await expect(page.locator('.lab-title')).toContainText('작은 건물')
  })
})

test('가이드의 소속 판정 랩은 장면에서 센 숫자를 띄우고, [IfcSpace 빼기] 를 누르면 0 이 된다', async ({ page }) => {
  test.setTimeout(90_000)
  // 저장소의 scenes/ 자리에 위의 작은 장면을 둔다. 층 둘에 기기 셋, 소속을 찾은 것 둘.
  await page.route('**/intro/scenes/tiny.json', (route) => route.fulfill({ json: scene }))
  await page.goto('/intro/index.html?scene=scenes/tiny.json&focus=assign')
  // 조립이 끝나면 큰 숫자가 부품 수에서 소속 판정 수(2/3)로 돌아온다. 라벨은 조립 전에도 "소속 판정" 이라 숫자를 먼저 기다린다.
  await expect(page.locator('.lab-big .v')).toHaveText('2', { timeout: 30_000 })
  await expect(page.locator('.lab-metric .lbl')).toContainText('소속 판정')
  // 그리는 동안은 클릭을 이벤트로 보낸다. 소프트웨어 GL 에서는 kit 의 후처리가 프레임마다 메인 스레드를 오래 잡아
  // Playwright 의 click 이 요소가 멈췄는지(두 프레임) 재다가 시간을 넘긴다.
  await page.locator('button[data-k="break"]').dispatchEvent('click')
  await expect(page.locator('.lab-big .v')).toHaveText('0')
  await expect(page.locator('.lab-metric .lbl')).toContainText('물리존 없음')
})

test('가이드의 흐름 랩은 저장소의 Duplex 장면에서 방향을 센다. [규칙 방향 빼기] 를 누르면 BIM 포트 방향만 남는다', async ({ page }) => {
  // 숫자는 public/intro/scenes/duplex.json 의 flows 를 출처(0 BIM 포트 · 1 사람 · 2 규칙 · 3 모름)별로 센 값이다.
  test.setTimeout(90_000)
  await page.goto('/intro/index.html?scene=scenes/duplex.json&focus=flow&theme=paper')
  await expect(page.locator('.lab-big .v')).toHaveText('518', { timeout: 30_000 })
  await expect(page.locator('.lab-sub')).toContainText('연결 1,253개 중')
  await page.locator('button[data-k="break"]').dispatchEvent('click')
  await expect(page.locator('.lab-big .v')).toHaveText('190')
})

test('scene 인자는 저장소의 scenes/ 안 JSON 만 받는다', async ({ page }) => {
  await page.route('**/__data/__intro**', (route) => route.fulfill({ json: [] }))
  await page.goto('/intro/index.html?scene=https://example.com/x.json&focus=flow')
  await expect(page.locator('.intro-empty')).toBeVisible()
})
