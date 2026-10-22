// 사용 가이드(public/guide/index.html)의 화면 그림을 찍는다. 실제 에디터에서 Duplex 건축+HVAC 로 프로젝트를 만들고, 가이드의 순서대로
// 조작하면서 찍는다. 흐름 장면(network)만 ifc4Mep 으로 맨 끝에 찍는다. 그림마다 번호 핀 자리(요소 왼쪽, 그림 안의 %)와 핀마다 확대 컷을
// screens/ 에 같이 남긴다. UI 가 바뀌면 다시 돌린다.
//
// 준비: 프로젝트·업로드가 서버의 data 폴더에 남으므로 빈 폴더를 붙인 e2e 모드 서버를 띄운다(로컬 data/ 의 프로젝트 목록을 더럽히지 않는다).
//   OE_DATA_ROOT=$(mktemp -d) npx vite --mode e2e --port 5179
//   node scripts/guide/capture.mjs            # BASE=http://localhost:5179/ 가 기본
//   THEME=dark node scripts/guide/capture.mjs # 다크 테마로 한 벌 더. screens/dark/ 에 같은 이름으로 남는다(가이드가 테마에 따라 고른다)
//   ONLY=project node scripts/guide/capture.mjs # 첫 화면(1단계)만 다시 찍는다. 다른 그림과 핀은 그대로 둔다
// 다크로 찍을 때는 서버의 data 폴더를 다시 비운다 — 같은 폴더면 프로젝트가 둘이 되어 첫 그림이 달라진다.
// Duplex 와 ifc4Mep 파일이 data/ 에 있어야 한다(npm run fetch:sample).
import { chromium } from '@playwright/test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const BASE = process.env.BASE ?? 'http://localhost:5179/'
const THEME = process.env.THEME === 'dark' ? 'dark' : 'light'
const ONLY = process.env.ONLY
const OUT = resolve(THEME === 'dark' ? 'public/guide/screens/dark' : 'public/guide/screens')
const ARCH = resolve('data/NBU_Duplex/NBU_Duplex-Apt_Arch.ifc')
const HVAC = resolve('data/NBU_Duplex/NBU_Duplex-Apt_Eng-HVAC.ifc')
// 흐름 장면은 포트에 방향이 적힌 파일이어야 칠할 것이 있다.
const MEP = resolve('data/ifc4Mep_IFC4.ifc')
// 고르는 설비. 아래로 몇 칸 옮기면 Utility 에서 Bedroom 1 로 소속이 바뀐다(2026-10-20 에 잰 것).
const BOILER = 'M_Hot Water Boiler - 59-440 kW #557516'
const W = 1440
const H = 900

for (const f of [ARCH, HVAC, MEP]) if (!existsSync(f)) throw new Error(`${f} 가 없다. npm run fetch:sample`)
mkdirSync(OUT, { recursive: true })
// 내보낸 TTL·GeoJSON 을 받아 두었다가 뷰어에 다시 넣는다. 저장소에는 남기지 않는다.
const DOWN = mkdtempSync(join(tmpdir(), 'oe-guide-'))

const angle = process.env.ANGLE ?? (process.platform === 'win32' ? 'd3d11' : 'gl')
const browser = await chromium.launch({ args: [`--use-angle=${angle}`, '--ignore-gpu-blocklist', '--enable-gpu', '--enable-unsafe-swiftshader'] })
// 2배로 그린다. 전체 그림은 CSS 크기(1배)로 저장하고, 확대 컷만 2배 그대로 저장해 작은 글씨도 읽히게 한다.
const ctx = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 2, acceptDownloads: true })
const page = await ctx.newPage()
page.on('pageerror', (e) => console.error('pageerror', e.message))
const pins = {}

/**
 * 확대 컷의 자리. 요소에 여백을 두르되 가로는 요소 왼쪽에서 시작한다 — 라벨(종류·소속)의 값과 버튼의 설명이 오른쪽에 붙어 있다.
 * 너무 크면 위를 기준으로 자른다. 창 밖으로는 나가지 않는다.
 */
