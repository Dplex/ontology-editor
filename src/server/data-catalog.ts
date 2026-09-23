// data/ 에 받아 둔 샘플을 화면에서 고를 수 있게 목록과 파일을 내준다(`/__data/`).
// 파일마다 "온톨로지를 어디까지 채우는가" 를 미리 잰다(`?profile`). 화면이 목록 옆에 등급 칩으로 보인다.
//
// **두 서버가 이 모듈 하나를 같이 쓴다.** dev 서버(vite.config.ts 의 플러그인)와 55 의 정적 서버
// (scripts/serve.mjs, `vite build --ssr` 로 묶은 판)다. 둘이 따로 구현하면 같은 파일에 다른 칩이 뜬다.
// 목록이 없거나 요청이 실패하면 화면은 고르기 칸을 숨긴다.
//
// **앱이 파일을 열 때 쓰는 임포터를 그대로 쓴다.** 목록의 숫자와 열었을 때의 숫자가 달라지면
// 목록을 믿을 수 없다. 대신 비싸다(30MB 파일이 1.5초). 그래서 한 번에 하나씩 돌리고, 결과를
// data/.profiles.json 에 둔다. 캐시 열쇠에 **src/lib 코드의 지문**을 넣는다 — 임포터를 고치면
// 숫자가 바뀌어야 하는데, 손으로 버전을 올리게 두면 언젠가 잊고 낡은 숫자를 보인다.
import { createHash } from 'node:crypto'
import { createReadStream, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join, relative, resolve, sep } from 'node:path'
import * as WebIFC from 'web-ifc'
import { importIfcWithMeshes } from '../lib/ifc/import'
import { profileOf, type Profile } from '../lib/profile'

type Profiled = { profile: Profile } | { error: string }

function codeStamp(libDir: string): string {
  const hash = createHash('sha1')
  const walk = (dir: string) => {
    for (const d of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(dir, d.name)
      if (d.isDirectory()) walk(path)
      else if (d.name.endsWith('.ts') && !d.name.endsWith('.test.ts')) hash.update(d.name).update(readFileSync(path))
    }
  }
  walk(libDir)
  return hash.digest('hex').slice(0, 12)
}

function profiler(root: string, libDir: string) {
  const cachePath = join(root, '.profiles.json')
  const stamp = codeStamp(libDir)
  let cache: Record<string, Profiled> = {}
  try {
    cache = JSON.parse(readFileSync(cachePath, 'utf-8'))
  } catch {
    // 없거나 깨졌으면 새로 잰다.
  }
  let api: Promise<WebIFC.IfcAPI> | null = null
  let queue: Promise<unknown> = Promise.resolve()

  return (file: string, path: string): Promise<Profiled> => {
    const st = statSync(file)
    const key = `${path}|${st.size}|${Math.round(st.mtimeMs)}|${stamp}`
    if (cache[key]) return Promise.resolve(cache[key])

    // 한 번에 하나씩. 30MB 파일 여럿을 동시에 열면 서버의 메모리가 튄다.
    const job = queue.then(async (): Promise<Profiled> => {
      if (cache[key]) return cache[key]
      api ??= (async () => {
        const a = new WebIFC.IfcAPI()
        await a.Init()
        // web-ifc 는 파싱 오류를 콘솔에 따로 찍는다. 화면이 이유를 보이므로 여기선 끈다.
        a.SetLogLevel(WebIFC.LogLevel.LOG_LEVEL_OFF)
        return a
      })()
      let result: Profiled
      try {
        result = { profile: profileOf(importIfcWithMeshes(await api, new Uint8Array(readFileSync(file))).model) }
      } catch (e) {
        result = { error: e instanceof Error ? e.message : String(e) }
      }
      cache[key] = result
      try {
        writeFileSync(cachePath, JSON.stringify(cache))
      } catch {
        // 못 써도 이번 실행 동안은 메모리 캐시로 돈다.
      }
      return result
    })
    queue = job.catch(() => {})
    return job
  }
}

/**
 * `/__data` 아래에 붙일 핸들러. `req.url` 은 붙인 자리 기준이다(`/`, `/a.ifc`, `/a.ifc?profile`).
 * `libDir` 은 캐시 지문을 뜨는 임포터 소스다. 55 에서도 체크아웃이 있으니 같은 자리를 본다.
 */
export function createDataCatalog(dataDir: string, libDir = resolve('src/lib')) {
  const root = resolve(dataDir)
  const list = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
      d.isDirectory()
        ? list(join(dir, d.name))
        : d.name.toLowerCase().endsWith('.ifc')
          ? [relative(root, join(dir, d.name)).split(sep).join('/')]
          : [],
    )
  // 고객사 실측 파일(성수)을 맨 위에 두고 나머지는 이름순이다. readdir 순서는 파일 시스템마다 달라서
  // 정렬하지 않으면 개발 PC 와 55 의 목록 순서가 어긋난다.
  const rank = (p: string) => (p.startsWith('성수/') ? 0 : 1)
  const ordered = (paths: string[]) => paths.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b, 'ko'))
  const profile = profiler(root, libDir)

  return (req: IncomingMessage, res: ServerResponse) => {
    const [rawPath, query] = (req.url ?? '/').split('?')
    const path = decodeURIComponent(rawPath).replace(/^\/+/, '')
    if (!path) {
      const files = (() => {
        try {
          return ordered(list(root)).map((p) => ({ path: p, size: statSync(join(root, p)).size }))
        } catch {
          return []
        }
      })()
      res.setHeader('Content-Type', 'application/json')
      res.end(JSON.stringify(files))
      return
    }
    const file = resolve(root, path)
    // data/ 밖을 가리키는 경로(../ 등)는 내주지 않는다.
    if (!file.startsWith(root + sep) || !file.toLowerCase().endsWith('.ifc')) {
      res.statusCode = 404
      res.end()
      return
    }
    if (query === 'profile') {
      Promise.resolve()
        .then(() => profile(file, path))
        .then((result) => {
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(result))
        })
        .catch(() => {
          res.statusCode = 404
          res.end()
        })
      return
    }
    // 크기를 알려 줘야 화면이 내려받기 진행 막대를 그린다. 성수 기계 파일은 203MB 다.
    try {
      res.setHeader('Content-Length', statSync(file).size)
    } catch {
      // 없는 파일이면 아래 스트림이 404 를 낸다.
    }
    createReadStream(file)
      .on('error', () => {
        res.statusCode = 404
        res.end()
      })
      .pipe(res)
  }
}
