import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { expect, test, type Page } from '@playwright/test'

// docs/seongsu-test.md 의 화면 항목(B~O)을 성수 건축+기계로 돈다. 두 파일을 한 번 열고 한 페이지에서 차례로 간다 —
// 여는 데만 15초가 넘고, 항목 대부분이 같은 모델 위의 편집이라서다. 그래서 편집 묶음마다 끝에 Ctrl+Z 로 연 때로
// 되돌리고(`undoAll`), 다음 묶음은 바뀐 것 0건에서 시작한다.
//
// 번호는 그 문서의 번호다. 걸린 시간과 수는 `record` 로 모아 data/성수/화면-결과.md 에 쓴다. 기준을 넘으면 실패다.
// 3D 를 짚는 것은 e2e 모드의 window.__viewer 이고(viewer.ts), 어디를 누를지는 연 직후 내보낸 GeoJSON 에서 고른다 —
// 성수의 방·벽·설비 이름을 이 파일에 박아 두면 판본이 바뀔 때마다 깨진다.
const ARCH = process.env.SEONGSU_ARCH ?? 'data/성수/Factorial_건축.ifc'
const MECH = process.env.SEONGSU_MECH ?? 'data/성수/Factorial_기계.ifc'
const REPORT = 'data/성수/화면-결과.md'
const have = existsSync(ARCH) && existsSync(MECH)

test.describe.configure({ mode: 'serial' })
test.skip(!have, `성수 파일이 없다(${ARCH}, ${MECH}). 성수가 있는 PC 나 55 에서 돈다`)

type Pt = { x: number; y: number }
type Ring = [number, number][]
type Space = { id: string; name: string; longName: string; ring: Ring; area: number; storey: string; elevation: number }
type Wall = { id: string; name: string; ring: Ring; loadBearing: boolean | null; storey: string; elevation: number }
type Device = { id: string; name: string; at: [number, number, number]; spaceId: string | null; storey: string }

let page: Page
const errors: string[] = []
const rows: [string, string, string][] = []
/** 잰 값을 결과 표에 한 줄로 남긴다. */
const record = (id: string, value: string, note = '') => {
  rows.push([id, value, note])
  console.log(`  ${id}: ${value}${note ? ` (${note})` : ''}`)
}
/** WebGL 렌더러. GPU 가 아니면 시간이 열 배로 재진다. */
let gpu = '모름'
const map = { spaces: [] as Space[], walls: [] as Wall[], devices: [] as Device[], elevation: new Map<string, number>() }

const settle = () => page.evaluate(() => new Promise<void>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r()))))
const viewer = <T>(fn: string, ...args: unknown[]) =>
  page.evaluate(([f, a]) => (window as any).__viewer[f as string](...(a as unknown[])), [fn, args] as const) as Promise<T>
/** 한 일에 걸린 시간(ms). 화면이 다음 두 프레임을 그릴 때까지 잰다. */
async function timed(fn: () => Promise<unknown>) {
  const t = performance.now()
  await fn()
  await settle()
  return Math.round(performance.now() - t)
}
const changeCount = async () => Number((await page.locator('.edit-bar .state').innerText()).match(/바뀐 것 (\d+)건/)![1])
const note = () => page.locator('.key-note')
const search = () => page.getByPlaceholder(/물리존·설비 이름이나 종류/)
async function openFold(title: string | RegExp) {
  const head = page.locator('.fold-head', { hasText: title }).first()
  if ((await head.getAttribute('aria-expanded')) !== 'true') await head.click()
}
async function editMode(on: boolean) {
  const button = page.getByRole('button', { name: on ? '편집' : '보기', exact: true })
  if ((await button.getAttribute('aria-pressed')) !== 'true') await button.click()
}
/** 표에서 설비를 이름으로 고른다. 3D 가 그 자리로 시점을 옮긴다. */
async function pickDevice(name: string) {
  await search().fill(name)
  await openFold(/설비 목록|설비 위치와 소속/)
  await page.locator('.equipment tbody tr').filter({ hasText: name }).first().locator('button').first().click()
  await search().fill('')
  // 칸에서 나온다. 포커스가 남으면 뒤의 단축키(F, Home …)가 검색 칸에 글자로 들어간다.
  await search().press('Escape')
  await page.locator('.viewport canvas').scrollIntoViewIfNeeded()
  await settle()
  await expect(page.locator('.picked h3')).toHaveText(name)
}
/** 검색 칸에 친 말(이름·종류)에 맞는 첫 설비를 고른다. */
async function pickFirst(query: string) {
  await search().fill(query)
  await openFold(/설비 목록|설비 위치와 소속/)
  const button = page.locator('.equipment tbody tr').first().locator('button').first()
  const name = await button.innerText()
  await button.click()
  await search().fill('')
  // 칸에서 나온다. 포커스가 남으면 뒤의 단축키(F, Home …)가 검색 칸에 글자로 들어간다.
  await search().press('Escape')
  await page.locator('.viewport canvas').scrollIntoViewIfNeeded()
  await settle()
  return name
}
async function showStorey(name: string | null) {
  const select = page.getByRole('combobox', { name: '보일 층' })
  if (name) await select.selectOption({ label: `${name}만` })
  else await select.selectOption({ index: 0 })
  // 상자에서 나온다. 포커스가 남으면 뒤의 글자 단축키(U, K …)를 상자가 먹는다.
  await select.evaluate((el) => (el as HTMLElement).blur())
  await page.locator('.viewport canvas').scrollIntoViewIfNeeded()
  await page.waitForTimeout(300)
  await settle()
}
const floor = (x: number, y: number, z: number) => viewer<Pt>('point', [x, y, z])
async function clickFloor(x: number, y: number, z: number) {
  const at = await floor(x, y, z)
  await page.mouse.click(at.x, at.y)
  await settle()
}
/** 끌기. 끄는 동안 프레임 간격의 가장 긴 것도 잰다. */
async function drag(from: Pt, to: Pt) {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  for (let i = 1; i <= 12; i++) await page.mouse.move(from.x + ((to.x - from.x) * i) / 12, from.y + ((to.y - from.y) * i) / 12)
  const t = performance.now()
  await page.mouse.up()
  await settle()
  return Math.round(performance.now() - t)
}
/** 설비가 맨 앞에 맞는 화면 점. 고른 설비의 가운데가 다른 것에 가리면 둘레를 돈다. */
async function frontPoint(id: string): Promise<Pt | null> {
  const p = await viewer<Pt | null>('part', id)
  if (!p) return null
  for (let r = 0; r < 150; r += 3)
    for (let a = 0; a < 360; a += r ? 15 : 360) {
      const x = p.x + r * Math.cos((a * Math.PI) / 180)
      const y = p.y + r * Math.sin((a * Math.PI) / 180)
      const hit = await viewer<{ front: string | null; arrow: boolean }>('hit', x, y, id)
      if (hit.front === id && !hit.arrow) return { x, y }
    }
  return null
}
/** 편집을 전부 되돌린다. 한 번에 걸린 시간 중 가장 긴 것을 돌려준다. */
async function undoAll() {
  let slowest = 0
  let n = 0
  await page.locator('.edit-bar').click({ position: { x: 2, y: 2 } })
  while (!(await page.locator('.edit-bar .undo').isDisabled())) {
    slowest = Math.max(slowest, await timed(() => page.keyboard.press('Control+z')))
    if (++n > 200) throw new Error('되돌리기가 끝나지 않는다')
  }
  await expect(page.locator('.edit-bar')).toContainText('바뀐 것 0건')
  return { n, slowest }
}
const inRing = (x: number, y: number, ring: Ring) => {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}
const centroid = (ring: Ring): [number, number] => {
  const pts = ring.slice(0, -1)
  return [pts.reduce((n, p) => n + p[0], 0) / pts.length, pts.reduce((n, p) => n + p[1], 0) / pts.length]
}
/**
 * 편집할 방: 층 하나에서 꼭짓점이 적은 방 중, 방 안의 한 점을 누르면 설비가 아니라 그 방이 맞는 것. 천장 설비가
 * 방 가운데를 가리는 일이 많아서 방 안의 여러 점을 본다. 돌려주는 (cx, cy) 가 그 점이다.
 */
