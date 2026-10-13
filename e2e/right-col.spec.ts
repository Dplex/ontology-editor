import { existsSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'

// 3D 오른쪽 위 세로 줄(.right-col). 시점 막대·벽 범례·방향 큐브·층별 칩이 서로 덮지 않는다. 따로 absolute 로 두었을 때는
// 1280 폭에서 막대가 두 줄로 꺾여 [전체 화면] 이 큐브·범례를 덮었고, 성수(층 19개)는 층별 칩이 큐브 위로 올라왔다.
const DUPLEX = 'data/NBU_Duplex/NBU_Duplex-Apt_Arch.ifc'
const SEONGSU = 'data/성수/Factorial_건축.ifc'
const PARTS = ['.view-tools', '.wall-key', '.nav-cube', '.storey-chips']

async function overlaps(page: Page) {
  const boxes = await Promise.all(PARTS.map((s) => page.locator(s).boundingBox()))
  const hits: string[] = []
  for (let i = 0; i < PARTS.length; i++)
    for (let j = i + 1; j < PARTS.length; j++) {
      const a = boxes[i]!, b = boxes[j]!
      if (a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height) hits.push(`${PARTS[i]} × ${PARTS[j]}`)
    }
  return hits
}

for (const [name, path, w, h] of [
  ['Duplex 건축 1280×720(막대가 두 줄)', DUPLEX, 1280, 720],
  ['성수 건축 1500×900(층 19개)', SEONGSU, 1500, 900],
] as const) {
  test(`${name}: 시점 막대·벽 범례·방향 큐브·층별 칩이 서로 덮지 않는다`, async ({ page }) => {
    test.skip(!existsSync(path), `${path} 이 없다`)
    test.setTimeout(180_000)
    await page.setViewportSize({ width: w, height: h })
    await page.goto('/')
    await page.locator('.drop input[type=file]').setInputFiles(path)
    await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 150_000 })
    for (const s of PARTS) await expect(page.locator(s)).toBeVisible()
    expect(await overlaps(page)).toEqual([])
    // 층별 칩은 3D 칸 안에 들어간다(넘치면 칸 안에서 굴린다).
    const v = (await page.locator('.viewport').boundingBox())!
    const c = (await page.locator('.storey-chips').boundingBox())!
    expect(c.y + c.height).toBeLessThanOrEqual(v.y + v.height)
    await page.locator('.viewport').screenshot({ path: test.info().outputPath('right-col.png') })
  })
}
