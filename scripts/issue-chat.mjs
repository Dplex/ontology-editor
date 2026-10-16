// 문서 챗봇 창의 `/issue <요청>` — gemini 가 문서·소스를 읽고 이슈 초안을 쓰면, 서버가 검사해 GitHub 이슈로 바로 올린다.
// serve.mjs 가 /__issue 에 붙인다(docs/dev/deploy55.md "/issue").
//
//   GET  /__issue   → { enabled, reason? }
//   POST /__issue   ← { question, history?, view?, link? }   → NDJSON(docs-chat.mjs 와 같다). 끝에 결과 글 하나.
//
// **gemini 는 이슈를 올리지 못한다.** 붙는 MCP 서버(issue-mcp.mjs)는 읽는 도구뿐이고, 정책(issue-chat.policy.toml)이 그 밖의 도구를
// 막는다. gemini 의 답(JSON 초안)을 여기서 받아 제목·본문 길이를 자르고, 라벨을 허용 목록으로 거르고, 시간당 개수를 세고, gh 를 셸 없이
// 정해진 인자로 띄운다. 저장소도 여기서 정한다(ISSUE_REPO) — 요청 글이 무엇을 시켜도 다른 곳에 올라가지 않는다.
//
// 이슈는 55 의 gh 로그인 계정(지금은 희록님)으로 올라간다(2026-10-16 사용자 결정 — 미리보기 없이 바로, 작성자 그대로). 본문 끝에
// "/issue 로 만든 이슈" 와 요청 원문을 붙여 사람이 쓴 이슈와 가른다.
//
// 환경:
//   ISSUE_CHAT=0                         끈다
//   ISSUE_REPO=github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology   올릴 곳(HOST/OWNER/REPO)
//   ISSUE_GH=gh                          gh 실행 파일(시험은 가짜를 넣는다)
//   ISSUE_MAX_PER_HOUR=10                서버 전체에서 한 시간에 올리는 수
import { spawn, spawnSync } from 'node:child_process'
import { createChat } from './docs-chat.mjs'

export const REPO = process.env.ISSUE_REPO || 'github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology'
/** gemini 가 고를 수 있는 라벨(issue-chat.md "라벨"). 종류는 하나만 남긴다. 상태 라벨(needs-pm·blocked …)은 사람이 붙인다. */
export const TYPE_LABELS = ['bug', 'enhancement', 'documentation', 'question']
export const EXTRA_LABELS = ['need-not-check', 'prd-011', 'phase-1', 'phase-2', 'phase-3']
const MAX_TITLE = 120
const MAX_BODY = 8000

/** 답 글에서 초안 JSON 을 꺼낸다. 코드 블록이 여럿이면 마지막 것, 없으면 글 전체를 JSON 으로 본다. */
export function parseDraft(text) {
  const t = String(text || '').trim()
  const blocks = [...t.matchAll(/```(?:json)?\s*\n([\s\S]*?)\n?```/g)].map((m) => m[1])
  const raw = blocks.length ? blocks[blocks.length - 1] : t
  let j
  try { j = JSON.parse(raw) } catch { return { error: 'gemini 답이 초안 꼴(JSON)이 아니다' } }
  if (j && typeof j.ask === 'string' && j.ask.trim()) return { ask: j.ask.trim().slice(0, 600) }
  if (!j || typeof j.title !== 'string' || typeof j.body !== 'string') return { error: '초안에 title·body 가 없다' }
  const title = j.title.replace(/\s+/g, ' ').trim()
  const body = j.body.trim()
  if (!title || !body) return { error: '초안의 제목이나 본문이 비었다' }
  return { title, body, labels: Array.isArray(j.labels) ? j.labels.filter((x) => typeof x === 'string') : [] }
}

/** 허용 라벨만, 종류 라벨은 하나만. 종류가 없으면 enhancement. */
export function cleanLabels(labels) {
  const want = [...new Set(labels.map((l) => l.trim().toLowerCase()))]
  const type = want.find((l) => TYPE_LABELS.includes(l)) ?? 'enhancement'
  return [type, ...EXTRA_LABELS.filter((l) => want.includes(l))]
}

