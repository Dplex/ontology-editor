import { test, expect } from '@playwright/test'

// 에디터 뼈대(와이어프레임 v0.2 ⑥) — 헤더·안내 바·도구 레일·레이어·뷰 컨트롤·우측 탭·상태줄.
// OE-UI-04(액션바·팔레트·패널), OE-WF-02·04(임시 저장본 안내·폐기), 제안 OE-UI-18·21·22(상태줄·우클릭·변경 표시)
test('editor shell: ops action bar, draft bar, change tag, discard, status bar', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  await page.goto('/')
  await page.locator('.floor-card').first().getByRole('button', { name: '운영 편집 →' }).click()
  // 운영 편집 액션바 — [임시 저장]·[미리보기]·[반영하기]·[편집 종료], 위치는 사이트 › 건물 › 층(OE-UI-04 AC1·AC14)
  for (const n of ['임시 저장', '미리보기', '반영하기', '편집 종료']) await expect(page.locator('.ed-head').getByRole('button', { name: n, exact: true })).toBeVisible()
  await expect(page.locator('.ed-crumb')).toContainText('›')
  await expect(page.getByTestId('mode-badge')).toHaveText('운영 편집')
  // 공간 편집 팔레트에는 공간 도구, 설비 편집으로 바꾸면 설비 도구(OE-UI-04 AC3). 아직 없는 도구는 비활성 + 이유
  const rail = page.getByRole('navigation', { name: '편집 도구' })
  await expect(rail.getByRole('button', { name: '＋ 물리존 그리기' })).toBeVisible()
  await expect(rail.getByRole('button', { name: '도구 · 문' })).toBeDisabled()
  await expect(rail.getByRole('button', { name: '도구 · 문' })).toHaveAttribute('title', /OE-OBJ-07/)
  await page.getByRole('button', { name: '설비 편집' }).click()
  await expect(rail.getByRole('button', { name: '＋ 설비 배치' })).toBeVisible()
  await expect(rail.getByRole('button', { name: '＋ 물리존 그리기' })).toHaveCount(0)
  await page.getByRole('button', { name: '공간 편집' }).click()
  // 이름을 바꾸면 목록·속성에 '변경' 표시, 상태줄에 저장 안 된 변경
  await page.locator('.object-list button').first().click()
  await expect(page.getByTestId('change-tag')).toHaveText('변경 없음')
  await page.getByRole('textbox', { name: '선택 이름' }).fill('바뀐 회의실')
  await page.getByRole('button', { name: '속성 적용' }).click()
  await expect(page.getByTestId('change-tag')).toHaveText('변경')
  await expect(page.locator('.object-list button').first()).toContainText('변경')
  await expect(page.getByTestId('change-counts')).toContainText('변경 1')
  await expect(page.locator('.ed-status')).toContainText('저장 안 된 변경 1건')
  await expect(page.locator('.ed-where')).toContainText('저장되지 않은 변경 1건')
  // 임시 저장 → 안내 바가 '임시 저장본에서 이어서 편집 중' + 폐기 버튼(OE-WF-02)
  await page.getByRole('button', { name: '임시 저장', exact: true }).click()
  await expect(page.getByTestId('draft-bar')).toContainText('임시 저장본에서 이어서 편집 중')
  await expect(page.locator('.ed-status')).toContainText('임시 저장됨')
  // 폐기 → 확인 팝업 → 기준(반영본)으로 돌아간다(OE-WF-04 AC1)
  await page.getByTestId('discard-draft').click()
  await expect(page.getByRole('dialog')).toContainText('되돌릴 수 없습니다')
  await page.getByTestId('discard-confirm').click()
  await expect(page.getByTestId('draft-bar')).not.toContainText('임시 저장본에서')
  await expect(page.locator('.object-list')).not.toContainText('바뀐 회의실')
  await page.screenshot({ path: '.local/proto-editor-shell.png' })
  expect(errors).toEqual([])
})

test('editor shell: plan context menu deletes a room, Ctrl+Z restores; cursor in status bar', async ({ page }) => {
  await page.goto('/')
  await page.locator('.floor-card').first().getByRole('button', { name: '운영 편집 →' }).click()
  await page.getByRole('button', { name: '평면도', exact: true }).click()
  const rows = page.locator('.object-list button')
  const before = await rows.count()
  const room = (await page.locator('.plan-room').first().boundingBox())!
  await page.mouse.move(room.x + room.width * .25, room.y + room.height * .7)
  await expect(page.locator('.ed-status')).toContainText(/x \d+\.\d\d y \d+\.\d\d/)
  await page.mouse.click(room.x + room.width * .25, room.y + room.height * .7, { button: 'right' })
  const menu = page.getByRole('menu')
  await expect(menu).toBeVisible()
  await menu.getByRole('menuitem', { name: /지우기/ }).click()
  await expect(rows).toHaveCount(before - 1)
  await page.keyboard.press('Control+z')
  await expect(rows).toHaveCount(before)
  // 설비 편집 모드에서는 물리존 메뉴가 잠긴다(OE-UI-04 AC4 와 같은 안내)
  await page.getByRole('button', { name: '설비 편집' }).click()
  await page.mouse.click(room.x + room.width * .25, room.y + room.height * .7, { button: 'right' })
  await expect(menu).toContainText('공간 편집 모드에서 편집')
  await expect(menu.getByRole('menuitem', { name: /지우기/ })).toBeDisabled()
})