async function roomToEdit(storey: string) {
  const rooms = map.spaces
    .filter((x) => x.storey === storey && x.ring.length >= 5 && x.ring.length <= 13 && x.area > 10 && x.area < 1000)
    .sort((a, b) => a.ring.length - b.ring.length)
  for (const s of rooms) {
    const xs = s.ring.map((p) => p[0])
    const ys = s.ring.map((p) => p[1])
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
    for (const [fx, fy] of [[0.5, 0.5], [0.3, 0.3], [0.7, 0.7], [0.3, 0.7], [0.7, 0.3], [0.5, 0.25], [0.5, 0.75], [0.25, 0.5], [0.75, 0.5]]) {
      const cx = x0 + (x1 - x0) * fx
      const cy = y0 + (y1 - y0) * fy
      // 새 물리존(2m 정사각형)과 나누는 선이 방 안에 들도록 벽에서 1.2m 는 떨어진 점만 쓴다.
      if (![[0, 0], [1.2, 0], [-1.2, 0], [0, 1.2], [0, -1.2]].every(([dx, dy]) => inRing(cx + dx, cy + dy, s.ring))) continue
      const at = await floor(cx, cy, s.elevation + 0.05)
      const hit = await viewer<{ equipment: string | null; space: string | null }>('pickAt', at.x, at.y)
      if (hit.space === s.id && !hit.equipment) return { space: s, cx, cy }
    }
  }
  return null
}

test.beforeAll(async ({ browser }) => {
  const context = await browser.newContext({ baseURL: process.env.BASE_URL ?? 'http://localhost:5176', viewport: { width: 1600, height: 1000 }, acceptDownloads: true })
  page = await context.newPage()
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('dialog', (d) => d.accept())
})

test.afterAll(async () => {
  if (!rows.length) return
  const commit = execSync('git rev-parse --short HEAD').toString().trim()
  const lines = [
    '# 성수 화면 결과',
    '',
    `${new Date().toISOString()} · \`npm run e2e:seongsu\` · 커밋 ${commit} · ${gpu}`,
    '',
    '번호는 docs/seongsu-test.md 의 번호다. 시간은 누른 때부터 화면이 다음 두 프레임을 그릴 때까지다.',
    '',
    '| 번호 | 값 | 비고 |',
    '|---|---|---|',
    ...rows.map((r) => `| ${r.map((c) => c.replace(/\|/g, '\\|')).join(' | ')} |`),
    '',
  ]
  mkdirSync(dirname(REPORT), { recursive: true })
  writeFileSync(REPORT, lines.join('\n'))
})

test('B 열기: 두 파일을 같이 고르면 합쳐 열리고, 3D 를 그리는 동안 화면이 오래 멈추지 않는다', async () => {
  await page.goto('/')
  await page.evaluate(() => {
    for (const k of Object.keys(localStorage)) if (k.startsWith('oe-draft')) localStorage.removeItem(k)
    localStorage.setItem('oe-mode', 'view')
  })
  gpu = await page.evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2')!
    return gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info')!.UNMASKED_RENDERER_WEBGL) as string
  })
  expect(gpu, 'WebGL 이 CPU 로 돈다. 시간이 열 배로 재진다').not.toMatch(/SwiftShader/i)
  await page.goto('/')
  // 메인 스레드가 멈춘 가장 긴 시간(프레임 간격)을 연 뒤 덩어리를 다 켤 때까지 잰다.
  await page.evaluate(() => {
    const w = window as any
    w.__gaps = []
    let last = performance.now()
    const tick = () => {
      const now = performance.now()
      w.__gaps.push(now - last)
      last = now
      w.__raf = requestAnimationFrame(tick)
    }
    tick()
  })
  const t = performance.now()
  await page.locator('.drop input[type=file]').setInputFiles([MECH, ARCH])
  await expect(page.locator('.appbar h2')).toHaveText(/Factorial_건축\.ifc \+ Factorial_기계\.ifc/, { timeout: 600_000 })
  await expect(page.locator('.progress-toast')).toHaveCount(0, { timeout: 600_000 })
  const openMs = Math.round(performance.now() - t)
  await expect.poll(async () => (await viewer<{ shown: number; chunks: number }>('stats')).shown === (await viewer<{ chunks: number }>('stats')).chunks, { timeout: 60_000 }).toBe(true)
  await page.waitForTimeout(300)
  const gap = await page.evaluate(() => {
    const w = window as any
    cancelAnimationFrame(w.__raf)
    return Math.round(Math.max(...w.__gaps))
  })
  const stats = await viewer<{ chunks: number; vertices: number; mb: number }>('stats')
  record('B-6a', `${(openMs / 1000).toFixed(1)}초`, '두 파일을 파일 칸에서 같이 골라 합쳐 열기(기계를 먼저 골라도 건축이 기준)')
  record('B-4·B-6 멈춤', `${gap}ms`, `여는 동안 가장 긴 프레임 간격. 설비 형상 ${stats.vertices.toLocaleString()}정점 ${stats.mb}MB 를 ${stats.chunks}덩어리로 올린다`)
  expect(gap, '연 뒤 화면이 1초 넘게 멈췄다').toBeLessThan(1000)

  // B-9 요약 수. A-1-11 과 같은 수다.
  const tile = (label: string) => page.locator('.tiles li', { hasText: label }).first().locator('b')
  await expect(tile('층')).toHaveText('19')
  await expect(tile('물리존')).toHaveText('508')
  await expect(tile('기기')).toHaveText('4911')
  record('B-9', '층 19 · 물리존 508 · 기기 4,911')
  const heap = await page.evaluate(() => Math.round(((performance as any).memory?.usedJSHeapSize ?? 0) / 1048576))
  record('B-10', `JS 힙 ${heap}MB`)

  // 어디를 누를지 고를 지도: GeoJSON 을 폴더 저장으로 받아 읽는다(층마다 한 파일).
  await page.evaluate(() => {
    const w = window as any
    w.__dir = {}
    w.showDirectoryPicker = async () => ({
      getFileHandle: async (name: string) => ({
        createWritable: async () => {
          let text = ''
          return { write: async (t: string) => void (text += t), close: async () => void (w.__dir[name] = text) }
        },
      }),
    })
  })
  const geoMs = await timed(async () => {
    await page.getByRole('button', { name: '기하 내보내기 (GeoJSON)' }).click()
    await expect(note()).toContainText('저장했습니다')
  })
  const files = await page.evaluate(() => (window as any).__dir as Record<string, string>)
  expect(Object.keys(files)).toHaveLength(19)
  record('L-2', `${geoMs}ms · 파일 ${Object.keys(files).length}개`, '폴더 저장')
  const names = new Map<string, string>()
  for (const [name, text] of Object.entries(files)) {
    const storey = name.replace(/^floor-|\.geojson$/g, '')
    for (const f of JSON.parse(text).features) {
      const p = f.properties
      if (p.storeyId) names.set(p.storeyId, storey)
      if (p.kind === 'space' && f.geometry?.coordinates?.[0]?.length)
        map.spaces.push({ id: f.id, name: p.name, longName: p.longName ?? '', ring: f.geometry.coordinates[0], area: p.areaM2, storey, elevation: p.elevation })
      else if (p.kind === 'wall' && f.geometry)
        map.walls.push({ id: f.id, name: p.name, ring: f.geometry.coordinates[0], loadBearing: p.loadBearing, storey, elevation: p.elevation })
      else if (p.kind === 'equipment' && f.geometry)
        map.devices.push({ id: f.id, name: p.name, at: f.geometry.coordinates, spaceId: p.spaceId, storey })
    }
  }
  for (const s of map.spaces) map.elevation.set(s.storey, s.elevation)
  // 외곽선이 있는 물리존(성수 508개 중 453개).
  expect(map.spaces.length).toBeGreaterThan(400)
})

