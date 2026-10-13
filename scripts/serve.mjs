// 빌드한 번들(dist/)을 그대로 내주는 정적 서버. 샘플 등급을 잴 때 node_modules 의 web-ifc 를 쓴다.
//
//   node scripts/serve.mjs            # ONTOLOGY_EDITOR_ADDR (기본 0.0.0.0:8084)
//
// 이 앱은 브라우저 안에서만 돈다. IFC 를 읽는 것도(web-ifc WASM) 내보내는 것도 브라우저가 한다.
// 그래서 서버가 할 일은 넷이다. 파일을 내주고, 살아 있다고 답하고(/healthz), data/ 의 샘플 목록과
// 등급 칩을 내주고(/__data/, dev 서버와 같은 src/server/data-catalog.ts 를 `npm run build:server` 로
// 묶은 판), [편집 저장] 한 편집을 받아 두고(PUT /__data/__edits, src/server/saved-edits.ts), 반영한 레이아웃을 버전으로 둔다
// (/__data/__layouts, src/server/layouts.ts), 시스템 로그를 쌓고(POST /__data/__log), 층마다 임시 저장본·편집 잠금을 둔다
// (/__data/__drafts·__locks, src/server/floor-state.ts). 쓰기는 고른 사람(data/.users.json)이
// 편집할 수 있는 역할일 때만 받는다(src/server/users.ts).
// 이 모듈은 dt 플랫폼과 따로라 정문(8000)은 거치지 않는다.
//
// 다섯째로 문서 챗봇(Alt+Shift+K)의 /__chat 이 있다(scripts/docs-chat.mjs, ADR-0001). 앱의 API 가 아니라 이 repo 의
// 문서를 읽고 답하는 개발용 부속이고, gemini 가 쓸 수 있는 도구는 문서 읽기 하나뿐이다. gemini 가 없는 기계에서는
// GET /__chat 이 enabled:false 를 주고 창이 그 이유를 보인다.
// 같은 창의 [온톨로지] 칸은 /__ask 다(ADR-0050). gemini 가 반영한 온톨로지(data/.layouts 의 현재 버전 TTL)를 읽기만 하는
// 도구(scripts/onto-mcp.mjs) 하나로 답한다.
//
// **wasm 의 Content-Type 을 application/wasm 으로 준다.** 틀리면 브라우저가 스트리밍 컴파일을
// 거절하고 web-ifc 가 느린 길로 돌거나 실패한다.
import { createServer } from 'node:http'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createChat } from './docs-chat.mjs'
import { sources } from './onto-sources.mjs'

const ROOT = resolve(process.env.ONTOLOGY_EDITOR_DIST || 'dist')
const [host, port] = (process.env.ONTOLOGY_EDITOR_ADDR || '0.0.0.0:8084').split(/:(?=\d+$)/)
const DATA = resolve(process.env.ONTOLOGY_EDITOR_DATA || 'data')
const CATALOG = resolve('dist-server/data-catalog.js')

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  // pdf.js 워커(PDF 도면 배경, src/lib/pdf-page.ts)가 .mjs 로 나간다. 모듈 워커는 JavaScript 타입이 아니면 브라우저가 실행하지 않는다.
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.wasm': 'application/wasm',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
}

try {
  statSync(join(ROOT, 'index.html'))
} catch {
  console.error(`!! ${ROOT}/index.html 이 없다. 먼저 npm run build`)
  process.exit(1)
}

// 샘플 목록은 없어도 앱은 돈다. 목록 요청이 실패하면 화면이 고르기 칸을 숨긴다.
const catalog = existsSync(CATALOG) ? (await import(pathToFileURL(CATALOG).href)).createDataCatalog(DATA) : null

function log(fields) {
  console.log(JSON.stringify({ time: new Date().toISOString(), ...fields }))
}

