import { copyFileSync, existsSync, linkSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { PUBLISH_ROOT } from '../playwright.publish-seongsu.config'

// 성수 크기의 반영(R: OE-WF-10~13·18·19, OE-GEN-05, ADR-0037). 화면 시험(seongsu.spec.ts)은 파일 칸으로 열어 서버 반영이 없다. 여기는 두 파일을
// data/ 목록에서 [합쳐서 열기] 하고, dev 서버에 붙은 진짜 src/server/data-catalog.ts(목록 폴더 data/.e2e-publish)로 [구축하기]·[반영하기]·
// 되돌리기를 돈다 — 3D 형상(GLB)이 수백 MB 라 만드는 시간, 화면이 멈추는 시간, 올리는 시간, 버전 폴더 크기를 잰다. 잰 값은 data/…/반영-결과.md 에 쓴다.
// 돌리기: SEONGSU_ARCH=… SEONGSU_MECH=… npm run e2e:seongsu:publish
const ARCH = process.env.SEONGSU_ARCH ?? 'data/성수/Factorial_건축.ifc'
const MECH = process.env.SEONGSU_MECH ?? 'data/성수/Factorial_기계.ifc'
const REPORT = join(dirname(ARCH), '반영-결과.md')
const have = existsSync(ARCH) && existsSync(MECH)
test.skip(!have, `성수 파일이 없다(${ARCH}, ${MECH}). 성수가 있는 PC 나 55 에서 돈다`)
test.describe.configure({ mode: 'serial' })

const rows: [string, string, string][] = []
const record = (id: string, value: string, note = '') => {
  rows.push([id, value, note])
  console.log(`  ${id}: ${value}${note ? ` (${note})` : ''}`)
}
const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)}MB`
/** 폴더가 실제로 쓰는 디스크. 하드 링크로 버전끼리 나눈 파일은 한 번만 센다(layouts.ts 의 dedupe). */
function du(dir: string, seen = new Set<bigint>()): number {
  let sum = 0
  for (const name of readdirSync(dir)) {
    const at = join(dir, name)
    const st = statSync(at, { bigint: true })
    if (st.isDirectory()) sum += du(at, seen)
    else if (!seen.has(st.ino)) {
      seen.add(st.ino)
      sum += Number(st.size)
    }
  }
  return sum
}

const root = resolve(PUBLISH_ROOT)
let page: Page
const errors: string[] = []
const SITE = '현장'
const paths = [`${SITE}/${basename(ARCH)}`, `${SITE}/${basename(MECH)}`]

test.beforeAll(async ({ browser }) => {
  // 앞 판의 버전·로그·임시 저장본을 지우고 두 파일만 둔다.
  for (const name of readdirSync(root)) rmSync(join(root, name), { recursive: true, force: true })
  mkdirSync(join(root, SITE))
  // 수백 MB 를 복사하지 않고 하드 링크로 둔다. 다른 드라이브면 복사한다.
  for (const [from, to] of [[ARCH, paths[0]], [MECH, paths[1]]]) {
    try {
      linkSync(from, join(root, to))
    } catch {
      copyFileSync(from, join(root, to))
    }
  }
  page = await browser.newPage()
  page.on('pageerror', (e) => errors.push(e.message))
  // 통과선은 낮춰 둔다(합성 성수의 비율은 이 시험이 보는 것이 아니다). 층 이름은 통과선과 상관없이 막아서 화면에서 넣는다(R-0).
  await page.addInitScript(() => localStorage.setItem('oe.gradeLines', JSON.stringify({ 0: 0.5, 1: 0.5, 2: 0.5, 3: 0.5, 4: 0.5 })))
  // 칸마다 채움(?profile)은 서버가 성수 기계를 1분 가까이 재는 동안 다른 요청을 받지 못한다. 열기 시간을 재기 전에 미리 재 둔다(서버가 캐시한다).
  // page.route 로 흉내 내면 안 된다 — 가로채기가 하나라도 있으면 Playwright 가 모든 요청을 보며 GLB(수백 MB)를 올리는 몸통을 문자열로 바꾸다 죽었다.
  for (const p of paths) await page.request.get(`/__data/${p.split('/').map(encodeURIComponent).join('/')}?profile`, { timeout: 600_000 })
})
test.afterAll(async () => {
  const lines = [
    `# 성수 크기 반영 결과`,
    '',
    `${new Date().toISOString().slice(0, 16).replace('T', ' ')} · ${basename(ARCH)} + ${basename(MECH)} · e2e-seongsu/publish-seongsu.spec.ts`,
    '',
    '| 번호 | 값 | 비고 |',
    '|---|---|---|',
    ...rows.map((r) => `| ${r.join(' | ')} |`),
    '',
  ]
  writeFileSync(REPORT, lines.join('\n'))
  await page?.close()
})