/** 보드 동기화(sync-board)가 제목 끝 티켓 ID 로 티켓 이슈를 찾으므로, 끝의 `(OE-XXX-nn)` 를 뗀다(board.md). */
export function cleanTitle(title) {
  const t = title.replace(/\s*\((?:OE-[A-Z0-9]+-\d+[a-z]?)(?:\s*[,·]\s*OE-[A-Z0-9]+-\d+[a-z]?)*\)\s*$/, '').trim()
  return t.length > MAX_TITLE ? `${t.slice(0, MAX_TITLE - 1)}…` : t
}

/** 창이 보낸 지금 주소에서 다시 여는 링크만 남긴다(share-link.ts 의 `?open=`·`?project=`·`storey`·`select`). 그 밖이면 null. */
export function reopenLink(link) {
  let u
  try { u = new URL(String(link || '')) } catch { return null }
  if (!/^https?:$/.test(u.protocol)) return null
  const keep = new URLSearchParams()
  for (const k of ['open', 'project', 'storey', 'select']) {
    const v = u.searchParams.get(k)
    if (v && v.length < 500) keep.set(k, v)
  }
  if (!keep.has('open') && !keep.has('project')) return null
  return `${u.origin}${u.pathname}?${keep}`
}

/** 본문 끝에 붙이는 출처. 요청 원문은 인용으로, 다시 여는 링크가 있으면 같이. */
export function footer(question, link) {
  const quoted = String(question).trim().slice(0, 1500).split('\n').map((l) => `> ${l}`).join('\n')
  return [
    '',
    '---',
    '문서 챗봇 `/issue` 로 만든 이슈입니다(gemini 가 문서·소스를 읽고 쓴 초안을 검토 없이 올렸습니다). 요청 원문:',
    '',
    quoted,
    ...(link ? ['', `요청할 때 보던 화면: ${link}`] : []),
  ].join('\n')
}

/**
 * gh 에 넘길 환경. GH_TOKEN·GH_ENTERPRISE_TOKEN 은 뺀다 — 8087 검토 판은 Actions(review55.sh)가 띄워서 그 실행의 토큰이 서버 환경에
 * 남아 있었고(2026-10-16 확인), 그대로 두면 55 의 로그인 계정이 아니라 그 토큰(곧 만료)으로 올리려 했다. 계정은 55 의 `gh auth login` 하나다.
 */
export function ghEnv(env, host) {
  const { GH_TOKEN, GH_ENTERPRISE_TOKEN, GITHUB_TOKEN, ...rest } = env
  return { ...rest, GH_HOST: host, GH_PROMPT_DISABLED: '1', NO_COLOR: '1' }
}

/** gh 로 이슈를 올리고 주소를 돌려준다. 셸을 거치지 않고, 본문은 stdin 으로 넘긴다. */
export function ghCreate({ title, body, labels }, { gh = process.env.ISSUE_GH || 'gh', repo = REPO, timeoutMs = 60_000 } = {}) {
  const host = repo.split('/')[0]
  const args = ['issue', 'create', '-R', repo, '--title', title, '--body-file', '-', ...labels.flatMap((l) => ['--label', l])]
  const [cmd, argv] = /\.m?js$/.test(gh) ? [process.execPath, [gh, ...args]] : [gh, args]
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, argv, { env: ghEnv(process.env, host), stdio: ['pipe', 'pipe', 'pipe'] })
    let out = ''
    let err = ''
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('gh 가 답하지 않는다')) }, timeoutMs)
    child.stdout.on('data', (d) => (out += d))
    child.stderr.on('data', (d) => (err = (err + d).slice(-2000)))
    child.on('error', (e) => { clearTimeout(timer); reject(new Error(`gh 를 못 띄웠다: ${e.message}`)) })
    child.on('close', (code) => {
      clearTimeout(timer)
      const url = /https?:\/\/\S+\/issues\/\d+/.exec(out)?.[0]
      if (code === 0 && url) resolve(url)
      else reject(new Error(`이슈를 올리지 못했다: ${(err || out).trim().split('\n').slice(-2).join(' ').slice(0, 300) || `gh 종료 ${code}`}`))
    })
    child.stdin.end(body)
  })
}

/** 오늘 날짜(본문 "지금 상태 (YYYY-MM-DD)" 에 쓴다). 서버 시계 기준, 한국 시각. */
const today = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10)

