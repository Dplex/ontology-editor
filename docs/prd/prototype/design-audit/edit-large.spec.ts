import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { test } from '@playwright/test'
import { THEMES, css } from './themes'

// 편집 모드·큰 파일에서 layout.css 가 깨지지 않는지 전/후(원본 vs Linear+fixes+layout)로 본다.
// 성수 파일이 이 PC 에 없어 같은 Revit IFC2x3 인 NIBS Medical Clinic(건축 + HVAC)을 대신 쓴다.
const OUT = '.local/design-audit/edit-large'
const SETS: Record<string, string[]> = {
  duplex: ['data/NBU_Duplex/NBU_Duplex-Apt_Arch.ifc'],
  clinic: ['data/NBU_MedicalClinic/NBU_MedicalClinic_Arch.ifc', 'data/NBU_MedicalClinic/NBU_MedicalClinic_Eng-HVAC.ifc'],
}
const read = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8')
const AFTER = css(THEMES.linear, 'light') + read('./fixes.css') + read('./layout.css')

for (const set of Object.keys(SETS)) for (const vp of [{ n: 'desktop', w: 1440, h: 900 }, { n: 'mobile', w: 390, h: 844 }]) for (const variant of ['before', 'after']) {
  test(`${set} ${vp.n} ${variant}`, async ({ page }) => {
    test.skip(!SETS[set].every(existsSync), '샘플 없음')
    test.setTimeout(300_000)
    mkdirSync(OUT, { recursive: true })
    await page.setViewportSize({ width: vp.w, height: vp.h })
    await page.goto('/')
    if (variant === 'after') await page.addStyleTag({ content: AFTER })
    await page.locator('.drop input[type=file]').setInputFiles(SETS[set])
    await page.locator('.appbar h2').waitFor({ timeout: 240_000 })
    await page.waitForTimeout(2500)
    const id = `${set}-${vp.n}-${variant}`
    await page.screenshot({ path: `${OUT}/${id}-view.png` })
    const editBtn = page.locator('.mode-switch button', { hasText: '편집' })
    await editBtn.waitFor({ timeout: 60_000 }); await page.waitForFunction(() => [...document.querySelectorAll('.mode-switch button')].every((b) => !(b as HTMLButtonElement).disabled), null, { timeout: 90_000 }).catch(() => {})
    const canEdit = await editBtn.isEnabled()
    if (canEdit) { await editBtn.click(); await page.waitForTimeout(1500) }
    await page.screenshot({ path: `${OUT}/${id}-edit.png` })
    await page.screenshot({ path: `${OUT}/${id}-edit-full.png`, fullPage: true })
    const m = await page.evaluate(() => {
      const vis = (el: Element) => { const r = el.getBoundingClientRect(), c = getComputedStyle(el); return r.width > 0 && r.height > 0 && c.display !== 'none' && c.visibility !== 'hidden' }
      const box = (s: string) => { const e = document.querySelector(s); return e && vis(e) ? e.getBoundingClientRect() : null }
      // 3D 위에 뜬 것들의 서로 겹침
      const names = ['.facade-dock', '.right-col .view-tools', '.right-col .wall-key', '.right-col .view-cube, .right-col [class*=cube]', '.tool-palette', '.bottom-view-dock', '.storey-chips', '.fly-badge']
      const boxes = names.map((n) => [n, box(n)] as const).filter(([, b]) => b)
      const overlaps: string[] = []
      for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) { const a = boxes[i][1]!, b = boxes[j][1]!; const w = Math.min(a.right, b.right) - Math.max(a.left, b.left), h = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top); if (w > 4 && h > 4) overlaps.push(`${boxes[i][0]} × ${boxes[j][0]} (${Math.round(w)}x${Math.round(h)})`) }
      // 편집 막대의 단추가 화면 안(또는 가로 스크롤 가능한 줄 안)에 닿는가
      const bar = document.querySelector('.edit-bar'), barBtns = bar ? [...bar.querySelectorAll('button')].filter(vis) : []
      const canvas = document.querySelector('canvas')!.getBoundingClientRect()
      const free = (() => { const c = document.createElement('canvas'); void c; return 0 })()
      void free
      return { docW: document.documentElement.scrollWidth, innerW: innerWidth, docH: document.documentElement.scrollHeight, appbarH: Math.round(document.querySelector('.appbar')!.getBoundingClientRect().height),
        editBarH: bar ? Math.round(bar.getBoundingClientRect().height) : null, editBarButtons: barBtns.length,
        editBarCutOff: barBtns.filter((b) => b.getBoundingClientRect().right > innerWidth + 1).map((b) => b.textContent!.trim().slice(0, 10)),
        canvasH: Math.round(canvas.height), overlaps }
    })
    writeFileSync(`${OUT}/${id}.json`, JSON.stringify({ canEdit, ...m }, null, 1))
    console.log('EDIT', id, JSON.stringify({ canEdit, ...m }))
  })
}
