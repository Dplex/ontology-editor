// 사용 가이드(public/guide/index.html)의 화면 그림을 찍는다. 실제 에디터에서 Duplex 건축+HVAC 로 프로젝트를 만들고, 가이드의 순서대로
// 조작하면서 찍는다. 흐름 장면(06)만 ifc4Mep 으로 맨 끝에 찍는다. 그림마다 번호 핀을 놓을 자리(요소의 가운데, 그림 안의 %)를
// screens/pins.js 에 같이 남긴다. UI 가 바뀌면 다시 돌린다.
//
// 준비: 프로젝트·업로드가 서버의 data 폴더에 남으므로 빈 폴더를 붙인 e2e 모드 서버를 띄운다(로컬 data/ 의 프로젝트 목록을 더럽히지 않는다).
//   OE_DATA_ROOT=$(mktemp -d) npx vite --mode e2e --port 5179
//   node scripts/guide/capture.mjs            # BASE=http://localhost:5179/ 가 기본
// Duplex 와 ifc4Mep 파일이 data/ 에 있어야 한다(npm run fetch:sample).
import { chromium } from '@playwright/test'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const BASE = process.env.BASE ?? 'http://localhost:5179/'
const OUT = resolve('public/guide/screens')
const ARCH = resolve('data/NBU_Duplex/NBU_Duplex-Apt_Arch.ifc')
const HVAC = resolve('data/NBU_Duplex/NBU_Duplex-Apt_Eng-HVAC.ifc')
// 흐름 장면은 포트가 방향을 말하는 파일이어야 칠할 것이 있다.
const MEP = resolve('data/ifc4Mep_IFC4.ifc')
// 고르는 설비. 아래로 네 칸 옮기면 Utility 에서 Bedroom 1 로 소속이 바뀐다(2026-10-20 에 잰 것).
const BOILER = 'M_Hot Water Boiler - 59-440 kW #557516'
const W = 1440
const H = 900

for (const f of [ARCH, HVAC, MEP]) if (!existsSync(f)) throw new Error(`${f} 가 없다. npm run fetch:sample`)
mkdirSync(OUT, { recursive: true })

const angle = process.env.ANGLE ?? (process.platform === 'win32' ? 'd3d11' : 'gl')
const browser = await chromium.launch({ args: [`--use-angle=${angle}`, '--ignore-gpu-blocklist', '--enable-gpu', '--enable-unsafe-swiftshader'] })
const page = await browser.newPage({ viewport: { width: W, height: H } })
page.on('pageerror', (e) => console.error('pageerror', e.message))
const pins = {}

/**
 * 화면을 찍고 핀 자리를 적는다. clip 이 없으면 창 전체다. 핀은 [설명, locator] 이고, 자리는 그림 크기에 대한 % 라서 가이드가 그림을
 * 줄여 보여도 같은 곳을 가리킨다. 화면 밖이거나 안 보이는 요소는 실패로 멈춘다 — 엉뚱한 곳을 가리키는 핀보다 낫다.
 */
async function shot(name, marks, clip = { x: 0, y: 0, width: W, height: H }, meta = {}) {
  await page.waitForTimeout(400)
  const list = []
  for (const [label, loc] of marks) {
    const box = await loc.boundingBox()
    if (!box) throw new Error(`${name}: "${label}" 이 안 보인다`)
    // 요소의 왼쪽 끝 바로 앞에 놓는다. 가운데에 놓으면 핀이 그 글자를 가린다. 그림 가장자리에서는 안쪽으로 당긴다.
    const cx = Math.max(14, box.x - 15 - clip.x)
    const cy = box.y + box.height / 2 - clip.y
    if (cx < 0 || cy < 0 || cx > clip.width || cy > clip.height) throw new Error(`${name}: "${label}" 이 그림 밖이다`)
    list.push({ label, x: +((cx / clip.width) * 100).toFixed(2), y: +((cy / clip.height) * 100).toFixed(2) })
  }
  await page.screenshot({ path: `${OUT}/${name}.png`, clip })
  pins[name] = { width: clip.width, height: clip.height, pins: list, ...meta }
  console.log('ok', name)
}