function zoomBox(box) {
  const pad = 28
  const w = Math.min(Math.max(box.width + pad * 2, 300), 520)
  const h = Math.min(Math.max(box.height + pad * 2, 120), 280)
  let x = box.x - pad
  let y = box.height + pad * 2 > h ? box.y - pad : box.y + box.height / 2 - h / 2
  x = Math.min(Math.max(0, x), W - w)
  y = Math.min(Math.max(0, y), H - h)
  return { x, y, width: w, height: h }
}

/**
 * 화면을 찍고 핀 자리를 적는다. clip 이 없으면 창 전체다. 핀은 [설명, locator] 이고, 자리는 그림 크기에 대한 % 라서 가이드가 그림을
 * 줄여 보여도 같은 곳을 가리킨다. 화면 밖이거나 안 보이는 요소는 실패로 멈춘다 — 엉뚱한 곳을 가리키는 핀보다 낫다.
 */
async function shot(name, marks, clip = { x: 0, y: 0, width: W, height: H }, meta = {}) {
  await page.waitForTimeout(400)
  const list = []
  const boxes = []
  for (const [label, loc] of marks) {
    const box = await loc.boundingBox()
    if (!box) throw new Error(`${name}: "${label}" 이 안 보인다`)
    // 요소의 왼쪽 끝 바로 앞에 놓는다. 가운데에 놓으면 핀이 그 글자를 가린다. 그림 가장자리에서는 안쪽으로 당긴다.
    const cx = Math.max(14, box.x - 15 - clip.x)
    const cy = box.y + box.height / 2 - clip.y
    if (cx < 0 || cy < 0 || cx > clip.width || cy > clip.height) throw new Error(`${name}: "${label}" 이 그림 밖이다`)
    list.push({ label, x: +((cx / clip.width) * 100).toFixed(2), y: +((cy / clip.height) * 100).toFixed(2), zoom: `${name}-${list.length + 1}.jpg` })
    boxes.push(box)
  }
  await page.screenshot({ path: `${OUT}/${name}.png`, clip, scale: 'css' })
  for (const [i, box] of boxes.entries()) await page.screenshot({ path: `${OUT}/${list[i].zoom}`, clip: zoomBox(box), type: 'jpeg', quality: 86 })
  pins[name] = { width: clip.width, height: clip.height, pins: list, ...meta }
  console.log('ok', name)
}
/** 핀 없이 한 장만(편집 전 화면처럼 비교용). */
async function plain(name, clip = { x: 0, y: 0, width: W, height: H }) {
  await page.waitForTimeout(400)
  await page.screenshot({ path: `${OUT}/${name}.png`, clip, scale: 'css' })
  console.log('ok', name)
}
/** 요소를 감싼 자리(여백 pad). 대화상자·패널만 잘라 찍을 때. */
async function around(loc, pad = 20) {
  const b = await loc.boundingBox()
  const x = Math.max(0, b.x - pad)
  const y = Math.max(0, b.y - pad)
  return { x, y, width: Math.min(W - x, b.width + pad * 2), height: Math.min(H - y, b.height + pad * 2) }
}

const btn = (name) => page.getByRole('button', { name, exact: true })
const chip = (n, word) => page.locator('button').filter({ hasText: new RegExp(`^\\s*${n}\\s*${word}\\s*$`) }).first()
// 오른쪽 패널. 기준·검증 드로어도 aside 라서 클래스로 가른다.
const side = page.locator('aside:not(.shell-drawer), .side-panel').first()
const fact = (label) => side.locator('dt').filter({ hasText: new RegExp(`^\\s*${label}\\s*$`) }).first()
const storey = page.getByRole('combobox', { name: '보일 층' })
const drawer = page.getByTestId('basis-drawer')
async function settle() {
  await page.locator('.progress-toast').waitFor({ state: 'detached', timeout: 120_000 }).catch(() => {})
  await page.waitForTimeout(1500)
}

