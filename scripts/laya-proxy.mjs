// Laya 종류 후보(ADR-0057)를 133 의 서버(scripts/laya/serve.py)로 넘긴다. 8084(scripts/serve.mjs)와 dev(vite.config.ts)가 같이 쓴다.
//
//   GET  /__laya        → { enabled, reason? }   편집 화면이 후보 칸을 보일지 정한다
//   POST /__laya/kinds  → serve.py 의 POST /kinds 를 그대로   { states: [단서 글…] } → { results, ms }
//
// 넘기는 길은 이 둘뿐이다(아무 경로나 133 으로 열어 주지 않는다). 주소는 LAYA_URL(예: http://10.251.31.133:8096). 없으면 꺼져 있고,
// 서버가 안 받으면 enabled:false 와 이유를 준다 — 화면은 후보 칸을 감추고 지금의 후보(kind-suggest.ts)만 보인다.
//
// fetch 가 아니라 node:http 로 부른다. 사내 PC 는 NODE_USE_ENV_PROXY=1 이라 fetch 가 사내 프록시로 나가는데, Node 가 NO_PROXY 의
// `10.*.*.*` 꼴을 알아보지 못해 133 에 닿지 않았다(2026-10-13). 그 설정은 node:http 의 기본 agent 에도 걸려서, 따로 만든 agent 로
// 부른다. 133 은 사내망 안이라 프록시를 탈 일이 없다.
import { Agent, request } from 'node:http'

const MAX_BODY = 1 << 20
const direct = new Agent({ keepAlive: true })

function call(url, { method = 'GET', body = null, timeout = 3000 } = {}) {
  return new Promise((resolve, reject) => {
    const req = request(url, { method, agent: direct, headers: body ? { 'Content-Type': 'application/json', 'Content-Length': body.length } : {} }, (res) => {
      const chunks = []
      res.on('data', (c) => chunks.push(c))
      res.on('end', () => resolve({ status: res.statusCode ?? 502, text: Buffer.concat(chunks).toString('utf8') }))
      res.on('error', reject)
    })
    req.setTimeout(timeout, () => req.destroy(Object.assign(new Error(`${timeout / 1000}초 초과`), { name: 'TimeoutError' })))
    req.on('error', reject)
    req.end(body ?? undefined)
  })
}

export function createLayaProxy({ url = process.env.LAYA_URL, log = () => {} } = {}) {
  const base = url ? url.replace(/\/+$/, '') : ''
  return async function laya(req, res) {
    const path = (req.url || '').split('?')[0].replace(/^\/__laya/, '') || '/'
    const json = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify(body))
    }
    if (req.method === 'GET' && path === '/') {
      if (!base) return json(200, { enabled: false, reason: 'LAYA_URL 이 없습니다' })
      try {
        const r = await call(`${base}/health`)
        if (r.status !== 200) return json(200, { enabled: false, reason: `Laya 서버가 ${r.status} 을 줬습니다` })
        return json(200, { enabled: true, ...JSON.parse(r.text) })
      } catch (e) {
        return json(200, { enabled: false, reason: `Laya 서버에 닿지 않습니다 (${e?.message ?? e})` })
      }
    }
    if (req.method === 'POST' && path === '/kinds') {
      if (!base) return json(503, { error: 'LAYA_URL 이 없습니다' })
      const chunks = []
      let size = 0
      for await (const c of req) {
        size += c.length
        if (size > MAX_BODY) return json(413, { error: '요청이 너무 큽니다' })
        chunks.push(c)
      }
      const started = Date.now()
      try {
        const r = await call(`${base}/kinds`, { method: 'POST', body: Buffer.concat(chunks), timeout: 20_000 })
        log({ msg: 'laya', status: r.status, ms: Date.now() - started })
        res.writeHead(r.status, { 'Content-Type': 'application/json; charset=utf-8' })
        return res.end(r.text)
      } catch (e) {
        log({ msg: 'laya failed', error: String(e?.message ?? e) })
        return json(502, { error: 'Laya 서버에 닿지 않습니다' })
      }
    }
    json(404, { error: 'not found' })
  }
}
