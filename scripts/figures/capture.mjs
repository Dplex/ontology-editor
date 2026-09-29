// 앱 화면을 캡처해 docs/figures/app-*.png 로 둔다. 정본 문서의 화면 그림이 여기서 나온다.
//
// 준비: `npm run dev`(5174)가 떠 있고, `npm run fetch:sample` 로 data/ 에 샘플이 있어야 한다.
// 샘플은 dev 서버의 data/ 목록에서 "열기"·"덧붙이기"로 연다. 앱이 파일을 여는 길과 같은 길이다.
// 성수 그림(seongsu)은 data/성수/ 에 두 파일이 있을 때만 찍는다(없으면 이유를 찍고 건너뛴다).
//
//   node scripts/figures/capture.mjs              # 전부
//   node scripts/figures/capture.mjs merge flow   # 고른 것만
//
// GPU 로 그린다. SwiftShader 는 성수(정점 1천만 개)를 그리는 데 몇 분씩 걸린다. 리눅스는 gl, 윈도는 d3d11 이고
// ANGLE=swiftshader 로 바꿀 수 있다.
import { chromium } from '@playwright/test'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'

const OUT = resolve('docs/figures')
const BASE = 'http://localhost:5174/'
const only = process.argv.slice(2)
const angle = process.env.ANGLE ?? (process.platform === 'win32' ? 'd3d11' : 'gl')

const browser = await chromium.launch({
  args: [`--use-angle=${angle}`, '--ignore-gpu-blocklist', '--enable-gpu', '--enable-unsafe-swiftshader'],
})
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 })

async function fresh() {
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.error('pageerror', e.message))
  await page.goto(BASE)
  // 그림은 라이트·보기 모드로 찍는다. 앞선 캡처가 남긴 모드·편집 기록을 지운다.
  await page.evaluate(() => {
    for (const k of Object.keys(localStorage)) if (k.startsWith('oe-draft')) localStorage.removeItem(k)
    localStorage.setItem('oe-mode', 'view')
    localStorage.setItem('oe-theme', 'light')
  })
  await page.goto(BASE)
  return page
}

/** 파일이 열리고 진행 표시가 사라질 때까지. 3D 가 형상 덩어리를 다 켤 틈을 준다. */
async function loaded(page, name) {
  await page.locator('.appbar h2', { hasText: name }).waitFor({ timeout: 600_000 })
  await page.locator('.progress-toast').waitFor({ state: 'detached', timeout: 600_000 })
  await page.waitForTimeout(3000)
}

const row = (page, path) => page.locator('.catalog tr').filter({ has: page.locator('td.name', { hasText: path }) }).first()

async function openData(page, path) {
  await row(page, path).getByRole('button', { name: '열기', exact: true }).click()
  await loaded(page, path.split('/').pop())
}

async function appendData(page, path) {
  // 파일을 연 뒤에는 목록이 접힌다. 펴고 고른다.
  if (!(await row(page, path).isVisible())) await page.locator('.catalog .fold-head').click()
  await row(page, path).getByRole('button', { name: '덧붙이기' }).click()
  await loaded(page, '+')
}

async function openFold(page, title) {
  const head = page.locator('.fold-head', { hasText: title }).first()
  if ((await head.getAttribute('aria-expanded')) !== 'true') await head.click()
  return head.locator('xpath=..')
}

/** 표에서 이름(또는 종류)으로 설비를 고른다. 검색 칸에서 나와야 뒤의 단축키가 먹는다. */
async function pick(page, query) {
  const search = page.getByPlaceholder(/물리존·설비 이름이나 종류/)
  await search.fill(query)
  await openFold(page, /설비 목록|설비 위치와 소속/)
  const button = page.locator('.equipment tbody tr').first().locator('button').first()
  const name = await button.innerText()
  await button.click()
  await search.fill('')
  await search.press('Escape')
  await page.locator('.stage').scrollIntoViewIfNeeded()
  await page.waitForTimeout(800)
  return name
}

const shot = (loc, name) => loc.screenshot({ path: `${OUT}/${name}.png` })
/** 긴 칸은 위에서부터 height 만큼만 찍는다. */
async function shotTop(page, loc, name, height = 900) {
  await loc.scrollIntoViewIfNeeded()
  const box = await loc.boundingBox()
  // fullPage 의 clip 은 페이지 좌표다. boundingBox 는 화면 좌표라 스크롤만큼 더한다.
  const [sx, sy] = await page.evaluate(() => [scrollX, scrollY])
  // 위에 붙는 도구막대가 칸의 머리줄을 덮지 않게 찍는 동안만 숨긴다.
  await page.evaluate(() => document.querySelectorAll('.appbar').forEach((el) => (el.style.visibility = 'hidden')))
  await page.screenshot({ path: `${OUT}/${name}.png`, clip: { x: box.x + sx, y: box.y + sy, width: box.width, height: Math.min(box.height, height) }, fullPage: true })
  await page.evaluate(() => document.querySelectorAll('.appbar').forEach((el) => (el.style.visibility = '')))
}