// 1. 프로젝트 만들기
await page.goto(BASE)
await page.evaluate((theme) => {
  localStorage.clear()
  localStorage.setItem('oe-theme', theme)
}, THEME)
await page.goto(BASE)
const user = page.getByLabel('사용자')
await user.selectOption('편집자')
const list = page.getByRole('region', { name: '프로젝트' })
await list.getByRole('button', { name: '새 프로젝트' }).click()
const form = page.getByRole('form', { name: '새 프로젝트' })
await form.getByLabel('프로젝트 이름').fill('Duplex 아파트')
await form.getByLabel('사이트 이름').fill('NBU 샘플')
await form.getByLabel('IFC 파일').setInputFiles([ARCH, HVAC])
await shot(
  'project',
  [
    ['사용자', user],
    ['새 프로젝트', list.getByRole('button', { name: '새 프로젝트' })],
    ['이름·사이트', form.getByLabel('프로젝트 이름')],
    ['IFC 파일 올리기', form.locator('label.pick')],
    ['만들기', form.getByRole('button', { name: '만들기' })],
  ],
  { x: 140, y: 30, width: 1160, height: 380 },
)
if (ONLY === 'project') {
  await finish()
  process.exit(0)
}
await form.getByRole('button', { name: '만들기' }).click()
await page.locator('.appbar h2').waitFor({ timeout: 120_000 })
await settle()

// 2. 에디터 한눈에
await shot('editor', [
  ['모드 배지', page.locator('.appbar').getByText('초기 구축', { exact: true })],
  ['기준 · 경고', page.locator('.appbar button', { hasText: '경고' })],
  ['편집 레일', btn('공간 편집')],
  ['3D · 평면도', btn('평면도')],
  ['현재층', storey],
  ['선택 오브젝트', side.getByText('선택 오브젝트', { exact: true })],
  ['층 현황', side.getByText('층 현황', { exact: true })],
  ['구축하기', btn('구축하기')],
])

// 3. 기준·검증 — 이 파일의 등급과 경고·검사
await page.locator('.appbar button', { hasText: '기준' }).first().click()
await drawer.waitFor()
await page.waitForTimeout(1200)
await shot(
  'criteria',
  [
    ['등급 칩', drawer.locator('ul.tiers li').first()],
    ['수용 기준선', drawer.getByText('수용 기준선 통과').first()],
    ['요약', drawer.getByText('요약', { exact: true }).first()],
    ['합친 방법', drawer.getByText(/두 파일을 층 이름/).first()],
  ],
  await around(drawer, 0),
)
// [경고] 버튼은 같은 드로어를 경고 목록에 맞춰 연다. 경고 바로 아래에 완전성 검사가 이어진다.
await page.getByRole('button', { name: '기준 · 검증 닫기' }).click()
await page.waitForTimeout(400)
await page.locator('.appbar button', { hasText: '경고' }).first().click()
await page.waitForTimeout(1200)
const checksHead = drawer.getByText('완전성 검사', { exact: true }).first()
await shot(
  'checks',
  [
    ['경고', drawer.getByText(/공간 2개에 바닥 외곽선/).first()],
    ['외곽선 없는 물리존', drawer.getByText('외곽선 없는 물리존', { exact: true }).first()],
    ['완전성 검사', checksHead],
    ['소속 허용 거리', drawer.getByText(/소속 허용 거리\(사이트 설정\)/).first()],
  ],
  await around(drawer, 0),
)
await page.getByRole('button', { name: '기준 · 검증 닫기' }).click()
await page.waitForTimeout(500)

// 4. 층 바꾸고 평면도
await storey.selectOption({ label: 'Level 2' })
await settle()
await btn('평면도').click()
await page.waitForTimeout(1500)
await shot('plan', [
  ['평면도', btn('평면도')],
  ['현재층', storey],
  ['물리존 목록', chip(10, '물리존')],
])
await btn('3D').click()
await page.waitForTimeout(1500)

