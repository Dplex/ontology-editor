import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { test } from '@playwright/test'
import AxeBuilder from '@axe-core/playwright'

// 상태 인벤토리: 컴포넌트마다 기본·호버·눌림·키보드 포커스·비활성을 계산된 스타일로 재고, 다크 테마에서 기본 상태와 대비를 잰다.
// 눌림은 단추 위에서 마우스를 누른 채 밖으로 끌어내 떼서 클릭이 일어나지 않게 한다.
const OUT = '.local/design-audit/states'
const FILES = (process.env.AUDIT_FILES ?? 'data/NBU_MedicalClinic/NBU_MedicalClinic_Arch.ifc,data/NBU_MedicalClinic/NBU_MedicalClinic_Eng-HVAC.ifc').split(',')
const TAG = process.env.AUDIT_TAG ?? 'clinic'
import { readFileSync } from 'node:fs'
import { THEMES, css as themeCss } from './themes'
// AUDIT_CSS_FILES=a.css,b.css 로 시험 CSS 를 얹고(앱 CSS 위), AUDIT_THEME=linear 이면 themes.ts 의 토큰도 얹는다.
const EXTRA_CSS = (process.env.AUDIT_THEME ? themeCss(THEMES[process.env.AUDIT_THEME], 'light') : '') + (process.env.AUDIT_CSS_FILES ?? '').split(',').filter(Boolean).map((f) => readFileSync(new URL(f, import.meta.url), 'utf8')).join(' ')
const FAMILIES: [string, string, 'view' | 'edit', boolean][] = [
  ['툴바 알약', '.bar-actions button.ghost:not([disabled]) >> nth=0', 'view', true],
  ['3D 위 도구', '.view-tools button.ghost >> nth=0', 'view', true],
  ['모드 스위치(꺼진 칸)', '.mode-switch button[aria-pressed=false]', 'view', true],
  ['사이드 탭', '.side-tabs button >> nth=1', 'view', true],
  ['링크 단추', 'button.link >> nth=0', 'view', true],
  ['접기 머리', 'button.fold-head >> nth=0', 'view', true],
  ['진단 칩', '.diag-chip >> nth=0', 'view', true],
  ['어두운 독 단추', '.facade-dock .dock-btn >> nth=0', 'view', true],
  ['하단 독 알약', '.bottom-view-dock .view-pill >> nth=0', 'view', true],
  ['층 칩', '.storey-chips button >> nth=0', 'view', true],
  ['선택 상자', 'select.storey-view', 'view', false],
  ['검색 입력', 'input.legend-search', 'view', false],
  ['숫자 입력', 'input.riser-height >> nth=0', 'view', false],
  ['체크박스', '.tool-palette input[type=checkbox] >> nth=0', 'edit', false],
  ['팔레트 단추', '.tool-palette button.ghost >> nth=0', 'edit', true],
  ['편집 대상 분절', '.edit-part button:not(.on) >> nth=0', 'edit', true],
  ['주요 단추(구축하기)', 'button.primary-action', 'edit', true],
  ['편집 막대 알약', '.edit-bar button.ghost:not(.primary-action):not([disabled]) >> nth=0', 'edit', true],
]
const PROPS = ['color', 'background-color', 'border-top-color', 'border-top-width', 'box-shadow', 'outline-style', 'outline-width', 'outline-color', 'outline-offset', 'opacity', 'transform', 'cursor', 'text-decoration-line', 'filter']
const read = (el: Element, props: string[]) => {
  const c = getComputedStyle(el)
  const o: Record<string, string> = {}
  for (const p of props) o[p] = c.getPropertyValue(p)
  o['focus-visible'] = String(el.matches(':focus-visible'))
  return o
}
const diff = (a: Record<string, string>, b: Record<string, string>) =>
  Object.keys(b).filter((k) => k !== 'focus-visible' && a[k] !== b[k]).map((k) => `${k}: ${a[k]} → ${b[k]}`)
const contrast = (el: Element) => {
  const parse = (s: string) => { const m = s.match(/[\d.]+/g)?.map(Number) ?? [0, 0, 0, 1]; return { r: m[0], g: m[1], b: m[2], a: m[3] ?? 1 } }
  const lum = ({ r, g, b }: { r: number; g: number; b: number }) => {
    const f = [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 })
    return 0.2126 * f[0] + 0.7152 * f[1] + 0.0722 * f[2]
  }
  const stack: { r: number; g: number; b: number; a: number }[] = []
  for (let e: Element | null = el; e; e = e.parentElement) {
    const c = parse(getComputedStyle(e).backgroundColor)
    if (c.a > 0) stack.push(c)
    if (c.a >= 1) break
  }
  let base = stack.length && stack[stack.length - 1].a >= 1 ? stack.pop()! : { r: 255, g: 255, b: 255, a: 1 }
  while (stack.length) {
    const t = stack.pop()!
    base = { r: t.r * t.a + base.r * (1 - t.a), g: t.g * t.a + base.g * (1 - t.a), b: t.b * t.a + base.b * (1 - t.a), a: 1 }
  }
  const fg = parse(getComputedStyle(el).color)
  const L1 = lum(fg), L2 = lum(base)
  return Math.round(((Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05)) * 100) / 100
}

