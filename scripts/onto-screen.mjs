// 온톨로지 질의의 "지금 화면(반영 전)"(ADR-0050). 화면이 지금 모델의 TTL 을 올리면 OS 임시 폴더에 토큰 이름으로 둔다.
//
//   POST /__ask/screen?token=<16~40자 영숫자>&title=<건물 이름>   본문: TTL 그대로(text/turtle)  → { source: "screen-<토큰>", bytes }
//
// gemini 의 도구(scripts/onto-mcp.mjs)가 ONTO_SCREENS 로 이 폴더를 출처로 읽는다(scripts/onto-sources.mjs). 반영본(data/.layouts)과 달리
// **버전이 아니고 남기지 않는다** — 같은 토큰이면 덮어쓰고, `KEEP_MS` 동안 다시 안 올리면 지운다. 토큰은 브라우저 탭마다 하나다
// (scripts/docs-chat.js). 질문 본문(64KB)에 TTL 을 싣지 않는 이유는 크기다 — 성수 TTL 은 MB 단위다.
import { mkdirSync, readdirSync, renameSync, rmSync, statSync, writeFileSync, createWriteStream } from 'node:fs'
import { join } from 'node:path'

const MAX_BYTES = 512 * 1024 * 1024
export const KEEP_MS = 2 * 60 * 60 * 1000
const MAX_FILES = 40
const TOKEN = /^[a-z0-9]{16,40}$/

export function createScreenStore({ dir, log = () => {} }) {
  mkdirSync(dir, { recursive: true })

  /** 오래된 것과 넘치는 것을 지운다. 올릴 때마다 한 번. */
  function reap(now = Date.now()) {
    const ttl = readdirSync(dir)
      .filter((f) => f.endsWith('.ttl'))
      .map((f) => ({ f, t: statSync(join(dir, f)).mtimeMs }))
      .sort((a, b) => b.t - a.t)
    ttl.forEach(({ f, t }, i) => {
      if (now - t > KEEP_MS || i >= MAX_FILES) {
        const id = f.slice(0, -4)
        rmSync(join(dir, f), { force: true })
        rmSync(join(dir, `${id}.json`), { force: true })
      }
    })
  }

  return async function screen(req, res) {
    const json = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify(body))
    }
    if (req.method !== 'POST') return json(405, { error: 'POST 만' })
    const url = new URL(req.url || '/', 'http://x')
    const token = url.searchParams.get('token') || ''
    if (!TOKEN.test(token)) return json(400, { error: '토큰은 16~40자 영숫자' })
    const title = (url.searchParams.get('title') || '화면').slice(0, 200)
    const by = (url.searchParams.get('by') || '').slice(0, 80)
    const part = join(dir, `${token}.ttl.part`)
    const out = createWriteStream(part)
    let size = 0
    try {
      for await (const c of req) {
        size += c.length
        if (size > MAX_BYTES) {
          out.destroy()
          rmSync(part, { force: true })
          return json(413, { error: `TTL 은 ${MAX_BYTES / 1024 / 1024}MB 까지` })
        }
        if (!out.write(c)) await new Promise((r) => out.once('drain', r))
      }
      await new Promise((r, j) => out.end((e) => (e ? j(e) : r())))
    } catch (e) {
      out.destroy()
      rmSync(part, { force: true })
      return json(400, { error: String(e?.message ?? e) })
    }
    // 반만 쓴 파일을 도구가 읽지 않게, 다 쓴 뒤에 이름을 바꾼다. 메타가 먼저 있어야 출처 목록에 든다.
    writeFileSync(join(dir, `${token}.json`), JSON.stringify({ title, by, at: new Date().toISOString() }))
    renameSync(part, join(dir, `${token}.ttl`))
    reap()
    log({ msg: 'onto screen', bytes: size })
    json(200, { source: `screen-${token}`, bytes: size })
  }
}
