import { existsSync } from 'node:fs'
import { expect, test } from '@playwright/test'

// 성수 건축·기계 IFC 위에 성수 IDF(Factorial.idf)를 얹는다(ADR-0069).
//   1. IDF 원점이 BIM 과 달라도 겹친 넓이로 찾아 옮겨 놓고, 그 값을 공조존 접이의 "IDF 위치" 에 보인다(x 16.66 · y 18.06 · 0°).
//   2. 층고가 달라도(IDF 3m · BIM 4.3m) 공조존 79개가 모두 층을 찾는다.
//   3. 기준층 창가 존의 IDF FCU 한 대는 존 안의 BIM FCU 여러 대로 풀려 "말단" 칸에 BIM 이름과 대수가 보인다.
//   4. 위치를 고쳐 다시 얹으면 출처가 사람(편집)이 되고, [자동으로] 로 되돌린다.
const DIR = process.env.SEONGSU_DIR ?? 'data/성수'
const FILES = ['Factorial_기계.ifc', 'Factorial_건축.ifc', 'Factorial.idf'].map((f) => `${DIR}/${f}`)

test.skip(!FILES.every(existsSync), `성수 파일이 없다(${FILES.join(', ')})`)

test('성수 + IDF: 원점·층고가 달라도 공조존이 제자리·제층에 얹히고 FCU 가 존 안의 BIM 기기로 풀린다', async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => localStorage.setItem('oe-mode', 'view'))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(FILES)
  await expect(page.locator('.appbar h2')).toContainText('Factorial.idf', { timeout: 600_000 })
  await expect(page.locator('.progress-toast')).toHaveCount(0, { timeout: 600_000 })

  const fold = page.locator('section.fold', { has: page.getByRole('button', { name: /공조존 \(IDF\)/ }) })
  await expect(fold.locator('.fold-meta')).toContainText('79개')
  if ((await fold.getAttribute('class'))?.includes('open') !== true) await fold.locator('.fold-head').click()

  const form = page.getByTestId('idf-placement')
  await expect(form.getByLabel('IDF x 이동(m)')).toHaveValue('16.66')
  await expect(form.getByLabel('IDF y 이동(m)')).toHaveValue('18.06')
  await expect(form).toContainText('96%')

  const rows = fold.locator('tbody tr')
  await expect(rows).toHaveCount(79)
  // 층을 못 찾은 존이 없다.
  await expect(fold.locator('tbody td', { hasText: '(층 모름)' })).toHaveCount(0)
  const north = rows.filter({ has: page.locator('td', { hasText: /^4F_office-N_FCU_a$/ }) })
  await expect(north.locator('td').nth(1)).toHaveText('4F')
  await expect(north).toContainText('등 6대(BIM)')
  await expect(north).toContainText('Business Facility')
  await form.scrollIntoViewIfNeeded()
  await page.screenshot({ path: 'test-results/idf-seongsu-fold.png' })

  // 3D: 4F 만 보며 공조존 외곽선.
  await page.getByRole('combobox', { name: '보일 층' }).selectOption({ label: '4F만' })
  await page.locator('.canvas-wrap > canvas').scrollIntoViewIfNeeded()
  // 오른쪽 층 현황이 IDF 공조존을 센다(4F 는 7개).
  await expect(page.locator('.floor-summary, section', { hasText: '공간 구성 — 물리존' }).first()).toContainText('공조존 7')
  await page.keyboard.press('o')
  await page.waitForTimeout(1500)
  await page.screenshot({ path: 'test-results/idf-seongsu-4f.png' })

  // 고쳐 다시 얹으면 출처가 편집이 되고, 자동으로 되돌릴 수 있다.
  await form.scrollIntoViewIfNeeded()
  await form.getByLabel('IDF x 이동(m)').fill('0')
  await form.getByRole('button', { name: '다시 얹기' }).click()
  await expect(form.getByRole('button', { name: '자동으로' })).toBeVisible()
  await expect(form).toContainText('0%')
  await form.getByRole('button', { name: '자동으로' }).click()
  await expect(form.getByLabel('IDF x 이동(m)')).toHaveValue('16.66')
  await expect(form.getByRole('button', { name: '자동으로' })).toHaveCount(0)
})