// 5. 설비 고르기 — 출처 칩. 옮기기 전 화면이기도 하다(move 와 견준다).
await chip(22, '설비').click()
await page.locator('button').filter({ hasText: BOILER }).first().click()
await page.waitForTimeout(1500)
await shot('equipment', [
  ['선택한 설비', page.locator('button').filter({ hasText: BOILER }).first()],
  ['종류 · 사전', fact('종류')],
  ['계통 · BIM', fact('계통')],
  ['소속 · 계산', fact('소속')],
  ['색 범례', page.locator('.color-key').first()],
])

// 6. 설비 옮기기 — 소속이 바로 바뀐다. 방향키는 화면 기준이라 시점에 따라 가는 쪽이 달라서, 한 칸씩 누르며 다른 방에 들 때 멈춘다.
// 목록 버튼에 포커스가 있으면 방향키가 목록으로 가서 포커스를 푼다.
const socOf = async () => {
  const t = (await side.innerText()).split('\n')
  return t[t.indexOf('소속') + 1]?.replace(/\s*계산$/, '').trim()
}
const from = await socOf()
const back = { ArrowDown: 'ArrowUp', ArrowUp: 'ArrowDown', ArrowLeft: 'ArrowRight', ArrowRight: 'ArrowLeft' }
let moved = null
for (const k of ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight']) {
  await page.evaluate(() => document.activeElement?.blur())
  for (let n = 1; n <= 40; n++) {
    await page.keyboard.press(k)
    await page.waitForTimeout(120)
    const now = await socOf()
    if (now && now !== from && !now.includes('소속 없음')) {
      moved = { from, to: now, key: k, presses: n }
      break
    }
  }
  if (moved) break
  for (let n = 0; n < 40; n++) await page.keyboard.press(back[k])
  await page.waitForTimeout(500)
}
if (!moved) throw new Error(`${from} 에서 다른 방으로 옮기지 못했다`)
await page.waitForTimeout(1000)
await shot(
  'move',
  [
    ['소속', fact('소속')],
    ['바뀐 것', page.locator('button').filter({ hasText: /바뀐 것/ }).first()],
    ['마지막 편집', page.getByText(/옮김$/).filter({ visible: true }).last()],
  ],
  undefined,
  { moved },
)

// 7. 방 이름 고치기 — 고치기 전 화면도 찍어 견준다.
await btn('공간 편집').click()
await page.waitForTimeout(800)
await chip(10, '물리존').click()
await page.locator('button').filter({ hasText: 'Bedroom 2' }).first().click()
await page.waitForTimeout(1000)
const inputs = side.locator('input[type=text]')
let roomName = null
for (let i = 0; i < (await inputs.count()); i++) if ((await inputs.nth(i).inputValue()) === 'Bedroom 2') roomName = inputs.nth(i)
if (!roomName) throw new Error('공간명 칸을 못 찾았다')
await roomName.scrollIntoViewIfNeeded()
await page.waitForTimeout(500)
await plain('room-before')
await roomName.fill('침실 2')
await roomName.press('Enter')
await page.waitForTimeout(1000)
await roomName.scrollIntoViewIfNeeded()
await shot('room', [
  ['공간 편집', btn('공간 편집')],
  ['공간명', roomName],
  ['방 목록', page.locator('button').filter({ hasText: '침실 2' }).last()],
  ['마지막 편집', page.getByText(/→ 침실 2/).filter({ visible: true }).last()],
])

// 8. 결과 비교 — TTL · GeoJSON 의 어느 줄이 되나
await page.locator('button').filter({ hasText: '침실 2' }).last().click()
await btn('결과 비교').click()
await page.waitForTimeout(2500)
await shot('compare', [
  ['결과 비교', btn('결과 비교')],
  ['TTL · GeoJSON', page.getByText(/DT 플랫폼이 읽는/).first()],
  ['TTL 블록', page.getByText(/rdfs:label "침실 2"/).first()],
])
await page.getByRole('button', { name: '닫기', exact: true }).first().click()
await page.waitForTimeout(500)