/** 화면이 멈춘 가장 긴 시간(프레임 간격)을 재기 시작한다. */
const startGaps = () =>
  page.evaluate(() => {
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
const stopGaps = () =>
  page.evaluate(() => {
    const w = window as any
    cancelAnimationFrame(w.__raf)
    return Math.round(Math.max(0, ...(w.__gaps as number[])))
  })
const versionDir = () => {
  const layouts = join(root, '.layouts')
  const key = readdirSync(layouts).find((n) => !n.startsWith('.'))!
  return join(layouts, key)
}
async function moveOneDevice() {
  const search = page.getByPlaceholder(/물리존·설비 이름이나 종류|설비 이름·종류나 소속 방/)
  await search.fill('공조기')
  const head = page.locator('.fold-head', { hasText: /설비 목록|설비 위치와 소속/ }).first()
  if ((await head.getAttribute('aria-expanded')) !== 'true') await head.click()
  await page.locator('.equipment tbody tr').first().locator('button').first().click()
  await search.fill('')
  await search.press('Escape')
  await page.locator('.viewport canvas').scrollIntoViewIfNeeded()
  await page.keyboard.press('ArrowRight')
}

test('R 성수 크기 반영: 합쳐 열기 → 구축하기(v1) → 반영하기(v2) → 되돌리기(v3), 시간·멈춤·버전 폴더 크기', async () => {
  test.setTimeout(1_200_000)
  await page.goto('/')
  await page.evaluate(() => localStorage.setItem('oe-mode', 'view'))
  await page.goto('/')
  for (const p of paths) await page.getByRole('checkbox', { name: `${p} 같이 열기` }).check()
  const t0 = Date.now()
  await page.getByRole('button', { name: '고른 2개 합쳐서 열기' }).click()
  await expect(page.locator('.appbar h2')).toContainText('+', { timeout: 600_000 })
  record('R-1', `${((Date.now() - t0) / 1000).toFixed(1)}초`, 'data/ 목록에서 합쳐 열기(서버에서 받아 읽기)')
  await page.getByLabel('사용자').selectOption('편집자')
  await page.getByRole('button', { name: '편집', exact: true }).click()
  const bar = page.locator('.edit-bar')
  await expect(bar.getByRole('button', { name: '구축하기' })).toBeVisible()
  // R-0 이름 없는 층(합성 성수의 기초 층)이 있으면 등급 0 미달이라 [구축하기] 가 막힌다. 층별 요약에서 이름을 넣어 푼다.
  const fold = page.locator('.fold-head', { hasText: '층별 요약' }).first()
  if ((await fold.getAttribute('aria-expanded')) !== 'true') await fold.click()
  const unnamed = page.getByRole('button', { name: '이름 없는 층 층 이름 넣기' })
  const blank = await unnamed.count()
  if (blank) await expect(bar.getByRole('button', { name: '구축하기' })).toHaveAttribute('title', /층 이름/)
  for (let i = 1; i <= blank; i++) {
    await unnamed.first().click()
    await page.getByLabel('이름 없는 층 층 이름').fill(`이름 없던 층 ${i}`)
    await page.getByLabel('이름 없는 층 층 이름').press('Enter')
  }
  await expect(unnamed).toHaveCount(0)
  record('R-0', `${blank}개`, '이름 없는 층 — 층별 요약에서 이름을 넣어 게이트(등급 0 층 이름)를 풂')
  await moveOneDevice()
  // 배관이 따라오면 그것도 센다(OE-PIP-12).
  await expect(bar).toContainText(/바뀐 것 [1-9]\d*건/)

  // R-2 구축하기(v1). 확인 창이 뜨기까지, 누른 뒤 끝나기까지, 그 사이 가장 긴 멈춤.
  const dialog = page.locator('dialog.publish-dialog')
  let t = Date.now()
  await bar.getByRole('button', { name: '구축하기' }).click()
  await expect(dialog.getByRole('heading')).toHaveText('구축하기 — v1')
  record('R-2', `${Date.now() - t}ms`, '확인 창(미리보기 요약)')
  await startGaps()
  t = Date.now()
  await dialog.getByRole('button', { name: '구축하기' }).click()
  await expect(page.locator('.key-note')).toContainText('v1 으로 구축했습니다', { timeout: 900_000 })
  const v1ms = Date.now() - t
  const v1gap = await stopGaps()
  const dir = versionDir()
  const v1 = join(dir, 'v1')
  const files = readdirSync(v1, { recursive: true }) as string[]
  const size = (f: string) => (existsSync(join(v1, f)) ? statSync(join(v1, f)).size : 0)
  const geo = files.filter((f) => f.startsWith('geojson') && f.endsWith('.geojson'))
  record('R-3', `${(v1ms / 1000).toFixed(1)}초`, `구축하기 끝까지(GLB 만들기·올리기 포함). 가장 긴 멈춤 ${v1gap}ms`)
  record(
    'R-4',
    mb(du(v1)),
    `v1 폴더: GLB ${mb(size('model.glb'))} · TTL ${mb(size('ontology.ttl'))} · GeoJSON ${geo.length}개 ${mb(geo.reduce((a, f) => a + size(f), 0))} · 편집 파일 ${mb(size('edits.json'))}`,
  )
  expect(size('model.glb')).toBeGreaterThan(0)
  expect(v1gap).toBeLessThan(5000)

  // R-5 반영하기(v2). 한 번 더 고치고 반영한다.
  await moveOneDevice()
  t = Date.now()
  await bar.getByRole('button', { name: '반영하기' }).click()
  await expect(dialog.getByRole('heading')).toHaveText('반영하기 — v2')
  await startGaps()
  await dialog.getByRole('button', { name: '반영하기' }).click()
  await expect(page.locator('.key-note')).toContainText('v2 으로 반영했습니다', { timeout: 900_000 })
  record('R-5', `${((Date.now() - t) / 1000).toFixed(1)}초`, `반영하기(v2) 확인 창부터. 가장 긴 멈춤 ${await stopGaps()}ms`)

  // R-6 되돌리기(v1 → v3). 서버가 v1 폴더를 복사한다.
  const versions = page.getByTestId('versions')
  await expect(versions.locator('tbody tr')).toHaveCount(2)
  t = Date.now()
  // 반영 결과 리포트의 [되돌리기] 가 직전 버전을 골라 둔 되돌리기 확인으로 간다(OE-SYNC-05).
  await page.getByTestId('version-report').getByRole('button', { name: '되돌리기 (v1)' }).click()
  await versions.locator('tbody tr', { hasText: 'v1' }).getByRole('button', { name: 'v1 다시 반영' }).click()
  await expect(page.locator('.key-note')).toContainText('v1 의 레이아웃을 v3 으로 다시 반영했습니다', { timeout: 600_000 })
  record('R-6', `${((Date.now() - t) / 1000).toFixed(1)}초`, '되돌리기 — v1 을 v3 으로 다시 반영(서버 복사)')
  const meta = await (await page.request.get(`/__data/__layouts?${new URLSearchParams({ key: paths.join('|') })}`)).json()
  expect(meta.current).toBe(3)
  const v3 = meta.versions.find((x: { version: number }) => x.version === 3)
  record('R-7', mb(du(dir)), `버전 셋(v1·v2·v3)이 쓴 디스크. v3(되돌리기)는 v1 에 링크 — 공유 ${v3.shared?.length ?? 0}/${v3.files.length}개`)
  expect(v3.shared).toEqual(v3.files)

  // R-8 층 이름만 고쳐 반영. GeoJSON 은 그 층 파일 말고 나누지만, 층 이름이 GLB 의 층 노드(extras)에 들어 있어 GLB 는 새로 생긴다.
  // 흐름 방향처럼 형상·이름과 무관한 편집은 GLB 도 나눈다(mesh3d.test.ts).
  const before = du(dir)
  const rename = page.getByRole('button', { name: /이름 없던 층 1 층 이름 고치기/ })
  if (await rename.count()) {
    await rename.click()
    await page.getByLabel('이름 없던 층 1 층 이름').fill('기초')
    await page.getByLabel('이름 없던 층 1 층 이름').press('Enter')
  } else {
    await page.locator('.fold-head', { hasText: '층별 요약' }).first().click()
    await page.getByRole('button', { name: /층 이름 고치기/ }).first().click()
    await page.locator('.storey-name-input').fill('기초 층')
    await page.locator('.storey-name-input').press('Enter')
  }
  t = Date.now()
  await bar.getByRole('button', { name: '반영하기' }).click()
  await dialog.getByRole('button', { name: '반영하기' }).click()
  await expect(page.locator('.key-note')).toContainText('v4 으로 반영했습니다', { timeout: 900_000 })
  const meta4 = await (await page.request.get(`/__data/__layouts?${new URLSearchParams({ key: paths.join('|') })}`)).json()
  const v4 = meta4.versions.find((x: { version: number }) => x.version === 4)
  record('R-8', `${((Date.now() - t) / 1000).toFixed(1)}초 · +${mb(du(dir) - before)}`, `층 이름만 고쳐 반영(v4). 공유: ${(v4.shared ?? []).join(', ') || '없음'}`)
  expect(errors).toEqual([])
})
