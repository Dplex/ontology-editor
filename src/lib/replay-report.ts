// 편집 리플레이(PoC)의 변경 리포트. 리플레이가 장면마다 계산한 것(replay.ts — TTL 의 바뀐 줄, GeoJSON 의 바뀐 feature)을
// 마크다운 한 장으로 낸다. 리플레이는 보는 것이고, 이것은 PM·검토자에게 넘기는 기록이다 — "이 편집이 온톨로지(TTL)의 어느 줄,
// 지도(GeoJSON)의 어느 feature 가 됐나" 를 장면 차례로 적는다. TTL 의 `ex:<GUID>` 는 이름으로 바꿔 읽게 한다(화면과 같은 규칙).

import { escapeLocalName } from './export/ttl'
import { CATEGORIES, type PlanItem, type ReplayStart, type ReplayStep } from './replay'

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
