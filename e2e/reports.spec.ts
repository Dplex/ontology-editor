import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'

// 생성 리포트(B-2)·고객사 결과 리포트(B-1)·누락 분류(OE-GEN-07·08, OE-BIM-20). mep.ifc 는 게이트 미달(설비 목록·소속 80%)이다.
const MEP = 'src/lib/ifc/fixtures/mep.ifc'

test('리포트 칸에서 11항 생성 리포트를 만들고, 고객사 결과 리포트 HTML 을 받으면 재제출 항목에 R 번호와 수정 방법이 있다. 요구사항 표에 분류가 붙는다 [OE-GEN-07#1] [OE-GEN-08#1] [OE-BIM-20#1~]', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(MEP)
  await expect(page.locator('.appbar h2')).toHaveText('mep.ifc', { timeout: 30_000 })

  // 요구사항 표의 분류 칸: 위반 줄마다 X/A/B/C.
  await page.getByRole('button', { name: /^요구사항/ }).click()
  const classes = await page.locator('.req-table td.req-class').allInnerTexts()
  expect(classes.length).toBeGreaterThan(10)
  expect(classes.some((x) => /^[XABC]-/.test(x))).toBe(true)

  const box = page.getByTestId('reports')
  await box.getByRole('button', { name: /^리포트/ }).click()
  await box.getByRole('button', { name: '생성 리포트 만들기' }).click()
  const gen = box.getByTestId('generation')
  await expect(gen.locator(':scope > li')).toHaveCount(11)
  await expect(gen.locator(':scope > li').nth(1)).toContainText('게이트(등급 2) 미달')
  await expect(gen.locator(':scope > li').nth(10)).toContainText(/sha256 [0-9a-f]{16}…/)
  if (process.env.SHOT) await gen.screenshot({ path: process.env.SHOT })

  const [dl] = await Promise.all([page.waitForEvent('download'), box.getByRole('button', { name: '고객사 결과 리포트(HTML)' }).click()])
  expect(dl.suggestedFilename()).toBe('mep-결과리포트.html')
  const html = readFileSync((await dl.path())!, 'utf-8')
  const section = html.slice(html.indexOf('5. 재제출 항목'), html.indexOf('6. 보정 항목'))
  expect(section).toMatch(/<li>[AB]-(설정|부재) · R\d+ /)
  expect(html).toContain('재제출 항목(A·B)을 고쳐 다시 보내 주세요')
  expect(errors).toEqual([])
})

test('리포트 칸에서 어긴 요소를 R 마다 세어 보이고, CSV(GlobalId·Revit 요소 ID)와 BCF(그 요소를 고르는 이슈)로 받는다', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(MEP)
  await expect(page.locator('.appbar h2')).toHaveText('mep.ifc', { timeout: 30_000 })
  const box = page.getByTestId('reports')
  await box.getByRole('button', { name: /^리포트/ }).click()
  const issues = box.getByTestId('issue-export')
  const rows = issues.locator('.issue-summary tbody tr')
  await expect(rows.first()).toBeVisible()
  const total = (await issues.locator('.issue-summary td.num').allInnerTexts()).reduce((s, t) => s + Number(t.replace(/,/g, '')), 0)
  expect(total).toBeGreaterThan(0)
  await expect(issues).toContainText(`어긴 요소 ${total.toLocaleString()}개`)

  const [csv] = await Promise.all([page.waitForEvent('download'), issues.getByRole('button', { name: '누락 요소 목록(CSV)' }).click()])
  expect(csv.suggestedFilename()).toBe('mep-누락요소.csv')
  const text = readFileSync((await csv.path())!, 'utf-8')
  expect(text.charCodeAt(0)).toBe(0xfeff) // 엑셀이 UTF-8 로 연다
  const lines = text.slice(1).trim().split('\r\n')
  expect(lines[0]).toBe('R,분류,규칙,무엇이 없나,GlobalId,Revit 요소 ID,이름,IFC 클래스,층,X,Y,Z,요청')
  expect(lines).toHaveLength(total + 1)

  const [bcf] = await Promise.all([page.waitForEvent('download'), issues.getByRole('button', { name: '누락 요소 BCF' }).click()])
  expect(bcf.suggestedFilename()).toBe('mep-누락요소.bcf')
  const { readStoreZip } = await import('../src/lib/zip')
  const files = readStoreZip(new Uint8Array(readFileSync((await bcf.path())!)))
  expect(files.has('bcf.version')).toBe(true)
  const markups = [...files.keys()].filter((n) => n.endsWith('/markup.bcf'))
  expect(markups.length).toBeGreaterThan(0)
  // 고르는 것은 IFC GlobalId(22자)인 요소뿐이다. 손으로 쓴 mep.ifc 는 일부만 22자다 — 실제 BIM 은 전부 22자다(ADR-0051 측정).
  const guidRows = lines.slice(1).filter((l) => /^[0-9A-Za-z_$]{22}$/.test(l.split(',')[4])).length
  const selected = [...files].filter(([n]) => n.endsWith('.bcfv')).reduce((s, [, b]) => s + (new TextDecoder().decode(b).match(/<Component IfcGuid=/g)?.length ?? 0), 0)
  expect(selected).toBe(guidRows)
  expect(errors).toEqual([])
})
