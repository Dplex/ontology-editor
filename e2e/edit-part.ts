import type { Page } from '@playwright/test'

// 편집 모드 [공간 편집 | 설비 편집](OE-UI-04, 도구 레일 맨 위). 팔레트가 그 모드의 도구만 보이고, 다른 모드의 오브젝트는 끌거나 방향키로 옮기지 못한다.
// 이미 그 모드면 아무것도 하지 않는다.
async function to(page: Page, name: '공간 편집' | '설비 편집') {
  const button = page.getByRole('group', { name: '편집 모드' }).getByRole('button', { name, exact: true })
  if ((await button.getAttribute('aria-pressed')) !== 'true') await button.click()
}
export const toSpace = (page: Page) => to(page, '공간 편집')
export const toEquipment = (page: Page) => to(page, '설비 편집')

/** 헤더의 [파일 ▾] 메뉴를 연다(열기 · 덧붙이기 · 편집 파일 · 내보내기). 이미 열려 있으면 그대로 둔다. */
export async function openFileMenu(page: Page) {
  const menu = page.locator('details.shell-menu')
  if ((await menu.getAttribute('open')) === null) await menu.locator('> summary').click()
}

/** 헤더의 [기준 ▾] 로 기준 · 검증 패널을 연다(리포트 · 검사 · 표 · 바뀐 내용). 이미 열려 있으면 그대로 둔다. */
export async function openDrawer(page: Page) {
  const button = page.getByTestId('basis-button')
  if ((await button.getAttribute('aria-expanded')) !== 'true') await button.click()
}

/**
 * 우측 아래 [층 현황] 에서 종류 칸을 열고 이름으로 찾아 누른다. 3D 아래의 설비 표·물리존 표가 빠져서(#715) 이름으로 고르는 길이 여기다.
 * 목록은 Revit 이름(`패밀리:유형:요소ID`)을 `패밀리 #요소ID` 로 줄여 보이고 검색도 줄인 이름에 걸린다 — 그래서 요소 ID 로 찾고, 줄의 전체 이름
 * (title)로 맞춘다. `exact: false` 면 전체 이름의 일부만 맞아도 된다(첫 줄).
 */
export async function pickFromFloor(page: Page, kind: '물리존' | '커스텀존' | '공조존' | '설비', name: string, exact = true) {
  const floor = page.getByTestId('floor-status')
  const toggle = floor.locator('.shell-floor-toggle')
  if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click()
  const kindButton = floor.getByRole('group', { name: '층 현황 종류' }).getByRole('button', { name: kind, exact: true })
  if ((await kindButton.getAttribute('aria-pressed')) !== 'true') await kindButton.click()
  const term = /^[^:]+:.+:(\d+)$/.exec(name)?.[1] ?? name
  await floor.locator('.shell-floor-search').fill(term)
  const quoted = JSON.stringify(name)
  const row = floor.locator('.shell-rows li > button').filter({ has: page.locator(exact ? `.name[title=${quoted}]` : `.name[title*=${quoted}]`) }).first()
  // 검색 결과가 다시 그려질 때까지 잠깐 기다린다.
  if (await row.waitFor({ timeout: 1500 }).then(() => true, () => false)) return row.click()
  // 층 현황은 지금 보는 층만 센다. 다른 층에 있으면 모든 층으로 넓혀 찾는다(예전 설비 표는 늘 파일 전체였다).
  const storeys = page.locator('select.storey-view')
  if ((await storeys.count()) && (await storeys.inputValue()) !== '') {
    await storeys.selectOption({ label: '모든 층' })
    if ((await kindButton.getAttribute('aria-pressed')) !== 'true') await kindButton.click()
    await floor.locator('.shell-floor-search').fill(term)
    if (await row.waitFor({ timeout: 1500 }).then(() => true, () => false)) return row.click()
  }
  // 덕트 · 배관 구간은 층 현황 목록에 없다. 화면의 모델을 TTL 로 받아(window.__oe.screen) 이름이 같은 엔티티의 id 로 고른다.
  if (kind === '설비') {
    const id = await idByName(page, name, exact)
    if (id) {
      await selectById(page, id)
      // 검색 칸에 초점이 남으면 다음 Ctrl+Z · Delete 가 그 칸의 글자에 간다.
      await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur())
      return
    }
  }
  return row.click()
}

