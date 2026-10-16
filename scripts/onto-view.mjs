// 온톨로지 질의 챗봇에 붙이는 "지금 화면" 줄(ADR-0050 "보는 화면"). 창(scripts/docs-chat.js)이 앱의 window.__oe.view() 를 질문과 같이 보내면
// serve.mjs 의 context() 가 이걸 불러 [지금 화면] 줄을 만든다. "이 층·이거·여기" 를 모델이 알아듣게 하려는 것이다.
//
// **클라이언트가 보낸 글을 그대로 넣지 않는다.** 이 줄은 질문 앞, 시스템이 붙인 자리에 들어가니 아무 글이나 받으면 지시문 통로가 된다.
//   - id 는 고른 출처 TTL 에 주어(`ex:… a 클래스`)로 있는 것만 남긴다. 클래스도 클라이언트 말이 아니라 그 TTL 에서 읽는다.
//   - 이름(rdfs:label)은 안 붙인다. 사람이 친 글(커스텀존 이름 등)이라서다. 모델은 onto_describe 로 찾는다.
//   - 나머지는 정해진 값(보기·편집 대상)이나 정해진 모양(클래스 이름, 정수)만 받는다. 개수에 상한을 둔다.
import { readFileSync, statSync } from 'node:fs'

const MAX_ID = 200
const CLASS = /^(brick|fso|ex):[A-Za-z0-9_]{1,80}$/
const MODE = { '3d': '3D', plan: '2D 평면도' }
const PART = { equipment: '설비', space: '공간(물리존·룸·벽)', ceiling: '천장 설비' }

let cache = { file: '', mtime: 0, size: 0, subjects: new Map() }

/** TTL 의 주어 → 클래스. modelToTTL 은 블록마다 `ex:<id> a <클래스> ;` 로 시작한다(src/lib/export/ttl.ts). 파일이 그대로면 다시 읽지 않는다. */
export function subjectsOf(file) {
  const st = statSync(file)
  if (cache.file === file && cache.mtime === st.mtimeMs && cache.size === st.size) return cache.subjects
  cache = { file, mtime: st.mtimeMs, size: st.size, subjects: parseSubjects(readFileSync(file, 'utf8')) }
  return cache.subjects
}

export function parseSubjects(ttl) {
  const out = new Map()
  for (const m of ttl.matchAll(/^ex:(\S+) a ((?:brick|fso|ex):[A-Za-z0-9_]+)/gm)) out.set(m[1], m[2])
  return out
}

/**
 * 창이 보낸 화면 상태(view)를 subjects(이 출처 TTL 의 주어 → 클래스)로 걸러 [지금 화면] 줄을 만든다. 남는 것이 없으면 ''.
 * view 모양은 App.vue 의 viewForChat 이다.
 */
export function viewLine(view, subjects) {
  if (!view || typeof view !== 'object' || Array.isArray(view)) return ''
  let dropped = 0
  const one = (x) => {
    if (x == null) return null
    if (typeof x === 'string' && x.length <= MAX_ID && subjects.has(x)) return x
    dropped++
    return null
  }
  const many = (xs, cap) => (Array.isArray(xs) ? xs.slice(0, cap).map(one).filter(Boolean) : [])
  const show = (id) => `ex:${id} (${subjects.get(id)})`
  const list = (ids, cap = 10) => ids.slice(0, cap).map(show).join(', ') + (ids.length > cap ? ` 외 ${ids.length - cap}개` : '')

  const rows = []
  const mode = MODE[view.mode]
  const part = view.editing === true ? PART[view.part] : undefined
  if (mode) rows.push(`보기: ${mode} · ${view.editing === true ? `편집 모드${part ? `(${part})` : ''}` : '보기 모드'}`)

  const from = view.range && typeof view.range === 'object' ? one(view.range.from) : null
  const to = view.range && typeof view.range === 'object' ? one(view.range.to) : null
  const storey = one(view.storey)
  if (from && to) rows.push(`보는 층: 다중층 뷰 ${show(from)} ~ ${show(to)}`)
  else if (storey) rows.push(`보는 층: ${show(storey)}`)
  else if (view.storey === null && !view.range) rows.push('보는 층: 모든 층')

  const selected = many(view.selected, 10)
  if (selected.length) rows.push(`선택 항목: ${list(selected)}`)
  const zone = one(view.zone)
  if (zone) rows.push(`고른 커스텀존: ${show(zone)}`)
  const hvac = one(view.hvacZone)
  if (hvac) rows.push(`꼭짓점을 고치는 공조존: ${show(hvac)}`)

  const f = view.filter
  if (f && typeof f === 'object' && !Array.isArray(f)) {
    const parts = []
    const storeys = many(f.storeys, 60)
    if (storeys.length) parts.push(`층 ${list(storeys)}`)
    const classes = Array.isArray(f.classes) ? f.classes.slice(0, 30).filter((c) => typeof c === 'string' && CLASS.test(c)) : []
    if (classes.length) parts.push(`클래스 ${classes.join(', ')}`)
    const systems = many(f.systems, 30)
    if (systems.length) parts.push(`계통 ${list(systems)}`)
    const isolate = many(f.isolate, 30)
    if (isolate.length) parts.push(`이것만 보기 ${list(isolate)}`)
    if (Number.isInteger(f.hidden) && f.hidden > 0 && f.hidden <= 1e6) parts.push(`숨긴 설비 ${f.hidden}개`)
    if (parts.length) rows.push(`보기 필터(화면에서만 거른 것, 온톨로지는 그대로): ${parts.join(' · ')}`)
  }

  if (!rows.length) return ''
  if (dropped) rows.push(`이 출처 TTL 에 없는 id ${dropped}개는 뺐다(반영 뒤에 만든 것이거나 온톨로지에 내지 않는 것).`)
  return [
    '[지금 화면] 질문할 때 사용자가 편집 화면에서 보던 것이다. "이 층·여기·이거·지금 보는·선택 항목" 은 이걸 가리킨다. 이름·속성은 도구로 찾는다.',
    ...rows.map((r) => `- ${r}`),
  ].join('\n')
}
