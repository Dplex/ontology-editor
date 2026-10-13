// 온톨로지 질의의 "지금 화면(반영 전)"(ADR-0050). 화면이 지금 모델의 TTL 을 올리면 OS 임시 폴더에 토큰 이름으로 둔다.
//
//   POST /__ask/screen?token=<16~40자 영숫자>&title=<건물 이름>   본문: TTL 그대로(text/turtle)  → { source: "screen-<토큰>", bytes }
//
// gemini 의 도구(scripts/onto-mcp.mjs)가 ONTO_SCREENS 로 이 폴더를 출처로 읽는다(scripts/onto-sources.mjs). 반영본(data/.layouts)과 달리
// **버전이 아니고 남기지 않는다** — 같은 토큰이면 덮어쓰고, `KEEP_MS` 동안 안 쓰면(올리지도 묻지도 않으면) 지운다. 토큰은 창을 연 페이지마다
// 하나다(scripts/docs-chat.js). 질문 본문(64KB)에 TTL 을 싣지 않는 이유는 크기다 — 성수 TTL 은 5MB 남짓이다.
//
// 8084 는 사내망 누구나 연다. 그래서 한 파일 `MAX_BYTES`, 폴더 합계 `MAX_TOTAL`, 동시 업로드 `MAX_UPLOADS` 로 디스크를 못 채우게 막고,
// 끊긴 업로드의 .part 도 지운다.
import { createWriteStream, mkdirSync, readdirSync, renameSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const MAX_BYTES = 64 * 1024 * 1024
const MAX_TOTAL = 512 * 1024 * 1024
const MAX_UPLOADS = 4
export const KEEP_MS = 2 * 60 * 60 * 1000
const PART_MS = 10 * 60 * 1000
const MAX_FILES = 40
const TOKEN = /^[a-z0-9]{16,40}$/

/** 화면 기준 TTL 을 방금 썼다고 알린다(질문이 그 출처를 고를 때 serve.mjs 가 부른다). 쓰이는 동안은 지우지 않게. */
export function touchScreen(file) {
  try {
    const now = new Date()
    utimesSync(file, now, now)
  } catch { /* 이미 지웠으면 그만이다 */ }
}

export function createScreenStore({ dir, log = () => {} }) {
  mkdirSync(dir, { recursive: true })
  let uploading = 0

  /** 폴더의 파일들. 다른 정리와 겹쳐 사라진 것은 건너뛴다. */
  function list() {
    const out = []
    for (const f of readdirSync(dir)) {
      try {
        const st = statSync(join(dir, f))
        out.push({ f, t: st.mtimeMs, size: st.size })
      } catch { /* 사이에 지워졌다 */ }
    }
    return out
  }

  /** 오래된 것·넘치는 것·끊긴 .part 를 지운다. 남은 합계 크기를 돌려준다. */
  function reap(now = Date.now()) {
    const files = list()
    for (const { f, t } of files) if (f.endsWith('.part') && now - t > PART_MS) rmSync(join(dir, f), { force: true })
    const ttl = files.filter(({ f }) => f.endsWith('.ttl')).sort((a, b) => b.t - a.t)
    let total = 0
    ttl.forEach(({ f, t, size }, i) => {
      if (now - t > KEEP_MS || i >= MAX_FILES) {
        rmSync(join(dir, f), { force: true })
        rmSync(join(dir, `${f.slice(0, -4)}.json`), { force: true })
      } else total += size
    })
    return total
  }

  return async function screen(req, res) {
    const json = (status, body) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify(body))
    }
    // 받지 않을 요청도 본문은 비워 준다 — 안 읽고 답하면 연결이 끊겨 창이 까닭을 못 본다.
    const refuse = (status, error) => {
      req.resume()
      json(status, { error })
    }
    if (req.method !== 'POST') return refuse(405, 'POST 만')
    const url = new URL(req.url || '/', 'http://x')
    const token = url.searchParams.get('token') || ''
    if (!TOKEN.test(token)) return refuse(400, '토큰은 16~40자 영숫자')
    if (uploading >= MAX_UPLOADS) return refuse(429, '지금 올리는 화면이 많다. 잠시 뒤에 다시')
    const declared = Number(req.headers['content-length'] || 0)
    if (declared > MAX_BYTES) return refuse(413, `TTL 은 ${MAX_BYTES / 1024 / 1024}MB 까지`)
    if (reap() + declared > MAX_TOTAL) return refuse(507, '화면 기준 임시 폴더가 찼다. 잠시 뒤에 다시')
    const title = (url.searchParams.get('title') || '화면').slice(0, 200)
    const by = (url.searchParams.get('by') || '').slice(0, 80)
    const part = join(dir, `${token}.${process.pid}.${Date.now()}.part`)
    uploading++
    try {
      const out = createWriteStream(part)
      let size = 0
      try {
        for await (const c of req) {
          size += c.length
          if (size > MAX_BYTES) {
            out.destroy()
            rmSync(part, { force: true })
            return refuse(413, `TTL 은 ${MAX_BYTES / 1024 / 1024}MB 까지`)
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
    } finally {
      uploading--
    }
  }
}
