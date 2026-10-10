// 반영한 레이아웃과 버전(OE-WF-10~13·18~20, OE-GEN-05·09, OE-SYNC-01·02, ADR-0037). 실제 DT·DB 대신 서버의 파일이다 — "DT 3D 맵과
// 온톨로지에 반영된 것" 은 이 저장소의 현재 버전 폴더다(2026-10-09 사용자 결정, D-INT 결정 전 ①파일).
//
// data/.layouts/<열쇠 해시>/
//   key.json            { key, paths } — 열쇠는 연 파일의 data/ 상대 경로를 `|` 로 이은 것(saved-edits.ts 와 같다)
//   current.json        { version } — 지금 반영된 버전. 임시 파일에 쓰고 rename 한다
//   v1/ v2/ …           버전마다 한 폴더: meta.json + ontology.ttl · edits.json · tree.json · report.json · model.glb · geojson/*.geojson
//   .stage-<id>/        올리는 중인 판. 다 올린 뒤 [반영] 하면 vN 으로 rename 한다 — 반만 반영된 버전이 생기지 않는다(OE-SYNC-02)
//
// 경로(`/__data` 아래 `/__layouts`):
//   GET  ?                                건물마다 현재 버전 [{ key, paths, current, at, by }]
//   GET  ?key=K                           { current, versions: [meta…] } — 최근 7일(OE-WF-20)과 현재 버전, 새것부터
//   GET  ?key=K&v=N&file=F                그 버전의 파일
//   PUT  ?key=K&stage=S&file=F            올리는 판에 파일 하나(몸통 그대로)
//   POST ?key=K&stage=S&publish           몸통 { by, floors, summary } → 새 버전(meta)
//   POST ?key=K&rollback=N                몸통 { by } → 그 버전을 새 버전으로 다시 반영(OE-WF-19)
import { createHash, randomBytes } from 'node:crypto'
import { cpSync, createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { dirname, join } from 'node:path'
import { dataKeyPaths } from './saved-edits'

/** 버전 히스토리에 보이고 되돌릴 수 있는 기간(OE-WF-20). 지난 버전은 감추기만 하고 파일은 둔다. */
export const KEEP_DAYS = 7
/** 파일 하나의 상한. 성수 GLB 가 수백 MB 다. */
const MAX_BYTES = 1024 * 1024 * 1024
/** 반영에 꼭 있어야 하는 파일. 하나라도 없으면 반영하지 않는다(TTL 만 바뀌고 GeoJSON 은 옛것인 상태를 만들지 않는다). */
export const REQUIRED = ['ontology.ttl', 'edits.json', 'tree.json'] as const

export type VersionMeta = {
  version: number
  /** 반영 일시(ISO). */
  at: string
  /** 반영자. */
  by: string
  /** 대상 층 이름. */
  floors: string[]
  /** 변경 요약(화면이 만든 것 그대로). */
  summary: Record<string, unknown>
  kind: 'publish' | 'rollback'
  /** 되돌리기면 원래 버전. */
  from?: number
  /** 이 버전 폴더의 파일(상대 경로). */
  files: string[]
}

const STAGE = /^[a-z0-9]{8,40}$/
/** 버전 안의 파일 이름. 하위 폴더는 geojson/ 하나뿐이고 위로 올라가는 경로는 받지 않는다. */
export function validFile(name: string): boolean {
  if (/^(ontology\.ttl|edits\.json|tree\.json|report\.json|model\.glb)$/.test(name)) return true
  const m = /^geojson\/([^/\\]+)$/.exec(name)
  return !!m && m[1].endsWith('.geojson') && !m[1].startsWith('.')
}

export type LayoutOptions = {
  now?: () => Date
  /** 판 폴더를 버전 폴더로 옮기기. 시험이 Windows 의 "아직 잡힌 파일" 실패를 흉내 내려고 바꾼다. */
  rename?: (from: string, to: string) => void
  /**
   * 쓰기(올리기·반영·되돌리기)를 해도 되는 사람. 안 되면 답을 보내고 null(users.ts 의 writer). 없으면 반영자를 몸통의 `by` 로 받는다
   * — 사람 목록이 없는 시험용이다.
   */
  writer?: (req: IncomingMessage, res: ServerResponse) => { name: string } | null
  /** 반영·되돌리기를 시스템 로그에 남긴다(activity-log.ts). */
  onVersion?: (e: { type: 'publish' | 'rollback'; user: string; key: string; floors: string[]; version: number }) => void
}

export function layouts(root: string, options: LayoutOptions = {}) {
  const now = options.now ?? (() => new Date())
  const base = join(root, '.layouts')
  const idOf = (key: string) => createHash('sha1').update(key).digest('hex').slice(0, 16)
  const dirOf = (key: string) => join(base, idOf(key))

  const readJson = <T>(file: string): T | null => {
    try {
      return JSON.parse(readFileSync(file, 'utf-8')) as T
    } catch {
      return null
    }
  }
  /** 쓰다 멈춰도 반쯤 쓴 파일이 남지 않게 임시 파일에 쓰고 rename 한다. */
  const writeAtomic = (file: string, text: string) => {
    const tmp = `${file}.${randomBytes(4).toString('hex')}.tmp`
    writeFileSync(tmp, text)
    renameSync(tmp, file)
  }
  const current = (dir: string) => readJson<{ version: number }>(join(dir, 'current.json'))?.version ?? null
  const versionsOf = (dir: string): VersionMeta[] =>
    existsSync(dir)
      ? readdirSync(dir)
          .filter((n) => /^v\d+$/.test(n))
          .flatMap((n) => readJson<VersionMeta>(join(dir, n, 'meta.json')) ?? [])
          .sort((a, b) => b.version - a.version)
      : []
  const fresh = (m: VersionMeta) => now().getTime() - new Date(m.at).getTime() <= KEEP_DAYS * 24 * 3600 * 1000
  const filesIn = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
      d.isDirectory() ? readdirSync(join(dir, d.name)).map((n) => `${d.name}/${n}`) : d.name === 'meta.json' ? [] : [d.name],
    )

  const rename = options.rename ?? renameSync
  const LOCKED = ['EPERM', 'EBUSY', 'EACCES']
  /**
   * 판 폴더를 버전 폴더로. Windows 는 하위 폴더(geojson/)에 누가 핸들을 열어 두면(파일 감시 — dev 서버의 vite 가 data/ 를 감시했다) 부모 폴더를
   * 옮기지 못한다(EPERM). 안의 것을 하나씩 옮기는 것은 된다 — 그때는 버전 폴더를 만들고 하나씩 옮기되 meta.json 을 맨 끝에 옮긴다. 버전 목록은
   * meta.json 이 있는 폴더만 세므로 도중에 멈춘 폴더는 버전이 아니다. 합성 성수(GLB 224MB)는 올리는 동안 감시가 붙어 반영이 늘 실패했다.
   */
  function moveStage(stage: string, target: string) {
    try {
      rename(stage, target)
      return
    } catch (e) {
      if (!LOCKED.includes((e as NodeJS.ErrnoException).code ?? '')) throw e
    }
    mkdirSync(target)
    const names = readdirSync(stage).sort((a, b) => Number(a === 'meta.json') - Number(b === 'meta.json'))
    for (const n of names) rename(join(stage, n), join(target, n))
    rmSync(stage, { recursive: true, force: true })
  }
  /** 올린 판(또는 옛 버전을 베낀 판)을 새 버전으로 넣는다. 번호가 겹치면(동시에 둘이 반영) 다음 번호로 다시 한다. */
  async function commit(dir: string, stage: string, meta: Omit<VersionMeta, 'version' | 'files'>): Promise<VersionMeta> {
    for (let tries = 0; tries < 5; tries++) {
      const version = (versionsOf(dir)[0]?.version ?? 0) + 1
      const full: VersionMeta = { version, ...meta, files: filesIn(stage).sort() }
      writeFileSync(join(stage, 'meta.json'), JSON.stringify(full, null, 2))
      const target = join(dir, `v${version}`)
      if (existsSync(target)) continue
      try {
        moveStage(stage, target)
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'EEXIST' || existsSync(join(target, 'meta.json'))) continue
        throw new Error(`올린 파일을 버전 폴더로 옮기지 못했습니다(${(e as NodeJS.ErrnoException).code ?? (e as Error).message})`)
      }
      writeAtomic(join(dir, 'current.json'), JSON.stringify({ version }))
      return full
    }
    throw new Error('버전 번호를 잡지 못했습니다')
  }

  const json = (res: ServerResponse, status: number, body: unknown) => {
    res.statusCode = status
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.end(JSON.stringify(body))
  }
  const readBody = (req: IncomingMessage) =>
    new Promise<string>((resolve, reject) => {
      const chunks: Buffer[] = []
      let size = 0
      req.on('data', (c: Buffer) => {
        size += c.length
        if (size > 1024 * 1024) reject(new Error('몸통이 너무 큽니다'))
        else chunks.push(c)
      })
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
      req.on('error', reject)
    })

  return (req: IncomingMessage, res: ServerResponse, query: string) => {
    const q = new URLSearchParams(query)
    const key = q.get('key')
    if (!key) {
      if (req.method !== 'GET') return json(res, 405, { error: 'key 가 없습니다' })
      const list = existsSync(base)
        ? readdirSync(base).flatMap((id) => {
            const dir = join(base, id)
            const k = readJson<{ key: string; paths: string[] }>(join(dir, 'key.json'))
            const v = current(dir)
            const meta = v ? readJson<VersionMeta>(join(dir, `v${v}`, 'meta.json')) : null
            return k && meta ? [{ key: k.key, paths: k.paths, current: v, at: meta.at, by: meta.by }] : []
          })
        : []
      return json(res, 200, list)
    }
    const paths = dataKeyPaths(root, key)
    if (!paths) return json(res, 404, { error: 'data/ 에 없는 파일입니다' })
    const dir = dirOf(key)

    if (req.method === 'GET' || req.method === 'HEAD') {
      const v = q.get('v')
      const file = q.get('file')
      if (v && file) {
        if (!/^\d+$/.test(v) || !validFile(file)) return json(res, 404, { error: '없는 파일입니다' })
        const at = join(dir, `v${v}`, file)
        if (!existsSync(at)) return json(res, 404, { error: '없는 파일입니다' })
        res.setHeader('Content-Length', statSync(at).size)
        res.setHeader('Content-Type', file.endsWith('.glb') ? 'model/gltf-binary' : file.endsWith('.ttl') ? 'text/turtle; charset=utf-8' : 'application/json; charset=utf-8')
        return void createReadStream(at).pipe(res)
      }
      const cur = current(dir)
      return json(res, 200, { current: cur, versions: versionsOf(dir).filter((m) => m.version === cur || fresh(m)) })
    }

    const stage = q.get('stage')
    const writer = options.writer ? options.writer(req, res) : { name: '' }
    if (!writer) return
    // 파일 하나 올리기.
    if (req.method === 'PUT') {
      const file = q.get('file')
      if (!stage || !STAGE.test(stage) || !file || !validFile(file)) return json(res, 400, { error: '올릴 판·파일 이름이 잘못됐습니다' })
      const at = join(dir, `.stage-${stage}`, file)
      mkdirSync(dirname(at), { recursive: true })
      let size = 0
      const out = createWriteStream(at)
      req.on('data', (c: Buffer) => {
        size += c.length
        if (size > MAX_BYTES) {
          req.destroy()
          out.destroy()
          json(res, 413, { error: '파일이 너무 큽니다' })
        }
      })
      req.pipe(out)
      // 'finish' 는 다 썼다는 뜻이지 파일을 닫았다는 뜻이 아니다. 닫기 전에 답하면 곧 이어지는 반영의 폴더 옮기기가 Windows 에서 걸린다.
      out.on('close', () => {
        if (!res.writableEnded) json(res, 200, { file, size })
      })
      out.on('error', (e) => {
        if (!res.writableEnded) json(res, 500, { error: e.message })
      })
      return
    }
    if (req.method !== 'POST') return json(res, 405, { error: `${req.method} 은 받지 않습니다` })

    readBody(req)
      .then(async (text) => {
        const body = (text ? JSON.parse(text) : {}) as { by?: string; floors?: string[]; summary?: Record<string, unknown> }
        const by = (writer.name || body.by || '').trim()
        if (!by) return json(res, 400, { error: '반영자가 없습니다' })
        mkdirSync(dir, { recursive: true })
        if (!existsSync(join(dir, 'key.json'))) writeFileSync(join(dir, 'key.json'), JSON.stringify({ key, paths }))
        // 오래 남은 올리던 판(반영하지 않고 떠난 것)을 치운다.
        for (const n of readdirSync(dir).filter((x) => x.startsWith('.stage-'))) {
          const at = join(dir, n)
          if (now().getTime() - statSync(at).mtimeMs > 24 * 3600 * 1000) rmSync(at, { recursive: true, force: true })
        }

        if (q.has('publish')) {
          if (!stage || !STAGE.test(stage)) return json(res, 400, { error: '올릴 판이 없습니다' })
          const at = join(dir, `.stage-${stage}`)
          if (!existsSync(at)) return json(res, 400, { error: '올린 파일이 없습니다' })
          const have = filesIn(at)
          const missing = REQUIRED.filter((f) => !have.includes(f))
          if (!have.some((f) => f.startsWith('geojson/'))) missing.push('geojson/*.geojson' as never)
          if (missing.length) return json(res, 400, { error: `반영하지 않았습니다 — 빠진 파일: ${missing.join(', ')}. 지금 반영된 버전은 그대로입니다.` })
          const meta = await commit(dir, at, { at: now().toISOString(), by, floors: body.floors ?? [], summary: body.summary ?? {}, kind: 'publish' })
          options.onVersion?.({ type: 'publish', user: by, key, floors: meta.floors, version: meta.version })
          return json(res, 200, meta)
        }

        const from = Number(q.get('rollback'))
        if (q.has('rollback')) {
          const old = readJson<VersionMeta>(join(dir, `v${from}`, 'meta.json'))
          if (!old) return json(res, 404, { error: `v${from} 이 없습니다` })
          if (!fresh(old)) return json(res, 400, { error: `v${from} 은 ${KEEP_DAYS}일이 지나 되돌릴 수 없습니다` })
          if (old.version === current(dir)) return json(res, 400, { error: `v${from} 은 지금 반영된 버전입니다` })
          const at = join(dir, `.stage-rb${randomBytes(6).toString('hex')}`)
          cpSync(join(dir, `v${from}`), at, { recursive: true })
          rmSync(join(at, 'meta.json'))
          const meta = await commit(dir, at, { at: now().toISOString(), by, floors: old.floors, summary: old.summary, kind: 'rollback', from })
          options.onVersion?.({ type: 'rollback', user: by, key, floors: meta.floors, version: meta.version })
          return json(res, 200, meta)
        }
        return json(res, 400, { error: 'publish 또는 rollback 이 필요합니다' })
      })
      .catch((e) => json(res, 500, { error: e instanceof Error ? e.message : String(e) }))
  }
}