const btn = (name) => page.getByRole('button', { name, exact: true })
const chip = (n, word) => page.locator('button').filter({ hasText: new RegExp(`^\\s*${n}\\s*${word}\\s*$`) }).first()
const side = page.locator('aside, .side-panel').first()
const fact = (label) => side.locator('dt').filter({ hasText: new RegExp(`^\\s*${label}\\s*$`) }).first()
const storey = page.getByRole('combobox', { name: '보일 층' })
async function settle() {
  await page.locator('.progress-toast').waitFor({ state: 'detached', timeout: 120_000 }).catch(() => {})
  await page.waitForTimeout(1500)
}

// 1. 프로젝트 만들기
await page.goto(BASE)
await page.evaluate(() => {
  localStorage.clear()
  localStorage.setItem('oe-theme', 'light')
})
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
  '01-new-project',
  [
    ['사용자', user],
    ['새 프로젝트', list.getByRole('button', { name: '새 프로젝트' })],
    ['이름·사이트', form.getByLabel('프로젝트 이름')],
    ['IFC 파일 올리기', form.locator('label.pick')],
    ['만들기', form.getByRole('button', { name: '만들기' })],
  ],
  { x: 140, y: 30, width: 1160, height: 380 },
)
await form.getByRole('button', { name: '만들기' }).click()
await page.locator('.appbar h2').waitFor({ timeout: 120_000 })
await settle()

// 2. 에디터 한눈에
await shot('02-editor', [
  ['모드 배지', page.locator('.appbar').getByText('초기 구축', { exact: true })],
  ['기준 · 경고', page.locator('.appbar button', { hasText: '경고' })],
  ['편집 레일', btn('공간 편집')],
  ['3D · 평면도', btn('평면도')],
  ['현재층', storey],
  ['선택 오브젝트', side.getByText('선택 오브젝트', { exact: true })],
  ['층 현황', side.getByText('층 현황', { exact: true })],
  ['구축하기', btn('구축하기')],
])

// 3. 층 바꾸고 평면도
await storey.selectOption({ label: 'Level 2' })
await settle()
await btn('평면도').click()
await page.waitForTimeout(1500)
await shot('03-plan', [
  ['평면도', btn('평면도')],
  ['현재층', storey],
  ['물리존 목록', chip(10, '물리존')],
])
await btn('3D').click()
await page.waitForTimeout(1500)

// 4. 설비 고르기 — 출처 칩
await chip(22, '설비').click()
await page.locator('button').filter({ hasText: BOILER }).first().click()
await page.waitForTimeout(1500)
await shot('04-equipment', [
  ['선택한 설비', page.locator('button').filter({ hasText: BOILER }).first()],
  ['종류 · 사전', fact('종류')],
  ['계통 · BIM', fact('계통')],
  ['소속 · 계산', fact('소속')],
  ['색 범례', page.locator('.color-key').first()],
])

// 5. 설비 옮기기 — 소속이 바로 바뀐다. 방향키는 화면 기준이라 시점에 따라 가는 쪽이 달라서, 한 칸씩 누르며 다른 방에 들 때 멈춘다.
// 목록 단추에 포커스가 있으면 방향키가 목록으로 가서 포커스를 푼다.
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
await shot('05-move', [
  ['소속', fact('소속')],
  ['바뀐 것', page.locator('.appbar ~ * button, button').filter({ hasText: /바뀐 것/ }).first()],
  ['마지막 편집', page.getByText(/옮김$/).filter({ visible: true }).last()],
], undefined, { moved })