const REPO = fileURLToPath(new URL('..', import.meta.url))
const chat = createChat({ root: REPO, log })
const ask = createChat({
  root: REPO,
  log,
  name: 'onto',
  mcp: { script: 'scripts/onto-mcp.mjs', env: { ONTO_DATA: DATA, ...(process.env.ONTO_FILES ? { ONTO_FILES: process.env.ONTO_FILES } : {}) } },
  policyFile: 'scripts/onto-chat.policy.toml',
  systemFile: 'scripts/onto-chat.md',
  // 창에서 고른 건물. 목록에 있는 이름만 받는다(질문 앞에 아무 글이나 끼워 넣지 못하게).
  context: (body) => {
    const s = sources(DATA, process.env.ONTO_FILES).find((x) => x.source === body.source)
    return s ? `[건물] source="${s.source}" (${s.title}${s.version ? `, 버전 ${s.version}` : ''}) — 도구를 부를 때 source 로 넘긴다.` : ''
  },
  info: () => ({ sources: sources(DATA, process.env.ONTO_FILES).map(({ file, ...s }) => s) }),
})

const server = createServer((req, res) => {
  const started = Date.now()
  const done = (status) => log({ msg: 'request', method: req.method, path: req.url, status, ms: Date.now() - started })

  const path = decodeURIComponent((req.url || '/').split('?')[0])
  if (path === '/__chat' || path === '/__ask') {
    res.on('finish', () => done(res.statusCode))
    ;(path === '/__ask' ? ask : chat)(req, res).catch(e => {
      log({ msg: 'chat failed', error: String(e?.stack || e) })
      if (!res.headersSent) res.writeHead(500)
      res.end()
    })
    return
  }

  // 쓰기는 8084 에 남기는 편집(/__data/__edits, src/server/saved-edits.ts)과 반영 버전(/__data/__layouts, src/server/layouts.ts)뿐이다.
  // 나머지는 읽기만 받는다.
  const writable = (req.method === 'PUT' && path === '/__data/__edits') || ((req.method === 'PUT' || req.method === 'POST') && path === '/__data/__layouts') || (req.method === 'POST' && path === '/__data/__log') ||
    ((req.method === 'PUT' || req.method === 'DELETE') && (path === '/__data/__drafts' || path === '/__data/__locks'))
  if (req.method !== 'GET' && req.method !== 'HEAD' && !writable) {
    res.writeHead(405, { Allow: 'GET, HEAD' }).end()
    return done(405)
  }

  if (path === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }).end('ok')
    return
  }

  if (catalog && (path === '/__data' || path.startsWith('/__data/'))) {
    req.url = (req.url || '').slice('/__data'.length) || '/'
    res.on('finish', () => done(res.statusCode))
    catalog(req, res)
    return
  }

  // dist 밖을 가리키는 경로(../ 등)는 내주지 않는다.
  const file = normalize(join(ROOT, path.endsWith('/') ? path + 'index.html' : path))
  if (file !== ROOT && !file.startsWith(ROOT + sep)) {
    res.writeHead(404).end()
    return done(404)
  }

  let st
  try {
    st = statSync(file)
  } catch {
    res.writeHead(404).end()
    return done(404)
  }
  if (!st.isFile()) {
    res.writeHead(404).end()
    return done(404)
  }

  res.writeHead(200, {
    'Content-Type': TYPES[extname(file)] || 'application/octet-stream',
    'Content-Length': st.size,
    // 자산 이름에 해시가 붙어 있어서 오래 둬도 된다. index.html 만 매번 새로 받게 한다.
    'Cache-Control': path.startsWith('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
  })
  if (req.method === 'HEAD') {
    res.end()
    return done(200)
  }
  createReadStream(file).pipe(res).on('finish', () => done(200))
})

server.listen(Number(port), host, () =>
  log({ msg: 'listening', addr: `${host}:${port}`, root: ROOT, data: catalog ? DATA : null }),
)
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => server.close(() => process.exit(0)))
}
