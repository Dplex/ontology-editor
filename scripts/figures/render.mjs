// docs/figures/*.svg 를 같은 이름의 PNG(2배 해상도)로 굽는다.
// SVG 가 시스템 글꼴(Noto Sans CJK KR)을 쓰므로 브라우저로 그린다. Confluence 에는 PNG 를 붙인다.
//
//   node scripts/figures/render.mjs            # 전부
//   node scripts/figures/render.mjs fig-06     # 이름에 fig-06 이 든 것만
//
// 그림 속 숫자는 docs/bim-to-dt-ontology.md 와 같은 출처다. 정본 수치가 바뀌면 SVG 를 고치고 다시 굽는다.
import { chromium } from '@playwright/test'
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const DIR = resolve('docs/figures')
const only = process.argv.slice(2)

const browser = await chromium.launch()
const page = await browser.newPage({ deviceScaleFactor: 2 })
for (const f of readdirSync(DIR).filter((f) => f.endsWith('.svg')).sort()) {
  if (only.length && !only.some((o) => f.includes(o))) continue
  const svg = readFileSync(join(DIR, f), 'utf-8')
  await page.setContent(`<!doctype html><html><body style="margin:0;background:#fff">${svg}</body></html>`)
  await page.evaluate(() => document.fonts.ready)
  await page.locator('svg').first().screenshot({ path: join(DIR, f.replace(/\.svg$/, '.png')) })
  console.log('ok', f)
}
await browser.close()
