// 시스템 로그(OE-COM-04, OE-XPRD-01 '레이아웃 반영 / 되돌리기', 사람은 server/users.ts). 편집 시작·임시 저장·저장·반영·되돌리기·편집 종료를 `data/.log.jsonl` 에
// 한 줄씩 쌓는다. 버전 보관 기간(OE-WF-20)과 무관하게 지우지 않는다. 항목은 유형·일시·사용자·사이트(열쇠)·대상 층·버전 번호(반영·되돌리기).
//
// 경로(`/__data` 아래 `/__log`):
//   GET  ?key=K          그 건물의 최근 200줄(새것부터). key 가 없으면 전체 최근 200줄
//   POST                 몸통 { type: 'edit-start' | 'edit-end' | 'draft', key, floors } — 화면에서만 아는 일. 반영·되돌리기·저장은 서버가 적는다
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'

export type LogType = 'edit-start' | 'edit-end' | 'draft' | 'save' | 'publish' | 'rollback'
export type LogEntry = { at: string; type: LogType; user: string; key: string; floors: string[]; version?: number }

const CLIENT_TYPES: readonly LogType[] = ['edit-start', 'edit-end', 'draft']
const SHOWN = 200

export function activityLog(root: string, now: () => Date = () => new Date()) {
  const file = join(root, '.log.jsonl')
  function write(entry: Omit<LogEntry, 'at'>) {
    appendFileSync(file, JSON.stringify({ at: now().toISOString(), ...entry }) + '\n')
  }
  function read(key: string | null): LogEntry[] {
    if (!existsSync(file)) return []
    return readFileSync(file, 'utf-8')
      .split('\n')
      .flatMap((l) => {
        try {
          return l ? [JSON.parse(l) as LogEntry] : []
        } catch {
          return []
        }
      })
      .filter((e) => !key || e.key === key)
      .reverse()
      .slice(0, SHOWN)
  }
  /** 화면이 보내는 일(편집 시작·종료·임시 저장). 사람은 부른 쪽이 확인해 넘긴다. */
  function handle(req: IncomingMessage, res: ServerResponse, query: string, user: () => string | null) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    if (req.method === 'GET') return res.end(JSON.stringify(read(new URLSearchParams(query).get('key'))))
    if (req.method !== 'POST') {
      res.statusCode = 405
      return res.end(JSON.stringify({ error: `${req.method} 은 받지 않습니다` }))
    }
    const who = user()
    if (!who) return
    let text = ''
    req.on('data', (c: Buffer) => {
      text += c.toString('utf-8')
      if (text.length > 64 * 1024) req.destroy()
    })
    req.on('end', () => {
      try {
        const body = JSON.parse(text) as { type?: LogType; key?: string; floors?: string[] }
        if (!body.type || !CLIENT_TYPES.includes(body.type) || typeof body.key !== 'string') throw new Error('type·key 가 잘못됐습니다')
        write({ type: body.type, user: who, key: body.key, floors: Array.isArray(body.floors) ? body.floors.map(String) : [] })
        res.end(JSON.stringify({ ok: true }))
      } catch (e) {
        res.statusCode = 400
        res.end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }))
      }
    })
  }
  return { write, read, handle }
}
