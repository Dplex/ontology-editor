import { test, expect } from '@playwright/test'

// 온톨로지 결과물 형태 — OE-GEN-01·06, OE-INT-02·03
test('output: artifact kinds, provenance table, TTL has no coordinates, OBJ/GLB download', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  await page.goto('/')
  await page.getByRole('button', { name: /검증 & 리포트/ }).click()
  await expect(page.getByTestId('output-panel')).toBeVisible()
  await expect(page.getByTestId('ttl-state')).toContainText('아직 만들지 않음')
  await page.getByRole('button', { name: '결과물 미리 만들기' }).click()
  await expect(page.getByTestId('ttl-state')).toContainText('좌표 리터럴 없음')
  await expect(page.getByTestId('geo-state')).toContainText('Feature')
  await expect(page.getByTestId('provenance')).toContainText('물리존(IfcSpace)')
  const [obj] = await Promise.all([page.waitForEvent('download'), page.getByTestId('make-obj').click()])
  expect(obj.suggestedFilename()).toMatch(/\.obj$/)
  const [glb] = await Promise.all([page.waitForEvent('download'), page.getByTestId('make-glb').click()])
  expect(glb.suggestedFilename()).toMatch(/\.glb$/)
  await page.getByText('온톨로지에서 BIM 을 다시 만들 수 있나').click()
  await expect(page.getByTestId('reverse')).toContainText('벽 두께')
  await page.screenshot({ path: '.local/proto-output.png', fullPage: true })
  expect(errors).toEqual([])
})
