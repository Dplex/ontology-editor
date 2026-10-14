import { existsSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'

// 성수 전부(4개)를 열고 10층만 본 채 범례에서 계통을 고르면 흐름이 달리는 빛으로 보인다(flow-pulse.ts, docs/seongsu-test.md C-15).
//   - 방향 있는 연결이 많은 계통(기계 급기 374)은 빛을 깔고, 화면이 실제로 움직이며, 매 프레임 그려도 프레임이 버틴다.
//   - 선택을 풀면 빛을 걷고, 가만히 있으면 다시 그리지 않는다.
//   - 방향을 아는 연결이 드문 계통(순환수 공급 7, 연결 1,500여 개 중 포트 방향 24개)은 패널이 빛이 왜 드문지 말한다.
// 움직임을 켜고 돈다 — 설정의 reducedMotion 은 빛을 멈춘다.
const DIR = process.env.SEONGSU_DIR ?? 'data/성수'
const FILES = ['Factorial_건축.ifc', 'Factorial_기계.ifc', 'Factorial_10F_Interior.ifc', 'Factorial_elevator.ifc'].map((f) => `${DIR}/${f}`)
const FLOWING = process.env.SEONGSU_FLOW_SYSTEM ?? '기계 급기 374'
const SPARSE = process.env.SEONGSU_SPARSE_SYSTEM ?? '순환수 공급 7'

test.use({ contextOptions: { reducedMotion: 'no-preference' } })
test.skip(!FILES.every(existsSync), `성수 파일이 없다(${FILES.join(', ')})`)

const flow = (page: Page) => page.evaluate(() => (window as any).__viewer.flow()) as Promise<number>
const legend = (page: Page, name: string) => page.locator('.legend button').filter({ has: page.locator('.name', { hasText: new RegExp(`^${name}$`) }) })
/** 60 프레임 동안의 평균 간격과 그동안 3D 를 다시 그린 장수. */
const frames = (page: Page) =>
  page.evaluate(async () => {
    const v = (window as any).__viewer
    const before = v.renders()
    const t: number[] = []
    await new Promise<void>((r) => {
      const f = (now: number) => (t.push(now), t.length < 61 ? requestAnimationFrame(f) : r())
      requestAnimationFrame(f)
    })
    const gaps = t.slice(1).map((x, i) => x - t[i])
    return { mean: gaps.reduce((a, b) => a + b, 0) / gaps.length, renders: v.renders() - before }
  })

test(`성수 전부 10층: ${FLOWING} 를 고르면 흐름이 달리고, 풀면 멈추며, ${SPARSE} 는 빛이 드문 까닭을 말한다`, async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => localStorage.setItem('oe-mode', 'view'))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(FILES)
  await expect(page.locator('.appbar h2')).toContainText('+', { timeout: 600_000 })
  await expect(page.locator('.progress-toast')).toHaveCount(0, { timeout: 600_000 })
  await page.getByRole('combobox', { name: '보일 층' }).selectOption({ label: '10F만' })
  const canvas = page.locator('.canvas-wrap > canvas')
  await canvas.scrollIntoViewIfNeeded()

  await legend(page, FLOWING).click()
  await expect.poll(() => flow(page)).toBeGreaterThan(0)
  await page.waitForTimeout(1500)
  const a = await canvas.screenshot()
  await page.waitForTimeout(500)
  const b = await canvas.screenshot()
  expect(a.equals(b)).toBe(false)
  const moving = await frames(page)
  console.log(`MEASURE 흐름 ${FLOWING}: 연결 ${await flow(page)} · 평균 프레임 ${moving.mean.toFixed(1)}ms · 다시 그림 ${moving.renders}/60`)
  expect(moving.mean).toBeLessThan(34)
  await legend(page, FLOWING).click()
  await expect.poll(() => flow(page)).toBe(0)
  await page.waitForTimeout(1500)
  expect((await frames(page)).renders).toBe(0)

  await legend(page, SPARSE).click()
  const note = page.getByTestId('system-flow-note')
  await expect(note).toContainText('방향을 아는 연결')
  console.log(`MEASURE 흐름 ${SPARSE}: 10층 연결 ${await flow(page)} · ${(await note.innerText()).replace(/\s+/g, ' ')}`)
})