// 9. 미리보기 — 반영 전 변경 요약과 소속이 바뀔 설비
await btn('미리보기').click()
const preview = page.getByTestId('preview')
await preview.waitFor()
await page.waitForTimeout(800)
await shot(
  'preview',
  [
    ['변경 요약', page.getByTestId('preview-summary')],
    ['소속이 바뀔 설비', preview.getByText(new RegExp(moved.to)).first()],
    ['규칙 경고', preview.getByText('규칙 경고').first()],
  ],
  await around(preview, 12),
)
await preview.getByRole('button', { name: '닫기', exact: true }).click()
await page.waitForTimeout(500)

// 10. 파일 ▾ 내보내기. 층이 여럿이면 폴더 고르기 창(showDirectoryPicker)으로 저장하는데 자동으로는 고를 수 없어서, 내려받기로 받게 한다.
await page.evaluate(() => {
  window.showDirectoryPicker = undefined
})
await page.locator('summary', { hasText: '파일 ▾' }).click()
await page.waitForTimeout(500)
await shot('export', [
  ['파일 ▾', page.locator('summary', { hasText: '파일 ▾' })],
  ['GeoJSON', page.getByRole('button', { name: '기하 내보내기 (GeoJSON)' })],
  ['TTL', page.getByRole('button', { name: '의미 내보내기 (Brick TTL)' })],
])
const saved = []
page.on('download', (d) => {
  const f = join(DOWN, d.suggestedFilename())
  saved.push(d.saveAs(f).then(() => f))
})
await page.getByRole('button', { name: '의미 내보내기 (Brick TTL)' }).click()
await page.getByRole('button', { name: '기하 내보내기 (GeoJSON)' }).click()
await page.waitForTimeout(3000)
const files = await Promise.all(saved)
console.log('exported', files.map((f) => f.split('/').pop()).join(' '))
if (!files.some((f) => f.endsWith('.ttl')) || !files.some((f) => f.endsWith('.geojson'))) throw new Error(`내보낸 파일이 모자란다: ${files}`)
await page.locator('summary', { hasText: '파일 ▾' }).click()

// 11. 구축하기
await btn('구축하기').click()
const dialog = page.locator('dialog[open]')
await dialog.waitFor()
await page.waitForTimeout(500)
await shot(
  'build',
  [
    ['대상 층', dialog.getByText(/대상 층/).first()],
    ['생성 항목', dialog.getByText(/생성 항목/).first()],
    ['임시 저장 후 구축', dialog.getByRole('button', { name: '임시 저장 후 구축' })],
  ],
  await around(dialog, 24),
)
await dialog.getByRole('button', { name: '임시 저장 후 구축' }).click()
await page.locator('.appbar').getByText('운영 편집', { exact: true }).waitFor({ timeout: 60_000 })
await settle()
await shot(
  'operate',
  [
    ['운영 편집', page.locator('.appbar').getByText('운영 편집', { exact: true })],
    ['기준 v1', page.locator('.appbar button', { hasText: 'v1' }).first()],
    ['반영하기', btn('반영하기')],
  ],
  { x: 0, y: 0, width: W, height: 90 },
)

// 12. 다시 열 때 — 구축한 프로젝트는 층을 골라 운영 편집으로 연다.
await page.goto(BASE)
await page.getByTestId('project-row').first().getByRole('button', { name: '열기' }).click()
const storeyList = page.locator('section, div').filter({ has: page.getByText(/선택한 층을 운영 편집 모드로 엽니다/) }).last()
await storeyList.waitFor()
await page.waitForTimeout(800)
await shot(
  'storeys',
  [
    ['구축 완료 v1', page.getByText(/구축 완료 v1/).first()],
    ['층 목록', page.getByText(/XYZ Level 2/).first()],
    ['운영 편집', page.getByRole('button', { name: '운영 편집' }).nth(2)],
    ['프로젝트 목록', page.getByRole('button', { name: /프로젝트 목록/ })],
  ],
  { x: 140, y: 30, width: 1160, height: 500 },
)

