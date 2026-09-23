// 빌드한 번들(dist/)을 그대로 내주는 정적 서버. 의존성은 node 뿐이다.
//
//   node scripts/serve.mjs            # ONTOLOGY_EDITOR_ADDR (기본 0.0.0.0:8084)
//
// 이 앱은 브라우저 안에서만 돈다. IFC 를 읽는 것도(web-ifc WASM) 내보내는 것도 브라우저가 한다.
// 그래서 서버가 할 일은 파일을 내주는 것과 살아 있다고 답하는 것(/healthz) 둘뿐이고,
// 55 의 다른 서비스처럼 정문(8000)을 거치지 않는다. 정문의 일은 토큰 검증인데 여기엔 지킬 API 가 없다.
//
// **wasm 의 Content-Type 을 application/wasm 으로 준다.** 틀리면 브라우저가 스트리밍 컴파일을
// 거절하고 web-ifc 가 느린 길로 돌거나 실패한다.
import { createServer } from 'node:http'
import { createReadStream, statSync } from 'node:fs'
import { extname, join, normalize, resolve, sep } from 'node:path'

const ROOT = resolve(process.env.ONTOLOGY_EDITOR_DIST || 'dist')
const [host, port] = (process.env.ONTOLOGY_EDITOR_ADDR || '0.0.0.0:8084').split(/:(?=\d+$)/)

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
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

function log(fields) {
  console.log(JSON.stringify({ time: new Date().toISOString(), ...fields }))
}

const server = createServer((req, res) => {
  const started = Date.now()
  const done = (status) => log({ msg: 'request', method: req.method, path: req.url, status, ms: Date.now() - started })

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' }).end()
    return done(405)
  }

  const path = decodeURIComponent((req.url || '/').split('?')[0])
  if (path === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }).end('ok')
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

server.listen(Number(port), host, () => log({ msg: 'listening', addr: `${host}:${port}`, root: ROOT }))
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => server.close(() => process.exit(0)))
}
