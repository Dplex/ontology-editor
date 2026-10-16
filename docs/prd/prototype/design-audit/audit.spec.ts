import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

// 1단계 진단: 화면별 스샷 + axe(WCAG AA 대비·라벨·포커스) + 계산된 스타일 통계(글자 크기·작은 클릭 영역).
const OUT = '.local/design-audit'
const DUPLEX = 'data/NBU_Duplex/NBU_Duplex-Apt_Arch.ifc'
const VIEWPORTS = [{ n: 'desktop', w: 1440, h: 900 }, { n: 'tablet', w: 1024, h: 768 }, { n: 'mobile', w: 390, h: 844 }]

async function stats(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const sizes: Record<string, number> = {}, small: string[] = []
    let n = 0
    for (const el of document.querySelectorAll<HTMLElement>('body *')) {
      const r = el.getBoundingClientRect(), cs = getComputedStyle(el)
      if (!r.width || !r.height || cs.visibility === 'hidden' || cs.display === 'none') continue
      if ([...el.childNodes].some((c) => c.nodeType === 3 && c.textContent!.trim())) { n++; const k = cs.fontSize; sizes[k] = (sizes[k] ?? 0) + 1 }
      if (el.matches('button,a[href],input:not([type=hidden]),select,[role=button]') && (r.width < 24 || r.height < 24) && small.length < 40)
        small.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ')[0]} ${Math.round(r.width)}x${Math.round(r.height)} "${(el.textContent ?? '').trim().slice(0, 16)}"`)
    }
    return { textNodes: n, fontSizeHistogram: sizes, under24px: small }
  })
}

for (const vp of VIEWPORTS) {
  for (const state of ['start', 'model'] as const) {
    test(`${state} @ ${vp.n}`, async ({ page }) => {
      test.skip(state === 'model' && !existsSync(DUPLEX), 'npm run fetch:sample 필요')
      mkdirSync(OUT, { recursive: true })
      await page.setViewportSize({ width: vp.w, height: vp.h })
      await page.goto('/')
      if (state === 'model') {
        await page.locator('.drop input[type=file]').setInputFiles(DUPLEX)
        await page.locator('.appbar h2').waitFor({ timeout: 120_000 })
        await page.waitForTimeout(1500)
      }
      const id = `${state}-${vp.n}`
      await page.screenshot({ path: `${OUT}/${id}.png`, fullPage: false })
      await page.screenshot({ path: `${OUT}/${id}-full.png`, fullPage: true })
      const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze()
      const violations = axe.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.length,
        sample: v.nodes.slice(0, 3).map((x) => ({ target: x.target.join(' '), summary: x.failureSummary?.split('\n').slice(1, 3).join(' ') })) }))
      writeFileSync(`${OUT}/${id}.json`, JSON.stringify({ viewport: vp, violations, ...(await stats(page)),
        scroll: await page.evaluate(() => ({ docH: document.documentElement.scrollHeight, docW: document.documentElement.scrollWidth, innerW: innerWidth })) }, null, 2))
    })
  }
}