// 13. 내보낸 파일 보기 — 받은 TTL·GeoJSON 을 받는 쪽 규칙으로 다시 읽는다.
await page.goto(new URL('viewer.html', BASE).href)
await page.locator('input[type=file]').setInputFiles(files)
await page.getByText(/feature/).first().waitFor()
const level2 = page.locator('button', { hasText: /^\s*Level_2\s*$/ }).first()
await level2.click()
await page.waitForTimeout(2000)
await shot('viewer', [
  ['TTL', page.getByText(/^TTL /).first()],
  ['GeoJSON', page.getByText(/^GeoJSON 층 파일/).first()],
  ['검사', page.getByText('검사', { exact: true }).first()],
  ['층 평면', level2],
])

// 14. 흐름 — Duplex HVAC 는 방향 있는 포트 연결이 중간의 SOURCEANDSINK 포트에서 끊겨 기기 기준 방향이 0/26 이라 칠할 하류가 없다.
// 포트 방향이 이어지는 ifc4Mep 을 보기 모드로 열어 밸브 하나를 고른다.
await page.goto(BASE)
await page.locator('.drop input[type=file]').setInputFiles(MEP)
await page.locator('.appbar h2', { hasText: 'ifc4Mep' }).waitFor({ timeout: 120_000 })
await settle()
await page.locator('button').filter({ hasText: /^\s*\d+\s*설비\s*$/ }).first().click()
await page.getByPlaceholder(/설비 .*이름 검색/).first().fill('밸브')
await page.waitForTimeout(800)
await side.locator('button').filter({ hasText: /^\s*1\.1\.16\s*밸브\s*$/ }).first().click()
await page.evaluate(() => document.activeElement?.blur())
await page.keyboard.press('f')
await page.waitForTimeout(2500)
await shot('network', [
  ['보내는 곳', side.getByText(/대로 보냅니다/).first()],
  ['색 범례', page.locator('.color-key').first()],
])

await finish()

// 가이드가 <script> 로 읽는다. fetch 로 JSON 을 읽으면 파일로 열었을 때(file://) 핀이 안 뜬다.
// 핀 자리는 라이트판 하나(screens/pins.js)를 두 테마가 같이 쓴다. 다크로 찍을 때는 쓰지 않고 라이트판과 대 본다 — 테마가 배치를 바꿨으면
// 다크 그림 위의 핀이 엉뚱한 곳을 가리키므로 멈춘다(2026-10-21 첫 다크 캡처는 16장 모두 0.5% 안에서 같았다).
// ONLY 로 한 장면만 찍었으면 나머지 장면의 핀은 있던 것을 그대로 둔다.
async function finish() {
  const light = {}
  const old = resolve('public/guide/screens/pins.js')
  if (existsSync(old)) new Function('window', readFileSync(old, 'utf8'))(light)
  if (THEME === 'light') {
    const all = ONLY ? { ...light.GUIDE_PINS, ...pins } : pins
    writeFileSync(`${OUT}/pins.js`, `window.GUIDE_PINS = ${JSON.stringify(all, null, 2)}\n`)
    return browser.close()
  }
  const off = Object.entries(pins).flatMap(([k, v]) =>
    v.pins.flatMap((p, i) => {
      const q = light.GUIDE_PINS?.[k]?.pins?.[i]
      return q && Math.hypot(p.x - q.x, p.y - q.y) <= 0.5 ? [] : [`${k} ${i + 1} ${p.label}`]
    }),
  )
  if (off.length) throw new Error(`다크 그림의 핀 자리가 라이트판과 다르다. 라이트로 다시 찍고 맞춘다:\n${off.join('\n')}`)
  return browser.close()
}
