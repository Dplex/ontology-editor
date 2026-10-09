import { expect, test, type Page } from '@playwright/test'
import { readFileSync } from 'node:fs'

// 임포트 결과와 보정 내용이 닫았다 다시 열어도 그대로다(OE-WF-06). 임포트 결과는 같은 IFC 를 다시 읽으면 같은 것이 나오고(임포터는 같은
// 입력에 같은 출력), 보정 내용은 층별 임시 저장본에 남는다(ADR-0014). 그래서 탭을 닫고 같은 파일을 다시 열어 [이어서 하기] 를 누르면,
// 내보낸 TTL·GeoJSON 이 닫기 전과 같아야 한다.
const MEP = 'src/lib/ifc/fixtures/mep.ifc'

async function open(page: Page) {
  await page.goto('/')
  await page.locator('input[type=file]').first().setInputFiles(MEP)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
}
/** 단추 하나를 눌러 내려받은 파일들을 이름 → 글자로. */
async function exportAll(page: Page, out: (name: string) => string): Promise<Record<string, string>> {
  const files: Record<string, string> = {}
  const saved: Promise<void>[] = []
  const on = (d: import('@playwright/test').Download) => {
    const path = out(`${Date.now()}-${d.suggestedFilename()}`)
    saved.push(d.saveAs(path).then(() => void (files[d.suggestedFilename()] = readFileSync(path, 'utf8'))))
  }
  page.on('download', on)
  await page.getByRole('button', { name: '의미 내보내기 (Brick TTL)' }).click()
  await page.getByRole('button', { name: '기하 내보내기 (GeoJSON)' }).click()
  await expect.poll(() => saved.length).toBeGreaterThanOrEqual(2)
  await page.waitForTimeout(300)
  await Promise.all(saved)
  page.off('download', on)
  return files
}

test('임포트 뒤 보정하고 탭을 닫았다가 같은 파일을 다시 열어 이어서 하면, 내보내는 TTL·GeoJSON 이 닫기 전과 같다 [OE-WF-06#1]', async ({ context }, info) => {
  await context.addInitScript(() => {
    delete (window as any).showDirectoryPicker
  })
  const first = await context.newPage()
  await open(first)
  await first.getByRole('button', { name: '편집', exact: true }).click()
  // 보정 셋: 설비 옮기기(소속이 바뀐다), 물리존 이름(방 종류가 따라 바뀐다), 방 종류 직접 정하기.
  const x = first.locator('.equipment tbody tr', { hasText: 'AHU-1' }).locator('.coord').first()
  await x.fill('50')
  await x.press('Enter')
  const name = first.getByLabel('101 이름')
  await name.fill('대회의실')
  await name.press('Enter')
  await first.getByLabel('101 종류').selectOption({ label: '창고' })
  await expect(first.locator('.edit-bar')).toContainText('바뀐 것')
  const before = await exportAll(first, (n) => info.outputPath(`before-${n}`))
  // 자동 저장은 편집이 멈추고 잠시 뒤에 한다.
  await first.waitForTimeout(1000)
  await first.close()

  const second = await context.newPage()
  await open(second)
  const bar = second.locator('.draft-bar')
  await bar.getByRole('button', { name: '이어서 하기' }).click()
  await expect(bar).toHaveCount(0)
  const after = await exportAll(second, (n) => info.outputPath(`after-${n}`))

  expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort())
  for (const file of Object.keys(before)) expect(after[file], file).toBe(before[file])
  // 보정이 실제로 들어 있다(같은 것이 "아무것도 안 남은 것" 이 아니다).
  expect(before['ontology.ttl']).toContain('rdfs:label "대회의실"')
  expect(before['ontology.ttl']).toContain('a brick:Storage_Room')
})
