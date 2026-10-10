// 편집 리플레이(PoC)의 변경 리포트. 리플레이가 장면마다 계산한 것(replay.ts — TTL 의 바뀐 줄, GeoJSON 의 바뀐 feature)을
// 마크다운 한 장으로 낸다. 리플레이는 보는 것이고, 이것은 PM·검토자에게 넘기는 기록이다 — "이 편집이 온톨로지(TTL)의 어느 줄,
// 지도(GeoJSON)의 어느 feature 가 됐나" 를 장면 차례로 적는다. TTL 의 `ex:<GUID>` 는 이름으로 바꿔 읽게 한다(화면과 같은 규칙).

import { escapeLocalName } from './export/ttl'
import { CATEGORIES, type PlanItem, type ReplayStart, type ReplayStep } from './replay'
import { impactLines, relationsOf } from './replay-relations'

/** Revit 의 "패밀리:유형:…:요소ID" 를 "패밀리 #요소ID" 로(App.vue·ReplayHud 의 shortName 과 같은 규칙). */
export function shortName(name: string): string {
  const revit = /^([^:]+):.+:(\d+)$/.exec(name)
  return revit ? `${revit[1]} #${revit[2]}` : name
}

/** TTL 의 지역 이름(ex: 뒤) → 사람이 읽는 이름. 연 때 평면과 장면에서 새로 생긴 것까지. */
export function nameTable(start: ReplayStart | null, steps: readonly ReplayStep[]): Map<string, string> {
  const out = new Map<string, string>()
  const learn = (it: PlanItem | null) => {
    if (!it || it.t === 'link' || it.t === 'wall' || it.t === 'opening') return
    out.set(escapeLocalName(it.id), it.t === 'equip' ? shortName(it.name) : it.name || it.id)
  }
  for (const it of start?.plan ?? []) learn(it)
  for (const s of start?.storeys ?? []) out.set(escapeLocalName(s.id), s.name)
  for (const s of start?.systems ?? []) out.set(escapeLocalName(s.id), s.name || s.id)
  for (const s of steps) for (const c of s.changes) learn(c.after)
  return out
}

/** TTL 한 줄의 `ex:<id>` 를 이름으로. 모르는 것은 이스케이프만 푼다. */
export function readableTtl(line: string, names: ReadonlyMap<string, string>): string {
  return line.replace(/ex:((?:\\.|[\w가-힣])+)/g, (m, id: string) => names.get(id) ?? m.replace(/\\(.)/g, '$1'))
}

const two = (n: number) => String(n).padStart(2, '0')
const clock = (ms: number) => {
  if (!ms) return ''
  const d = new Date(ms)
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map(two).join(':')
}
/** 마크다운 표 칸에 넣을 수 있게 `|` 와 줄바꿈을 막는다. */
const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ')

/** 장면 하나에 적는 TTL 줄 수. 넘으면 "외 n줄" — 계통 확정처럼 수백 줄이 바뀐 장면이 리포트를 덮지 않게. */
const TTL_LINES = 40

