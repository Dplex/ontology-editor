// 사람과 역할(OE-COM-01·02, OE-XPRD-04). 로그인 대신 서버의 `data/.users.json` 목록에서 고른다(2026-10-09 사용자 결정, 서버 파일).
// R1 은 편집 권한을 나누지 않지만, R2 의 "Viewer 는 편집에 진입할 수 없고 Admin·Super Admin 은 편집과 [반영하기] 를 할 수 있다" 를 미리 둔다.
// 화면은 고른 사람을 `X-OE-User` 머리(URL 인코딩한 이름)로 보내고, 서버는 쓰기(저장·반영·되돌리기·로그)마다 그 사람의 역할을 본다.
// 사내망 누구나 이름을 고를 수 있어 보안은 아니다 — 권한 카탈로그(PRD_009) 자리를 흉내 낸 것이다.
//
// 경로(`/__data` 아래 `/__users`):
//   GET  /__users   [{ name, role }]
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'

export type Role = 'viewer' | 'admin' | 'super_admin'
export type User = { name: string; role: Role }

/** 처음 띄울 때 만드는 목록. 사람을 바꾸려면 data/.users.json 을 고친다. */
export const DEFAULT_USERS: User[] = [
  { name: '편집자', role: 'admin' },
  { name: '관리자', role: 'super_admin' },
  { name: '보기 전용', role: 'viewer' },
]
const ROLES: readonly Role[] = ['viewer', 'admin', 'super_admin']

/** 편집·반영할 수 있는 역할. */
export const canEdit = (role: Role) => role !== 'viewer'

export function users(root: string) {
  const file = join(root, '.users.json')
  function list(): User[] {
    if (!existsSync(file)) writeFileSync(file, JSON.stringify(DEFAULT_USERS, null, 2))
    try {
      const raw = JSON.parse(readFileSync(file, 'utf-8')) as unknown
      return Array.isArray(raw)
        ? raw.flatMap((u) => (u && typeof u.name === 'string' && u.name.trim() && ROLES.includes(u.role) ? [{ name: u.name.trim(), role: u.role as Role }] : []))
        : []
    } catch {
      return []
    }
  }
  /** 요청한 사람. 머리가 없거나 목록에 없으면 null. */
  function who(req: IncomingMessage): User | null {
    const raw = req.headers['x-oe-user']
    const name = typeof raw === 'string' ? decodeURIComponent(raw) : ''
    return list().find((u) => u.name === name) ?? null
  }
  /** 쓰기를 해도 되는 사람이면 그 사람, 아니면 답을 보내고 null. */
  function writer(req: IncomingMessage, res: ServerResponse): User | null {
    const u = who(req)
    const deny = (status: number, error: string) => {
      res.statusCode = status
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({ error }))
      return null
    }
    if (!u) return deny(401, '사용자를 고르세요(화면 위의 사용자 칸)')
    if (!canEdit(u.role)) return deny(403, `${u.name}은(는) 보기 전용(Viewer)이라 편집·저장·반영할 수 없습니다`)
    return u
  }
  function handle(req: IncomingMessage, res: ServerResponse) {
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    if (req.method !== 'GET') {
      res.statusCode = 405
      return res.end(JSON.stringify({ error: '사람 목록은 data/.users.json 을 고칩니다' }))
    }
    res.end(JSON.stringify(list()))
  }
  return { list, who, writer, handle }
}
