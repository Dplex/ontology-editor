import { existsSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'

// 성수 전부(건축·기계·10층 인테리어·엘리베이터)를 열고 10층만 본 채 범례에서 계통을 고른다(docs/seongsu-test.md C-14).
//   1. 범례의 수와 고른 계통 패널의 "구성 N개" 가 같다. 범례가 설비의 `systemId` 로 셀 때는 두 계통에 든 FCU 가 한쪽에서만 세여
//      순환수 공급 7 이 범례 1400 · 패널 1537 로 어긋났다.
//   2. 고르는 동안 10층 가구를 흐리게 하고 고르지 않는다. 그대로 두면 의자·책상이 천장 아래 배관을 가렸다. 풀면 돌아온다.
const DIR = process.env.SEONGSU_DIR ?? 'data/성수'
const FILES = ['Factorial_건축.ifc', 'Factorial_기계.ifc', 'Factorial_10F_Interior.ifc', 'Factorial_elevator.ifc'].map((f) => `${DIR}/${f}`)
const SYSTEM = process.env.SEONGSU_SYSTEM ?? '순환수 공급 7'

test.skip(!FILES.every(existsSync), `성수 파일이 없다(${FILES.join(', ')})`)

const viewer = <T,>(page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(([f, a]) => (window as any).__viewer[f as string](...(a as unknown[])), [fn, args] as const) as Promise<T>

test(`성수 전부 10층: 범례에서 ${SYSTEM} 를 고르면 범례 수가 구성 수와 같고, 가구를 흐리게 해 고르지 않는다`, async ({ page }) => {
  await page.goto('/')
  await page.evaluate(() => localStorage.setItem('oe-mode', 'view'))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(FILES)
  await expect(page.locator('.appbar h2')).toContainText('+', { timeout: 600_000 })
  await expect(page.locator('.progress-toast')).toHaveCount(0, { timeout: 600_000 })
  await page.getByRole('combobox', { name: '보일 층' }).selectOption({ label: '10F만' })
  await page.locator('.canvas-wrap > canvas').scrollIntoViewIfNeeded()

  const furniture = await viewer<string[]>(page, 'objects')
  expect(furniture.length).toBeGreaterThan(0)
  const opacities = () => Promise.all(furniture.map((id) => viewer<number>(page, 'objectOpacity', id)))
  const solid = await opacities()

  const button = page.locator('.legend button').filter({ has: page.locator('.name', { hasText: new RegExp(`^${SYSTEM}$`) }) })
  const listed = Number(await button.locator('.mono').innerText())
  await button.click()
  await expect(page.locator('.system-picked .stats').first()).toContainText(`구성 ${listed}개`)
  console.log(`MEASURE ${SYSTEM}: 범례 ${listed} · 가구 ${furniture.length}`)

  expect(Math.max(...(await opacities()))).toBeLessThanOrEqual(0.08)
  // 흐린 가구 윗면을 눌러도 가구가 골라지지 않는다.
  const at = await viewer<{ x: number; y: number } | null>(page, 'object', furniture[0])
  if (at) {
    await page.mouse.click(at.x, at.y)
    await expect(page.locator('.object-picked')).toHaveCount(0)
  }

  // 가구 자리를 누르면 그 뒤의 바닥·배관이 골라진다(그동안은 가구가 흐린 채다). Esc 로 고른 것을 다 풀면 가구가 돌아온다.
  for (let i = 0; i < 3; i++) await page.keyboard.press('Escape')
  await expect(button).toHaveAttribute('aria-pressed', 'false')
  await expect.poll(opacities).toEqual(solid)
})