test('editor shell: initial build has floor picker, 구축하기 and no 미리보기 (OE-UI-04 AC2)', async ({ page }) => {
  await page.goto('/')
  await page.locator('.floor-card').nth(1).getByRole('button', { name: '초기 구축 →' }).click()
  const head = page.locator('.ed-head')
  await expect(head.getByRole('combobox', { name: '작업 층' })).toBeVisible()
  await expect(head.getByRole('button', { name: '구축하기', exact: true })).toBeVisible()
  await expect(head.getByRole('button', { name: '미리보기', exact: true })).toHaveCount(0)
  await expect(page.getByTestId('mode-badge')).toHaveText('초기 구축')
  await expect(page.getByTestId('draft-bar')).toContainText('임포트 결과에서 편집 중')
})

// OE-UI-23 AC3·AC4 를 에디터 화면에서 — 보이는 글자 12px 이상, 버튼 24px 이상(평면도 SVG 글자는 3D/도면 표기라 뺀다)
test('editor shell: no text under 12px and no button under 24px (OE-UI-23 AC3·AC4)', async ({ page }) => {
  await page.goto('/')
  await page.locator('.floor-card').first().getByRole('button', { name: '운영 편집 →' }).click()
  await page.locator('.object-list button').first().click()
  for (const mode of ['공간 편집', '설비 편집']) {
    await page.getByRole('button', { name: mode }).click()
    const bad = await page.evaluate(() => {
      const out: string[] = []
      for (const el of document.querySelectorAll<HTMLElement>('.ed *')) {
        if (el.closest('svg')) continue
        const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue
        const own = [...el.childNodes].some(n => n.nodeType === 3 && n.textContent!.trim())
        if (own && parseFloat(getComputedStyle(el).fontSize) < 12) out.push('font ' + getComputedStyle(el).fontSize + ' ' + el.textContent!.trim().slice(0, 20))
        if (el.tagName === 'BUTTON' && (r.height < 24 || r.width < 24)) out.push('button ' + Math.round(r.width) + 'x' + Math.round(r.height) + ' ' + el.textContent!.trim().slice(0, 20))
      }
      return out
    })
    expect(bad, mode).toEqual([])
  }
})

// 우측 패널 두 파트(2026-10-16 PM 결정, OE-UI-04 3번) — 위 = 고른 오브젝트 정보(종류에 따라 바뀜), 아래 = 이 층 현황(늘 고정)
test('editor shell: right panel top follows selection, bottom floor status stays', async ({ page }) => {
  await page.goto('/')
  await page.locator('.floor-card').first().getByRole('button', { name: '운영 편집 →' }).click()
  const top = page.locator('.ed-rpan .inspector'), bottom = page.getByRole('region', { name: '층 현황' })
  const topBox = async () => (await top.boundingBox())!.y, bottomBox = async () => (await bottom.boundingBox())!.y
  // 고른 것 없음 → 위는 안내, 아래는 종류별 개수
  await expect(page.getByTestId('no-selection')).toBeVisible()
  await expect(bottom.getByRole('group', { name: '종류별 현황' })).toContainText('물리존')
  expect(await topBox()).toBeLessThan(await bottomBox())
  // 물리존을 고르면 위가 물리존 정보
  await page.locator('.object-list button').first().click()
  await expect(top).toContainText('선택 오브젝트 · 물리존')
  await expect(page.getByTestId('space-relations')).toBeVisible()
  // 아래 목록을 설비로 바꿔 설비를 고르면 위가 설비 정보로 바뀌고, 아래 현황은 그대로 있다
  const y = await bottomBox()
  await page.getByRole('button', { name: '설비', exact: true }).click()
  await page.locator('.object-list button').first().click()
  await expect(top).toContainText('선택 오브젝트 · 설비')
  await expect(top).toContainText('설치면')
  expect(await bottomBox()).toBe(y)
  // 평면도에서 물리존을 누르면 아래 목록이 설비여도 위는 물리존 정보
  await page.getByRole('button', { name: '평면도', exact: true }).click()
  const room = (await page.locator('.plan-room').first().boundingBox())!
  await page.mouse.click(room.x + room.width * .25, room.y + room.height * .7)
  await expect(top).toContainText('선택 오브젝트 · 물리존')
  await expect(bottom.getByRole('button', { name: '설비', exact: true })).toHaveAttribute('aria-pressed', 'true')
})