export function replayReport(input: { title: string; start: ReplayStart | null; steps: readonly ReplayStep[]; now?: Date }): string {
  const { title, start, steps } = input
  const names = nameTable(start, steps)
  const storeyName = new Map((start?.storeys ?? []).map((s) => [s.id, s.name]))
  const added = steps.reduce((n, s) => n + s.ttlCount.added, 0)
  const removed = steps.reduce((n, s) => n + s.ttlCount.removed, 0)
  const geo = steps.reduce((n, s) => n + (s.geojson ? s.geojson.count.changed + s.geojson.count.added + s.geojson.count.removed : 0), 0)
  const storeys = new Set(steps.flatMap((s) => s.storeyIds))
  const out: string[] = []
  out.push(`# 편집 리플레이 리포트 — ${start?.building || title}`)
  out.push('')
  out.push(`- 파일: ${title}`)
  out.push(`- 만든 때: ${(input.now ?? new Date()).toLocaleString('ko-KR')}`)
  out.push(`- 편집 ${steps.length}건 · 고친 층 ${storeys.size}개 · TTL +${added} −${removed}줄 · GeoJSON feature ${geo}개`)
  out.push('')
  out.push('TTL 은 온톨로지(관계), GeoJSON 은 형상(좌표·외곽선)이다. 같은 편집이 둘 중 한쪽에만 남기도 한다 — 방 안에서 옮긴 설비는 GeoJSON 에만, 흐름 방향은 TTL 에만.')
  out.push('')
  out.push('## 갈래별')
  out.push('')
  out.push('| 갈래 | 장면 | TTL 더함 | TTL 지움 |')
  out.push('|---|---:|---:|---:|')
  for (const c of CATEGORIES) {
    const of = steps.filter((s) => s.category === c)
    if (!of.length) continue
    out.push(`| ${c} | ${of.length} | ${of.reduce((n, s) => n + s.ttlCount.added, 0)} | ${of.reduce((n, s) => n + s.ttlCount.removed, 0)} |`)
  }
  out.push('')
  out.push('## 장면')
  out.push('')
  out.push('| # | 갈래 | 편집 | 층 | 시각 | TTL | GeoJSON |')
  out.push('|---:|---|---|---|---|---|---|')
  for (const s of steps) {
    const g = s.geojson ? `~${s.geojson.count.changed} +${s.geojson.count.added} −${s.geojson.count.removed}` : '—'
    out.push(`| ${two(s.index + 1)} | ${s.category} | ${cell(s.label)} | ${cell(s.storeyIds.map((id) => storeyName.get(id) ?? id).join(', '))} | ${clock(s.time)} | +${s.ttlCount.added} −${s.ttlCount.removed} | ${g} |`)
  }
  for (const s of steps) {
    out.push('')
    out.push(`### #${two(s.index + 1)} ${s.category} — ${s.label}`)
    out.push('')
    const where = s.storeyIds.map((id) => storeyName.get(id) ?? id).join(', ')
    out.push(`${[clock(s.time), where].filter(Boolean).join(' · ')}${s.geojson ? ` · \`${s.geojson.file}\`` : ''}`)
    out.push('')
    const impact = impactLines(relationsOf(s.ttl), (ref) => readableTtl(ref, names))
    if (impact.length) {
      out.push('DT 에 물으면:')
      out.push('')
      for (const l of impact) out.push(`- ${l}`)
      out.push('')
    }
    if (s.ttl.length) {
      out.push('TTL:')
      out.push('')
      out.push('```diff')
      let n = 0
      let more = 0
      for (const c of s.ttl) {
        for (const [mark, line] of [['', c.subject], ...c.removed.map((l) => ['-', l]), ...c.added.map((l) => ['+', l])] as [string, string][]) {
          if (n >= TTL_LINES) {
            more++
            continue
          }
          out.push(`${mark || ' '} ${readableTtl(line, names)}`)
          n++
        }
      }
      out.push('```')
      if (more) out.push(`외 ${more}줄`)
    } else out.push('TTL 변화 없음 — 좌표·외곽선은 GeoJSON 에만 남는다.')
    if (s.geo.length) {
      out.push('')
      out.push('GeoJSON:')
      out.push('')
      for (const l of s.geo) out.push(`- ${l}`)
    }
  }
  out.push('')
  return out.join('\n')
}

/**
 * 요약 재생에 넣을 장면(번호, 차례대로). 공간 투어 앱의 하이라이트 릴처럼 긴 세션에서 볼 만한 장면 몇 개만 고른다 — 바뀐 양
 * (평면의 바뀐 것·TTL 줄·GeoJSON feature, 로그로 눌러 계통 확정처럼 수백 곳이 바뀐 장면 하나가 다 먹지 않게)이 큰 것부터,
 * 단 갈래마다 하나를 먼저 넣어 한 갈래로 쏠리지 않게. 1× 로 30초 남짓(장면 5.2초 × 6)이 되도록 6장면까지. 장면이 적으면
 * (MIN_TOTAL 이하) 고르지 않는다 — 다 보는 것과 다르지 않다.
 */
export const HIGHLIGHT_MIN_TOTAL = 6
export function pickHighlights(steps: readonly ReplayStep[], total = steps.length): number[] {
  if (total <= HIGHLIGHT_MIN_TOTAL || steps.length < total) return []
  const n = Math.min(6, Math.max(4, Math.ceil(total / 3)))
  const score = (s: ReplayStep) =>
    Math.log1p(s.changes.length) + 0.6 * Math.log1p(s.ttlCount.added + s.ttlCount.removed) + 0.4 * Math.log1p(s.geojson ? s.geojson.count.changed + s.geojson.count.added + s.geojson.count.removed : 0)
  const ranked = [...steps].sort((a, b) => score(b) - score(a) || a.index - b.index)
  const picked: ReplayStep[] = []
  // 갈래마다 가장 큰 장면 하나(큰 갈래부터), 그다음 남은 자리를 큰 장면으로.
  for (const s of ranked) if (picked.length < n && !picked.some((p) => p.category === s.category)) picked.push(s)
  for (const s of ranked) if (picked.length < n && !picked.includes(s)) picked.push(s)
  return picked.map((s) => s.index).sort((a, b) => a - b)
}
