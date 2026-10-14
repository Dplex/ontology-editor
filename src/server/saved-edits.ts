// 8084 에 남기는 편집(OE-COM-08 "저장 시 변경사항을 웹에서 바로 확인"). data/ 에서 연 IFC 에 대한 편집 파일(lib/edit-file.ts)을
// 서버에 두고, 누가 같은 IFC 를 열든 얹어서 보인다. 임시 저장은 여기에 오지 않는다 — 그 브라우저에만 남는다.
//
// **열쇠는 연 파일 목록이다.** 건축·설비를 합쳐 연 판(`a.ifc + b.ifc`)의 편집은 그 둘을 합친 모델 기준이라, 한 파일만 연
// 판과 섞이면 못 찾는 것이 생긴다. 목록의 순서도 열쇠다 — 합치기는 먼저 연 쪽을 기준 모델로 삼는다(App.vue 의 append).
//
// 저장본은 data/.edits/<열쇠 해시>.json 이고, 덮어쓰기 전 판은 data/.edits/history/ 에 20개까지 남긴다. 사내망 누구나
// 쓸 수 있어서(PoC, 정문 없음) 잘못 덮은 것을 되찾을 길을 남긴다.
//
// **저장은 작업에 묶인다(OE-HIST-03, OE-PIP-15 AC8).** 저장본은 편집 파일 하나지만, 저장할 때마다 어느 작업의 저장인지 같이 받아
// `works` 에 적는다. 층 편집과 다중층 세션은 서로 다른 작업이고, 다중층 세션 안에서 여러 번 저장해도 작업은 하나다 — 같은 id 로 오면
// 마지막 작업을 고친다(영향 층을 더하고 저장 횟수를 센다). 이전 작업은 기준 이력으로 남고, 작업마다 앞 작업 끝의 편집 건수(`base`)와
// 이 작업 끝의 건수(`edits`)를 적어 그 세션에서 생긴 차이를 보인다. 임시 저장·자동 저장은 여기 오지 않으므로 작업을 만들지 않는다.
//
// 경로(`/__data` 아래):
//   GET  /__edits                 저장본 목록 [{ key, paths, count, savedAt }]
//   GET  /__edits?key=…           저장본(편집 파일). 없으면 404
//   GET  /__edits?key=…&works     그 저장본의 작업 목록 [Work…](오래된 것부터). 저장본이 없으면 []
//   PUT  /__edits?key=…[&work=…&kind=floor|multi&storeys=a,b]
//                                 저장. 몸통은 편집 파일. { key, count, savedAt, work }. work 가 없으면 새 층 작업으로 친다
// key 는 연 파일의 data/ 상대 경로를 `|` 로 이은 것이다.
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join, resolve, sep } from 'node:path'
import { countEdits, parseEditFile } from '../lib/edit-file'

/** 편집 파일 하나의 상한. 성수 전부를 고쳐도 몇 MB 다. 넘으면 잘못 온 요청이다. */
const MAX_BYTES = 32 * 1024 * 1024
/** 열쇠마다 남기는 덮어쓰기 전 판. */
const KEEP = 20
/** 저장본마다 남기는 작업 수. 넘으면 오래된 것부터 버린다(편집 파일은 그대로다). */
const KEEP_WORKS = 200
/** 작업 id 모양. 화면이 짓는다. 파일에 그대로 들어가므로 글자를 좁힌다. */
const WORK_ID = /^[A-Za-z0-9_-]{1,64}$/

type Saved = { key: string; paths: string[]; count: number; savedAt: string }

/**
 * 완료 저장 하나가 속한 작업. 층 편집(`floor`)은 다중층 진입 전·종료 뒤의 층 편집이고, 다중층 세션(`multi`)은 진입부터 종료까지다.
 * `storeys` 는 그 작업 동안 저장한 영향 층 id 다.
 */