/** 화면 모델의 TTL 에서 rdfs:label 이 `name` 인 엔티티의 id(GlobalId). 없으면 null. */
export async function idByName(page: Page, name: string, exact = true): Promise<string | null> {
  return page.evaluate(
    ([n, ex]) => {
      const ttl: string = (window as any).__oe?.screen?.()?.ttl ?? ''
      for (const block of ttl.split(/\n\s*\n/)) {
        const id = /^ex:(\S+) a /m.exec(block)?.[1]
        const raw = /rdfs:label "((?:[^"\\]|\\.)*)"/.exec(block)?.[1]
        if (!id || raw === undefined) continue
        const label = raw.replace(/\\(.)/g, '$1')
        if (ex ? label === n : label.includes(n as string)) return id.replace(/\\(.)/g, '$1')
      }
      return null
    },
    [name, exact] as const,
  )
}
/** 화면 모델의 TTL 에서 rdfs:label 이 `pattern` 에 맞는(`cls` 를 주면 그 클래스인) 엔티티 수. 예전 설비 표의 줄 수 대신 쓴다(덕트 · 배관 구간도 센다). */
export async function countByLabel(page: Page, pattern: RegExp, cls?: string): Promise<number> {
  return page.evaluate(
    ([src, flags, c]) => {
      const re = new RegExp(src as string, flags as string)
      const ttl: string = (window as any).__oe?.screen?.()?.ttl ?? ''
      return ttl.split(/\n\s*\n/).filter((b) => {
        const a = /^ex:\S+ a (\S+)/m.exec(b)?.[1]?.replace(/[;,.]$/, '')
        const raw = a ? /rdfs:label "((?:[^"\\]|\\.)*)"/.exec(b)?.[1] : undefined
        return raw !== undefined && (!c || a === c) && re.test(raw.replace(/\\(.)/g, '$1'))
      }).length
    },
    [pattern.source, pattern.flags, cls ?? ''] as const,
  )
}
/** 이름이 `name` 인 설비의 3D 형상 가운데 x(소수 둘째 자리, 문자열). 예전 설비 표의 x 칸 대신 쓴다 — 고르지 않아도, 보기 모드에서도 읽힌다. */
export async function xOf(page: Page, name: string): Promise<string | null> {
  const id = await idByName(page, name)
  return page.evaluate((x) => {
    const c = x ? ((window as any).__viewer?.center(x) as number[] | null | undefined) : null
    return c ? String(Math.round(c[0] * 100) / 100) : null
  }, id)
}
export const pickEquipment = (page: Page, name: string, exact = true) => pickFromFloor(page, '설비', name, exact)
export const pickSpace = (page: Page, name: string, exact = false) => pickFromFloor(page, '물리존', name, exact)

/**
 * 공간 편집 레일의 펼침 칸(공조존 · 평면도 배경 · 벽·문·창 설정)을 연다. 예전 3D 아래 칸이 여기로 옮겼다(#715). 편집 모드여야 하고,
 * 공간 편집으로 바꾼 뒤 연다. 이미 열려 있으면 그대로 둔다.
 */
export async function openRailPanel(page: Page, name: '공조존' | '평면도 배경' | '벽·문·창 설정') {
  await toSpace(page)
  // 레일 단추 이름 앞에 아이콘 글리프(data-ico)가 붙는다("▨ 평면도 배경"). 끝으로 맞춘다.
  const button = page.getByRole('navigation', { name: '공간 편집 칸' }).getByRole('button', { name: new RegExp(`${name}$`) })
  if ((await button.getAttribute('aria-pressed')) !== 'true') await button.click()
}

/**
 * 캔버스의 빈 곳(아래 가운데)을 끌어 바닥 점 `at` 을 캔버스 가운데보다 조금 오른쪽으로 옮긴다. 레일 펼침 칸 · 레이어 칸이 캔버스 왼쪽 위에
 * 떠서, 처음 시점에 모델이 그 밑에 있으면 바닥을 눌러도 칸이 받는다(mep.ifc 는 멀리 있는 덕트 표시 상자까지 한 화면에 맞춰 왼쪽 아래에 선다).
 */
export async function panClear(page: Page, at: [number, number, number] = [5, 4, 0]) {
  const canvas = page.locator('.canvas-wrap > canvas')
  await canvas.scrollIntoViewIfNeeded()
  const box = (await canvas.boundingBox())!
  const c = (await page.evaluate((p) => (window as any).__viewer.point(p), at)) as { x: number; y: number }
  const from = { x: box.x + box.width * 0.5, y: box.y + box.height * 0.85 }
  const to = { x: box.x + box.width * 0.62, y: box.y + box.height * 0.5 }
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + to.x - c.x, from.y + to.y - c.y, { steps: 12 })
  await page.mouse.up()
  // 놓은 뒤에도 카메라가 관성으로 조금 더 간다. 멈춘 뒤에 화면 좌표를 읽어야 누르는 자리가 맞다.
  await page.waitForTimeout(400)
}

/** 고른 설비의 위치 칸(오른쪽 위 선택 카드). 예전 3D 아래 설비 표의 x·y·z 칸이 여기다. 편집 모드에서만 있다. */
export const coordOf = (page: Page, axis: 0 | 1 | 2 | number) => page.locator('.position-edit .coord').nth(axis)