// 2026-10-16 PM 요청 — 기준 · 검증은 헤더 [기준 …] 의 비모달 드로어, 편집 모드 전환은 좌측 레일 맨 위
test('editor shell: check drawer from header, mode switch on top of the tool rail', async ({ page }) => {
  await page.goto('/')
  await page.locator('.floor-card').first().getByRole('button', { name: '운영 편집 →' }).click()
  // 우측 패널 '고른 것 없음' 에는 생성 기준 · 등급 · 경고가 없다
  await expect(page.getByTestId('no-selection')).toBeVisible()
  await expect(page.locator('.ed-rpan .gauge-row')).toHaveCount(0)
  await expect(page.getByTestId('grade-chips')).toHaveCount(0)
  // 헤더 버튼으로 열면 드로어에 셋 다 있고, 3D 캔버스는 그대로 보인다(모달 아님)
  const btn = page.getByTestId('check-open')
  await expect(btn).toHaveAttribute('aria-expanded', 'false')
  await btn.click()
  const drawer = page.getByRole('dialog', { name: /기준 .* 검증/ })
  await expect(drawer).toContainText('생성 기준')
  await expect(drawer.getByTestId('grade-chips')).toBeVisible()
  await expect(drawer.getByTestId('warnings')).toBeVisible()
  await expect(btn).toHaveAttribute('aria-expanded', 'true')
  await expect(page.locator('.studio-canvas')).toBeVisible()
  await page.getByRole('button', { name: '평면도', exact: true }).click()   // 드로어가 열린 채 캔버스 조작
  await expect(drawer).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(drawer).toHaveCount(0)
  // 편집 모드는 헤더가 아니라 레일 맨 위. 바꾸면 레일 도구가 바로 바뀐다
  await expect(page.locator('.ed-head').getByRole('button', { name: '설비 편집' })).toHaveCount(0)
  const rail = page.getByRole('navigation', { name: '편집 도구' })
  const mode = rail.getByRole('group', { name: '편집 모드' })
  const modeY = (await mode.boundingBox())!.y, toolY = (await rail.getByRole('button', { name: '＋ 물리존 그리기' }).boundingBox())!.y
  expect(modeY).toBeLessThan(toolY)
  await mode.getByRole('button', { name: '설비 편집' }).click()
  await expect(rail.getByRole('button', { name: '＋ 설비 배치' })).toBeVisible()
  await expect(rail.getByRole('button', { name: '＋ 물리존 그리기' })).toHaveCount(0)
  await mode.getByRole('button', { name: '공간 편집' }).click()
  await expect(rail.getByRole('button', { name: '＋ 공조존 만들기' })).toBeVisible()
})

// 다중층 보기(OE-ML-01 진입 ④, 2026-10-16) — 보기 전환 [다중층 ▾] 에서 범위를 고르면 여러 층을 함께 보고, 모드에 맞는 다중층 도구만 보인다
for (const [mode, card] of [['운영 편집', 0], ['초기 구축', 1]] as const) test(`editor shell: multi-floor range view in ${mode}`, async ({ page }) => {
  await page.goto('/')
  await page.locator('.floor-card').nth(card).getByRole('button', { name: mode + ' →' }).click()
  await page.getByTestId('multi-open').click()
  const range = page.getByRole('dialog', { name: '다중층 범위' })
  await expect(range).toContainText('보기 범위만 바꿉니다')
  await range.getByRole('button', { name: '전체' }).click()
  await page.getByTestId('multi-apply').click()
  await expect(page.getByTestId('crumb-range')).toContainText(/~.*3개 층/)
  await expect(page.getByTestId('tool-hint')).toContainText('다중층 보기')
  const rail = page.getByRole('navigation', { name: '편집 도구' })
  await expect(rail.getByRole('button', { name: '도구 · 계단(다중층)' })).toBeVisible()
  await expect(rail.getByRole('button', { name: '＋ 물리존 그리기' })).toHaveCount(0)
  await rail.getByRole('group', { name: '편집 모드' }).getByRole('button', { name: '설비 편집' }).click()
  await expect(rail.getByRole('button', { name: '도구 · 층간 배관(다중층)' })).toBeVisible()
  await expect(rail.getByRole('button', { name: '도구 · 층간 배관(다중층)' })).toHaveAttribute('title', /OE-ML-12/)
  await page.getByTestId('multi-leave').click()
  await expect(page.getByTestId('crumb-range')).toHaveCount(0)
  await expect(rail.getByRole('button', { name: '＋ 설비 배치' })).toBeVisible()
})