export type Work = {
  id: string
  kind: 'floor' | 'multi'
  storeys: string[]
  startedAt: string
  savedAt: string
  /** 저장한 사람(`X-OE-User`). 고르지 않았으면 없다. */
  by?: string
  /** 이 작업에서 저장한 횟수. */
  saves: number
  /** 앞 작업이 끝났을 때의 편집 건수. 이 작업이 만든 차이는 `edits - base` 쯤이다(같은 대상을 다시 고치면 늘지 않는다). */
  base: number
  /** 이 작업의 마지막 저장 때 편집 건수. */
  edits: number
}

/** 저장 요청의 작업 칸. 모양이 틀리면 문자열(까닭). */
export function workOf(query: URLSearchParams): { id: string; kind: Work['kind']; storeys: string[] } | null | string {
  const id = query.get('work')
  if (id === null) return null
  if (!WORK_ID.test(id)) return '작업 id 가 올바르지 않습니다'
  const kind = query.get('kind') ?? 'floor'
  if (kind !== 'floor' && kind !== 'multi') return '작업 종류는 floor 나 multi 입니다'
  const storeys = (query.get('storeys') ?? '').split(',').filter(Boolean).slice(0, 500)
  return { id, kind, storeys }
}

/** 작업 목록에 이번 저장을 적는다. 마지막 작업과 id 가 같으면 그 작업을 고치고, 다르면 새 작업을 붙인다. */
export function recordWork(works: readonly Work[], save: { id: string; kind: Work['kind']; storeys: string[]; at: string; by?: string; edits: number }): Work[] {
  const last = works.at(-1)
  if (last && last.id === save.id) {
    const storeys = [...new Set([...last.storeys, ...save.storeys])]
    return [...works.slice(0, -1), { ...last, storeys, savedAt: save.at, saves: last.saves + 1, edits: save.edits, ...(save.by ? { by: save.by } : {}) }]
  }
  const work: Work = { id: save.id, kind: save.kind, storeys: [...new Set(save.storeys)], startedAt: save.at, savedAt: save.at, ...(save.by ? { by: save.by } : {}), saves: 1, base: last?.edits ?? 0, edits: save.edits }
  return [...works, work].slice(-KEEP_WORKS)
}

/** 프로젝트 id(projects.ts 가 짓는다). 열쇠에 붙어 파일 이름이 되므로 글자를 좁힌다. */
export const PROJECT_ID = /^p[0-9a-f]{12}$/

/**
 * 열쇠(연 파일의 data/ 상대 경로를 `|` 로 이은 것)가 data/ 안의 .ifc 들이면 그 경로들. 아니면 null(아무 이름이나 받아 디스크를 채우지 않게).
 * 프로젝트로 연 판은 열쇠 앞에 `@프로젝트id|` 가 붙는다(projects.ts). 같은 IFC 로 만든 두 프로젝트의 임시 저장본·잠금·반영 버전이
 * 섞이지 않게 열쇠를 가른다(OE-UI-02 AC4). 그 프로젝트가 있어야 받는다.
 */
export function dataKeyPaths(root: string, key: string): string[] | null {
  const [head, ...rest] = key.split('|')
  if (head?.startsWith('@')) {
    if (!PROJECT_ID.test(head.slice(1)) || !existsSync(join(root, '.projects', `${head.slice(1)}.json`))) return null
    return dataKeyPaths(root, rest.join('|'))
  }
  const paths = key.split('|')
  if (!paths.length || paths.some((p) => !p || !p.toLowerCase().endsWith('.ifc'))) return null
  for (const p of paths) {
    const file = resolve(root, p)
    if (!file.startsWith(root + sep) || !existsSync(file)) return null
  }
  return paths
}

