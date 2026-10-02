#!/usr/bin/env node
// docs/prd/features 의 티켓 md → 칸반 이슈(사내 GitHub)를 맞춘다. 파일이 정본이고 보드는 파생이다(docs/prd/README.md "보드 동기화").
//
//   node scripts/sync-board.mjs                 점검만 한다(쓰지 않는다). 어긋남이 있으면 종료 코드 1
//   node scripts/sync-board.mjs --diff          어긋난 이슈마다 새로 쓸 수정 이력까지 보인다
//   node scripts/sync-board.mjs --apply         어긋난 이슈의 제목·본문·라벨과 Phase 칸을 고친다
//   --only=OE-COM-01,OE-COM-02   그 티켓만      --date=2026-10-02   수정 이력의 날짜(기본: 오늘)
//
// 맞추는 것: 제목, 본문(md 사본 + 수정 이력), 라벨 phase-1/2, Phase 칸. 개발이 손댄 이슈(In Progress·In Review·Done)의 요구사항·
// 수용 기준이 바뀌면 라벨 `modified` 를 붙인다(뗄 때는 개발이 구현을 다시 본 뒤 손으로). 보드의 모든 항목에서 라벨을 `🏷️ 라벨` 칸으로
// 옮겨 적는다(라벨 보드의 열). 이 스크립트가 하지 않는 것: Status 이동(개발이 판단),
// 코멘트, 이슈 닫기·만들기. `planned` 라벨이 없는 이슈(구현 완료 보고로 대체된 것)는 건드리지 않는다.
// 로컬 `gh` 로 수동 실행한다 — 의존성 없이 node 만 있으면 된다.
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

process.env.GH_HOST ||= 'github.sec.samsung.net'
const HOST = process.env.GH_HOST
const OWNER = 'IoT-Solution'
const REPO = `${OWNER}/bim-to-dt-ontology`
const PROJECT = 1
const FEATURES = fileURLToPath(new URL('../docs/prd/features/', import.meta.url))
const BLOB = `https://${HOST}/${REPO}/blob/main/docs/prd/features`

const BANNER = '> **계획 티켓(backlog)** — 아직 구현되지 않았습니다. 구현이 끝나면 별도 완료 보고 이슈로 대체/연결합니다.'
const HIST_OPEN = '<!-- board-sync:history -->'
const HIST_CLOSE = '<!-- /board-sync:history -->'
const PHASE = { R1: { label: 'phase-1', option: 'P1 · 1차 릴리즈' }, R2: { label: 'phase-2', option: 'P2 · 후속' } }
const PHASE_LABELS = Object.values(PHASE).map((p) => p.label)
/** 요구사항이 바뀌면 개발이 다시 봐야 하는 절. 검증·메모는 개발이 쓰는 절이라 바뀌어도 `modified` 를 붙이지 않는다. */
const SPEC_SECTIONS = ['요구사항', '수용 기준']
/** 개발이 이미 손댄 상태. Todo·PRD in progress 는 다시 볼 구현이 없어 `modified` 를 붙이지 않는다. */
const DEV_STATUS = /In Progress|In Review|Done/
const MODIFIED = 'modified'
/**
 * 라벨을 보드 열로 보이려고 옮겨 적는 단일 선택 칸. 보드는 라벨(여러 개)을 열로 못 쓴다. 정본은 라벨이고 이 칸은 사본이다.
 * 라벨이 둘 이상이면 앞의 것 하나만 적는다(반려가 가장 급하고, 그다음 요구사항 변경 · 기획 결정 · 외부 대기 · 개발 남음).
 */
const LABEL_FIELD = '🏷️ 라벨'
const LABEL_ORDER = ['rejected', MODIFIED, 'needs-pm', 'blocked', 'needs-dev', 'enhancement']
const wantLabelOption = (labels) => LABEL_ORDER.find((l) => (labels ?? []).includes(l)) ?? null
// item-list JSON 은 칸 이름의 첫 글자를 소문자로 바꿔 열쇠로 쓴다(`poC 상태`). 이모지로 시작하는 이름은 그대로라 끝으로 찾는다.
const labelFieldValue = (item) => item[Object.keys(item).find((k) => k.endsWith('라벨')) ?? ''] ?? null