test('states', async ({ page }) => {
  test.skip(!FILES.every(existsSync), '샘플 없음')
  test.setTimeout(900_000)
  mkdirSync(OUT, { recursive: true })
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto('/')
  if (EXTRA_CSS) await page.addStyleTag({ content: EXTRA_CSS })
  await page.locator('.drop input[type=file]').setInputFiles(FILES)
  await page.locator('.appbar h2').waitFor({ timeout: 600_000 })
  await page.waitForFunction(() => [...document.querySelectorAll('.mode-switch button')].every((b) => !(b as HTMLButtonElement).disabled), null, { timeout: 120_000 }).catch(() => {})
  await page.waitForTimeout(1500)
  const result: any = { states: {}, dark: {}, disabled: [], axe: {} }
  for (const mode of ['view', 'edit'] as const) {
    if (mode === 'edit') { await page.locator('.mode-switch button', { hasText: '편집' }).click(); await page.waitForTimeout(1200) }
    for (const theme of ['light', 'dark']) {
      await page.evaluate((t) => { document.documentElement.dataset.theme = t === 'dark' ? 'dark' : '' }, theme)
      await page.waitForTimeout(400)
      for (const [name, sel, , press] of FAMILIES.filter((f) => f[2] === mode)) {
        const el = page.locator(sel).first()
        if (!(await el.count())) { if (theme === 'light') result.states[name] = { missing: true }; continue }
        try {
          await el.scrollIntoViewIfNeeded({ timeout: 2000 })
          await page.mouse.move(2, 2)
          await page.waitForTimeout(120)
          const def = await el.evaluate(read, PROPS)
          const cr = await el.evaluate(contrast)
          if (theme === 'dark') {
            result.dark[name] = { contrast: cr, bg: def['background-color'], fg: def['color'] }
            await page.keyboard.press('Shift'); await el.focus(); await page.waitForTimeout(200)
            const fd = await el.evaluate(read, PROPS)
            result.dark[name].focusIndicator = fd['outline-style'] !== 'none' && fd['outline-width'] !== '0px' ? `outline ${fd['outline-width']} ${fd['outline-color']}` : 'none'
            if (['툴바 알약', '링크 단추', '체크박스', '검색 입력'].includes(name)) { const bb = await el.boundingBox(); if (bb) await page.screenshot({ path: `${OUT}/${TAG}-focus-dark-${name}.png`, clip: { x: Math.max(0, bb.x - 10), y: Math.max(0, bb.y - 10), width: bb.width + 20, height: bb.height + 20 } }) }
            await el.evaluate((e) => (e as HTMLElement).blur())
            continue
          }
          const rec: any = { default: def, contrast: cr }
          await el.hover({ timeout: 2000 })
          await page.waitForTimeout(250)
          rec.hover = diff(def, await el.evaluate(read, PROPS))
          if (press) {
            const b = await el.boundingBox()
            await page.mouse.move(b!.x + b!.width / 2, b!.y + b!.height / 2)
            await page.mouse.down()
            await page.waitForTimeout(250)
            rec.active = diff(def, await el.evaluate(read, PROPS))
            await page.mouse.move(2, 2)
            await page.mouse.up()
          }
          await page.mouse.move(2, 2)
          await page.keyboard.press('Shift')
          await el.focus()
          await page.waitForTimeout(250)
          const fo = await el.evaluate(read, PROPS)
          rec.focus = diff(def, fo)
          rec.focusVisible = fo['focus-visible'] === 'true'
          rec.focusIndicator = fo['outline-style'] !== 'none' && fo['outline-width'] !== '0px' ? `outline ${fo['outline-width']} ${fo['outline-color']}` : fo['box-shadow'] !== def['box-shadow'] ? 'box-shadow' : 'none'
          if (['툴바 알약', '링크 단추', '체크박스', '검색 입력'].includes(name)) { const bb = await el.boundingBox(); if (bb) await page.screenshot({ path: `${OUT}/${TAG}-focus-light-${name}.png`, clip: { x: Math.max(0, bb.x - 10), y: Math.max(0, bb.y - 10), width: bb.width + 20, height: bb.height + 20 } }) }
          await el.evaluate((e) => (e as HTMLElement).blur())
          result.states[name] = rec
        } catch (e) { if (theme === 'light') result.states[name] = { error: String(e).slice(0, 90) } }
      }
    }
    await page.evaluate(() => { document.documentElement.dataset.theme = '' })
    const dis = await page.evaluate(() => {
      const m = new Map<string, { n: number; sample: string }>()
      for (const e of document.querySelectorAll<HTMLElement>('button:disabled, input:disabled, select:disabled, [aria-disabled=true]')) {
        const r = e.getBoundingClientRect()
        if (r.width < 2) continue
        const c = getComputedStyle(e)
        const k = `opacity ${c.opacity} | cursor ${c.cursor} | color ${c.color} | bg ${c.backgroundColor}`
        const g = m.get(k) ?? { n: 0, sample: (e.className || e.tagName) + ' "' + (e.textContent ?? '').trim().slice(0, 14) + '"' }
        g.n++
        m.set(k, g)
      }
      return [...m.entries()].map(([k, v]) => ({ sig: k, ...v }))
    })
    result.disabled.push(...dis.map((d: any) => ({ mode, ...d })))
    await page.evaluate(() => { document.documentElement.dataset.theme = 'dark' })
    await page.waitForTimeout(900)
    const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
    result.axe[`dark-${mode}`] = axe.violations.map((v) => ({ id: v.id, n: v.nodes.length, sample: v.nodes.slice(0, 3).map((x) => x.target.join(' ')) }))
    await page.screenshot({ path: `${OUT}/${TAG}-dark-${mode}.png` })
    await page.evaluate(() => { document.documentElement.dataset.theme = '' })
    await page.waitForTimeout(900)
    const axeL = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()
    result.axe[`light-${mode}`] = axeL.violations.map((v) => ({ id: v.id, n: v.nodes.length, sample: v.nodes.slice(0, 3).map((x) => x.target.join(' ')) }))
  }
  writeFileSync(`${OUT}/${TAG}-states.json`, JSON.stringify(result, null, 1))
  console.log('STATES done', Object.keys(result.states).length)
})