/** 창이 보낸 지금 화면(storey-progress.ts 의 viewForChat). id 와 정해진 값만 짧게 옮긴다. */
export function viewLine(view) {
  if (!view || typeof view !== 'object') return ''
  const id = (x) => (typeof x === 'string' && /^[\w$\\.~!&'()*+,;=/?#@%-]{1,64}$/.test(x) ? x : null)
  const parts = []
  if (view.mode === '3d' || view.mode === 'plan') parts.push(`보기 ${view.mode === '3d' ? '3D' : '평면도'}`)
  if (view.editing) parts.push(`편집 모드${typeof view.part === 'string' && /^\w{1,20}$/.test(view.part) ? `(${view.part})` : ''}`)
  if (id(view.storey)) parts.push(`층 id ${view.storey}`)
  const sel = Array.isArray(view.selected) ? view.selected.map(id).filter(Boolean).slice(0, 5) : []
  if (sel.length) parts.push(`고른 것 id ${sel.join(', ')}`)
  return parts.length ? `[지금 화면] ${parts.join(' · ')} — 이 id 는 code_search 가 아니라 요청을 이해하는 데만 쓴다.` : ''
}

export function createIssueChat({ root, log = () => {}, ghOptions = {} }) {
  const max = Number(process.env.ISSUE_MAX_PER_HOUR) || 10
  const made = []
  const gh = ghOptions.gh || process.env.ISSUE_GH || 'gh'
  return createChat({
    root,
    log,
    name: 'issue',
    mcp: { script: 'scripts/issue-mcp.mjs', env: { DOCS_ROOT: root } },
    policyFile: 'scripts/issue-chat.policy.toml',
    systemFile: 'scripts/issue-chat.md',
    // 앞선 대화(문서 질문들)는 붙이지 않는다 — 이슈에는 `/issue` 뒤의 요청만 들어가야 한다(2026-10-16 사용자 요청).
    turns: 0,
    check: () => {
      if (process.env.ISSUE_CHAT === '0') return 'ISSUE_CHAT=0 으로 꺼 두었다'
      const [cmd, argv] = /\.m?js$/.test(gh) ? [process.execPath, [gh, 'auth', 'status']] : [gh, ['auth', 'status']]
      const r = spawnSync(cmd, argv, { encoding: 'utf8', timeout: 20000, env: ghEnv(process.env, REPO.split('/')[0]) })
      return r.status === 0 ? null : `이 서버의 gh 가 ${REPO.split('/')[0]} 에 로그인되어 있지 않다`
    },
    context: (body) => [`[오늘] ${today()}`, viewLine(body.view)].filter(Boolean).join('\n'),
    finish: async ({ text, body, question, emit }) => {
      const draft = parseDraft(text)
      if (draft.ask) {
        emit({ type: 'text', text: `이슈를 만들지 않았습니다. ${draft.ask}`, delta: false })
        return { created: false, why: 'ask' }
      }
      if (draft.error) throw new Error(`${draft.error} — 이슈를 만들지 않았습니다`)
      const now = Date.now()
      while (made.length && now - made[0] > 3600_000) made.shift()
      if (made.length >= max) throw new Error(`한 시간에 ${max}개까지 올립니다. 잠시 뒤에 다시 보내 주세요`)
      const title = cleanTitle(draft.title)
      const labels = cleanLabels(draft.labels)
      const link = reopenLink(body.link)
      const bodyText = (draft.body.length > MAX_BODY ? `${draft.body.slice(0, MAX_BODY)}\n\n(본문이 길어 잘랐습니다)` : draft.body) + footer(question, link)
      emit({ type: 'tool', name: 'gh issue create', args: { labels: labels.join(', ') } })
      const url = await ghCreate({ title, body: bodyText, labels }, { gh })
      made.push(now)
      const n = /\/issues\/(\d+)/.exec(url)?.[1]
      const dropped = draft.labels.filter((l) => !labels.includes(l.trim().toLowerCase()))
      emit({
        type: 'text',
        delta: false,
        text: [
          `이슈 #${n} 를 올렸습니다 — ${url}`,
          '',
          `**${title}**`,
          `라벨: ${labels.map((l) => `\`${l}\``).join(' ')}${dropped.length ? ` (허용 목록 밖이라 뺀 것: ${dropped.join(', ')})` : ''}`,
          '',
          '```',
          draft.body.replace(/```/g, "'''"),
          '```',
        ].join('\n'),
      })
      return { created: true, issue: Number(n), labels }
    },
  })
}