const args = process.argv.slice(2)
const flag = (name) => args.includes(`--${name}`)
const opt = (name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3)
const APPLY = flag('apply')
const SHOW = flag('diff') || APPLY
const ONLY = opt('only')?.split(',').map((s) => s.trim())
const DATE = opt('date') ?? new Date().toLocaleDateString('sv-SE')

const lf = (s) => s.replace(/\r\n/g, '\n')
const gh = (a) => {
  try {
    return execFileSync('gh', a, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (e) {
    throw new Error(`gh ${a.slice(0, 3).join(' ')} 실패: ${(e.stderr || e.message).toString().trim()}`)
  }
}

function loadTickets() {
  const out = new Map()
  for (const folder of readdirSync(FEATURES)) {
    if (!/^E\d\d-/.test(folder)) continue
    for (const file of readdirSync(FEATURES + folder)) {
      if (!/^OE-.*\.md$/.test(file)) continue
      const m = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(lf(readFileSync(`${FEATURES}${folder}/${file}`, 'utf8')))
      if (!m) throw new Error(`${file}: 머리 필드 없음`)
      const fm = {}
      for (const line of m[1].split('\n')) {
        const kv = /^([a-z_]+): (.*)$/.exec(line)
        if (!kv) throw new Error(`${file}: 머리 필드 줄이 "key: json" 이 아니다: ${line}`)
        fm[kv[1]] = JSON.parse(kv[2])
      }
      out.set(fm.id, { fm, folder, md: m[2].trim() })
    }
  }
  return out
}

/** md 본문을 `## 절` 이름 → 내용으로 가른다. */
function sections(md) {
  const out = {}
  let cur = null
  for (const l of md.split('\n')) {
    const h = /^## (.+?)\s*$/.exec(l)
    if (h) out[(cur = h[1])] = []
    else if (cur) out[cur].push(l)
  }
  for (const k of Object.keys(out)) out[k] = out[k].join('\n').trim()
  return out
}

function head(t) {
  const { fm, folder } = t
  return [
    BANNER,
    '',
    `PRD ${fm.prd} · 티켓 [docs/prd/features/${folder}/${fm.id}.md](${BLOB}/${folder}/${fm.id}.md)`,
    `에픽 ${fm.epic} ${fm.epic_title} · release ${fm.release} · priority ${fm.priority}`,
  ].join('\n')
}

const expectedBase = (t) => `${head(t)}\n\n${t.md}`
const expectedTitle = (t) => `${t.fm.title} (${t.fm.id})`

const HIST_RE = new RegExp(`\\n\\n${HIST_OPEN}\\n\\*\\*수정 이력\\*\\*\\n([\\s\\S]*?)\\n${HIST_CLOSE}(?=\\n\\n)`)
/** 이슈 본문을 md 사본 부분과 수정 이력으로 가른다. */
function splitBody(body) {
  const b = lf(body ?? '').replace(/\s+$/, '')
  const h = HIST_RE.exec(b)
  return { base: h ? b.replace(h[0], '') : b, history: h ? h[1] : '' }
}

/** 이슈 본문(md 사본 부분)에서 `# OE-…` 부터의 md. */
function mdOf(base) {
  const at = base.search(/^# OE-/m)
  return at < 0 ? '' : base.slice(at).trim()
}

/** 요구사항·수용 기준이 바뀌었나. */
function specChanged(oldBase, t) {
  const before = sections(mdOf(oldBase))
  const after = sections(t.md)
  return SPEC_SECTIONS.some((k) => (before[k] ?? '') !== (after[k] ?? ''))
}

const quote = (s) => s.split('\n').map((l) => (l ? `  > ${l}` : '  >')).join('\n')

/** 이슈 본문의 옛 md 사본과 새 md 를 견줘 무엇이 바뀌었는지 수정 이력 줄로 만든다. */
function describeChanges(oldBase, t) {
  const lines = []
  const add = (s) => lines.push(`- (${DATE}) ${s}`)
  const rp = /release (R\d) · priority (P\d)/.exec(oldBase)
  if (rp && rp[1] !== t.fm.release) add(`release ${rp[1]} → ${t.fm.release}`)
  if (rp && rp[2] !== t.fm.priority) add(`priority ${rp[2]} → ${t.fm.priority}`)

  const oldMd = mdOf(oldBase)
  const oldTitle = /^# OE-\S+ (.*)$/m.exec(oldMd)?.[1]
  if (oldTitle !== undefined && oldTitle !== t.fm.title) add(`제목 "${oldTitle}" → "${t.fm.title}"`)

  const before = sections(oldMd)
  const after = sections(t.md)
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (before[k] === after[k]) continue
    if (before[k] === undefined) add(`**${k}** 절 추가`)
    else if (after[k] === undefined) add(`**${k}** 절 삭제`)
    else add(`**${k}** 수정 — 이전 문구:\n${quote(before[k] || '(비어 있음)')}`)
  }
  if (!lines.length) add('본문 갱신')
  return lines.join('\n')
}

function newBody(oldBody, t) {
  const { base, history } = splitBody(oldBody)
  const entries = base === expectedBase(t) ? '' : describeChanges(base, t)
  const hist = [history, entries].filter(Boolean).join('\n')
  const block = hist ? `\n\n${HIST_OPEN}\n**수정 이력**\n${hist}\n${HIST_CLOSE}` : ''
  return { body: `${head(t)}${block}\n\n${t.md}`, entries }
}

function compare(item, t) {
  const diffs = []
  if (item.title !== expectedTitle(t)) diffs.push('제목')
  const { base } = splitBody(item.content.body)
  if (base !== expectedBase(t)) diffs.push('본문')
  const want = PHASE[t.fm.release]
  const labels = item.labels ?? []
  const wantLabels = [...labels.filter((l) => !PHASE_LABELS.includes(l)), want.label]
  // 개발이 손댄 이슈의 요구사항이 바뀌면 다시 보라고 표시한다. 떼는 것은 개발 몫이라 여기서는 붙이기만 한다.
  if (base !== expectedBase(t) && DEV_STATUS.test(item.status ?? '') && specChanged(base, t) && !wantLabels.includes(MODIFIED)) wantLabels.push(MODIFIED)
  if (labels.length !== wantLabels.length || wantLabels.some((l) => !labels.includes(l))) diffs.push('라벨')
  if (item.phase !== want.option) diffs.push('Phase')
  return { diffs, wantLabels }
}

function projectMeta() {
  const id = JSON.parse(gh(['project', 'view', String(PROJECT), '--owner', OWNER, '--format', 'json'])).id
  const phase = JSON.parse(gh(['project', 'field-list', String(PROJECT), '--owner', OWNER, '--format', 'json'])).fields.find((f) => f.name === 'Phase')
  return { id, phase }
}

function apply(item, t, d, meta) {
  if (d.diffs.some((x) => x !== 'Phase')) {
    const payload = {}
    if (d.diffs.includes('제목')) payload.title = expectedTitle(t)
    if (d.diffs.includes('본문')) payload.body = newBody(item.content.body, t).body
    if (d.diffs.includes('라벨')) payload.labels = d.wantLabels
    const file = join(mkdtempSync(join(tmpdir(), 'board-sync-')), 'issue.json')
    writeFileSync(file, JSON.stringify(payload), 'utf8')
    gh(['api', '-X', 'PATCH', `repos/${REPO}/issues/${item.content.number}`, '--input', file, '--silent'])
  }
  if (d.diffs.includes('Phase')) {
    const opt = meta.phase.options.find((o) => o.name === PHASE[t.fm.release].option)
    if (!opt) throw new Error(`Phase 칸에 "${PHASE[t.fm.release].option}" 선택지가 없다`)
    gh(['project', 'item-edit', '--id', item.id, '--project-id', meta.id, '--field-id', meta.phase.id, '--single-select-option-id', opt.id])
  }
}

function main() {
  const tickets = loadTickets()
  const items = JSON.parse(gh(['project', 'item-list', String(PROJECT), '--owner', OWNER, '--limit', '500', '--format', 'json'])).items
  const byId = new Map()
  const stray = []
  for (const i of items) {
    const id = /\((OE-[A-Z0-9]+-\d+)\)\s*$/.exec(i.title)?.[1]
    if (!id) stray.push(i)
    else if (byId.has(id)) throw new Error(`제목 끝 ${id} 이 이슈 둘에 있다: #${byId.get(id).content.number}, #${i.content.number}`)
    else byId.set(id, i)
  }

  const scope = [...tickets.values()].filter((t) => !ONLY || ONLY.includes(t.fm.id))
  if (ONLY) for (const id of ONLY) if (!tickets.has(id)) throw new Error(`--only: 티켓 ${id} 이 없다`)
  const noIssue = [], unmanaged = [], drift = [], handOver = [], boardAhead = []
  for (const t of scope) {
    const item = byId.get(t.fm.id)
    if (!item) { noIssue.push(t.fm.id); continue }
    if (!(item.labels ?? []).includes('planned')) { unmanaged.push(`${t.fm.id} #${item.content.number}`); continue }
    const d = compare(item, t)
    if (d.diffs.length) drift.push({ t, item, d })
    if (t.fm.status === 'prd-done' && item.status === 'PRD in progress') handOver.push(`${t.fm.id} #${item.content.number}`)
    if (t.fm.status === 'prd-review' && item.status && item.status !== 'PRD in progress') boardAhead.push(`${t.fm.id} #${item.content.number} (${item.status})`)
  }
  // 라벨 칸은 계획 이슈만이 아니라 보드의 모든 항목을 맞춘다(완료 보고 이슈의 enhancement 도 보인다).
  const labelDrift = items.filter((i) => i.content?.number && wantLabelOption(i.labels) !== labelFieldValue(i))
  const orphan = [...byId].filter(([id]) => !tickets.has(id)).map(([id, i]) => `${id} #${i.content.number}`)

  console.log(`보드 동기화 ${APPLY ? '적용' : '점검(쓰지 않음)'} — 티켓 ${tickets.size}, 이슈 ${items.length}, 점검 ${scope.length}, 어긋남 ${drift.length}`)
  for (const { t, item, d } of drift) {
    console.log(`  ${t.fm.id} #${item.content.number}  ${d.diffs.join(' · ')}`)
    if (SHOW && d.diffs.includes('본문')) console.log(newBody(item.content.body, t).entries.replace(/^/gm, '      '))
  }

  if (labelDrift.length) {
    console.log(`\n${LABEL_FIELD} 칸 ${APPLY ? '맞춤' : '어긋남'} (${labelDrift.length})`)
    for (const i of labelDrift) console.log(`  #${i.content.number}  ${labelFieldValue(i) ?? '(비어 있음)'} → ${wantLabelOption(i.labels) ?? '(비움)'}`)
  }

  let failed = 0
  if (APPLY && labelDrift.length) {
    const id = JSON.parse(gh(['project', 'view', String(PROJECT), '--owner', OWNER, '--format', 'json'])).id
    const field = JSON.parse(gh(['project', 'field-list', String(PROJECT), '--owner', OWNER, '--format', 'json'])).fields.find((f) => f.name === LABEL_FIELD)
    if (!field) throw new Error(`보드에 "${LABEL_FIELD}" 칸이 없다`)
    for (const i of labelDrift) {
      const want = wantLabelOption(i.labels)
      const opt = want && field.options.find((o) => o.name === want)
      try {
        if (want && !opt) throw new Error(`"${LABEL_FIELD}" 칸에 "${want}" 선택지가 없다`)
        const value = opt ? ['--single-select-option-id', opt.id] : ['--clear']
        gh(['project', 'item-edit', '--id', i.id, '--project-id', id, '--field-id', field.id, ...value])
      } catch (e) { failed++; console.log(`  ✗ #${i.content.number}: ${e.message}`) }
    }
  }
  if (APPLY && drift.length) {
    const meta = drift.some(({ d }) => d.diffs.includes('Phase')) ? projectMeta() : null
    for (const { t, item, d } of drift) {
      try { apply(item, t, d, meta); console.log(`  ✓ ${t.fm.id} #${item.content.number}`) }
      catch (e) { failed++; console.log(`  ✗ ${t.fm.id} #${item.content.number}: ${e.message}`) }
    }
  }

  const note = (title, list) => list.length && console.log(`\n${title} (${list.length})\n  ${list.join('\n  ')}`)
  note('[참고] prd-done 인데 보드는 PRD in progress — 개발로 넘길 후보(Status 는 쓰지 않는다)', handOver)
  note('[참고] prd-review 인데 보드가 PRD in progress 보다 앞섬', boardAhead)
  note('[참고] planned 라벨이 없어 건드리지 않은 이슈', unmanaged)
  note('[주의] 이슈가 없는 티켓(이 스크립트는 이슈를 만들지 않는다)', noIssue)
  note('[주의] 티켓 파일이 없는 이슈', orphan)
  note('[참고] 제목 끝에 티켓 ID 가 없는 보드 항목', stray.map((i) => `#${i.content?.number} ${i.title}`))

  process.exit(failed || (!APPLY && (drift.length || labelDrift.length)) ? 1 : 0)
}

main()
