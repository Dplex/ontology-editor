import { existsSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'

// OE-UI-12 3D 단일 층 표시: "숨긴 층은 그리지도 고르지도 않는다". 방 둘짜리 fixture 는 층마다 설비가 없어 실제 BIM 으로 잰다.
// 병원 건축+HVAC 의 1층만 볼 때, 2층 설비가 있던 화면 자리를 눌러도 2층 설비·방이 골라지지 않아야 한다. 2층은 1층 위에 있어서
// 걸러지지 않으면 광선이 2층에 먼저 닿는다. 층마다 무엇이 있는지는 평면도(층 하나를 그린다)에서 읽는다.
const ARCH = 'data/NBU_MedicalClinic/NBU_MedicalClinic_Arch.ifc'
const HVAC = 'data/NBU_MedicalClinic/NBU_MedicalClinic_Eng-HVAC.ifc'

type Pick = { equipment: string | null; element: string | null; space: string | null }
const storeyBox = (page: Page) => page.getByRole('combobox', { name: '보일 층' })
const tab = (page: Page, name: '3D' | '평면도') => page.getByRole('group', { name: '보기' }).getByRole('button', { name }).click()

/** 평면도에 그려진 그 층의 설비·방·벽 id. */
async function onStorey(page: Page, label: string) {
  await storeyBox(page).selectOption({ label: `${label}만` })
  await tab(page, '평면도')
  const plan = page.getByRole('img', { name: `${label} 평면도` })
  await expect(plan.locator('.spaces polygon').first()).toBeVisible()
  const ids = (sel: string, attr: string) => plan.locator(sel).evaluateAll((els, a) => els.map((e) => e.getAttribute(a)!), attr)
  return { devices: await ids('.devices circle', 'data-equipment'), spaces: await ids('.spaces polygon', 'data-space'), walls: await ids('.walls polygon', 'data-wall') }
}

test('병원: 한 층만 보면 다른 층 설비·방·벽은 그리지도 고르지도 않는다', async ({ page }) => {
  test.skip(!existsSync(ARCH) || !existsSync(HVAC), '병원 건축·HVAC 이 없다(npm run fetch:sample)')
  test.setTimeout(300_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles([ARCH, HVAC])
  await expect(page.locator('.appbar h2')).toContainText('+', { timeout: 240_000 })

  const first = await onStorey(page, 'First Floor')
  const second = await onStorey(page, 'Second Floor')
  expect(first.devices.length).toBeGreaterThan(100)
  expect(second.devices.length).toBeGreaterThan(100)
  const upstairs = { devices: new Set(second.devices), spaces: new Set(second.spaces), walls: new Set(second.walls) }

  // 모든 층을 볼 때는 2층 설비 자리를 누르면 2층 설비가 골라진다(대조군). 1층만 보면 하나도 안 골라진다.
  const viewer = <T,>(fn: string, ...args: unknown[]) =>
    page.evaluate(([f, a]) => ((window as any).__viewer[f as string] as (...x: unknown[]) => T)(...(a as unknown[])), [fn, args] as const)
  const sample = second.devices.filter((_, i) => i % Math.ceil(second.devices.length / 60) === 0)
  const pickAll = async () => {
    const out: Pick[] = []
    for (const id of sample) {
      const at = await viewer<{ x: number; y: number } | null>('part', id)
      if (at) out.push(await viewer<Pick>('pickAt', at.x, at.y))
    }
    return out
  }
  await tab(page, '3D')
  await storeyBox(page).selectOption({ label: '모든 층' })
  await page.waitForTimeout(300)
  const all = await pickAll()
  expect(all.filter((p) => p.equipment && upstairs.devices.has(p.equipment)).length).toBeGreaterThan(sample.length / 3)

  await storeyBox(page).selectOption({ label: 'First Floor만' })
  await expect.poll(() => viewer<string[]>('visibleStoreys')).toHaveLength(1)
  await page.waitForTimeout(300)
  const one = await pickAll()
  expect(one.length).toBeGreaterThan(sample.length / 2)
  expect(one.filter((p) => p.equipment && upstairs.devices.has(p.equipment))).toEqual([])
  expect(one.filter((p) => p.space && upstairs.spaces.has(p.space))).toEqual([])
  // 1층 것은 골라진다 — 아무것도 안 골라서 통과하는 것이 아니다.
  const own = new Set(first.devices)
  const ownPicked = []
  for (const id of first.devices.slice(0, 60)) {
    const at = await viewer<{ x: number; y: number } | null>('part', id)
    const p = at ? await viewer<Pick>('pickAt', at.x, at.y) : null
    if (p?.equipment && own.has(p.equipment)) ownPicked.push(id)
  }
  expect(ownPicked.length).toBeGreaterThan(30)

  // 편집 모드의 [벽·문·창] 도 같다. 2층 벽 자리를 눌러도 2층 벽은 안 골라지고, 1층 벽은 골라진다.
  await page.getByRole('button', { name: '편집', exact: true }).click()
  await page.getByRole('button', { name: '벽·문·창' }).click()
  await expect.poll(async () => (await viewer<string[]>('elements')).length).toBeGreaterThan(0)
  const pickWalls = async (ids: string[]) => {
    const out: string[] = []
    for (const id of ids.filter((_, i) => i % Math.ceil(ids.length / 60) === 0)) {
      const at = await viewer<{ x: number; y: number } | null>('element', id)
      const p = at ? await viewer<Pick>('pickAt', at.x, at.y) : null
      if (p?.element) out.push(p.element)
    }
    return out
  }
  const upWalls = await pickWalls(second.walls)
  expect(upWalls.length).toBeGreaterThan(20)
  expect(upWalls.filter((id) => upstairs.walls.has(id))).toEqual([])
  expect((await pickWalls(first.walls)).filter((id) => first.walls.includes(id)).length).toBeGreaterThan(30)
  expect(errors).toEqual([])
})

// 다른 층 끝으로 가는 연결 화살표. 연결의 29%(병원 MEP 13608 중 3992)가 층을 넘는다(덕트·배관이 낀 연결). 한 층만 볼 때 화살표를
// 그리면 안 보이는 곳을 가리켰다. 그리지 않고, 패널의 연결 표에 "다른 층" 으로 남긴다.
const DUPLEX_MEP = 'data/NBU_Duplex/NBU_Duplex-Apt_Eng-MEP.ifc'
// Level 2 라디에이터. 배관 둘에 붙었고 하나는 Level 1 소속이다.
const RADIATOR = 'M_Radiator - Hosted:Readiator - 25:Readiator - 25:538562'

test('Duplex MEP: 한 층만 보면 다른 층 끝으로 가는 화살표는 그리지 않고, 패널에 다른 층이라고 적는다', async ({ page }) => {
  test.skip(!existsSync(DUPLEX_MEP), `${DUPLEX_MEP} 이 없다(npm run fetch:sample)`)
  test.setTimeout(120_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(DUPLEX_MEP)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 90_000 })
  await page.getByRole('button', { name: '편집', exact: true }).click()
  await page.locator('input[type=search]').fill('538562')
  await page.locator('.equipment tbody tr', { hasText: RADIATOR }).last().getByRole('button', { name: RADIATOR, exact: true }).click()
  const arrows = () => page.evaluate(() => ((window as any).__viewer.arrows() as unknown[]).length)
  const rows = page.locator('.picked table.neighbors tr')
  await expect(rows).toHaveCount(2)

  // 모든 층: 화살표 둘, "다른 층" 없음. 파일을 열면 한 층만 보이므로(OE-UI-12) 모든 층으로 바꾼다.
  await storeyBox(page).selectOption({ label: '모든 층' })
  await expect.poll(arrows).toBe(2)
  await expect(page.locator('.picked .other-floor')).toHaveCount(0)
  // Level 2 만: Level 1 배관으로 가는 화살표는 없고, 그 줄에 다른 층이라고 적는다. 방향 단추는 그대로 있다.
  await storeyBox(page).selectOption({ label: 'Level 2만' })
  await expect.poll(arrows).toBe(1)
  await expect(page.locator('.picked .other-floor')).toHaveCount(1)
  await expect(page.locator('.picked .other-floor')).toContainText('Level 1')
  await expect(rows.filter({ has: page.locator('.other-floor') }).locator('.flow-edit')).toHaveCount(1)
  if (process.env.SHOT) await page.screenshot({ path: process.env.SHOT })
  // 다시 모든 층이면 둘 다.
  await storeyBox(page).selectOption({ label: '모든 층' })
  await expect.poll(arrows).toBe(2)
  await expect(page.locator('.picked .other-floor')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('파일을 열면 방이 있는 가장 낮은 층만 보이고, 방이 없으면 설비가 놓인 가장 낮은 층이다', async ({ page }) => {
  // 기초 층(T/FDN · TOF Footing)은 방도 설비도 없다. 처음부터 그 층을 열면 빈 화면이다.
  const cases: [string, string][] = [
    ['data/NBU_Duplex/NBU_Duplex-Apt_Arch.ifc', 'Level 1만'],
    ['data/NBU_MedicalClinic/NBU_MedicalClinic_Arch.ifc', 'First Floor만'],
    // ifc4Mep 은 방이 없다. 설비가 놓인 가장 낮은 층이다(기초 -01. Fundering 을 건너뛴다).
    ['data/ifc4Mep_IFC4.ifc', '00. Begane grond만'],
  ]
  test.skip(!cases.every(([f]) => existsSync(f)), '샘플 BIM 이 없다(npm run fetch:sample)')
  test.setTimeout(180_000)
  for (const [file, label] of cases) {
    await page.goto('/')
    await page.locator('.drop input[type=file]').setInputFiles(file)
    await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 120_000 })
    const checked = storeyBox(page).locator('option:checked')
    await expect(checked).toHaveText(label)
    await expect.poll(() => page.evaluate(() => ((window as any).__viewer.visibleStoreys() as string[]).length)).toBeLessThanOrEqual(1)
    if (process.env.SHOT && label === 'Level 1만') await page.screenshot({ path: process.env.SHOT })
  }
})
