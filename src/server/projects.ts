// 프로젝트(OE-UI-02·03, OE-WF-06). 에디터의 첫 화면은 프로젝트 목록이고, 초기 구축 작업본은 [새 프로젝트]로만 만든다.
// 실제 DB 대신 서버의 파일이다(2026-10-09 사용자 결정, D-INT 결정 전 ①파일 — floor-state.ts·layouts.ts 와 같다).
//
// 프로젝트는 이름·사이트 이름과 그 프로젝트가 쓰는 IFC(data/ 상대 경로)의 묶음이다. 같은 IFC 로 프로젝트를 여럿 만들 수 있고
// (OE-UI-02 AC4), 그래서 임시 저장본·잠금·반영 버전의 열쇠는 파일 경로 앞에 `@프로젝트id|` 를 붙인 것이다(saved-edits.ts dataKeyPaths).
// 구축 여부는 따로 적지 않고 그 열쇠의 반영 버전(layouts.ts)이 있는지로 읽는다 — 적는 곳이 둘이면 어긋난다.
//
// 층 구성(건물·층)은 IFC 를 열어야 안다. 서버는 IFC 를 읽지 않으므로, 화면이 프로젝트를 처음 열 때 센 것을 `summary` 로 올려 두고
// 목록이 그것으로 건물 수·층 수·층 범위를 보인다. 아직 연 적이 없으면 없다.
//
// data/.projects/<id>.json   { id, name, site, paths, createdAt, createdBy, summary? }
// data/uploads/<시각>-<이름>.ifc   [새 프로젝트]에서 올린 IFC. data/ 목록에도 보인다.
//
// 경로(`/__data` 아래):
//   GET  /__projects                      [{ …프로젝트, built, drafts }] — 새것부터
//   POST /__projects                      몸통 { name, site, paths } → 프로젝트(쓰기 사람만)
//   PUT  /__projects?id=I&summary         몸통 { buildings: [{ name, storeys: [{ key, name, elevation }] }] }
//   POST /__upload?name=N                 몸통 IFC 그대로 → { path }(쓰기 사람만)
import { randomBytes } from 'node:crypto'
import { createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { basename, join } from 'node:path'
import { draftSummary } from './floor-state'
import { currentVersion } from './layouts'
import { dataKeyPaths, PROJECT_ID } from './saved-edits'

export type ProjectStorey = { key: string; name: string; elevation: number }
export type ProjectSummary = { buildings: { name: string; storeys: ProjectStorey[] }[] }
export type Project = {
  id: string
  name: string
  site: string
  /** 쓰는 IFC 의 data/ 상대 경로. 순서가 합치기의 기준이다(saved-edits.ts). */
  paths: string[]
  createdAt: string
  createdBy: string
  summary?: ProjectSummary
}
export type ProjectRow = Project & {
  /** 열쇠(`@id|경로…`). 임시 저장본·잠금·반영 버전이 이 열쇠를 쓴다. */
  key: string
  /** 반영(구축)한 버전. 없으면 구축 전이다. */
  built: { version: number; at: string; by: string } | null
  /** 층별 임시 저장본(누가·언제). */
  drafts: { floor: string; by: string; savedAt: string }[]
}

/** 올리는 IFC 하나의 상한. 성수 기계가 400MB 남짓이다. */
const MAX_UPLOAD = 1024 * 1024 * 1024
const MAX_JSON = 1024 * 1024

export const projectKey = (p: Pick<Project, 'id' | 'paths'>) => [`@${p.id}`, ...p.paths].join('|')

type Writer = (req: IncomingMessage, res: ServerResponse) => { name: string } | null

export function projects(root: string, writer: Writer, now: () => Date = () => new Date()) {
  const dir = join(root, '.projects')
  const json = (res: ServerResponse, status: number, body: unknown) => {
    res.statusCode = status
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.end(JSON.stringify(body))
  }
  const read = (id: string): Project | null => {
    try {
      return JSON.parse(readFileSync(join(dir, `${id}.json`), 'utf-8')) as Project
    } catch {
      return null
    }
  }
  const write = (p: Project) => {
    mkdirSync(dir, { recursive: true })
    const file = join(dir, `${p.id}.json`)
    const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`
    writeFileSync(tmp, JSON.stringify(p, null, 2))
    renameSync(tmp, file)
  }
  const rows = (): ProjectRow[] =>
    (existsSync(dir) ? readdirSync(dir) : [])
      .filter((n) => n.endsWith('.json'))
      .flatMap((n) => read(n.slice(0, -5)) ?? [])
      .map((p) => {
        const key = projectKey(p)
        return { ...p, key, built: currentVersion(root, key), drafts: draftSummary(root, key) }
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const body = (req: IncomingMessage, limit: number, done: (text: string) => void, res: ServerResponse) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > limit) {
        json(res, 413, { error: '몸통이 너무 큽니다' })
        req.destroy()
      } else chunks.push(c)
    })
    req.on('end', () => {
      if (!res.writableEnded) done(Buffer.concat(chunks).toString('utf-8'))
    })
  }
  const text = (v: unknown, max = 100) => (typeof v === 'string' ? v.trim().slice(0, max) : '')

  function handle(req: IncomingMessage, res: ServerResponse, query: string) {
    const q = new URLSearchParams(query)
    if (req.method === 'GET') return json(res, 200, rows())
    if (req.method === 'PUT' && q.has('summary')) {
      const id = q.get('id') ?? ''
      const p = PROJECT_ID.test(id) ? read(id) : null
      if (!p) return json(res, 404, { error: '없는 프로젝트입니다' })
      return body(req, MAX_JSON, (raw) => {
        const summary = parseSummary(raw)
        if (!summary) return json(res, 400, { error: '층 구성의 모양이 맞지 않습니다' })
        write({ ...p, summary })
        json(res, 200, { ok: true })
      }, res)
    }
    if (req.method !== 'POST') return json(res, 405, { error: `${req.method} 은 받지 않습니다` })
    const who = writer(req, res)
    if (!who) return
    body(req, MAX_JSON, (raw) => {
      let input: { name?: unknown; site?: unknown; paths?: unknown }
      try {
        input = JSON.parse(raw)
      } catch {
        return json(res, 400, { error: 'JSON 이 아닙니다' })
      }
      const name = text(input.name)
      const site = text(input.site)
      const paths = Array.isArray(input.paths) ? input.paths.filter((x): x is string => typeof x === 'string') : []
      if (!name) return json(res, 400, { error: '프로젝트 이름을 넣으세요' })
      if (!site) return json(res, 400, { error: '사이트 이름을 넣으세요' })
      // 프로젝트는 반드시 IFC 를 쓴다(OE-UI-02 "BIM(IFC 형식) 파일 업로드를 요구한다").
      if (!paths.length || !dataKeyPaths(root, paths.join('|'))) return json(res, 400, { error: 'IFC 파일을 올리세요' })
      const p: Project = { id: `p${randomBytes(6).toString('hex')}`, name, site, paths, createdAt: now().toISOString(), createdBy: who.name }
      write(p)
      json(res, 200, { ...p, key: projectKey(p), built: null, drafts: [] } satisfies ProjectRow)
    }, res)
  }

  /** IFC 올리기. 몸통을 바로 디스크에 흘려 쓴다(수백 MB 를 메모리에 모으지 않는다). 다 받은 뒤에 이름을 붙여 반쯤 쓴 파일이 목록에 안 보이게 한다. */
  function upload(req: IncomingMessage, res: ServerResponse, query: string) {
    if (req.method !== 'POST') return json(res, 405, { error: `${req.method} 은 받지 않습니다` })
    const who = writer(req, res)
    if (!who) return
    const raw = basename(new URLSearchParams(query).get('name') ?? '')
    const safe = raw.replace(/[^\p{L}\p{N}._ -]/gu, '_').slice(-80)
    if (!safe.toLowerCase().endsWith('.ifc') || safe.startsWith('.')) return json(res, 400, { error: 'IFC 파일(.ifc)만 받습니다' })
    const stamp = now().toISOString().replace(/[-:]/g, '').replace(/\..+$/, '').replace('T', '-')
    const rel = `uploads/${stamp}-${safe}`
    const target = join(root, rel)
    mkdirSync(join(root, 'uploads'), { recursive: true })
    const tmp = join(root, 'uploads', `.${randomBytes(6).toString('hex')}.part`)
    const out = createWriteStream(tmp)
    let size = 0
    let failed = false
    const fail = (status: number, error: string) => {
      if (failed) return
      failed = true
      out.destroy()
      rmSync(tmp, { force: true })
      json(res, status, { error })
    }
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > MAX_UPLOAD) {
        fail(413, '파일이 너무 큽니다(1GB 까지)')
        req.destroy()
      }
    })
    req.on('error', () => fail(400, '받다가 끊겼습니다'))
    out.on('error', () => fail(500, '저장하지 못했습니다'))
    out.on('finish', () => {
      if (failed) return
      if (!size) return fail(400, '빈 파일입니다')
      renameSync(tmp, target)
      json(res, 200, { path: rel, size })
    })
    req.pipe(out)
  }

  return { handle, upload }
}

/** 화면이 올린 층 구성을 받는 모양으로 좁힌다. 맞지 않으면 null. */
export function parseSummary(raw: string): ProjectSummary | null {
  try {
    const v = JSON.parse(raw) as { buildings?: unknown }
    if (!Array.isArray(v.buildings) || v.buildings.length > 200) return null
    const buildings = v.buildings.map((b) => {
      const storeys = Array.isArray(b?.storeys) ? b.storeys : null
      if (!storeys || storeys.length > 500 || typeof b.name !== 'string') throw new Error('shape')
      return {
        name: String(b.name).slice(0, 100),
        storeys: storeys.map((s: { key?: unknown; name?: unknown; elevation?: unknown }) => {
          if (typeof s?.key !== 'string' || typeof s.name !== 'string' || typeof s.elevation !== 'number' || !Number.isFinite(s.elevation)) throw new Error('shape')
          return { key: s.key.slice(0, 200), name: s.name.slice(0, 100), elevation: s.elevation }
        }),
      }
    })
    return { buildings }
  } catch {
    return null
  }
}