// 7. 방 이름 고치기
await btn('공간 편집').click()
await page.waitForTimeout(800)
await chip(10, '물리존').click()
await page.locator('button').filter({ hasText: 'Bedroom 2' }).first().click()
await page.waitForTimeout(1000)
const inputs = side.locator('input[type=text]')
let roomName = null
for (let i = 0; i < (await inputs.count()); i++) if ((await inputs.nth(i).inputValue()) === 'Bedroom 2') roomName = inputs.nth(i)
if (!roomName) throw new Error('공간명 칸을 못 찾았다')
await roomName.fill('침실 2')
await roomName.press('Enter')
await page.waitForTimeout(1000)
await roomName.scrollIntoViewIfNeeded()
await shot('07-room', [
  ['공간 편집', btn('공간 편집')],
  ['공간명', roomName],
  ['방 목록', page.locator('button').filter({ hasText: '침실 2' }).last()],
  ['마지막 편집', page.getByText(/→ 침실 2/).filter({ visible: true }).last()],
])

// 8. 결과 비교 — TTL · GeoJSON 의 어느 줄이 되나
await page.locator('button').filter({ hasText: '침실 2' }).last().click()
await btn('결과 비교').click()
await page.waitForTimeout(2500)
await shot('08-compare', [
  ['결과 비교', btn('결과 비교')],
  ['TTL · GeoJSON', page.getByText(/DT 플랫폼이 읽는/).first()],
])
await page.getByRole('button', { name: '닫기', exact: true }).first().click()
await page.waitForTimeout(500)

// 9. 파일 ▾ 내보내기
await page.locator('summary', { hasText: '파일 ▾' }).click()
await page.waitForTimeout(500)
await shot('09-export', [
  ['파일 ▾', page.locator('summary', { hasText: '파일 ▾' })],
  ['GeoJSON', page.getByRole('button', { name: '기하 내보내기 (GeoJSON)' })],
  ['TTL', page.getByRole('button', { name: '의미 내보내기 (Brick TTL)' })],
])
await page.locator('summary', { hasText: '파일 ▾' }).click()

// 10. 구축하기
await btn('구축하기').click()
const dialog = page.locator('dialog[open]')
await dialog.waitFor()
await page.waitForTimeout(500)
const db = await dialog.boundingBox()
const pad = 24
await shot(
  '10-build',
  [
    ['대상 층', dialog.getByText(/대상 층/).first()],
    ['생성 항목', dialog.getByText(/생성 항목/).first()],
    ['임시 저장 후 구축', dialog.getByRole('button', { name: '임시 저장 후 구축' })],
  ],
  { x: Math.max(0, db.x - pad), y: Math.max(0, db.y - pad), width: Math.min(W, db.width + pad * 2), height: Math.min(H, db.height + pad * 2) },
)
await dialog.getByRole('button', { name: '임시 저장 후 구축' }).click()
await page.locator('.appbar').getByText('운영 편집', { exact: true }).waitFor({ timeout: 60_000 })
await settle()
await shot(
  '11-operate',
  [
    ['운영 편집', page.locator('.appbar').getByText('운영 편집', { exact: true })],
    ['기준 v1', page.locator('.appbar button', { hasText: 'v1' }).first()],
    ['반영하기', btn('반영하기')],
  ],
  { x: 0, y: 0, width: W, height: 90 },
)

// 6. 흐름 — Duplex 는 포트에 방향이 없어(등급 3) 칠할 것이 없다. 포트가 방향을 말하는 ifc4Mep 을 보기 모드로 열어 밸브 하나를 고른다.
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
await shot('06-network', [
  ['보내는 곳', side.getByText(/대로 보냅니다/).first()],
  ['색 범례', page.locator('.color-key').first()],
])

// 가이드가 <script> 로 읽는다. fetch 로 JSON 을 읽으면 파일로 열었을 때(file://) 핀이 안 뜬다.
writeFileSync(`${OUT}/pins.js`, `window.GUIDE_PINS = ${JSON.stringify(pins, null, 2)}\n`)
await browser.close()
