// vitest/config 의 defineConfig 는 vite 것을 그대로 확장하면서 test 키를 알아본다.
// vite 쪽에서 가져오면 vue-tsc 가 test 를 모르는 속성이라고 막는다.
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import type { Plugin } from 'vite'
import { resolve } from 'node:path'
import { createDataCatalog } from './src/server/data-catalog'

// data/ 에 받아 둔 샘플을 화면에서 고르게 한다. 목록·파일·등급 측정은 src/server/data-catalog.ts
// 가 맡고, 55 의 정적 서버(scripts/serve.mjs)도 같은 모듈을 쓴다.
function dataFiles(): Plugin {
  return {
    name: 'data-files',
    configureServer(server) {
      server.middlewares.use('/__data', createDataCatalog(resolve('data')))
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
