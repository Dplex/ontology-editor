import { expect, test, type Page } from '@playwright/test'
import { enterEdit, idByName } from './edit-part'
import { readFileSync } from 'node:fs'

// 말로 편집 시키기(ADR-0060). [온톨로지] 칸의 gemini 가 답 끝에 붙인 ```oe-edit 계획을 창이 미리 보이고, [적용] 을 누르면 편집 화면이
// 여느 편집과 같은 함수로 실행한다. 창(scripts/docs-chat.js)은 8084 빌드에만 끼워 넣어서 dev 화면에 직접 끼우고, gemini 의 답은
// page.route 로 흉내 낸다. 대상 id 는 픽스처(mep.ifc)의 것을 TTL 처럼 ex: 로 적는다.
const MEP = 'src/lib/ifc/fixtures/mep.ifc'
const OFFICE = 'ex:0MEP\\$Space\\$Office\\$0000'
const AT1 = 'ex:0MEP\\$Equip\\$AT01\\$0000'

async function open(page: Page, answer: string) {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.route('**/__ask', async (r) => {
    if (r.request().method() === 'GET') return r.fulfill({ json: { enabled: true, sources: [] } })
    await r.fulfill({ contentType: 'application/x-ndjson', body: `${JSON.stringify({ type: 'text', text: answer })}\n${JSON.stringify({ type: 'done', ms: 5 })}\n` })
  })
  await page.route('**/__ask/screen**', (r) => r.fulfill({ json: { source: 'screen-x', bytes: 1 } }))
  await page.goto('/')
  await page.addScriptTag({ content: readFileSync('scripts/docs-chat.js', 'utf8') })
  await page.locator('.drop input[type=file]').setInputFiles(MEP)
  await expect(page.locator('.appbar h2')).toBeVisible({ timeout: 30_000 })
  return errors
}

async function ask(page: Page, q: string) {
  await page.keyboard.press('Alt+Shift+K')
  const chat = page.locator('#docs-chat')
  await chat.getByRole('button', { name: '온톨로지' }).click()
  await chat.locator('textarea').fill(q)
  await chat.locator('textarea').press('Enter')
  return chat
}

const plan = (cmds: unknown[]) => `사무실에 공조기를 더하고 AT-101-01 과 잇겠습니다.\n\n\`\`\`oe-edit\n${JSON.stringify(cmds)}\n\`\`\``

test('"사무실에 공조기 놓고 AT-101-01 과 연결해줘" — 계획을 미리 보이고 [적용] 하면 더하고 잇는다, Ctrl+Z 두 번이면 돌아온다', async ({ page }) => {
  const errors = await open(page, plan([
    { do: 'add_equipment', space: OFFICE, kind: 'ahu', name: '공조기-9' },
    { do: 'connect', from: '공조기-9', to: AT1 },
  ]))
  await enterEdit(page)
  const chat = await ask(page, '사무실에 공조기 놓고 AT-101-01 과 연결해줘')
  const box = chat.locator('.plan')
  await expect(box).toContainText('사무실에 공조기 "공조기-9" 더하기')
  await expect(box).toContainText('공조기-9(새로 더할 설비) – AT-101-01 연결')
  // 계획 블록(JSON)은 글로 보이지 않는다
  await expect(chat.locator('.msg.bot').last()).not.toContainText('"do"')
  await box.getByRole('button', { name: '적용' }).click()
  await expect(box).toContainText('✔ 1F 사무실에 공조기-9를 더했습니다')
  await expect(box).toContainText('✔ 공조기-9–AT-101-01을 연결했습니다')
  await expect(box.getByRole('button', { name: '적용' })).toBeDisabled()
  await chat.screenshot({ path: 'test-results/edit-commands.png' })

  await chat.getByRole('button', { name: '✕' }).click()
  // 더한 설비가 모델에 있다(화면 모델의 TTL 로 본다 — 설비 표는 #715 에서 빠졌다).
  await expect.poll(() => idByName(page, '공조기-9')).not.toBeNull()
  await expect(page.getByTestId('changes-link')).toContainText('바뀐 것 2건')
  await page.locator('body').click({ position: { x: 5, y: 5 } })
  await page.keyboard.press('Control+z')
  await page.keyboard.press('Control+z')
  await expect.poll(() => idByName(page, '공조기-9')).toBeNull()
  await expect(page.getByTestId('changes-link')).toContainText('바뀐 것 0건')
  expect(errors).toEqual([])
})

test('편집 모드가 아니면 적용하지 않고 [편집] 을 누르라고 한다 — 편집에 들어가 다시 누르면 된다', async ({ page }) => {
  const errors = await open(page, plan([{ do: 'add_equipment', space: OFFICE, kind: 'ahu', name: '공조기-9' }]))
  const chat = await ask(page, '사무실에 공조기 놓아줘')
  const box = chat.locator('.plan')
  await expect(box).toContainText('[편집] 을 누른 뒤 적용합니다')
  await box.getByRole('button', { name: '적용' }).click()
  await expect(box).toContainText('편집 모드에서 적용합니다')
  await expect(box.getByRole('button', { name: '적용' })).toBeEnabled()
  await chat.getByRole('button', { name: '✕' }).click()
  await enterEdit(page)
  await page.keyboard.press('Alt+Shift+K')
  await box.getByRole('button', { name: '적용' }).click()
  await expect(box).toContainText('✔ 1F 사무실에 공조기-9를 더했습니다')
  expect(errors).toEqual([])
})

test('못 찾은 대상이 있으면 [적용] 이 막히고, 틀린 계획은 까닭을 보인다', async ({ page }) => {
  const errors = await open(page, plan([{ do: 'connect', from: 'AHU-1', to: 'VAV3' }]))
  await enterEdit(page)
  const chat = await ask(page, 'AHU-1 이랑 VAV3 연결해줘')
  const box = chat.locator('.plan')
  await expect(box).toContainText('설비 "VAV3" 을 지금 화면에서 찾지 못했습니다')
  await expect(box.getByRole('button', { name: '적용' })).toBeDisabled()
  expect(errors).toEqual([])
})

test('[문서] 칸의 서버 확인이 늦게 실패해도 이미 바꾼 [온톨로지] 칸의 입력을 잠그지 않는다', async ({ page }) => {
  const errors = await open(page, plan([]))
  // 창은 처음에 [문서] 칸(/__chat)을 확인한다. 그 실패가 [온톨로지] 로 바꾼 뒤에 닿게 늦춘다 — 느린 실행에서 생기던 순서다.
  await page.route('**/__chat', async (r) => {
    await new Promise((done) => setTimeout(done, 600))
    await r.fulfill({ status: 500, body: 'no' })
  })
  const docsCheck = page.waitForResponse('**/__chat')
  await page.keyboard.press('Alt+Shift+K')
  const chat = page.locator('#docs-chat')
  await chat.getByRole('button', { name: '온톨로지' }).click()
  await docsCheck
  // 응답을 받은 다음 실패 처리(.catch)가 돌 틈을 준다.
  await page.waitForTimeout(300)
  await expect(chat.locator('textarea')).toBeEnabled()
  await expect(chat).not.toContainText('/__chat 이 없다')
  expect(errors).toEqual([])
})