/** `onSaved` 는 저장한 뒤 부른다(시스템 로그). */
export function savedEdits(root: string, onSaved?: (key: string) => void) {
  const dir = join(root, '.edits')
  const historyDir = join(dir, 'history')
  const idOf = (key: string) => createHash('sha1').update(key).digest('hex').slice(0, 16)
  const fileOf = (key: string) => join(dir, `${idOf(key)}.json`)

  const valid = (key: string) => dataKeyPaths(root, key)

  function list(): Saved[] {
    if (!existsSync(dir)) return []
    return readdirSync(dir)
      .filter((n) => n.endsWith('.json'))
      .flatMap((n) => {
        try {
          const { key, paths, count, savedAt } = JSON.parse(readFileSync(join(dir, n), 'utf-8')) as Saved
          return [{ key, paths, count, savedAt }]
        } catch {
          return []
        }
      })
      .sort((a, b) => b.savedAt.localeCompare(a.savedAt))
  }

  function worksOf(key: string): Work[] {
    const at = fileOf(key)
    if (!existsSync(at)) return []
    try {
      return (JSON.parse(readFileSync(at, 'utf-8')) as { works?: Work[] }).works ?? []
    } catch {
      return []
    }
  }

  function save(key: string, paths: string[], text: string, work: { id: string; kind: Work['kind']; storeys: string[] }, by?: string): (Saved & { work: string }) | string {
    const file = parseEditFile(text)
    if (typeof file === 'string') return file
    const saved: Saved = { key, paths, count: countEdits(file), savedAt: new Date().toISOString() }
    const works = recordWork(worksOf(key), { ...work, at: saved.savedAt, by, edits: saved.count })
    mkdirSync(historyDir, { recursive: true })
    const at = fileOf(key)
    if (existsSync(at)) {
      const id = idOf(key)
      renameSync(at, join(historyDir, `${id}.${Date.now()}.json`))
      const old = readdirSync(historyDir).filter((n) => n.startsWith(`${id}.`)).sort()
      for (const n of old.slice(0, Math.max(0, old.length - KEEP))) rmSync(join(historyDir, n))
    }
    writeFileSync(at, JSON.stringify({ ...saved, works, file }))
    return { ...saved, work: work.id }
  }

  const json = (res: ServerResponse, status: number, body: unknown) => {
    res.statusCode = status
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.end(JSON.stringify(body))
  }

  return (req: IncomingMessage, res: ServerResponse, query: string) => {
    const params = new URLSearchParams(query)
    const key = params.get('key')
    if (!key) {
      if (req.method !== 'GET') return json(res, 405, { error: 'key 가 없습니다' })
      return json(res, 200, list())
    }
    const paths = valid(key)
    if (!paths) return json(res, 404, { error: 'data/ 에 없는 파일입니다' })

    if ((req.method === 'GET' || req.method === 'HEAD') && params.has('works')) return json(res, 200, worksOf(key))
    if (req.method === 'GET' || req.method === 'HEAD') {
      const at = fileOf(key)
      if (!existsSync(at)) return json(res, 404, { error: '저장본이 없습니다' })
      try {
        return json(res, 200, (JSON.parse(readFileSync(at, 'utf-8')) as { file: unknown }).file)
      } catch {
        return json(res, 500, { error: '저장본을 읽지 못했습니다' })
      }
    }
    if (req.method !== 'PUT') return json(res, 405, { error: `${req.method} 은 받지 않습니다` })
    const work = workOf(params)
    if (typeof work === 'string') return json(res, 400, { error: work })
    const rawBy = req.headers['x-oe-user']
    let by: string | undefined
    try {
      by = typeof rawBy === 'string' && rawBy ? decodeURIComponent(rawBy) : undefined
    } catch {
      by = undefined
    }

    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > MAX_BYTES) {
        json(res, 413, { error: '편집 파일이 너무 큽니다' })
        req.destroy()
      } else chunks.push(c)
    })
    req.on('end', () => {
      if (res.writableEnded) return
      try {
        // 작업 칸 없이 온 저장(예전 화면·스크립트)은 그 저장 하나를 새 층 작업으로 친다.
        const result = save(key, paths, Buffer.concat(chunks).toString('utf-8'), work ?? { id: `w${Date.now().toString(36)}${randomBytes(3).toString('hex')}`, kind: 'floor', storeys: [] }, by)
        if (typeof result === 'string') return json(res, 400, { error: result })
        onSaved?.(key)
        return json(res, 200, result)
      } catch (e) {
        return json(res, 500, { error: e instanceof Error ? e.message : String(e) })
      }
    })
  }
}