test('C 3D 보기: 층 고르기, 전체 보기, 고른 연결망, 설명 풍선, 회전, 전체 화면, 테마', async () => {
  // C-2 층 하나만 그린다.
  await showStorey('3F')
  expect(await viewer<string[]>('visibleStoreys')).toHaveLength(1)
  // C-3 다른 층 설비를 목록에서 고르면 3D 가 그 층으로 따라간다.
  const other = map.devices.find((d) => d.storey === '5F' && /FCU/.test(d.name))!
  await pickDevice(other.name)
  await expect(page.getByRole('combobox', { name: '보일 층' })).toHaveValue(/.+/)
  expect(await page.getByRole('combobox', { name: '보일 층' }).locator('option:checked').innerText()).toBe('5F만')
  record('C-3', '통과', `${other.name} 을 고르자 3F → 5F`)
  await showStorey(null)

  // C-9 FCU 하나가 건물 절반으로 번지지 않는다(방향 모르는 연결에서 멈춘다).
  const fcu = 'FCU3:FCU3:958283'
  await pickDevice(fcu)
  await expect(page.locator('.picked .flow .linked small')).toHaveText('그중 기기 143')
  record('C-9', '기기 143', fcu)

  // C-5 F 는 그 연결망에 시점을 맞춘다.
  const before = await viewer<Pt>('point', [0, 0, 0])
  await page.keyboard.press('f')
  await settle()
  expect(await viewer<Pt>('point', [0, 0, 0])).not.toEqual(before)
  // C-4 Home 은 건물 전체.
  await page.keyboard.press('Home')
  await settle()

  // C-10 설비 위에 마우스를 올리면 설명 풍선이 따라온다.
  const id = map.devices.find((d) => d.name === fcu)!.id
  const at = await frontPoint(id)
  if (at) {
    await page.mouse.move(at.x - 30, at.y)
    const hover = await timed(async () => {
      await page.mouse.move(at.x, at.y)
      await expect(page.locator('.hover-tip')).toBeVisible()
    })
    await expect(page.locator('.hover-tip')).toContainText('FCU')
    record('C-10', `${hover}ms`, '설명 풍선이 뜰 때까지')
  }

  // C-11 회전·확대. 프레임 간격의 95% 가 50ms 안이어야 한다.
  const box = (await page.locator('.viewport canvas').boundingBox())!
  await page.evaluate(() => {
    const w = window as any
    w.__gaps = []
    let last = performance.now()
    const tick = () => {
      const now = performance.now()
      w.__gaps.push(now - last)
      last = now
      w.__raf = requestAnimationFrame(tick)
    }
    tick()
  })
  await page.mouse.move(box.x + 200, box.y + 300)
  await page.mouse.down()
  for (let i = 0; i < 60; i++) await page.mouse.move(box.x + 200 + i * 8, box.y + 300 + (i % 7))
  await page.mouse.up()
  for (let i = 0; i < 10; i++) {
    await page.mouse.wheel(0, -200)
    await page.waitForTimeout(30)
  }
  const frames = await page.evaluate(() => {
    const w = window as any
    cancelAnimationFrame(w.__raf)
    const s = (w.__gaps as number[]).slice(1).sort((a, b) => a - b)
    return { p50: Math.round(s[s.length >> 1]), p95: Math.round(s[Math.floor(s.length * 0.95)]), max: Math.round(s[s.length - 1]) }
  })
  record('C-11', `중앙값 ${frames.p50}ms · 95% ${frames.p95}ms · 최대 ${frames.max}ms`, '회전과 확대 중 프레임 간격')
  expect(frames.p95).toBeLessThan(50)

  // C-6 W 는 내력벽 켜고 끄기. C-7 R 은 규칙 방향 표시.
  const wallsButton = page.getByRole('button', { name: '내력벽' })
  const w0 = await wallsButton.getAttribute('aria-pressed')
  const wMs = await timed(() => page.keyboard.press('w'))
  expect(await wallsButton.getAttribute('aria-pressed')).not.toBe(w0)
  record('C-6', `${wMs}ms`, '내력벽 켜기')
  await page.keyboard.press('w')
  await page.keyboard.press('r')
  await expect(note()).toContainText('규칙 방향')
  await page.keyboard.press('r')

  // C-12 전체 화면: 3D 와 고른 설비 패널이 같이 뜨고, 편집 체크가 3D 위에 있다.
  await page.getByRole('button', { name: '전체 화면' }).click()
  await expect(page.locator('.edit-toggle input')).toBeVisible()
  await expect(page.locator('.picked')).toBeVisible()
  await page.getByRole('button', { name: /전체 화면 나가기/ }).click()
  await expect(page.locator('.edit-toggle input')).toHaveCount(0)

  // C-13 테마는 저장된 값만 따른다(기본 라이트).
  const theme = page.locator('.appbar').getByRole('button', { name: /^(다크|라이트)$/ })
  await theme.click()
  expect(await page.evaluate(() => [document.documentElement.dataset.theme, localStorage.getItem('oe-theme')])).toEqual(['dark', 'dark'])
  await theme.click()
  expect(await page.evaluate(() => [document.documentElement.dataset.theme !== 'dark', localStorage.getItem('oe-theme')])).toEqual([true, 'light'])
  expect(errors).toEqual([])
})

test('D 패널: 무엇인지와 출처, 계통별 표, 담당 공간, 검색, 층별 요약, 검사, 경고', async () => {
  // D-2 디퓨저와 덕트는 이름 옆에 무엇인지와 출처가 붙는다.
  for (const what of ['디퓨저', '덕트']) {
    const name = await pickFirst(what)
    await expect(page.locator('.picked .stats').first()).toContainText(what)
    await expect(page.locator('.picked .stats .src').first()).toBeVisible()
    record('D-2', '통과', `${name}: ${what}, 출처 표시`)
  }
  // D-3 공조기: 계통별 표가 패널 폭 안에 있고, 담당 공간은 몇 줄만 보인다.
  const ahu = map.devices.find((d) => /AHU/i.test(d.name))!
  await pickDevice(ahu.name)
  const overflow = await page.locator('.picked').evaluate((el) => el.scrollWidth - el.clientWidth)
  expect(overflow, '패널이 가로로 넘친다').toBeLessThanOrEqual(1)
  const panelHeight = await page.locator('.picked').evaluate((el) => Math.round(el.getBoundingClientRect().height))
  record('D-3', `패널 높이 ${panelHeight}px`, `${ahu.name}. 가로 넘침 없음`)
  // D-4 연결망 보기.
  const netMs = await timed(() => page.getByRole('button', { name: '연결망 보기' }).click())
  record('D-4', `${netMs}ms`, '연결망 보기')

  // D-6 / 는 검색 칸으로 간다.
  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('/')
  await expect(search()).toBeFocused()
  await page.keyboard.press('Escape')
  // D-7 층별 요약은 층마다 한 줄.
  await expect(page.locator('.storeys tbody tr')).toHaveCount(19)
  // D-10 종류와 관제점 후보.
  const kinds = await page.locator('.fold-head', { hasText: '종류와 관제점 후보' }).innerText()
  record('D-10', kinds.replace(/\s+/g, ' ').replace(/^▸ ?/, ''))
  // D-11 담당 공간.
  const served = await page.locator('.fold-head', { hasText: '담당 공간' }).innerText()
  expect(served).toContain('공기 원천 268대')
  record('D-11', served.replace(/\s+/g, ' ').replace(/^▸ ?/, ''))
  // D-12 임포트 경고 수.
  record('D-12', `경고 ${await page.locator('.warnings li').count()}줄`)
  expect(errors).toEqual([])
})

