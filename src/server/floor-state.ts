// 층마다의 임시 저장본과 편집 잠금(OE-WF-01~05, OE-COM-03·05·06). 실제 DB 대신 서버의 파일이다(2026-10-09 사용자 결정).
//
// - 임시 저장본: 층(또는 층이 없는 편집의 건물 조각 `*`)마다 하나. 다시 저장하면 덮는다(OE-WF-03). 사람의 것이 아니라 층의 것이라(OE-COM-03) 누구나
//   이어서 편집한다. 반영하면 쓸모가 없어 화면이 지운다.
// - 잠금: 층마다 한 사람. 편집을 시작하면 잡고, 화면이 1분마다 다시 잡아 늘이며, [편집 종료]·층 바꾸기·창 닫기 때 푼다(OE-COM-06). 브라우저가 죽어
//   풀지 못하면 2분 뒤 저절로 풀린다. 남이 잡은 층은 409 와 그 사람 이름을 돌려준다(OE-COM-05). 다른 층은 막지 않는다. 보기는 막지 않는다.
//
// data/.drafts/<열쇠 해시>/<층 해시>.json   { floor, by, savedAt, file }
// data/.locks/<열쇠 해시>/<층 해시>.json    { floor, by, until }
//
// 경로(`/__data` 아래):
//   GET    /__drafts?key=K                { [floor]: { by, savedAt, file } }
//   PUT    /__drafts?key=K&floor=F         몸통 편집 파일(그 층 조각)
//   DELETE /__drafts?key=K[&floor=F]       그 층(없으면 전부)
//   GET    /__locks?key=K                 [{ floor, by, until }] — 지난 것은 빼고
//   PUT    /__locks?key=K&floor=F          잡기·늘이기. 남이 잡았으면 409 { by }
//   DELETE /__locks?key=K&floor=F          풀기(잡은 사람만)
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'
import { parseEditFile } from '../lib/edit-file'
import { dataKeyPaths } from './saved-edits'

/** 잠금이 저절로 풀리는 시간. 화면은 그 절반마다 다시 잡는다. */
export const LOCK_MS = 2 * 60 * 1000
const MAX_BYTES = 32 * 1024 * 1024

type Writer = (req: IncomingMessage, res: ServerResponse) => { name: string } | null

export function floorState(root: string, writer: Writer, now: () => Date = () => new Date()) {
  const hash = (s: string) => createHash('sha1').update(s).digest('hex').slice(0, 16)
  const dirOf = (kind: 'drafts' | 'locks', key: string) => join(root, `.${kind}`, hash(key))
  const fileOf = (kind: 'drafts' | 'locks', key: string, floor: string) => join(dirOf(kind, key), `${hash(floor)}.json`)
  const readAll = <T>(dir: string): T[] =>
    existsSync(dir)
      ? readdirSync(dir).flatMap((n) => {
          try {
            return [JSON.parse(readFileSync(join(dir, n), 'utf-8')) as T]
          } catch {
            return []
          }
        })
      : []
  const json = (res: ServerResponse, status: number, body: unknown) => {
    res.statusCode = status
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.end(JSON.stringify(body))
  }
  type Lock = { floor: string; by: string; until: string }
  const live = (l: Lock) => new Date(l.until).getTime() > now().getTime()

  function drafts(req: IncomingMessage, res: ServerResponse, query: string) {
    const q = new URLSearchParams(query)
    const key = q.get('key') ?? ''
    const floor = q.get('floor')
    if (!dataKeyPaths(root, key)) return json(res, 404, { error: 'data/ 에 없는 파일입니다' })
    if (req.method === 'GET') {
      const out: Record<string, unknown> = {}
      for (const d of readAll<{ floor: string; by: string; savedAt: string; file: unknown }>(dirOf('drafts', key))) out[d.floor] = { by: d.by, savedAt: d.savedAt, file: d.file }
      return json(res, 200, out)
    }
    const who = writer(req, res)
    if (!who) return
    if (req.method === 'DELETE') {
      if (floor) rmSync(fileOf('drafts', key, floor), { force: true })
      else rmSync(dirOf('drafts', key), { recursive: true, force: true })
      return json(res, 200, { ok: true })
    }
    if (req.method !== 'PUT' || !floor) return json(res, 400, { error: 'floor 가 필요합니다' })
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > MAX_BYTES) {
        json(res, 413, { error: '임시 저장본이 너무 큽니다' })
        req.destroy()
      } else chunks.push(c)
    })
    req.on('end', () => {
      if (res.writableEnded) return
      const file = parseEditFile(Buffer.concat(chunks).toString('utf-8'))
      if (typeof file === 'string') return json(res, 400, { error: file })
      mkdirSync(dirOf('drafts', key), { recursive: true })
      const savedAt = now().toISOString()
      writeFileSync(fileOf('drafts', key, floor), JSON.stringify({ floor, by: who.name, savedAt, file }))
      json(res, 200, { floor, by: who.name, savedAt })
    })
  }

  function locks(req: IncomingMessage, res: ServerResponse, query: string) {
    const q = new URLSearchParams(query)
    const key = q.get('key') ?? ''
    const floor = q.get('floor')
    if (!dataKeyPaths(root, key)) return json(res, 404, { error: 'data/ 에 없는 파일입니다' })
    if (req.method === 'GET') return json(res, 200, readAll<Lock>(dirOf('locks', key)).filter(live))
    const who = writer(req, res)
    if (!who) return
    if (!floor) return json(res, 400, { error: 'floor 가 필요합니다' })
    const at = fileOf('locks', key, floor)
    const held = existsSync(at) ? (JSON.parse(readFileSync(at, 'utf-8')) as Lock) : null
    const other = held && live(held) && held.by !== who.name ? held : null
    if (req.method === 'DELETE') {
      if (held && !other) rmSync(at, { force: true })
      return json(res, 200, { ok: true })
    }
    if (req.method !== 'PUT') return json(res, 405, { error: `${req.method} 은 받지 않습니다` })
    if (other) return json(res, 409, { error: `${other.by}님이 편집 중입니다`, by: other.by, until: other.until })
    mkdirSync(dirOf('locks', key), { recursive: true })
    const lock: Lock = { floor, by: who.name, until: new Date(now().getTime() + LOCK_MS).toISOString() }
    writeFileSync(at, JSON.stringify(lock))
    return json(res, 200, lock)
  }

  return { drafts, locks }
}
