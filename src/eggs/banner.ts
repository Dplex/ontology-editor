// B. 콘솔 배너(banner) — 파일을 열면 개발자 도구 콘솔에 한 번 찍는다(docs/plans/easter-eggs.md). 기본으로 켜진 유일한 egg 다(G2 예외).
//
// - 층 수만큼 줄을 쌓은 글자 건물, 그 옆에 층·물리존·기기 수, 마지막 줄 `~ 를 눌러 보세요`.
// - DOM·3D 를 건드리지 않는다. e2e 모드에서는 찍지 않는다(부르는 쪽 editor/eggs.ts 가 거른다).
// - **TTL `feeds` 수는 넣지 않았다.** 계획에는 있지만 그 수는 TTL 을 지어야 나온다. 파일을 열 때마다 성수에서 0.27초를 기본 경로에
//   더하게 되어(G6) 뺐다. 수는 기본 화면의 층 현황(B-9)과 같은 이름으로 센다 — 기기는 덕트·배관을 뺀 수다(countOf.devices).
import { countOf, type Model } from '../lib/model'

/** 글자 건물에 쌓을 층 줄의 최대. 이보다 많으면 위를 `⋮` 로 줄인다. */
const MAX_FLOORS = 24

/** 찍을 줄들. 단위 테스트가 이것을 본다. */
export function bannerLines(model: Readonly<Model>, title: string): string[] {
  const c = countOf(model as Model)
  const n = c.storeys
  const floors = Math.min(n, MAX_FLOORS)
  const facts = [title, `층 ${n.toLocaleString()} · 물리존 ${c.spaces.toLocaleString()} · 기기 ${c.devices.toLocaleString()}`]
  const body: string[] = []
  if (n > MAX_FLOORS) body.push('   ⋮⋮   ')
  for (let i = 0; i < floors; i++) body.push(i === floors - 1 ? ' │▪ ▪▪│ ' : ' │▪▪ ▪│ ')
  const building = [' ┌────┐ ', ...body, '─┴────┴─']
  // 사실 두 줄을 건물 위쪽 옆에 붙인다.
  const lines = building.map((row, i) => (i >= 1 && i <= facts.length ? `${row}  ${facts[i - 1]}` : row))
  if (building.length <= facts.length) lines.push(...facts.slice(building.length - 1).map((f) => `         ${f}`))
  lines.push('', '~ 를 눌러 보세요')
  return lines
}

export function printBanner(model: Readonly<Model>, title: string) {
  console.log(`%c${bannerLines(model, title).join('\n')}`, 'font-family: ui-monospace, Menlo, monospace; line-height: 1.25')
}
