import { existsSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'

// 평면도 탭. 층 하나를 위에서 그리고, 편집 모드에서 방 꼭짓점을 끌면 3D 에서 놓는 것과 같은 길(dropVertex)로 경계를 고친다.
const FIXTURE = 'src/lib/ifc/fixtures/two-rooms.ifc'

test('평면도 탭은 고른 층을 위에서 그리고, 편집 모드에서 꼭짓점을 끌면 넓이가 바뀐다', async ({ page }) => {
  await page.goto('/')
  await page.locator('input[type=file]').first().setInputFiles(FIXTURE)
  await expect(page.getByRole('heading', { name: 'two-rooms.ifc' })).toBeVisible({ timeout: 30_000 })

  // 파일을 열면 방이 있는 가장 낮은 층(1F)만 보인다(OE-UI-12). 평면도도 바로 그 층을 그린다.
  await expect(page.getByRole('combobox', { name: '보일 층' }).locator('option:checked')).toHaveText('1F만')
  await page.getByRole('group', { name: '보기' }).getByRole('button', { name: '평면도' }).click()
  const plan = page.getByRole('img', { name: '1F 평면도' })
  await expect(plan).toBeVisible()
  // "모든 층" 이면 평면도는 그리지 않고 층을 고르라고 한다.
  await page.getByRole('combobox', { name: '보일 층' }).selectOption({ label: '모든 층' })
  await expect(page.locator('.plan-empty')).toBeVisible()
  await page.getByRole('combobox', { name: '보일 층' }).selectOption({ label: '1F만' })
  await expect(plan).toBeVisible()
  const rooms = plan.locator('.spaces polygon')
  expect(await rooms.count()).toBeGreaterThan(0)

  // 보기 모드에서는 방을 골라도 손잡이가 없다. 대신 오른쪽 패널에 그 방이 뜬다(고치는 칸과 안내는 없다).
  await rooms.first().click()
  await expect(plan.locator('.handle')).toHaveCount(0)
  await expect(page.locator('.space-picked')).toBeVisible()
  await expect(page.locator('.space-picked .hint')).toHaveCount(0)

  await page.getByRole('button', { name: '편집', exact: true }).click()
  await expect(plan.locator('.handle').first()).toBeVisible()
  const handle = plan.locator('.handle').nth(1)
  // 가운데로 스크롤한다. 위쪽에 붙으면 편집 막대(sticky)가 손잡이를 덮는다.
  await handle.evaluate((el) => el.scrollIntoView({ block: 'center' }))
  const box = (await handle.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2, { steps: 5 })
  await page.mouse.up()

  // 넓이가 바뀐 것이 리포트에 남는다.
  await expect(page.locator('.report')).toContainText('㎡ →')

  // 탭을 바꿔도 고른 층은 그대로다.
  await page.getByRole('group', { name: '보기' }).getByRole('button', { name: '3D' }).click()
  await expect(page.getByRole('combobox', { name: '보일 층' })).not.toHaveValue('')
})

test('평면도를 보는 동안 한 편집이 바로 그려지고, 층을 옮긴 설비를 따라 층이 바뀐다', async ({ page }) => {
  // 편집은 모델을 그 자리에서 고친다. 같은 층 객체를 넘기면 평면도가 다시 그리지 않아, 방향키로 옮긴 설비의 점이
  // 예전 자리에 남았고(성수에서 찾았다), PageUp 으로 위층에 옮긴 설비는 화면에서 사라졌다.
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(['src/lib/ifc/fixtures/mep.ifc', FIXTURE])
  await expect(page.locator('.appbar h2')).toHaveText('two-rooms.ifc + mep.ifc', { timeout: 30_000 })
  await page.getByRole('button', { name: '편집', exact: true }).click()
  await page.locator('.equipment tbody tr', { hasText: 'AHU-1' }).getByRole('button', { name: 'AHU-1', exact: true }).click()
  await page.getByRole('combobox', { name: '보일 층' }).selectOption({ label: '1F만' })
  await page.getByRole('group', { name: '보기' }).getByRole('button', { name: '평면도' }).click()
  const dot = page.locator('svg.floor-plan circle.chosen')
  const cx = async () => Number(await dot.getAttribute('cx'))
  const cy = async () => Number(await dot.getAttribute('cy'))
  const [x0, y0] = [await cx(), await cy()]
  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('Shift+ArrowRight')
  await expect.poll(async () => Math.hypot((await cx()) - x0, (await cy()) - y0)).toBeCloseTo(1, 1)

  await page.keyboard.press('PageUp')
  await expect(page.getByRole('combobox', { name: '보일 층' }).locator('option:checked')).toHaveText('2F만')
  await expect(page.getByRole('img', { name: '2F 평면도' }).locator('circle.chosen')).toHaveCount(1)
})

test('설비를 고른 채 평면도의 방을 누르면 패널이 그 방으로 바뀐다', async ({ page }) => {
  // 평면도가 고른 방을 제 안에만 들고 있어서, 방에 테두리만 뜨고 패널은 앞서 고른 설비 그대로였다(성수에서 찾았다).
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(['src/lib/ifc/fixtures/mep.ifc', FIXTURE])
  await expect(page.locator('.appbar h2')).toHaveText('two-rooms.ifc + mep.ifc', { timeout: 30_000 })
  await page.locator('.equipment tbody tr', { hasText: 'AHU-1' }).getByRole('button', { name: 'AHU-1', exact: true }).click()
  await expect(page.locator('.picked h3')).toHaveText('AHU-1')
  await page.getByRole('combobox', { name: '보일 층' }).selectOption({ label: '1F만' })
  await page.getByRole('group', { name: '보기' }).getByRole('button', { name: '평면도' }).click()
  const room = page.getByRole('img', { name: '1F 평면도' }).locator('.spaces polygon').first()
  await room.click({ force: true })
  await expect(page.locator('.space-picked')).toBeVisible()
  await expect(page.locator('svg.floor-plan circle.chosen')).toHaveCount(0)
  // 3D 로 돌아가도 같은 방이 골라져 있다.
  await page.getByRole('group', { name: '보기' }).getByRole('button', { name: '3D' }).click()
  await expect(page.locator('.space-picked')).toBeVisible()
})

// --- 실제 BIM (OE-UI-11) ---------------------------------------------------------------
// 손으로 쓴 fixture 는 방 둘이라 이름표가 겹치거나 설비가 다른 층에 있는 경우가 없다. 병원 건축(1층 방 154·벽 656)과
// Duplex 건축(기초 층 벽 7개가 전부 내력벽)으로 평면도 선택이 오른쪽 패널과 양쪽으로 맞는지 본다. 파일이 없으면 건너뛴다.
const CLINIC = 'data/NBU_MedicalClinic/NBU_MedicalClinic_Arch.ifc'
const DUPLEX = 'data/NBU_Duplex/NBU_Duplex-Apt_Arch.ifc'
const storeyBox = (page: Page) => page.getByRole('combobox', { name: '보일 층' })
const tab = (page: Page, name: '3D' | '평면도') => page.getByRole('group', { name: '보기' }).getByRole('button', { name }).click()

test('병원 건축: 평면도에서 고른 방·설비가 패널에 뜨고, 패널·목록에서 고른 것이 평면도에 뜬다', async ({ page }) => {
  test.skip(!existsSync(CLINIC), `${CLINIC} 이 없다(npm run fetch:sample)`)
  test.setTimeout(180_000)
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(CLINIC)
  await expect(page.locator('.appbar h2')).toHaveText('NBU_MedicalClinic_Arch.ifc', { timeout: 120_000 })
  await storeyBox(page).selectOption({ label: 'Second Floor만' })
  await tab(page, '평면도')
  const plan2 = page.getByRole('img', { name: 'Second Floor 평면도' })
  await expect(plan2.locator('.spaces polygon')).toHaveCount(106)

  // 2층 설비 하나를 평면도에서 누르면 패널이 그 설비다. 점의 이름표(title)와 패널 제목이 같다.
  const dot = plan2.locator('.devices circle').first()
  const device = (await dot.locator('title').textContent())!.trim()
  const deviceId = (await dot.getAttribute('data-equipment'))!
  await dot.click({ force: true })
  await expect(page.locator('.picked h3').first()).toHaveText(device)
  await expect(plan2.locator('circle.chosen')).toHaveAttribute('data-equipment', deviceId)

  // 1층으로 간다. 고른 설비가 다른 층이라 평면도에는 골라진 점이 없다.
  await storeyBox(page).selectOption({ label: 'First Floor만' })
  const plan = page.getByRole('img', { name: 'First Floor 평면도' })
  await expect(plan.locator('.spaces polygon')).toHaveCount(154)
  expect(await plan.locator('.walls polygon').count()).toBeGreaterThanOrEqual(656)
  await expect(plan.locator('circle.chosen')).toHaveCount(0)
  // 전체를 보면 작은 방 이름은 겹치니 빼고 그린다. 확대하면 들어가는 만큼 더 뜬다.
  const labelsAll = await plan.locator('.labels text').count()
  expect(labelsAll).toBeGreaterThan(0)
  expect(labelsAll).toBeLessThan(154)
  const box = (await plan.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  for (let i = 0; i < 8; i++) await page.mouse.wheel(0, -100)
  await expect.poll(() => plan.locator('.labels text').count()).not.toBe(labelsAll)

  // 방을 누르면 패널이 그 방이고, 고른 방 이름은 작아도 늘 그린다.
  await tab(page, '3D')
  await tab(page, '평면도')
  const room = plan.locator('.spaces polygon').nth(40)
  const roomId = (await room.getAttribute('data-space'))!
  await room.click({ force: true })
  const roomName = (await page.locator('.space-picked h3').textContent())!.trim()
  await expect(plan.locator('.spaces polygon.chosen')).toHaveAttribute('data-space', roomId)
  await expect(plan.locator('.labels text', { hasText: roomName })).not.toHaveCount(0)
  // 같은 방을 다시 누르면 풀리고 패널도 닫힌다.
  await room.click({ force: true })
  await expect(page.locator('.space-picked')).toHaveCount(0)
  await expect(plan.locator('.spaces polygon.chosen')).toHaveCount(0)
  // 패널의 [선택 해제] 도 평면도에서 푼다.
  await room.click({ force: true })
  await page.locator('.space-picked').getByRole('button', { name: '선택 해제' }).click()
  await expect(plan.locator('.spaces polygon.chosen')).toHaveCount(0)

  // 목록에서 2층 설비를 고르면 평면도가 2층으로 바뀌고 그 점이 골라진다.
  await page.locator('input[type=search]').fill(device)
  await page.locator('.equipment tbody tr', { hasText: device }).first().getByRole('button', { name: device, exact: true }).click()
  await expect(storeyBox(page).locator('option:checked')).toHaveText('Second Floor만')
  await expect(plan2.locator('circle.chosen')).toHaveAttribute('data-equipment', deviceId)
  expect(errors).toEqual([])
})

/** 칠한 색이 바탕과 얼마나 다른가(WCAG 대비). 투명도는 바탕과 섞어서 잰다. */
async function contrast(page: Page, selector: string): Promise<number> {
  return page.locator(selector).first().evaluate((el) => {
    const rgb = (c: string) => c.match(/[\d.]+/g)!.slice(0, 3).map(Number)
    const st = getComputedStyle(el)
    const a = Number(st.opacity) * Number(st.fillOpacity || 1)
    const bg = rgb(getComputedStyle(el.closest('svg')!).backgroundColor)
    const fill = rgb(st.fill).map((v, i) => v * a + bg[i] * (1 - a))
    const lum = (c: number[]) => {
      const [r, g, b] = c.map((v) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4))
      return 0.2126 * r + 0.7152 * g + 0.0722 * b
    }
    const [x, y] = [lum(fill), lum(bg)].sort((p, q) => q - p)
    return (x + 0.05) / (y + 0.05)
  })
}

test('Duplex 건축: 내력벽은 밝은·어두운 테마 모두 보통 벽보다 진하고, [벽·문·창] 을 켜면 평면도에서 벽을 고른다', async ({ page }) => {
  test.skip(!existsSync(DUPLEX), `${DUPLEX} 이 없다(npm run fetch:sample)`)
  test.setTimeout(120_000)
  await page.goto('/')
  await page.locator('.drop input[type=file]').setInputFiles(DUPLEX)
  await expect(page.locator('.appbar h2')).toHaveText('NBU_Duplex-Apt_Arch.ifc', { timeout: 90_000 })
  const fdn = page.getByRole('img', { name: 'T/FDN 평면도' })
  const plan = page.getByRole('img', { name: 'Level 1 평면도' })
  const measure = async () => {
    await storeyBox(page).selectOption({ label: 'T/FDN만' })
    await expect(fdn.locator('.walls polygon.bearing').first()).toBeVisible()
    expect(await fdn.locator('.walls polygon:not(.bearing)').count()).toBe(0)
    const bearing = await contrast(page, 'svg.floor-plan .walls polygon.bearing')
    await storeyBox(page).selectOption({ label: 'Level 1만' })
    await expect(plan.locator('.walls polygon').first()).toBeVisible()
    expect(await plan.locator('.walls polygon.bearing').count()).toBe(0)
    return { bearing, plain: await contrast(page, 'svg.floor-plan .walls polygon') }
  }
  // 기초 층(T/FDN)은 벽 7개가 전부 내력벽이고, 1층은 하나도 없다.
  await storeyBox(page).selectOption({ label: 'T/FDN만' })
  await tab(page, '평면도')
  const light = await measure()
  await page.locator('button.theme').first().click()
  const dark = await measure()
  await page.locator('button.theme').first().click()
  // 다크에서 어두운 회색으로 칠했을 때는 내력벽 대비가 보통 벽보다 낮았다.
  expect(light.bearing).toBeGreaterThan(light.plain * 1.5)
  expect(dark.bearing).toBeGreaterThan(dark.plain * 1.5)

  // 보기 모드에서는 벽을 눌러도 고르지 않는다(3D 와 같다). 편집 모드에서 [벽·문·창] 을 켜면 고르고 패널에 뜬다.
  // 편집 도구 줄은 3D 에만 있어서 3D 에서 켜고 평면도로 온다 — 켠 것은 탭을 바꿔도 그대로다.
  const wall = plan.locator('.walls polygon').nth(3)
  const wallId = (await wall.getAttribute('data-wall'))!
  await wall.click({ force: true })
  await expect(page.locator('.element-picked')).toHaveCount(0)
  await tab(page, '3D')
  await page.getByRole('button', { name: '편집', exact: true }).click()
  // 편집 모드여도 [벽·문·창] 을 켜기 전에는 고르지 않는다.
  await tab(page, '평면도')
  await wall.click({ force: true })
  await expect(page.locator('.element-picked')).toHaveCount(0)
  await tab(page, '3D')
  await page.getByRole('button', { name: '벽·문·창' }).click()
  await tab(page, '평면도')
  await wall.click({ force: true })
  await expect(page.locator('.element-picked')).toBeVisible()
  await expect(plan.locator('.walls polygon.chosen').first()).toHaveAttribute('data-wall', wallId)
  if (process.env.SHOT) await page.locator('.viewport').screenshot({ path: `${process.env.SHOT}-wall.png` })
  // 고른 벽을 방향키로 옮기면 평면도의 벽이 따라 그려진다. 이 벽은 외벽이라 층 편집에서 옮기지 않으므로(OE-EXT-02) 내벽으로 풀고 옮긴다.
  const external = page.locator('.element-picked').getByTestId('wall-external-select')
  if ((await external.inputValue()) === 'true') await external.selectOption('false')
  const drawn = plan.locator(`.walls polygon[data-wall="${wallId}"]`).first()
  const before = (await drawn.getAttribute('points'))!
  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('ArrowRight')
  await expect(drawn).not.toHaveAttribute('points', before)
  // 3D 로 갔다 와도 같은 벽이 골라져 있다.
  await tab(page, '3D')
  await expect(page.locator('.element-picked')).toBeVisible()
  await tab(page, '평면도')
  await expect(plan.locator('.walls polygon.chosen').first()).toHaveAttribute('data-wall', wallId)
  // 방을 누르면 벽은 풀린다(패널은 하나만).
  await plan.locator('.spaces polygon').first().click({ force: true })
  await expect(page.locator('.element-picked')).toHaveCount(0)
  await expect(plan.locator('.walls polygon.chosen')).toHaveCount(0)
})
