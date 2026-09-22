// vitest/config 의 defineConfig 는 vite 것을 그대로 확장하면서 test 키를 알아본다.
// vite 쪽에서 가져오면 vue-tsc 가 test 를 모르는 속성이라고 막는다.
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import type { Plugin } from 'vite'
import { createHash } from 'node:crypto'
import { createReadStream, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import * as WebIFC from 'web-ifc'
import { importIfcWithMeshes } from './src/lib/ifc/import'
import { profileOf, type Profile } from './src/lib/profile'

// data/ 에 받아 둔 샘플을 화면에서 고를 수 있게 dev 서버가 목록과 파일을 내준다.
// dev 전용이다. 빌드 번들에는 data/ 가 없고, 목록 요청이 실패하면 화면은 고르기 칸을 숨긴다.
// 파일마다 "온톨로지를 어디까지 채우는가" 를 미리 잰다(`?profile`). 화면이 목록 옆에 보인다.
//
// **앱이 파일을 열 때 쓰는 임포터를 그대로 쓴다.** 목록의 숫자와 열었을 때의 숫자가 달라지면
// 목록을 믿을 수 없다. 대신 비싸다(30MB 파일이 1.5초). 그래서 한 번에 하나씩 돌리고, 결과를
// data/.profiles.json 에 둔다. 캐시 열쇠에 **src/lib 코드의 지문**을 넣는다 — 임포터를 고치면
// 숫자가 바뀌어야 하는데, 손으로 버전을 올리게 두면 언젠가 잊고 낡은 숫자를 보인다.
type Profiled = { profile: Profile } | { error: string }

function codeStamp(): string {
  const hash = createHash('sha1')
  const walk = (dir: string) => {
    for (const d of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(dir, d.name)
      if (d.isDirectory()) walk(path)
      else if (d.name.endsWith('.ts') && !d.name.endsWith('.test.ts')) hash.update(d.name).update(readFileSync(path))
    }
  }
  walk(resolve('src/lib'))
  return hash.digest('hex').slice(0, 12)
}

function profiler(root: string) {
  const cachePath = join(root, '.profiles.json')
  const stamp = codeStamp()
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

    // 한 번에 하나씩. 30MB 파일 여럿을 동시에 열면 dev 서버의 메모리가 튄다.
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

function dataFiles(): Plugin {
  const root = resolve('data')
  const list = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
      d.isDirectory()
        ? list(join(dir, d.name))
        : d.name.toLowerCase().endsWith('.ifc')
          ? [relative(root, join(dir, d.name)).split(sep).join('/')]
          : [],
    )
  return {
    name: 'data-files',
    configureServer(server) {
      const profile = profiler(root)
      server.middlewares.use('/__data', (req, res) => {
        const [rawPath, query] = (req.url ?? '/').split('?')
        const path = decodeURIComponent(rawPath).replace(/^\/+/, '')
        if (!path) {
          const files = (() => {
            try {
              return list(root).map((p) => ({ path: p, size: statSync(join(root, p)).size }))
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
        createReadStream(file)
          .on('error', () => {
            res.statusCode = 404
            res.end()
          })
          .pipe(res)
      })
    },
  }
}

export default defineConfig({
  plugins: [vue(), dataFiles()],

  // 5173 은 ieum-pipeline/web 이 쓴다. 두 화면을 같이 띄우는 일이 잦아서 포트를 비켜 둔다.
  server: { port: 5174 },

  // 자산을 상대 경로로 참조한다. 이 번들은 루트가 아닌 하위 경로에서도 서빙될 수 있고,
  // 절대 경로(`/assets/...`)로 빌드하면 그때 자산이 전부 404 가 되어 화면이 흰 채로 뜬다.
  base: './',

  build: { outDir: 'dist', emptyOutDir: true },

  // vitest 는 src 의 순수 로직만 본다. e2e/ 는 Playwright 것이라 여기서 걸러내지 않으면
  // vitest 가 브라우저 API 를 못 찾고 깨진다.
  test: { include: ['src/**/*.test.ts'] },
})