/** 오른쪽 위 선택 카드(설비 · 물리존 · 벽 등 고른 것의 정보). 예전 3D 아래 표의 한 줄이 보이던 소속 · 출처가 여기 있다. */
export const pickedCard = (page: Page) => page.locator('.shell-sel section.picked').first()

/**
 * id 로 고른다(온톨로지 챗의 [3D] 와 같은 길, window.__editor3d). 층 현황 목록은 덕트 · 배관 구간을 싣지 않아서, 구간은 이렇게 고르거나 3D 에서 누른다.
 */
export async function selectById(page: Page, id: string) {
  await page.evaluate((x) => (window as any).__editor3d.show([x]), id)
}

/**
 * 편집 모드로 들어간다. 이미 편집 중이면 그대로 둔다 — 모드는 이 브라우저에 기억돼(oe-mode) 다시 열면 편집 중으로 열리고, 그때는 [편집 시작] 이
 * 없다(예전 [보기 | 편집] 토글은 두 번 눌러도 같았다).
 */
export async function enterEdit(page: Page) {
  const start = page.getByTestId('edit-start')
  const exit = page.locator('.shell-exit')
  await start.or(exit).first().waitFor()
  if (await start.isVisible()) await start.click()
  await exit.waitFor()
}

/**
 * 설비의 소속(물리존 이름, 없으면 "(소속 없음)"). 예전 설비 표의 소속 칸 대신 화면 모델의 TTL(window.__oe.screen)에서 읽는다 — 고르지 않고 읽으니
 * 선택 · 시점이 그대로다. 소속이 층뿐(brick:Floor)이면 "(소속 없음)" 이다.
 */
export async function placeOf(page: Page, name: string): Promise<string> {
  return page.evaluate((n) => {
    const ttl: string = (window as any).__oe?.screen?.()?.ttl ?? ''
    const blocks = ttl.split(/\n\s*\n/).map((b) => {
      const label = /rdfs:label "((?:[^"\\]|\\.)*)"/.exec(b)?.[1]?.replace(/\\(.)/g, '$1') ?? null
      return { id: /^ex:(\S+) a /m.exec(b)?.[1] ?? null, cls: /^ex:\S+ a (\S+)/m.exec(b)?.[1] ?? '', label, loc: /brick:hasLocation (ex:\S+?)\s*[;.]/.exec(b)?.[1]?.slice(3) ?? null }
    })
    const me = blocks.find((b) => b.label === n)
    if (!me) return '(설비 없음)'
    const at = me.loc ? blocks.find((b) => b.id === me.loc) : null
    if (!at || at.cls === 'brick:Floor') return '(소속 없음)'
    return at.label ?? '(소속 없음)'
  }, name)
}

/** 캔버스 오른쪽 위 [다중층 ▾] 팝오버를 연다(범위 고르기 · [다중층 보기] · [층 편집으로]). 이미 열려 있으면 그대로 둔다. */
export async function openMultiPopover(page: Page) {
  const pop = page.locator('.shell-range details.multi')
  if ((await pop.getAttribute('open')) === null) await pop.locator('> summary').click()
  return page.getByRole('group', { name: '다중층 보기 범위' })
}
/** 다중층 뷰를 연다. 범위를 주지 않으면 팝오버가 채운 범위(지금 층 ±1, 층을 안 골랐으면 전체)다. */
export async function openMultiView(page: Page, range?: { from: string; to: string }) {
  const pop = await openMultiPopover(page)
  if (range) {
    await pop.getByLabel('다중층 시작 층').selectOption({ label: range.from })
    await pop.getByLabel('다중층 끝 층').selectOption({ label: range.to })
  }
  await pop.getByRole('button', { name: '다중층 보기' }).click()
}
/** 다중층 뷰에서 층 편집으로 돌아간다. */
export async function leaveMultiView(page: Page) {
  const pop = await openMultiPopover(page)
  await pop.getByRole('button', { name: '층 편집으로' }).click()
}

/**
 * 층 현황 설비 칸의 계통 칩 줄. 예전 오른쪽 계통 범례(.legend)가 여기로 옮겼다(#715). 지금 층 설비가 든 계통만 보이고, 많으면 [+N] 을 편다.
 */
export async function systemChips(page: Page) {
  const floor = page.getByTestId('floor-status')
  const toggle = floor.locator('.shell-floor-toggle')
  if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click()
  const kind = floor.getByRole('group', { name: '층 현황 종류' }).getByRole('button', { name: '설비', exact: true })
  if ((await kind.getAttribute('aria-pressed')) !== 'true') await kind.click()
  const chips = floor.locator('.shell-systems')
  const more = chips.locator('button.more')
  if ((await more.count()) && (await more.getAttribute('aria-expanded')) === 'false') await more.click()
  return chips
}
