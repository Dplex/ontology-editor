import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'

// 생성 전 검증(OE-GEN-03, lib/pre-build.ts). 화면에서는 같은 층의 방번호로 바꾸지 못해(space-number.spec.ts) 겹침은 BIM 에서만 들어온다.
// two-rooms.ifc 의 102(복도)를 101 로 바꾼 사본을 연다 — 1F 에 방번호 101 이 둘이다.
const ROOMS = readFileSync('src/lib/ifc/fixtures/two-rooms.ifc', 'utf-8')
const DUP = Buffer.from(ROOMS.replace("IFCSPACE('0PoC$Space$Corridor$00',$,'102'", "IFCSPACE('0PoC$Space$Corridor$00',$,'101'"))

test('한 층 안에 방번호가 겹치면 [구축하기] 가 막히고 까닭이 보이며, 생성 리포트 ⑩ 에 차단·경고 항목이 다 있다 [OE-GEN-03#1,2,3]', async ({ page }) => {
  expect(DUP.toString()).not.toEqual(ROOMS)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.addInitScript(() => localStorage.setItem('oe.gradeLines', JSON.stringify({ 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 })))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles({ name: 'dup-rooms.ifc', mimeType: 'application/octet-stream', buffer: DUP })
  await expect(page.locator('.appbar h2')).toHaveText('dup-rooms.ifc', { timeout: 30_000 })
  await page.getByRole('button', { name: '편집', exact: true }).click()
  const build = page.locator('.edit-bar').getByRole('button', { name: '구축하기' })
  await expect(build).toBeDisabled()
  await expect(build).toHaveAttribute('title', /생성 전 검증에서 막혔습니다 — 방번호가 겹치는 물리존: 1F 101 ×2/)

  const box = page.getByTestId('reports')
  await box.getByRole('button', { name: /^리포트/ }).click()
  await box.getByRole('button', { name: '생성 리포트 만들기' }).click()
  const check = box.getByTestId('generation').locator(':scope > li').nth(9)
  await expect(check).toContainText('[차단] 한 층 안에서 방번호가 겹치지 않는다')
  for (const label of ['층마다 물리존이 하나 이상 있다', '좌표 없는 설비·배관', '좌표가 있는 설비가 물리존에 소속된다', '공조존 공백·중복(Z-01~06)', '완전성 검사', 'feeds 에서 뺀 방향'])
    await expect(check).toContainText(label)
  expect(errors).toEqual([])
})
