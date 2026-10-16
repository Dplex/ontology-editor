import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'
import { THEMES, css } from './themes'

// 전/후: Linear 토큰 + fixes.css 를 얹고 1단계와 같은 수치를 잰다.
const OUT = process.env.LAYOUT === '1' ? '.local/design-audit/after-layout' : '.local/design-audit/after'
const DUPLEX = 'data/NBU_Duplex/NBU_Duplex-Apt_Arch.ifc'
const FIX = readFileSync(new URL('./fixes.css', import.meta.url), 'utf8') + (process.env.LAYOUT === '1' ? readFileSync(new URL('./layout.css', import.meta.url), 'utf8') : '')
for (const vp of [{ n: 'desktop', w: 1440, h: 900 }, { n: 'tablet', w: 1024, h: 768 }, { n: 'mobile', w: 390, h: 844 }]) {
  test(`after @ ${vp.n}`, async ({ page }) => {
    mkdirSync(OUT, { recursive: true })
    await page.setViewportSize({ width: vp.w, height: vp.h })
    await page.goto('/')
    await page.addStyleTag({ content: css(THEMES.linear, 'light') + FIX })
    await page.locator('.drop input[type=file]').setInputFiles(DUPLEX)
    await page.locator('.appbar h2').waitFor({ timeout: 120_000 })
    await page.waitForTimeout(1500)
    await page.screenshot({ path: `${OUT}/model-${vp.n}.png` })
    await page.screenshot({ path: `${OUT}/model-${vp.n}-full.png`, fullPage: true })
    const m = await page.evaluate(() => {
      let tiny = 0, small = 0
      for (const el of document.querySelectorAll<HTMLElement>('body *')) {
        const r = el.getBoundingClientRect(), cs = getComputedStyle(el)
        if (!r.width || !r.height || cs.display === 'none' || cs.visibility === 'hidden') continue
        if (parseFloat(cs.fontSize) < 11.99 && [...el.childNodes].some((c) => c.nodeType === 3 && c.textContent!.trim())) tiny++
        if (el.matches('button,a[href],select,[role=button]') && (r.width < 24 || r.height < 24)) small++
      }
      const q = (s: string) => { const e = document.querySelector(s); return e ? Math.round(e.getBoundingClientRect().height) : 0 }
      return { appbarH: q('.appbar'), canvasH: q('canvas'), under12pxText: tiny, under24pxTargets: small, docH: document.documentElement.scrollHeight, docW: document.documentElement.scrollWidth, innerW: innerWidth }
    })
    const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
    writeFileSync(`${OUT}/model-${vp.n}.json`, JSON.stringify({ ...m, axeViolations: axe.violations.map((v) => `${v.id} x${v.nodes.length}`) }))
    console.log('AFTER', vp.n, JSON.stringify({ ...m, axe: axe.violations.map((v) => `${v.id} x${v.nodes.length}`) }))
  })
}
