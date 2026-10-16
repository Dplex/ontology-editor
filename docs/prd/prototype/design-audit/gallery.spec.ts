import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { readFileSync } from 'node:fs'
import { test } from '@playwright/test'
import { THEMES, css as themeCss } from './themes'
const TAG = process.env.AUDIT_TAG ?? ''
const EXTRA_CSS = (process.env.AUDIT_THEME ? themeCss(THEMES[process.env.AUDIT_THEME], 'light') : '') + (process.env.AUDIT_CSS_FILES ?? '').split(',').filter(Boolean).map((f) => readFileSync(new URL(f, import.meta.url), 'utf8')).join(' ')

// 컴포넌트 인벤토리의 시각 자료: 대표 요소를 하나씩 잘라 찍는다(원본 스타일, 라이트).
const OUT = '.local/design-audit/inventory/crops' + (process.env.AUDIT_TAG ? '-' + process.env.AUDIT_TAG : '')
const FILES = ['data/NBU_MedicalClinic/NBU_MedicalClinic_Arch.ifc', 'data/NBU_MedicalClinic/NBU_MedicalClinic_Eng-HVAC.ifc']
// [이름, 선택자, 모드]
const ITEMS: [string, string, 'view' | 'edit'][] = [
  ['버튼-툴바 알약(.ghost)', '.bar-actions button.ghost >> nth=0', 'view'], ['버튼-3D 위 도구(.view-tools .ghost)', '.view-tools button.ghost >> nth=0', 'view'],
  ['버튼-주요(.primary-action)', 'button.primary-action', 'edit'], ['모드 스위치(.mode-switch)', '.mode-switch', 'view'], ['편집 대상(.edit-part)', '.edit-part', 'edit'],
  ['링크 버튼(button.link)', 'button.link >> nth=0', 'view'], ['접기 머리(.fold-head)', 'button.fold-head >> nth=0', 'view'], ['사이드 탭(.side-tabs)', '.side-tabs', 'view'],
  ['독 버튼(.dock-btn)', '.facade-dock', 'view'], ['하단 독(.view-pill)', '.bottom-view-dock', 'view'], ['진단 칩(.diag-chip)', '.diag-chip >> nth=0', 'view'],
  ['출처 배지 BIM(.src.bim)', '.src.bim >> nth=0', 'view'], ['출처 배지 계산(.src.calc)', '.src.calc >> nth=0', 'view'], ['출처 배지 사전(.src.dict)', '.src.dict >> nth=0', 'view'],
  ['이슈 코드(.issue-code)', '.issue-code >> nth=0', 'view'], ['요약 타일(li.partial)', 'li.partial >> nth=0', 'view'], ['경고 칩(.warn-count)', '.warn-count', 'view'], ['모드 칩(.mode-chip)', '.mode-chip', 'edit'],
  ['단축키 kbd', 'kbd >> nth=0', 'view'], ['선택 상자(select)', 'select.storey-view', 'view'], ['검색 입력(.legend-search)', 'input.legend-search', 'view'], ['체크박스', 'input[type=checkbox] >> nth=0', 'view'], ['숫자 입력(.riser-height)', 'input.riser-height >> nth=0', 'view'],
  ['범례 카드(.wall-key)', '.wall-key', 'view'], ['등급 배너(.grade-banner)', '.grade-banner', 'view'], ['요약 카드(.floor-summary)', '.floor-summary', 'view'], ['편집 막대(.edit-bar)', '.edit-bar', 'edit'], ['도구 팔레트(.tool-palette)', '.tool-palette', 'edit'],
  ['표(규칙표)', '.checks table >> nth=0', 'view'], ['층 칩(.storey-chips)', '.storey-chips', 'view'],
]
test('gallery', async ({ page }) => {
  test.skip(!FILES.every(existsSync), '샘플 없음')
  test.setTimeout(300_000)
  mkdirSync(OUT, { recursive: true })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/')
  if (EXTRA_CSS) await page.addStyleTag({ content: EXTRA_CSS })
  await page.locator('.drop input[type=file]').setInputFiles(FILES)
  await page.locator('.appbar h2').waitFor({ timeout: 240_000 })
  await page.waitForFunction(() => [...document.querySelectorAll('.mode-switch button')].every((b) => !(b as HTMLButtonElement).disabled), null, { timeout: 90_000 }).catch(() => {})
  await page.waitForTimeout(1500)
  await page.evaluate(() => document.querySelectorAll<HTMLElement>('.side button[aria-expanded="false"]').forEach((b) => b.click()))
  await page.waitForTimeout(800)
  const done: string[] = [], missing: string[] = []
  for (const mode of ['view', 'edit'] as const) {
    if (mode === 'edit') { await page.locator('.mode-switch button', { hasText: '편집' }).click(); await page.waitForTimeout(1200) }
    for (const [name, sel] of ITEMS.filter((i) => i[2] === mode)) {
      const el = page.locator(sel).first()
      try { await el.scrollIntoViewIfNeeded({ timeout: 2000 }); await page.waitForTimeout(150); await el.screenshot({ path: `${OUT}/${name.replace(/[^\w가-힣.()-]/g, '_')}.png`, timeout: 4000 }); done.push(name) } catch { missing.push(name) }
    }
  }
  writeFileSync(`${OUT}/_result.json`, JSON.stringify({ done, missing }, null, 1))
  console.log('GAL', done.length, 'missing:', missing.join(', '))
})
