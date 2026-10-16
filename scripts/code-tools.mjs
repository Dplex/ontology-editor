// 이 repo 의 소스를 읽기만 하는 MCP 도구(/issue 챗봇, issue-mcp.mjs). 고치는 도구는 없다.
//
// 읽을 수 있는 곳은 ALLOWED 의 폴더·파일뿐이다. 55 의 repo 폴더에는 .env(서버 설정)·data/(고객사 BIM·편집)·run/(챗봇 작업 폴더)도
// 있어서, 경로를 받는 대로 읽으면 사내망 누구나 질문 한 줄로 그것을 이슈 본문에 옮겨 적게 된다. 그래서 목록에 든 파일만 읽고,
// 점으로 시작하는 이름(.env·.git)·비밀처럼 보이는 이름은 목록에서부터 뺀다.
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'

/** 읽을 수 있는 폴더(아래 전부)와 파일. */
const ALLOWED_DIRS = ['src', 'scripts', 'e2e', 'e2e-seongsu', 'docs']
const ALLOWED_FILES = ['intent.md', 'CLAUDE.md', 'README.md', 'TODO.md', 'package.json', 'vite.config.ts', 'playwright.config.ts', 'index.html', 'viewer.html', 'reference.md']
const EXT = /\.(ts|vue|mjs|cjs|js|css|md|py|sh|toml|json|html|ya?ml)$/i
/** 폴더 이름이 이것이면 들어가지 않는다. 생성물과 시험 입력이다 — 픽스처(가짜 gemini 의 답 등)를 읽으면 그 글을 근거로 삼았다(55 실측 2026-10-16). */
const SKIP_DIRS = new Set(['node_modules', 'run', 'data', 'dist', 'dist-server', 'test-results', 'playwright-report', 'public', 'fixtures'])
/** 이 챗봇 자신의 시험. 예시 요청·초안이 들어 있어 근거로 섞인다. */
const SKIP_FILES = new Set(['scripts/issue-chat.test.ts'])
const SECRET = /(^|[-_.])(env|secret|secrets|token|tokens|credential|credentials|password|passwd|key|keys)([-_.]|$)|\.pem$|\.p12$/i
const MAX_FILE = 400 * 1024
const MAX_LINES = 400
const MAX_HITS = 60

export function allowedFiles(root) {
  const out = []
  const walk = (dir) => {
    let names
    try { names = readdirSync(join(root, dir), { withFileTypes: true }) } catch { return }
    for (const d of names) {
      if (d.name.startsWith('.') || SECRET.test(d.name)) continue
      const rel = dir ? `${dir}/${d.name}` : d.name
      if (d.isDirectory()) { if (!SKIP_DIRS.has(d.name)) walk(rel) }
      else if (d.isFile() && EXT.test(d.name) && !SKIP_FILES.has(rel)) out.push(rel)
    }
  }
  for (const d of ALLOWED_DIRS) walk(d)
  for (const f of ALLOWED_FILES) { try { if (statSync(join(root, f)).isFile()) out.push(f) } catch { /* 없으면 건너뛴다 */ } }
  return out
}

/** 받은 경로를 목록 안의 경로로. 목록 밖이면 null — `../`·절대 경로·역슬래시도 여기서 걸러진다. */
export function resolveAllowed(files, path) {
  const p = String(path || '').trim().replace(/\\/g, '/').replace(/^\.\//, '')
  return files.includes(p) ? p : null
}

export function codeTools(root) {
  let cache = null
  const files = () => {
    if (!cache || Date.now() - cache.at > 60_000) cache = { at: Date.now(), list: allowedFiles(root) }
    return cache.list
  }
  const text = (rel) => {
    const abs = join(root, rel)
    if (relative(root, abs).split(sep)[0] === '..') return null
    if (statSync(abs).size > MAX_FILE) return null
    return readFileSync(abs, 'utf8')
  }
  return [
    {
      name: 'code_files',
      description: `소스 파일 목록. dir 로 좁힌다(예: "src/editor", "src/lib/ifc"). 읽을 수 있는 곳: ${ALLOWED_DIRS.join(', ')} 와 루트의 ${ALLOWED_FILES.join(', ')}.`,
      inputSchema: { type: 'object', properties: { dir: { type: 'string', description: '이 폴더 아래만(없으면 전부, 최대 300개)' } } },
      run: (a) => {
        const dir = String(a.dir || '').replace(/\\/g, '/').replace(/\/+$/, '')
        const all = files().filter((f) => !dir || f === dir || f.startsWith(`${dir}/`))
        return { count: all.length, files: all.slice(0, 300), truncated: all.length > 300 }
      },
    },
    {
      name: 'code_search',
      description: '소스에서 글자를 찾는다(대소문자 무시, 정규식 아님). 함수·변수 이름, 화면 글자(한국어), data-testid, 오류 문구로 찾는다. 결과의 path·line 을 code_read 로 읽는다.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '찾을 글자 그대로' },
          dir: { type: 'string', description: '이 폴더 아래만(예: "src/components")' },
          limit: { type: 'number', description: `결과 수(기본 30, 최대 ${MAX_HITS})` },
        },
        required: ['query'],
      },
      run: (a) => {
        const q = String(a.query || '').toLowerCase()
        if (q.length < 2) return { error: '두 글자 이상으로 찾는다' }
        const dir = String(a.dir || '').replace(/\\/g, '/').replace(/\/+$/, '')
        const limit = Math.min(MAX_HITS, Math.max(1, Number(a.limit) || 30))
        const hits = []
        let total = 0
        for (const f of files()) {
          if (dir && !f.startsWith(`${dir}/`) && f !== dir) continue
          const t = text(f)
          if (!t) continue
          const lines = t.split(/\r?\n/)
          for (let i = 0; i < lines.length; i++) {
            if (!lines[i].toLowerCase().includes(q)) continue
            total++
            if (hits.length < limit) hits.push({ path: f, line: i + 1, text: lines[i].trim().slice(0, 200) })
          }
        }
        return { query: a.query, total, hits, truncated: total > hits.length }
      },
    },
    {
      name: 'code_read',
      description: `소스 파일을 줄 번호와 함께 읽는다. start·end 로 범위를 준다(한 번에 ${MAX_LINES}줄까지). path 는 code_files·code_search 결과의 것.`,
      inputSchema: {
        type: 'object',
        properties: { path: { type: 'string' }, start: { type: 'number', description: '첫 줄(1부터, 기본 1)' }, end: { type: 'number', description: '끝 줄(기본 start+200)' } },
        required: ['path'],
      },
      run: (a) => {
        const rel = resolveAllowed(files(), a.path)
        if (!rel) return { error: `${a.path} 는 읽을 수 없다(목록 밖이거나 없다). code_files·code_search 로 찾는다` }
        const t = text(rel)
        if (t === null) return { error: `${rel} 는 너무 커서 읽지 않는다` }
        const lines = t.split(/\r?\n/)
        const start = Math.max(1, Math.floor(Number(a.start) || 1))
        const end = Math.min(lines.length, Math.floor(Number(a.end) || start + 200), start + MAX_LINES - 1)
        return { path: rel, lines: lines.length, start, end, text: lines.slice(start - 1, end).map((l, i) => `${start + i}: ${l}`).join('\n') }
      },
    },
  ]
}
