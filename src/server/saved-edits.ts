// 8084 에 남기는 편집(OE-COM-08 "저장 시 변경사항을 웹에서 바로 확인"). data/ 에서 연 IFC 에 대한 편집 파일(lib/edit-file.ts)을
// 서버에 두고, 누가 같은 IFC 를 열든 얹어서 보인다. 임시 저장은 여기에 오지 않는다 — 그 브라우저에만 남는다.
//
// **열쇠는 연 파일 목록이다.** 건축·설비를 합쳐 연 판(`a.ifc + b.ifc`)의 편집은 그 둘을 합친 모델 기준이라, 한 파일만 연
// 판과 섞이면 못 찾는 것이 생긴다. 목록의 순서도 열쇠다 — 합치기는 먼저 연 쪽을 기준 모델로 삼는다(App.vue 의 append).
//
// 저장본은 data/.edits/<열쇠 해시>.json 이고, 덮어쓰기 전 판은 data/.edits/history/ 에 20개까지 남긴다. 사내망 누구나
// 쓸 수 있어서(PoC, 정문 없음) 잘못 덮은 것을 되찾을 길을 남긴다.
//
// 경로(`/__data` 아래):
//   GET  /__edits            저장본 목록 [{ key, paths, count, savedAt }]
//   GET  /__edits?key=…      저장본(편집 파일). 없으면 404
//   PUT  /__edits?key=…      저장. 몸통은 편집 파일. { key, count, savedAt }
// key 는 연 파일의 data/ 상대 경로를 `|` 로 이은 것이다.
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join, resolve, sep } from 'node:path'
import { countEdits, parseEditFile } from '../lib/edit-file'

/** 편집 파일 하나의 상한. 성수 전부를 고쳐도 몇 MB 다. 넘으면 잘못 온 요청이다. */
const MAX_BYTES = 32 * 1024 * 1024
/** 열쇠마다 남기는 덮어쓰기 전 판. */
const KEEP = 20

type Saved = { key: string; paths: string[]; count: number; savedAt: string }

export function savedEdits(root: string) {
  const dir = join(root, '.edits')
  const historyDir = join(dir, 'history')
  const idOf = (key: string) => createHash('sha1').update(key).digest('hex').slice(0, 16)
  const fileOf = (key: string) => join(dir, `${idOf(key)}.json`)

  /** 열쇠가 data/ 안의 .ifc 들인가. 아니면 쓰지 않는다(아무 이름이나 받아 디스크를 채우지 않게). */
  function valid(key: string): string[] | null {
    const paths = key.split('|')
    if (!paths.length || paths.some((p) => !p || !p.toLowerCase().endsWith('.ifc'))) return null
    for (const p of paths) {
      const file = resolve(root, p)
      if (!file.startsWith(root + sep) || !existsSync(file)) return null
    }
    return paths
  }

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

  function save(key: string, paths: string[], text: string): Saved | string {
    const file = parseEditFile(text)
    if (typeof file === 'string') return file
    const saved: Saved = { key, paths, count: countEdits(file), savedAt: new Date().toISOString() }
    mkdirSync(historyDir, { recursive: true })
    const at = fileOf(key)
    if (existsSync(at)) {
      const id = idOf(key)
      renameSync(at, join(historyDir, `${id}.${Date.now()}.json`))
      const old = readdirSync(historyDir).filter((n) => n.startsWith(`${id}.`)).sort()
      for (const n of old.slice(0, Math.max(0, old.length - KEEP))) rmSync(join(historyDir, n))
    }
    writeFileSync(at, JSON.stringify({ ...saved, file }))
    return saved
  }

  const json = (res: ServerResponse, status: number, body: unknown) => {
    res.statusCode = status
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.end(JSON.stringify(body))
  }

  return (req: IncomingMessage, res: ServerResponse, query: string) => {
    const key = new URLSearchParams(query).get('key')
    if (!key) {
      if (req.method !== 'GET') return json(res, 405, { error: 'key 가 없습니다' })
      return json(res, 200, list())
    }
    const paths = valid(key)
    if (!paths) return json(res, 404, { error: 'data/ 에 없는 파일입니다' })

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
        const result = save(key, paths, Buffer.concat(chunks).toString('utf-8'))
        if (typeof result === 'string') return json(res, 400, { error: result })
        return json(res, 200, result)
      } catch (e) {
        return json(res, 500, { error: e instanceof Error ? e.message : String(e) })
      }
    })
  }
}
