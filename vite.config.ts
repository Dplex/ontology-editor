// vitest/config 의 defineConfig 는 vite 것을 그대로 확장하면서 test 키를 알아본다.
// vite 쪽에서 가져오면 vue-tsc 가 test 를 모르는 속성이라고 막는다.
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import type { Plugin } from 'vite'
import { createReadStream, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'

// data/ 에 받아 둔 샘플을 화면에서 고를 수 있게 dev 서버가 목록과 파일을 내준다.
// dev 전용이다. 빌드 번들에는 data/ 가 없고, 목록 요청이 실패하면 화면은 고르기 칸을 숨긴다.
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
      server.middlewares.use('/__data', (req, res) => {
        const path = decodeURIComponent((req.url ?? '/').split('?')[0]).replace(/^\/+/, '')
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