test('E 설비 편집: 끌기·Esc·방향키·층 옮기기·방 밖·더하기·이름·지우기와 되돌리기', async () => {
  await editMode(true)
  const fcu = map.devices.find((d) => d.name === 'FCU3:FCU3:958291')!
  await pickDevice(fcu.name)
  const coord = (i: number) => page.locator('.picked .position-edit .coord').nth(i).inputValue()
  const home = () => page.locator('.picked .position-edit').innerText()
  const x0 = await coord(0)

  // E-1 3D 에서 끌기. 가까이 당겨 가리지 않는 점을 잡는다.
  await page.keyboard.press('f')
  for (let i = 0; i < 6; i++) {
    await page.mouse.move(800, 500)
    await page.mouse.wheel(0, -300)
    await page.waitForTimeout(40)
  }
  await page.keyboard.press('f')
  await page.waitForTimeout(300)
  const from = await frontPoint(fcu.id)
  expect(from, 'FCU 를 3D 에서 잡을 자리가 없다').not.toBeNull()
  const center = (await viewer<number[]>('center', fcu.id))!
  const to = await viewer<Pt>('point', [center[0] - 3, center[1], center[2]])
  // E-2 끌다가 Esc 는 제자리.
  await page.mouse.move(from!.x, from!.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 8 })
  await page.keyboard.press('Escape')
  await page.mouse.up()
  await settle()
  expect(await coord(0)).toBe(x0)
  const dropMs = await drag(from!, to)
  await expect.poll(() => coord(0)).not.toBe(x0)
  expect(Number(await coord(0))).toBeCloseTo(Number(x0) - 3, 0)
  record('E-1', `${dropMs}ms`, '놓은 때부터')

  // E-3 방향키. 한 번씩 누른 것과 쌓인 반복 30번.
  const arrows: number[] = []
  for (let i = 0; i < 5; i++) {
    const before = await coord(0)
    arrows.push(
      await timed(async () => {
        await page.keyboard.press('ArrowRight')
        await expect.poll(() => coord(0)).not.toBe(before)
      }),
    )
  }
  const y0 = Number(await coord(1))
  const burst = await timed(async () => {
    await page.evaluate(() => {
      for (let i = 0; i < 30; i++) window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', code: 'ArrowUp', repeat: i > 0, bubbles: true }))
    })
    await expect.poll(async () => Math.abs(Number(await coord(1)) - y0)).toBeGreaterThan(2.9)
  })
  const median = [...arrows].sort((a, b) => a - b)[2]
  record('E-3', `${median}ms`, `방향키 5번의 중앙값. 쌓인 키 반복 30번은 ${burst}ms 에 한 번으로 옮긴다`)
  expect(median).toBeLessThan(500)
  expect(burst).toBeLessThan(1500)
  // E-4 같은 설비를 여러 번 옮겨도 리포트에는 한 줄.
  await expect(page.locator('.edit-bar')).toContainText('바뀐 것 1건')

  // E-7 PageUp 은 위층으로 옮기고 소속을 다시 정한다.
  const storey0 = await page.locator('.picked .storey-move select').inputValue()
  const upMs = await timed(() => page.keyboard.press('PageUp'))
  expect(await page.locator('.picked .storey-move select').inputValue()).not.toBe(storey0)
  record('E-7', `${upMs}ms`, (await home()).match(/소속 [^·\n]+/)?.[0] ?? '')
  await page.keyboard.press('PageDown')

  // E-10 방 밖으로. 소속이 빠지고 TTL 에는 층이 hasLocation 으로 남는다.
  const xInput = page.locator('.picked .position-edit .coord').nth(0)
  await xInput.fill('-40')
  await xInput.press('Enter')
  await expect(page.locator('.picked .position-edit')).toContainText('소속 방 없음')
  const ttl = await download(() => page.getByRole('button', { name: '의미 내보내기 (Brick TTL)' }).click())
  const block = ttlBlock(ttl.text, fcu.id)
  expect(block).toMatch(/brick:hasLocation ex:[^\s;]+/)
  record('E-10', '통과', `방 밖으로 옮긴 FCU 는 TTL 에 층을 위치로 적는다. TTL ${ttl.ms}ms, ${ttl.kb}KB`)
  await page.keyboard.press('Escape')

  // E-13 연결 많은 FCU 지우기, E-14 되돌리면 연결이 전부 돌아온다.
  await pickDevice('FCU3:FCU3:958283')
  const neighbors = await page.locator('.picked table.neighbors tr').count()
  const delMs = await timed(() => page.locator('.picked').getByRole('button', { name: '설비 지우기' }).click())
  await expect(note()).toContainText('연결')
  const backMs = await timed(async () => {
    await page.locator('.edit-bar').click({ position: { x: 2, y: 2 } })
    await page.keyboard.press('Control+z')
  })
  await pickDevice('FCU3:FCU3:958283')
  await expect(page.locator('.picked table.neighbors tr')).toHaveCount(neighbors)
  record('E-13·E-14', `지우기 ${delMs}ms · 되돌리기 ${backMs}ms`, `연결 ${neighbors}개가 같이 빠졌다가 돌아온다`)

  // E-15 BIM 설비 이름 고치기. TTL rdfs:label 이 바뀐다.
  const name = page.locator('.picked .equipment-name-edit input')
  await name.fill('FCU-3F-테스트')
  await name.press('Enter')
  await expect(page.locator('.picked h3')).toHaveText('FCU-3F-테스트')
  const ttl2 = await download(() => page.getByRole('button', { name: '의미 내보내기 (Brick TTL)' }).click())
  expect(ttlBlock(ttl2.text, map.devices.find((d) => d.name === 'FCU3:FCU3:958283')!.id)).toContain('rdfs:label "FCU-3F-테스트"')

  // E-11·E-12 설비를 바닥에 더하고 이름을 고친다. 종류는 모름으로 둔다.
  await showStorey('3F')
  const target = await roomToEdit('3F')
  expect(target, '3F 에서 누를 방을 못 찾았다').not.toBeNull()
  await page.getByRole('button', { name: '설비 더하기' }).click()
  await clickFloor(target!.cx, target!.cy, target!.space.elevation)
  await expect(page.locator('.picked h3')).toHaveText(/^새 설비 \d+$/)
  await expect(page.locator('.picked')).toContainText(target!.space.longName || target!.space.name)
  await expect(page.locator('.picked .kind-edit select')).toHaveValue('')
  await name.fill('새 FCU')
  await name.press('Enter')
  await expect(page.locator('.report')).toContainText('설비 새 FCU를 더했습니다')

  const undo = await undoAll()
  record('I-2', `${undo.n}번 · 가장 긴 것 ${undo.slowest}ms`, 'E 묶음을 끝까지 되돌려 바뀐 것 0건')
  await showStorey(null)
  expect(errors).toEqual([])
})

/** 내려받기 하나를 받아 글자로 읽는다. */
async function download(action: () => Promise<unknown>) {
  const t = performance.now()
  const [d] = await Promise.all([page.waitForEvent('download'), action()])
  const path = await d.path()
  const text = readFileSync(path!, 'utf-8')
  return { text, ms: Math.round(performance.now() - t), kb: Math.round(Buffer.byteLength(text) / 1024), name: d.suggestedFilename() }
}
/** TTL 에서 주어 하나의 블록. GUID 의 $ 는 \$ 로 적힌다. */
function ttlBlock(ttl: string, id: string) {
  const key = `ex:${id.replace(/\$/g, '\\$')} `
  const i = ttl.indexOf(key)
  if (i < 0) return ''
  const end = ttl.indexOf(' .\n', i)
  return ttl.slice(i, end < 0 ? undefined : end)
}

/** 3D 에서 누를 수 있는 벽: 벽 윗면 가운데를 누르면 설비가 아니라 그 벽이 맞는 것. */
async function wallToPick(filter: (w: Wall) => boolean, limit = 40) {
  let tried = 0
  for (const w of map.walls.filter(filter)) {
    if (++tried > limit) break
    const [x, y] = centroid(w.ring)
    const at = await floor(x, y, w.elevation + 1.15)
    const hit = await viewer<{ equipment: string | null; element: string | null }>('pickAt', at.x, at.y)
    if (hit.element === w.id && !hit.equipment) return { wall: w, at }
  }
  return null
}
/**
 * 양옆이 서로 다른 방인 벽(칸막이). 벽 외곽선의 긴 변에 수직으로, 두께 밖 0.3m 의 두 점이 각각 다른 방 안에 든다.
 */
function partitionWalls(storey: string) {
  const rooms = map.spaces.filter((x) => x.storey === storey)
  const roomAt = (x: number, y: number) => rooms.find((r) => inRing(x, y, r.ring))?.id ?? null
  const out: { wall: Wall; left: string; right: string }[] = []
  for (const w of map.walls.filter((x) => x.storey === storey)) {
    const pts = w.ring.slice(0, -1)
    let best = { len: 0, dx: 0, dy: 0 }
    for (let i = 0; i < pts.length; i++) {
      const [ax, ay] = pts[i]
      const [bx, by] = pts[(i + 1) % pts.length]
      const len = Math.hypot(bx - ax, by - ay)
      if (len > best.len) best = { len, dx: (bx - ax) / len, dy: (by - ay) / len }
    }
    if (best.len < 2) continue
    const [cx, cy] = centroid(w.ring)
    // 두께는 긴 변에 수직인 방향으로 잰 폭이다.
    const across = pts.map(([x, y]) => (x - cx) * -best.dy + (y - cy) * best.dx)
    const half = (Math.max(...across) - Math.min(...across)) / 2 + 0.3
    const left = roomAt(cx - best.dy * half, cy + best.dx * half)
    const right = roomAt(cx + best.dy * half, cy - best.dx * half)
    if (left && right && left !== right) out.push({ wall: w, left, right })
  }
  return out
}
const panelArea = async () => Number(await page.locator('.space-picked .stats b.mono').first().innerText())

