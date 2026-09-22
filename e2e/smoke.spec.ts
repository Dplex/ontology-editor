import { expect, test } from '@playwright/test'

// 파일 선택은 실제 파일 없이 setInputFiles 의 buffer 형태로 넣는다. 픽스처 파일을 저장소에
// 두지 않아도 되고, 어떤 입력이 어떤 화면을 만드는지가 테스트 안에서 한눈에 보인다.
const TTL = `@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .
@prefix bldg: <https://ieum.example/building#> .

bldg:Room-101 rdf:type bldg:Room .
`

test('처음 열면 파일을 받을 자리만 보인다', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'ontology-editor' })).toBeVisible()
  await expect(page.getByText('.ttl 파일을 여기에 끌어다 놓으세요.')).toBeVisible()
})

test('ttl 을 열면 접두사 표가 나온다', async ({ page }) => {
  await page.goto('/')

  await page.locator('input[type=file]').setInputFiles({
    name: 'sample.ttl',
    mimeType: 'text/turtle',
    buffer: Buffer.from(TTL, 'utf-8'),
  })

  await expect(page.getByRole('heading', { name: 'sample.ttl' })).toBeVisible()
  await expect(page.getByText('접두사 2개')).toBeVisible()
  await expect(page.getByText('https://ieum.example/building#')).toBeVisible()
})
