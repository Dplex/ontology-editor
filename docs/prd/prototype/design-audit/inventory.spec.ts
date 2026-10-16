import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { readFileSync } from 'node:fs'
import { test } from '@playwright/test'
import { THEMES, css as themeCss } from './themes'
const TAG = process.env.AUDIT_TAG ?? 'base'
const EXTRA_CSS = (process.env.AUDIT_THEME ? themeCss(THEMES[process.env.AUDIT_THEME], 'light') : '') + (process.env.AUDIT_CSS_FILES ?? '').split(',').filter(Boolean).map((f) => readFileSync(new URL(f, import.meta.url), 'utf8')).join(' ')

// 컴포넌트 인벤토리용 계측: 열람·편집 화면에서 단추·알약·카드·입력·표·제목을 "계산된 스타일 서명"별로 묶어 센다.
// 같은 서명 = 같은 컴포넌트로 본다. 서명이 여러 개면 한 컴포넌트가 여러 모양이라는 뜻이다.
const OUT = '.local/design-audit/inventory'
const FILES = ['data/NBU_MedicalClinic/NBU_MedicalClinic_Arch.ifc', 'data/NBU_MedicalClinic/NBU_MedicalClinic_Eng-HVAC.ifc']

test('inventory', async ({ page }) => {
  test.skip(!FILES.every(existsSync), '샘플 없음')
  test.setTimeout(300_000)
  mkdirSync(OUT, { recursive: true })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/')
  if (EXTRA_CSS) await page.addStyleTag({ content: EXTRA_CSS })
  await page.locator('.drop input[type=file]').setInputFiles(FILES)
  await page.locator('.appbar h2').waitFor({ timeout: 240_000 })
  await page.waitForFunction(() => [...document.querySelectorAll('.mode-switch button')].every((b) => !(b as HTMLButtonElement).disabled), null, { timeout: 90_000 }).catch(() => {})
  await page.waitForTimeout(2000)
  const collected: Record<string, any[]> = {}
  for (const mode of ['view', 'edit']) {
    if (mode === 'edit') { await page.locator('.mode-switch button', { hasText: '편집' }).click(); await page.waitForTimeout(1500) }
    // 접힌 칸(Fold)을 펼쳐 숨은 컴포넌트도 센다.
    await page.evaluate(() => document.querySelectorAll<HTMLElement>('.side button[aria-expanded="false"]').forEach((b) => b.click()))
    await page.waitForTimeout(800)
    const r = await page.evaluate(() => {
      const num = (v: string) => Math.round(parseFloat(v) * 10) / 10
      const vis = (el: Element) => { const r = el.getBoundingClientRect(), c = getComputedStyle(el); return r.width > 2 && r.height > 2 && c.display !== 'none' && c.visibility !== 'hidden' && !el.closest('canvas') }
      const sig = (el: Element, extra: string[] = []) => { const c = getComputedStyle(el); const r = el.getBoundingClientRect()
        return [c.fontSize, c.fontWeight, `h${Math.round(r.height)}`, `pad ${c.paddingTop} ${c.paddingRight}`, `r ${c.borderTopLeftRadius}`, `bd ${c.borderTopWidth} ${c.borderTopColor}`, `bg ${c.backgroundColor}`, `fg ${c.color}`, ...extra.map((p) => c.getPropertyValue(p))].join(' | ') }
      const cls = (e: Element) => e.tagName.toLowerCase() + (typeof e.className === 'string' && e.className.trim() ? '.' + e.className.trim().split(/\s+/).slice(0, 3).join('.') : '')
      const group = (els: Element[], extra: string[] = []) => { const m = new Map<string, { n: number; samples: Set<string>; idx: number }>(); els.filter(vis).forEach((e, i) => { const k = sig(e, extra); const g = m.get(k) ?? { n: 0, samples: new Set<string>(), idx: i }; g.n++; if (g.samples.size < 4) g.samples.add(cls(e) + ' "' + (e.textContent ?? '').trim().slice(0, 14) + '"'); m.set(k, g) })
        return [...m.entries()].sort((a, b) => b[1].n - a[1].n).map(([k, v]) => ({ sig: k, n: v.n, samples: [...v.samples] })) }
      const all = [...document.querySelectorAll('body *')].filter(vis)
      const buttons = all.filter((e) => e.matches('button, summary, label.ghost, a.link, [role=button]'))
      const pills = all.filter((e) => !e.matches('button, summary, a, label.ghost, kbd') && e.children.length < 3 && num(getComputedStyle(e).borderTopLeftRadius) >= 8 && getComputedStyle(e).display !== 'block' && (e.textContent ?? '').trim().length > 0 && (e.textContent ?? '').trim().length < 24 && e.getBoundingClientRect().height < 40 && (getComputedStyle(e).backgroundColor !== 'rgba(0, 0, 0, 0)' || num(getComputedStyle(e).borderTopWidth) > 0))
      const cards = all.filter((e) => { const c = getComputedStyle(e), r = e.getBoundingClientRect(); return !e.matches('button, input, select, label, summary, canvas') && r.width > 150 && r.height > 36 && num(c.borderTopLeftRadius) >= 4 && (num(c.borderTopWidth) > 0 || c.boxShadow !== 'none') && c.backgroundColor !== 'rgba(0, 0, 0, 0)' })
      const inputs = all.filter((e) => e.matches('input:not([type=hidden]), select, textarea'))
      const tables = all.filter((e) => e.matches('table, th, td'))
      const heads = all.filter((e) => e.matches('h1, h2, h3, h4, h5'))
      const kbds = all.filter((e) => e.matches('kbd'))
      const texts = new Map<string, number>(); all.forEach((e) => { if ([...e.childNodes].some((c) => c.nodeType === 3 && c.textContent!.trim())) { const c = getComputedStyle(e); const k = `${c.fontSize} / ${c.fontWeight} / lh ${c.lineHeight}`; texts.set(k, (texts.get(k) ?? 0) + 1) } })
      return { buttons: group(buttons), pills: group(pills), cards: group(cards, ['box-shadow']), inputs: group(inputs.map((e) => e)), tables: group(tables), heads: group(heads), kbds: group(kbds), text: [...texts.entries()].sort((a, b) => b[1] - a[1]) }
    })
    collected[mode] = [r]
    await page.screenshot({ path: `${OUT}/screen-${TAG}-${mode}.png` })
  }
  writeFileSync(`${OUT}/inventory-${TAG}.json`, JSON.stringify(collected, null, 1))
  for (const mode of ['view', 'edit']) { const r = collected[mode][0]; console.log('INV', mode, Object.fromEntries(Object.entries(r).map(([k, v]: any) => [k, k === 'text' ? v.length : `${v.length} groups / ${v.reduce((a: number, g: any) => a + g.n, 0)}`]))) }
})