test('F 물리존: 바닥 고르기·꼭짓점 끌기·짚고 옮기기·넣고 지우기·교차·만들기·나누기·합치기·지우기와 되돌리기', async () => {
  await editMode(true)
  await showStorey('3F')
  const target = await roomToEdit('3F')
  expect(target, '3F 에서 누를 방을 못 찾았다').not.toBeNull()
  const { space, cx, cy } = target!
  const z = space.elevation
  const panel = page.locator('.space-picked')

  // D-5 바닥을 누르면 물리존이 골라진다.
  const pickMs = await timed(() => clickFloor(cx, cy, z + 0.05))
  await expect(panel.locator('h3')).toHaveText(space.longName || space.name)
  record('D-5', `${pickMs}ms`, `${space.longName || space.name} ${space.area.toFixed(1)}㎡, 꼭짓점 ${space.ring.length - 1}개`)
  const a0 = await panelArea()

  // F-3 3D 에서 꼭짓점 끌기. 첫 꼭짓점을 가운데 쪽으로 30% 당긴다.
  const handles = await viewer<Pt[]>('handles')
  expect(handles).toHaveLength(space.ring.length - 1)
  const [vx, vy] = space.ring[0]
  const f3 = await drag(handles[0], await floor(vx + (cx - vx) * 0.3, vy + (cy - vy) * 0.3, z + 0.12))
  await expect.poll(panelArea).not.toBe(a0)
  await expect(page.locator('.report')).toContainText('㎡ →')
  record('F-3', `${f3}ms`, `넓이 ${a0} → ${await panelArea()}㎡`)

  // F-4 ] 로 꼭짓점을 짚고 방향키로 옮긴다.
  await page.keyboard.press(']')
  const a1 = await panelArea()
  const f4 = await timed(async () => {
    await page.keyboard.press('ArrowRight')
    await expect.poll(panelArea).not.toBe(a1)
  })
  record('F-4', `${f4}ms`, '짚은 꼭짓점 방향키 한 번')

  // F-5 Insert 는 꼭짓점 하나를 넣고, F-6 Delete 는 셋에서 멈춘다.
  const n = (await viewer<Pt[]>('handles')).length
  await page.keyboard.press('Insert')
  await expect.poll(async () => (await viewer<Pt[]>('handles')).length).toBe(n + 1)
  for (let i = 0; i < n + 2; i++) await page.keyboard.press('Delete')
  await expect.poll(async () => (await viewer<Pt[]>('handles')).length).toBe(3)
  record('F-5·F-6', '통과', `꼭짓점 ${n} → ${n + 1} → 3 에서 멈춤`)
  await undoAll()

  // F-7 선이 꼬이게 끌면 놓지 않고 알린다.
  await clickFloor(cx, cy, z + 0.05)
  const before = await panelArea()
  const hs = await viewer<Pt[]>('handles')
  await drag(hs[0], await floor(cx + (cx - vx) * 2.5, cy + (cy - vy) * 2.5, z + 0.12))
  await expect(page.locator('.edit-notice')).toContainText('교차')
  expect(await panelArea()).toBe(before)
  record('F-7', '막는다', '자기 교차가 되는 자리에는 놓지 않고 "교차" 를 알린다(이 목록은 "막지 않고 경고" 라고 적었다)')

  // F-10 물리존 그리기. 방 가운데에 2m 정사각형.
  await page.getByRole('button', { name: '물리존 그리기' }).click()
  for (const [dx, dy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) await clickFloor(cx + dx, cy + dy, z)
  const f10 = await timed(() => page.keyboard.press('Enter'))
  await expect(panel.locator('h3')).toHaveText(/^새 물리존 \d+$/)
  await expect(page.locator('.report')).toContainText(/물리존 새 물리존 \d+을 만들었습니다/)
  record('F-10', `${f10}ms`, '4.0㎡ 물리존을 그리고 Enter')
  // F-15 그린 물리존을 지운다.
  const f15 = await timed(() => panel.getByRole('button', { name: '지우기', exact: true }).click())
  await expect(panel).toHaveCount(0)
  record('F-15', `${f15}ms`)

  // F-11 나누기: 가운데를 지나는 가로선. F-13 조각을 다시 합친다.
  await clickFloor(cx, cy, z + 0.05)
  const whole = await panelArea()
  const xs = space.ring.map((p) => p[0])
  await panel.getByRole('button', { name: '나누기' }).click()
  await clickFloor(Math.min(...xs) - 1, cy, z)
  const f11 = await timed(() => clickFloor(Math.max(...xs) + 1, cy, z))
  const split = await page.locator('.report').innerText().catch(() => '')
  if (/-2/.test(split)) {
    record('F-11', `${f11}ms`, `${whole}㎡ 를 ${await panelArea()}㎡ 와 나머지로`)
    const merge = panel.locator('.space-tools select')
    const option = (await merge.locator('option').allInnerTexts()).find((t) => /-2/.test(t))!
    const f13 = await timed(() => merge.selectOption({ label: option }))
    await expect.poll(panelArea).toBeCloseTo(whole, 0)
    record('F-13', `${f13}ms`, `다시 ${await panelArea()}㎡`)
  } else {
    record('F-11', '나누지 않음', (await note().innerText()).slice(0, 80))
  }
  // F-16 끝까지 되돌린다.
  const undo = await undoAll()
  record('F-16', `${undo.n}번 · 가장 긴 것 ${undo.slowest}ms`, '물리존 편집을 끝까지 되돌려 바뀐 것 0건')

  // F-8 외곽선 없는 방을 3D 에서 그린다.
  await showStorey(null)
  await search().fill('')
  await openFold('물리존 이름·경계')
  const ringless = page.locator('.spaces-edit tbody tr', { hasText: '외곽선 없음' }).first()
  const storeyName = await ringless.locator('.tag').innerText()
  await ringless.getByRole('button', { name: '3D에서 그리기' }).click()
  await page.locator('.viewport canvas').scrollIntoViewIfNeeded()
  await settle()
  const host = map.spaces.find((s) => s.storey === storeyName)!
  const [hx, hy] = centroid(host.ring)
  for (const [dx, dy] of [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]]) await clickFloor(hx + dx, hy + dy, host.elevation)
  await page.keyboard.press('Enter')
  await expect(page.locator('.report')).toContainText('㎡')
  record('F-8', '통과', `${storeyName} 의 외곽선 없는 방에 1㎡ 외곽선`)
  await undoAll()
  expect(errors).toEqual([])
})

test('G 연결: 짚기·방향 바꾸기·포트 방향은 그대로·잇기·끊기', async () => {
  await editMode(true)
  await showStorey(null)
  await pickDevice('FCU3:FCU3:958283')
  const rows = page.locator('.picked .neighbors tr')
  // G-3 D 를 먼저 누르면 첫 연결을 짚는다. ] 로 다음 연결.
  await page.keyboard.press('d')
  await expect(rows.nth(0)).toHaveClass(/active/)
  const unknown = await rows.evaluateAll((trs) => trs.findIndex((tr) => tr.querySelector('.rel')?.textContent?.trim() === '연결'))
  expect(unknown).toBeGreaterThanOrEqual(0)
  for (let i = 0; i < unknown; i++) await page.keyboard.press(']')
  const row = rows.nth(unknown)
  await expect(row).toHaveClass(/active/)
  // G-1 방향 모르는 연결에 D: 하류 → 상류 → 방향 모름.
  const seen: string[] = []
  let slowest = 0
  for (let i = 0; i < 3; i++) {
    slowest = Math.max(slowest, await timed(() => page.keyboard.press('d')))
    seen.push((await row.locator('.rel').innerText()).trim())
  }
  expect(seen).toEqual(['하류', '상류', '연결'])
  record('G-1', `${slowest}ms`, `D 세 번: ${seen.join(' → ')}`)
  await page.keyboard.press('Escape')

  // G-2 포트가 말한 방향은 D 로 바뀌지 않는다.
  await pickFirst('공조기')
  await page.keyboard.press('d')
  const port = await rows.evaluateAll((trs) => trs.findIndex((tr) => ['하류', '상류'].includes(tr.querySelector('.rel')?.textContent?.trim() ?? '')))
  if (port >= 0) {
    for (let i = 0; i < port; i++) await page.keyboard.press(']')
    const rel = await rows.nth(port).locator('.rel').innerText()
    await page.keyboard.press('d')
    await expect(rows.nth(port).locator('.rel')).toHaveText(rel)
    // G-8 포트 연결에는 끊기가 없다.
    await expect(rows.nth(port).getByRole('button', { name: '끊기' })).toHaveCount(0)
    record('G-2·G-8', '통과', `포트 방향 "${rel.trim()}" 은 D 로 안 바뀌고 끊기가 없다`)
  }
  await page.keyboard.press('Escape')

  // G-6 잇기, G-7 끊기.
  await pickDevice('FCU3:FCU3:958283')
  const n = await rows.count()
  await page.locator('.picked').getByRole('button', { name: '잇기', exact: true }).click()
  await expect(page.locator('.picked')).toContainText('이을 상대를')
  await search().fill('FCU3:FCU3:958291')
  const joinMs = await timed(async () => {
    await page.locator('.equipment tbody tr', { hasText: 'FCU3:FCU3:958291' }).first().locator('button').first().click()
    await expect(rows).toHaveCount(n + 1)
  })
  await search().fill('')
  await search().press('Escape')
  const joined = rows.filter({ hasText: 'FCU3:FCU3:958291' })
  await expect(joined).toContainText('직접 이음')
  const cutMs = await timed(() => joined.getByRole('button', { name: '끊기' }).click())
  await expect(rows).toHaveCount(n)
  record('G-6·G-7', `잇기 ${joinMs}ms · 끊기 ${cutMs}ms`, '규칙 방향을 다시 돌린다')
  await undoAll()
  expect(errors).toEqual([])
})