const jobs = {
  // 파일 목록의 등급 칩. 파일마다 재는 데 시간이 걸려서 "재는 중" 이 사라질 때까지 기다린다.
  async catalog() {
    const page = await fresh()
    await page.locator('.catalog').waitFor()
    await page.waitForFunction(() => !document.querySelector('.catalog')?.textContent?.includes('재는 중'), null, {
      timeout: 600_000,
    })
    await shot(page.locator('.catalog'), 'app-catalog')
    await page.close()
  },
  // 등급 0: 공간 골격만 있는 건축 모델.
  async fzk() {
    const page = await fresh()
    await openData(page, 'AC20-FZK-Haus.ifc')
    await shot(page.locator('.stage'), 'app-fzk-3d')
    await shot(page.locator('.review'), 'app-fzk-review')
    await page.close()
  },
  // 등급 3: 계통별 색. 포트가 없어 방향은 없다.
  async duplexMep() {
    const page = await fresh()
    await openData(page, 'NBU_Duplex-Apt_Eng-MEP-Optimized.ifc')
    await shot(page.locator('.stage'), 'app-duplex-mep-3d')
    await page.close()
  },
  // 등급 2: 건축 + 설비 파일 합치기.
  async merge() {
    const page = await fresh()
    await openData(page, 'NBU_Duplex-Apt_Arch.ifc')
    await appendData(page, 'NBU_Duplex-Apt_Eng-HVAC.ifc')
    await shot(page.locator('.stage'), 'app-duplex-merged-3d')
    await shot(page.locator('.review'), 'app-duplex-merged-review')
    await page.close()
  },
  // 등급 4: 포트가 방향을 말하는 파일에서 상류·하류를 칠한다. 칠할 것이 가장 많은 밸브를 고른다.
  async flow() {
    const page = await fresh()
    await openData(page, 'ifc4Mep_IFC4.ifc')
    const search = page.getByPlaceholder(/물리존·설비 이름이나 종류/)
    await search.fill('밸브')
    await openFold(page, /설비 목록|설비 위치와 소속/)
    const rows = page.locator('.equipment tbody tr')
    const n = Math.min(await rows.count(), 60)
    let best = { i: -1, score: -1 }
    for (let i = 0; i < n; i++) {
      await rows.nth(i).locator('button').first().click()
      const up = Number(await page.locator('.picked .flow .upstream b').textContent())
      const down = Number(await page.locator('.picked .flow .downstream b').textContent())
      if (up + down > best.score) best = { i, score: up + down }
    }
    if (best.i < 0) throw new Error('고를 밸브가 없다')
    await rows.nth(best.i).locator('button').first().click()
    await search.fill('')
    await search.press('Escape')
    await page.getByRole('button', { name: '연결망 보기' }).click()
    await page.locator('.stage').scrollIntoViewIfNeeded()
    await page.waitForTimeout(2000)
    await shot(page.locator('.viewport'), 'app-ifc4mep-flow-3d')
    await shot(page.locator('.picked'), 'app-ifc4mep-flow-panel')
    await page.close()
  },
  // 손으로 쓴 최소 사양 파일: 빠진 것 경고와 경계 편집(E2) 리포트.
  async edit() {
    const page = await fresh()
    await page.locator('.drop input[type=file]').setInputFiles(resolve('src/lib/ifc/fixtures/mep.ifc'))
    await loaded(page, 'mep.ifc')
    await shot(page.locator('.review'), 'app-mep-fixture-review')
    // e2e 의 경계 편집과 같은 조작: 사무실 오른쪽 두 꼭짓점 x 를 5 로.
    await page.getByRole('button', { name: '편집', exact: true }).click()
    await openFold(page, '물리존 이름·경계')
    // 이름은 글자가 아니라 입력 칸의 값이라 칸 값으로 줄을 찾는다.
    const rows = page.locator('.spaces-edit tbody tr')
    const index = await rows.evaluateAll((trs) => trs.findIndex((tr) => tr.querySelector('input')?.value === '사무실'))
    const spaceRow = rows.nth(index)
    for (const i of [1, 2]) {
      const x = spaceRow.locator('.vertex').nth(i).locator('.coord').first()
      await x.fill('5')
      await x.press('Enter')
    }
    await page.waitForTimeout(1500)
    await shot(page.locator('#changes').locator('xpath=ancestor::section[1]'), 'app-edit-after-panel')
    await page.close()
  },
  // 성수(고객사 실측) 건축 + 기계. 한 번 열고 여러 장을 찍는다.
  async seongsu() {
    if (!existsSync('data/성수/Factorial_건축.ifc') || !existsSync('data/성수/Factorial_기계.ifc')) {
      console.log('skip seongsu: data/성수/ 에 건축·기계 파일이 없다')
      return
    }
    const page = await fresh()
    await row(page, '성수/Factorial_건축.ifc').getByRole('button', { name: /짝 .*합쳐서 열기/ }).click()
    await loaded(page, '+')
    await shot(page.locator('.stage'), 'app-seongsu-3d')

    // FCU 하나의 연결망. 방향을 모르는 연결에서 멈춰 기기 143대까지만 번진다.
    await pick(page, 'FCU3:FCU3:958283')
    await page.keyboard.press('f')
    await page.waitForTimeout(1500)
    await shot(page.locator('.stage'), 'app-seongsu-fcu')
    await page.keyboard.press('Escape')

    // 한 층만 보기와 평면도.
    await page.getByRole('combobox', { name: '보일 층' }).selectOption({ label: '3F만' })
    await page.waitForTimeout(1500)
    await shot(page.locator('.stage'), 'app-seongsu-3f')
    await page.getByRole('group', { name: '보기' }).getByRole('button', { name: '평면도' }).click()
    await page.waitForTimeout(800)
    await shot(page.locator('.stage'), 'app-seongsu-plan')
    await page.getByRole('group', { name: '보기' }).getByRole('button', { name: '3D' }).click()

    // 검토 칸: 규칙 방향 확정 표, 완전성 검사와 위반 이유, 요구사항 보고서.
    const rules = await openFold(page, '규칙 방향 확정')
    await shotTop(page, rules, 'app-seongsu-rules', 760)
    const checks = await openFold(page, '완전성 검사')
    await checks.locator('tbody tr', { hasText: '연결망에 붙어' }).locator('button.link').click()
    await page.waitForTimeout(800)
    await shotTop(page, checks, 'app-seongsu-checks', 1100)
    const req = await openFold(page, '요구사항')
    await shotTop(page, req, 'app-seongsu-requirements', 1300)

    // 편집 모드: 설비를 옮기고 층을 바꾸고, 방 이름과 패밀리 종류를 고친 뒤의 화면.
    await page.getByRole('button', { name: '편집', exact: true }).click()
    await page.getByRole('combobox', { name: '보일 층' }).selectOption({ index: 0 })
    await pick(page, 'FCU3:FCU3:958291')
    for (let i = 0; i < 12; i++) await page.keyboard.press('ArrowRight')
    await page.keyboard.press('u')
    await page.keyboard.press('k')
    await page.locator('.picked .kind-edit select').selectOption({ label: '배기팬' })
    await pick(page, 'FCU3:FCU3:958291')
    await page.waitForTimeout(1000)
    const top = await page.locator('.appbar').boundingBox()
    const stage = await page.locator('.stage').boundingBox()
    await page.screenshot({ path: `${OUT}/app-seongsu-edit.png`, clip: { x: 0, y: top.y, width: 1440, height: stage.y + stage.height - top.y } })
    // 바뀐 내용: 머리줄부터 리포트 끝까지만 자른다(감싼 칸은 3D 까지 품는다).
    await page.locator('.changes-head').scrollIntoViewIfNeeded()
    const head = await page.locator('.changes-head').boundingBox()
    const report = await page.locator('.report').boundingBox()
    await page.screenshot({ path: `${OUT}/app-seongsu-changes.png`, clip: { x: head.x, y: head.y, width: head.width, height: report.y + report.height - head.y } })

    // 벽·문·창 편집 층.
    await page.getByRole('combobox', { name: '보일 층' }).selectOption({ label: '3F만' })
    await page.getByRole('button', { name: '벽·문·창' }).click()
    await page.keyboard.press('Home')
    await page.waitForTimeout(1500)
    await shot(page.locator('.stage'), 'app-seongsu-walls')
    await page.close()
  },
}

let failed = false
for (const [name, job] of Object.entries(jobs)) {
  if (only.length && !only.includes(name)) continue
  const t = Date.now()
  try {
    await job()
    console.log('ok', name, ((Date.now() - t) / 1000).toFixed(1) + 's')
  } catch (e) {
    failed = true
    console.error('FAIL', name, e.message)
  }
}
await browser.close()
process.exit(failed ? 1 : 0)
