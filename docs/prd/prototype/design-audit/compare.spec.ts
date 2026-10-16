import { mkdirSync, writeFileSync } from 'node:fs'
import { test } from '@playwright/test'
import { THEMES, css } from './themes'

// 2단계: 같은 화면(시작·Duplex 열람·모바일)에 후보 토큰을 입혀 스샷 + 핵심 색쌍 대비비를 잰다.
const OUT = '.local/design-audit/compare'
const DUPLEX = 'data/NBU_Duplex/NBU_Duplex-Apt_Arch.ifc'
const lum = (hex: string) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return +((x + 0.05) / (y + 0.05)).toFixed(2) }

for (const name of Object.keys(THEMES)) {
  test(`theme ${name}`, async ({ page }) => {
    mkdirSync(OUT, { recursive: true })
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.goto('/')
    await page.addStyleTag({ content: css(THEMES[name], 'light') })
    await page.screenshot({ path: `${OUT}/${name}-start.png` })
    await page.locator('.drop input[type=file]').setInputFiles(DUPLEX)
    await page.locator('.appbar h2').waitFor({ timeout: 120_000 })
    await page.waitForTimeout(1500)
    await page.screenshot({ path: `${OUT}/${name}-model-light.png` })
    await page.evaluate(() => (document.documentElement.dataset.theme = 'dark'))
    await page.waitForTimeout(400)
    await page.screenshot({ path: `${OUT}/${name}-model-dark.png` })
    await page.evaluate(() => (document.documentElement.dataset.theme = ''))
    await page.setViewportSize({ width: 390, height: 844 })
    await page.waitForTimeout(400)
    await page.screenshot({ path: `${OUT}/${name}-model-mobile.png` })
    // 대비: 토큰 값을 읽어 AA(4.5) 를 잰다.
    const res: Record<string, Record<string, number>> = {}
    for (const mode of ['light', 'dark']) {
      await page.evaluate((m) => (document.documentElement.dataset.theme = m === 'dark' ? 'dark' : ''), mode)
      const v = await page.evaluate(() => { const s = getComputedStyle(document.documentElement); const g = (k: string) => { const c = document.createElement('canvas').getContext('2d')!; c.fillStyle = s.getPropertyValue(k).trim(); return c.fillStyle as string }; return Object.fromEntries(['--bg', '--surface', '--surface-soft', '--fg', '--muted', '--accent', '--accent-soft', '--on-accent'].map((k) => [k, g(k)])) })
      res[mode] = { '본문/면': ratio(v['--fg'], v['--surface']), '보조글씨/면': ratio(v['--muted'], v['--surface']), '보조글씨/옅은면': ratio(v['--muted'], v['--surface-soft']), '액센트/면': ratio(v['--accent'], v['--surface']), '액센트/액센트옅은': ratio(v['--accent'], v['--accent-soft']), '버튼글씨/액센트': ratio(v['--on-accent'], v['--accent']) }
    }
    writeFileSync(`${OUT}/${name}-contrast.json`, JSON.stringify(res, null, 1))
  })
}
