// 앱 화면을 캡처해 docs/figures/app-*.png 로 둔다. 정본 문서의 화면 그림이 여기서 나온다.
//
// 준비: `npm run dev`(5174)가 떠 있고, `npm run fetch:sample` 로 data/ 에 샘플이 있어야 한다.
// 샘플은 dev 서버의 data/ 목록에서 "열기"·"덧붙이기"로 연다. 앱이 파일을 여는 길과 같은 길이다.
//
//   node scripts/figures/capture.mjs              # 전부
//   node scripts/figures/capture.mjs merge flow   # 고른 것만
//
// ifc4Mep(28MB)은 3D 가 무거워 flow 하나에 몇 분 걸린다. WebGL 은 헤드리스라 SwiftShader 로 그린다.
import { chromium } from '@playwright/test'
import { resolve } from 'node:path'

const OUT = resolve('docs/figures')
const BASE = 'http://localhost:5174/'
const only = process.argv.slice(2)

const browser = await chromium.launch({
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
})
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 })

async function fresh() {
  const page = await ctx.newPage()
  page.on('pageerror', (e) => console.error('pageerror', e.message))
  await page.goto(BASE)
  return page
}

async function openData(page, path) {
  const row = page.locator('.catalog tr', { hasText: path }).first()
  await row.getByRole('button', { name: '열기' }).click()
  await page.locator('.review h2').waitFor({ timeout: 180_000 })
  // 3D 가 첫 프레임을 그릴 틈을 준다.
  await page.waitForTimeout(2500)
}

async function appendData(page, path) {
  // 파일을 연 뒤에는 목록이 접힌다. 펴고 고른다.
  if (!(await page.locator('.catalog tr').first().isVisible())) await page.locator('.catalog .fold-head').click()
  const row = page.locator('.catalog tr', { hasText: path }).first()
  await row.getByRole('button', { name: '덧붙이기' }).click()
  await page.locator('.review h2', { hasText: '+' }).waitFor({ timeout: 180_000 })
  await page.waitForTimeout(2500)
}

const shot = (loc, name) => loc.screenshot({ path: `${OUT}/${name}.png` })

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
    await shot(page.locator('.viewport'), 'app-fzk-3d')
    await shot(page.locator('.review'), 'app-fzk-review')
    await page.close()
  },
  // 등급 3: 계통별 색. 포트가 없어 방향은 없다.
  async duplexMep() {
    const page = await fresh()
    await openData(page, 'NBU_Duplex-Apt_Eng-MEP-Optimized.ifc')
    await shot(page.locator('.viewport'), 'app-duplex-mep-3d')
    await page.close()
  },
  // 등급 2: 건축 + 설비 파일 합치기.
  async merge() {
    const page = await fresh()
    await openData(page, 'NBU_Duplex-Apt_Arch.ifc')
    await appendData(page, 'NBU_Duplex-Apt_Eng-HVAC.ifc')
    await shot(page.locator('.viewport'), 'app-duplex-merged-3d')
    await shot(page.locator('.review'), 'app-duplex-merged-review')
    await page.close()
  },
  // 등급 4: 포트가 방향을 말하는 파일에서 상류·하류를 칠한다.
  async flow() {
    const page = await fresh()
    await openData(page, 'ifc4Mep_IFC4.ifc')
    // 설비가 많으면 목록이 접혀 있고 앞의 200행만 그린다. 펴고, 후보 종류로 좁힌다.
    await page.locator('.fold-head', { hasText: '설비 위치와 소속' }).click()
    await page.locator('.edit-filter input').fill('Valve')
    // 칠할 것이 가장 많은 기기를 고른다. 3D 를 클릭하면 화면 크기에 따라 흔들리니 표에서 고른다.
    const rows = page.locator('.equipment tbody tr', {
      has: page.locator('td.muted', { hasText: /^(Boiler|UnitaryEquipment|AirTerminal|SpaceHeater|Valve)\b/ }),
    })
    const n = Math.min(await rows.count(), 60)
    let best = { i: -1, score: -1 }
    for (let i = 0; i < n; i++) {
      await rows.nth(i).locator('button.link').first().click()
      const up = Number(await page.locator('.picked .flow .upstream b').textContent())
      const down = Number(await page.locator('.picked .flow .downstream b').textContent())
      if (up + down > best.score) best = { i, score: up + down }
    }
    if (best.i < 0) throw new Error('고를 기기가 없다')
    await rows.nth(best.i).locator('button.link').first().click()
    await page.getByRole('button', { name: '연결망에 맞추기' }).click()
    await page.waitForTimeout(2000)
    await shot(page.locator('.viewport'), 'app-ifc4mep-flow-3d')
    await shot(page.locator('.picked'), 'app-ifc4mep-flow-panel')
    await page.close()
  },
  // 손으로 쓴 최소 사양 파일: 빠진 것 경고와 경계 편집(E2) 리포트.
  async edit() {
    const page = await fresh()
    await page.locator('.drop input[type=file]').setInputFiles(resolve('src/lib/ifc/fixtures/mep.ifc'))
    await page.locator('.review h2').waitFor({ timeout: 60_000 })
    await page.waitForTimeout(1500)
    await shot(page.locator('.review'), 'app-mep-fixture-review')
    // e2e 의 경계 편집과 같은 조작: 사무실 오른쪽 두 꼭짓점 x 를 5 로.
    const spaceRow = page.locator('.equipment tbody tr', { hasText: '사무실' }).first()
    for (const i of [1, 2]) {
      const x = spaceRow.locator('.vertex').nth(i).locator('.coord').first()
      await x.fill('5')
      await x.blur()
    }
    await page.waitForTimeout(1500)
    await shot(page.locator('.editor'), 'app-edit-after-panel')
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