test('H 종류와 I 되돌리기: U·K 로 패밀리 종류 정하기, 되돌리기 속도, 글자 칸, 한글 입력, 안내', async () => {
  await editMode(true)
  // H-1 U 는 종류 모르는 패밀리로 가고 단서가 보인다.
  const uMs = await timed(() => page.keyboard.press('u'))
  await expect(note()).toContainText(/종류 모르는 패밀리 1\/\d+/)
  const family = (await note().innerText()).match(/1\/(\d+): (.+?) (\d+)대/)
  record('H-1', `${uMs}ms`, family ? `모르는 패밀리 ${family[1]}개, 첫째 ${family[2]} ${family[3]}대` : '')
  // H-2 K 로 종류를 고르면 같은 패밀리 전체가 바뀐다.
  await page.keyboard.press('k')
  const kind = page.locator('.picked .kind-edit select')
  await expect(kind).toBeFocused()
  const kMs = await timed(() => kind.selectOption({ label: '배기팬' }))
  await expect(page.locator('.report')).toContainText(/대: 종류 모름 → 배기팬/)
  record('H-2', `${kMs}ms`, (await page.locator('.report li', { hasText: '배기팬' }).first().innerText()).trim())
  // H-3 공기 쪽 패밀리를 바꾸면 규칙이 다시 돌고, 포트와 새로 어긋난 계통이 있으면 알린다.
  const h3 = await note().innerText()
  record('H-3', h3.includes('어긋') ? '알림 있음' : '새로 어긋난 계통 없음', h3.slice(0, 120))
  // H-4 원래대로 되돌려 고르면 편집 목록에서 빠진다.
  await kind.selectOption('')
  await expect(page.locator('.report li', { hasText: '배기팬' })).toHaveCount(0)

  // I-1·I-3 편집 여럿 뒤 되돌리기·다시 하기 한 번.
  await pickDevice('FCU3:FCU3:958291')
  for (const key of ['ArrowRight', 'ArrowUp', 'PageUp', 'ArrowLeft', 'PageDown']) {
    await page.keyboard.press(key)
    await settle()
  }
  await page.keyboard.press('u')
  await page.keyboard.press('k')
  await page.locator('.picked .kind-edit select').selectOption({ label: '배기팬' })
  const undos: number[] = []
  for (let i = 0; i < 3; i++) undos.push(await timed(() => page.keyboard.press('Control+z')))
  const redos: number[] = []
  redos.push(await timed(() => page.keyboard.press('Control+Shift+z')))
  redos.push(await timed(() => page.keyboard.press('Control+y')))
  record('I-1·I-3', `되돌리기 ${undos.join('/')}ms · 다시 ${redos.join('/')}ms`)
  expect(Math.max(...undos)).toBeLessThan(1000)
  await undoAll()

  // I-4 글자 칸의 Ctrl+Z 는 칸의 글자만 되돌린다.
  await pickDevice('FCU3:FCU3:958291')
  const name = page.locator('.picked .equipment-name-edit input')
  await name.click()
  await name.press('End')
  await name.pressSequentially('XYZ')
  await name.press('Control+z')
  expect(await name.inputValue()).not.toContain('XYZ')
  await expect(page.locator('.edit-bar')).toContainText('바뀐 것 0건')
  await name.press('Escape')
  // I-5 한글 입력 상태의 E 는 'ㄷ' 로 들어와도 모드를 바꾼다(키 코드로 맞춘다).
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ㄷ', code: 'KeyE', bubbles: true })))
  await expect(page.getByRole('button', { name: '보기', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ㄷ', code: 'KeyE', bubbles: true })))
  await expect(page.getByRole('button', { name: '편집', exact: true })).toHaveAttribute('aria-pressed', 'true')
  // I-6 ? 는 안내를 연다.
  await page.keyboard.press('Shift+Slash')
  const help = page.getByRole('dialog', { name: '단축키' })
  await expect(help).toBeVisible()
  for (const k of ['보기 ↔ 편집', '되돌리기', '다시 하기', '규칙 방향', '내력벽']) await expect(help).toContainText(k)
  await page.keyboard.press('Escape')
  record('I-4·I-5·I-6', '통과')
  expect(errors).toEqual([])
})

test('J 완전성 검사에서 한 번에 고치기', async () => {
  await editMode(true)
  await openFold('완전성 검사')
  const out: string[] = []
  for (const [label, key] of [['소속 방이 있다', 'J-1'], ['연결망에 붙어', 'J-2']] as const) {
    const tr = page.locator('.checks tbody tr', { hasText: label }).first()
    const count = async () => (await tr.innerText()).match(/(\d+) \/ (\d+)/)![1]
    const before = await count()
    await tr.locator('button.link').click()
    const fix = page.locator('.check-list button.fix').first()
    await expect(fix).toBeVisible()
    const what = await fix.innerText()
    const ms = await timed(() => fix.click())
    await expect.poll(count).not.toBe(before)
    const after = await count()
    await page.locator('.edit-bar').click({ position: { x: 2, y: 2 } })
    const back = await timed(() => page.keyboard.press('Control+z'))
    await expect.poll(count).toBe(before)
    record(key, `${ms}ms · 되돌리기 ${back}ms`, `[${what}] 통과 ${before} → ${after}`)
    out.push(key)
  }
  expect(out).toHaveLength(2)
  await undoAll()
  expect(errors).toEqual([])
})

test('N 벽·문·창: 켜기·고르기·방향키·내력 여부·긋기·문 놓기·지우기와 방 경계 같이', async () => {
  await editMode(true)
  await showStorey('3F')
  const layer = page.getByRole('button', { name: '벽·문·창' })
  const n1 = await timed(() => layer.click())
  expect((await viewer<string[]>('elements')).length).toBeGreaterThan(50)
  record('N-1', `${n1}ms`, `벽·문·창 ${(await viewer<string[]>('elements')).length}개`)
  const panel = page.locator('.element-picked')

  // N-2·N-3 내력 모름인 벽을 골라 방향키로 옮기고 내력으로 바꾼다.
  const unknown = await wallToPick((w) => w.loadBearing === null)
  const any = unknown ?? (await wallToPick((w) => w.storey === '3F'))
  expect(any, '3F 에서 누를 벽을 못 찾았다').not.toBeNull()
  await showStorey(any!.wall.storey)
  await page.mouse.click(any!.at.x, any!.at.y)
  await expect(panel.locator('h3')).toHaveText(any!.wall.name)
  const n2 = await timed(() => page.keyboard.press('ArrowRight'))
  record('N-2', `${n2}ms`, `${any!.wall.name}`)
  if (unknown) {
    await panel.locator('select').last().selectOption('true')
    await expect(page.locator('.report')).toContainText('모름 → 내력')
    record('N-3', '통과', '내력 모름 → 내력')
  }
  // N-7 벽 지우기와 되돌리기.
  const before = (await viewer<string[]>('elements')).length
  const n7 = await timed(() => panel.getByRole('button', { name: '벽 지우기' }).click())
  await expect.poll(async () => (await viewer<string[]>('elements')).length).toBeLessThan(before)
  await page.locator('.edit-bar').click({ position: { x: 2, y: 2 } })
  await page.keyboard.press('Control+z')
  await expect.poll(async () => (await viewer<string[]>('elements')).length).toBe(before)
  record('N-7', `${n7}ms`, '지우고 Ctrl+Z 로 돌아온다')

  // N-4 벽 긋기, N-5 문 놓기(벽 가까이).
  const room = await roomToEdit(any!.wall.storey)
  if (room) {
    const { cx, cy, space } = room
    await page.getByRole('button', { name: '벽 긋기' }).click()
    await clickFloor(cx - 1.5, cy, space.elevation)
    await clickFloor(cx + 1.5, cy, space.elevation)
    await expect(panel.locator('h3')).toHaveText('새 벽')
    await expect(panel.locator('select').last()).toHaveValue('null')
    await page.getByRole('button', { name: '문 놓기' }).click()
    await clickFloor(cx, cy + 0.1, space.elevation)
    await expect(panel.locator('h3')).toHaveText('새 문')
    record('N-4·N-5', '통과', '3m 벽(내력 모름)과 그 벽의 문')
  }
  await undoAll()

  // N-8a·N-8b 칸막이 벽을 방 경계와 같이 옮긴다. 벽의 양옆(두께 밖 0.3m)이 서로 다른 방인 벽을 GeoJSON 에서 고른다.
  await showStorey('3F')
  const partitions = partitionWalls('3F')
  let carried = false
  const why: string[] = []
  for (const { wall: w } of partitions.slice(0, 30)) {
    const [x, y] = centroid(w.ring)
    const at = await floor(x, y, w.elevation + 1.15)
    const hit = await viewer<{ equipment: string | null; element: string | null }>('pickAt', at.x, at.y)
    if (hit.element !== w.id || hit.equipment) {
      why.push('누를 수 없음')
      continue
    }
    await page.mouse.click(at.x, at.y)
    await expect(panel.locator('h3')).toHaveText(w.name)
    await panel.locator('.carry-rooms input').check()
    await page.keyboard.press('ArrowUp')
    await page.keyboard.press('ArrowRight')
    await settle()
    // 벽 하나가 옮긴 방들은 리포트 한 줄에 적힌다("TPS 9.1㎡ → 9.4㎡ · EPS 5.1㎡ → 4.8㎡"). 넓이 변화를 센다.
    const report = await page.locator('.report').innerText().catch(() => '')
    const lines = report.split('\n').filter((l) => l.includes('㎡ →'))
    if ((report.match(/㎡ →/g) ?? []).length >= 2) {
      record('N-8a', '통과', `${w.name}: ${lines.join(' / ')}`)
      // N-8b 다섯 걸음 나갔다 돌아오면 넓이가 처음과 같다.
      for (let i = 0; i < 4; i++) await page.keyboard.press('ArrowUp')
      for (let i = 0; i < 5; i++) await page.keyboard.press('ArrowDown')
      await page.keyboard.press('ArrowLeft')
      await expect(page.locator('.report li', { hasText: '㎡ →' })).toHaveCount(0)
      record('N-8b', '통과', '다섯 걸음 나갔다 돌아오면 방 넓이가 처음과 같다')
      carried = true
      break
    }
    why.push(`${w.name}: ${lines.join(' / ') || '넓이 변화 없음'}`)
    await undoAll()
  }
  if (!carried) record('N-8a', '따라오지 않음', `양옆이 다른 방인 3F 벽 ${partitions.length}장 모두 방 둘이 같이 바뀌지 않았다: ${why.join(' / ')}`)
  await undoAll()
  await layer.click()
  await showStorey(null)
  expect(errors).toEqual([])
})

test('O 계통: 계통 빼기와 같은 자리로 되돌리기, 종류 바꾸기 알림, 유체, 확정 뒤 옮기기, 만들고 지우기, 찾기', async () => {
  await editMode(true)
  // O-2 계통 없음으로 뺐다가 되돌리면 원래 계통으로.
  await pickDevice('FCU3:FCU3:958291')
  const stats = page.locator('.picked .stats').first()
  const system = (await stats.innerText()).match(/순환수[^·\n]*|기계[^·\n]*/)?.[0]?.trim() ?? ''
  await page.locator('.picked .system-edit select').selectOption('')
  await expect(stats).toContainText('(계통 없음)')
  await page.locator('.edit-bar').click({ position: { x: 2, y: 2 } })
  await page.keyboard.press('Control+z')
  await expect(stats).toContainText(system)
  record('O-2', '통과', `${system} → (계통 없음) → Ctrl+Z 로 ${system}`)

  // O-3 급기 계통을 환기로: 규칙 방향이 몇 개 빠졌는지 알린다.
  await openFold('규칙 방향 확정')
  const rows = page.locator('.rule-systems tbody tr')
  // 종류 칸이 급기이고 포트와 대 본 일치율이 있는, 확정 전 계통.
  const index = await rows.evaluateAll((trs) =>
    trs.findIndex((tr) => {
      const td = [...tr.querySelectorAll('td')].map((c) => c.textContent!.trim())
      return td[1]?.startsWith('급기') && td[3]?.includes('%') && td[4] === '확정'
    }),
  )
  expect(index).toBeGreaterThanOrEqual(0)
  const supply = rows.nth(index)
  const supplyName = (await supply.locator('button').first().innerText()).trim()
  await supply.locator('button').first().click()
  const picked = page.locator('.system-picked')
  const o3 = await timed(() => picked.locator('.system-kind-edit select').first().selectOption({ label: '환기' }))
  await expect(note()).toContainText(`계통 ${supplyName}: 규칙 방향`)
  record('O-3', `${o3}ms`, (await note().innerText()).trim())
  await page.keyboard.press('Control+z')

  // O-4 순환수 계통의 유체.
  await page.locator('.legend button', { hasText: /^순환수 공급/ }).first().click()
  const fluid = picked.locator('.system-kind-edit select').nth(1)
  await expect(fluid).toBeVisible()
  await fluid.selectOption('chilled')
  await expect(picked.locator('.stats')).toContainText('냉수')
  const ttl = await download(() => page.getByRole('button', { name: '의미 내보내기 (Brick TTL)' }).click())
  expect(ttl.text).toContain('brick:Chilled_Water_System')
  record('O-4', '통과', '순환수 공급 → 냉수, TTL 계통 클래스 brick:Chilled_Water_System')
  await page.keyboard.press('Control+z')

  // O-5 확정한 계통의 덕트를 다른 계통으로 옮겨도 확정한 방향은 그대로다(규칙이 확정 계통을 얼려 둔다).
  // FCU3:958283 의 급기 덕트가 든 계통을 확정하고, 그 덕트의 계통을 바꾼 뒤 TTL 의 feeds 를 견준다.
  await pickDevice('FCU3:FCU3:958283')
  const duct = (await page.locator('.picked .neighbors tr', { hasText: '급기' }).first().locator('a, button').first().innerText()).trim()
  await pickDevice(duct)
  const ductSystem = (await page.locator('.picked .system-edit select').evaluate((el: HTMLSelectElement) => el.selectedOptions[0].text)).split(' · ')[0].trim()
  await openFold('규칙 방향 확정')
  const confirmRow = rows.filter({ has: page.getByRole('button', { name: ductSystem, exact: true }) })
  await confirmRow.getByRole('button', { name: '확정', exact: true }).click()
  await expect(confirmRow).toContainText('확정함')
  const feeds = async () =>
    ((await download(() => page.getByRole('button', { name: '의미 내보내기 (Brick TTL)' }).click())).text.match(/brick:feeds/g) ?? []).length
  const f1 = await feeds()
  await pickDevice(duct)
  const select = page.locator('.picked .system-edit select')
  const other = await select.locator('option').nth(3).getAttribute('value')
  await select.selectOption(other!)
  const f2 = await feeds()
  expect(f2).toBe(f1)
  record('O-5', '통과', `${ductSystem} 확정 뒤 ${duct} 의 계통을 바꿔도 feeds ${f1} → ${f2}`)
  await undoAll()

  // O-5a 새 계통, O-5b 지우고 되돌리기.
  await pickDevice('FCU3:FCU3:958291')
  await page.locator('.picked').getByRole('button', { name: '새 계통…' }).click()
  const form = page.locator('.picked .new-system')
  await form.locator('input').fill('시험 계통')
  await form.locator('select').selectOption('supply_air')
  await form.getByRole('button', { name: '만들어 넣기' }).click()
  await expect(page.locator('.report')).toContainText('계통 시험 계통을 만들었습니다')
  await page.locator('.legend button', { hasText: '시험 계통' }).click()
  await page.locator('.system-picked').getByRole('button', { name: '계통 지우기' }).click()
  await expect(page.locator('.legend')).not.toContainText('시험 계통')
  await page.locator('.edit-bar').click({ position: { x: 2, y: 2 } })
  await page.keyboard.press('Control+z')
  await expect(page.locator('.legend')).toContainText('시험 계통')
  record('O-5a·O-5b', '통과')
  await undoAll()

  // O-5c 계통 찾기 칸.
  await pickDevice('FCU3:FCU3:958291')
  const all = await page.locator('.picked .system-edit select option').count()
  await page.getByPlaceholder(/계통 \d+개에서 찾기/).fill('급기 12')
  await expect.poll(() => page.locator('.picked .system-edit select option').count()).toBeLessThan(all)
  record('O-5c', '통과', `선택지 ${all} → ${await page.locator('.picked .system-edit select option').count()}`)
  await page.getByPlaceholder(/계통 \d+개에서 찾기/).fill('')
  expect(errors).toEqual([])
})

test('K·L 저장과 불러오기, 자동 저장, 내보내기가 같다', async () => {
  await editMode(true)
  // 편집 여러 종류를 섞는다: 설비 옮기기, 방 이름, 패밀리 종류, 계통 확정, 잇기.
  await pickDevice('FCU3:FCU3:958291')
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('PageUp')
  await showStorey('3F')
  const target = (await roomToEdit('3F'))!
  await clickFloor(target.cx, target.cy, target.space.elevation + 0.05)
  const rename = page.locator('.space-picked .space-name input')
  await rename.fill('회의실 가')
  await rename.press('Enter')
  await rename.press('Escape')
  await showStorey(null)
  await page.keyboard.press('u')
  await page.keyboard.press('k')
  await page.locator('.picked .kind-edit select').selectOption({ label: '배기팬' })
  await openFold('규칙 방향 확정')
  const confirm = page.locator('.rule-systems tbody tr').getByRole('button', { name: '확정', exact: true })
  const ttlFeeds = async () => ((await download(() => page.getByRole('button', { name: '의미 내보내기 (Brick TTL)' }).click())).text.match(/brick:feeds/g) ?? []).length
  const feeds0 = await ttlFeeds()
  // L-3 확정한 만큼 feeds 가 는다(기기→기기라 규칙 방향 수보다 적게 는다).
  for (let i = 0; i < 30; i++) await confirm.first().click()
  const feeds1 = await ttlFeeds()
  expect(feeds1).toBeGreaterThanOrEqual(feeds0)
  record('L-3', `feeds ${feeds0} → ${feeds1}`, '계통 30개 확정')
  const changes = await changeCount()

  // K-1 저장. K-7 자동 저장 크기.
  const saved = await download(() => page.keyboard.press('Control+s'))
  await page.waitForTimeout(1500)
  const draft = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('oe-draft')).map((k) => localStorage.getItem(k)!.length))
  record('K-1·K-7', `편집 파일 ${saved.kb}KB · 자동 저장 ${Math.round(draft[0] / 1024)}KB`, `바뀐 것 ${changes}건`)
  const ttl = (await download(() => page.getByRole('button', { name: '의미 내보내기 (Brick TTL)' }).click())).text
  // L-4·L-5·L-6 옮긴 설비의 소속, 고친 방 이름, 좌표가 없는 TTL.
  expect(ttl).toContain('rdfs:label "회의실 가"')
  expect(ttl).not.toMatch(/POLYGON\(|geo:asWKT|wktLiteral/)
  record('L-5·L-6', '통과', 'TTL 에 고친 방 이름, 기하 없음')

  // K-3 새로 열어 건축만 열면 묻지 않는다. K-4 기계를 덧붙이면 묻고, 이어서 하면 돌아온다.
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(ARCH)
  await expect(page.locator('.appbar h2')).toHaveText('Factorial_건축.ifc', { timeout: 600_000 })
  await expect(page.locator('.progress-toast')).toHaveCount(0, { timeout: 600_000 })
  await expect(page.locator('.draft-bar')).toHaveCount(0)
  await page.locator('.appbar label', { hasText: '덧붙이기' }).locator('input[type=file]').setInputFiles(MECH)
  await expect(page.locator('.appbar h2')).toHaveText(/\+/, { timeout: 600_000 })
  await expect(page.locator('.progress-toast')).toHaveCount(0, { timeout: 600_000 })
  await expect(page.locator('.draft-bar')).toBeVisible()
  const restore = await timed(() => page.getByRole('button', { name: '이어서 하기' }).click())
  await editMode(true)
  expect(await changeCount()).toBe(changes)
  const restored = (await download(() => page.getByRole('button', { name: '의미 내보내기 (Brick TTL)' }).click())).text
  expect(restored.split('\n').sort()).toEqual(ttl.split('\n').sort())
  record('K-3·K-4', `이어서 하기 ${restore}ms`, `바뀐 것 ${changes}건이 돌아오고 TTL 이 같다`)

  // K-6 열자마자 새로 고치면 기록이 남아 다시 묻는다. K-5 버리면 다음에는 안 묻는다.
  const reopen = async () => {
    await page.goto('/')
    await page.locator('.drop input[type=file]').setInputFiles([ARCH, MECH])
    await expect(page.locator('.appbar h2')).toHaveText(/\+/, { timeout: 600_000 })
    await expect(page.locator('.progress-toast')).toHaveCount(0, { timeout: 600_000 })
  }
  await reopen()
  await expect(page.locator('.draft-bar')).toBeVisible()
  await page.getByRole('button', { name: '버리기' }).click()
  await reopen()
  await expect(page.locator('.draft-bar')).toHaveCount(0)
  record('K-5·K-6', '통과')

  // K-2 편집 파일 불러오기. 못 찾은 것 0, TTL 이 저장 전과 같다(구성원 순서만 다를 수 있어 줄로 견준다).
  await editMode(true)
  const file = `test-results/seongsu-edits.json`
  mkdirSync('test-results', { recursive: true })
  writeFileSync(file, saved.text)
  const load = await timed(async () => {
    await page.locator('.load-edits input[type=file]').setInputFiles(file)
    await expect(page.locator('.edit-file-note')).toBeVisible()
  })
  const loadNote = await page.locator('.edit-file-note').innerText()
  expect(loadNote).not.toContain('찾지 못함')
  const loaded = (await download(() => page.getByRole('button', { name: '의미 내보내기 (Brick TTL)' }).click())).text
  expect(loaded.split('\n').sort()).toEqual(ttl.split('\n').sort())
  record('K-2·O-6', `${load}ms`, loadNote.trim())

  // K-9 다른 파일에 불러오면 못 찾은 것을 알리고 엉뚱한 곳에 얹지 않는다.
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles('src/lib/ifc/fixtures/mep.ifc')
  await expect(page.locator('.appbar h2')).toHaveText('mep.ifc')
  await editMode(true)
  await page.locator('.load-edits input[type=file]').setInputFiles(file)
  await expect(page.locator('.edit-file-note')).toContainText('찾지 못함')
  expect(await changeCount()).toBe(0)
  record('K-9', '통과', (await page.locator('.edit-file-note').innerText()).trim().slice(0, 120))

  // K-8 편집이 남은 채 탭을 닫으면 묻는다.
  // 작은 파일은 검색 칸이 없고 표가 펼쳐져 있다.
  await page.locator('.equipment tbody tr', { hasText: 'AHU-1' }).getByRole('button', { name: 'AHU-1', exact: true }).click()
  await page.keyboard.press('ArrowRight')
  await expect(page.locator('.edit-bar')).toContainText('바뀐 것 1건')
  let asked = false
  page.on('dialog', (d) => void (asked ||= d.type() === 'beforeunload'))
  await page.close({ runBeforeUnload: true })
  await expect.poll(() => asked).toBe(true)
  record('K-8', '통과', '닫기 전에 브라우저가 묻는다')
  expect(errors).toEqual([])
})
