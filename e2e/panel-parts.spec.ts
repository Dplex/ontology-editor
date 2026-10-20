import { existsSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { enterEdit, selectById } from './edit-part'

// OE-BIM-07 좌표 없는 분전반 부품(2026-10-03 사용자 결정). ifc4Mep 00층의 퓨즈는 그 층에 하나뿐인 분전반(MB01) 자리에 놓이고, 그 좌표의
// 출처 칩은 BIM 이 아니라 계산이다. 01층 퓨즈는 분전반이 둘이라 좌표가 없다.
const MEP = 'data/ifc4Mep_IFC4.ifc'

test('ifc4Mep: 분전반 자리에 놓은 퓨즈의 좌표 출처는 계산이다', async ({ page }) => {
  test.skip(!existsSync(MEP), `${MEP} 이 없다(npm run fetch:sample)`)
  test.setTimeout(120_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(MEP)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 90_000 })
  await enterEdit(page)
  // 예전 설비 표의 좌표 출처 칩 대신, 하나씩 골라 선택 카드의 위치 칸 옆 칩을 본다(#715 에서 표가 빠졌다).
  const idsOf = (name: string) =>
    page.evaluate((n) => {
      const ttl: string = (window as any).__oe.screen().ttl
      return ttl
        .split(/\n\s*\n/)
        .filter((b) => b.includes(`rdfs:label "${n}"`))
        .map((b) => /^ex:(\S+) a /m.exec(b)![1].replace(/\\(.)/g, '$1'))
    }, name)
  const chips = page.locator('.position-edit .src')
  const fuses = await idsOf('F1')
  expect(fuses).toHaveLength(2)
  // 둘 중 좌표가 있는 하나(00층)만 칩이 있고, 계산이다.
  const kinds: string[] = []
  for (const id of fuses) {
    await selectById(page, id)
    await expect(page.locator('.picked h3').first()).toHaveText('F1')
    if (await chips.count()) kinds.push((await chips.getAttribute('class')) ?? '')
  }
  expect(kinds).toHaveLength(1)
  expect(kinds[0]).toContain('calc')
  // 분전반 MB01 자체는 BIM 좌표다(대조군).
  const [board] = await idsOf('MB01')
  await selectById(page, board)
  await expect(chips).toHaveClass(/bim/)
  expect(errors).toEqual([])
})
