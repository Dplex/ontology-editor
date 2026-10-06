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

export default defineConfig(({ mode }) => ({
  // e2e 는 data/ 목록을 붙이지 않는다. 화면이 뜨자마자 파일마다 등급을 재는데, 측정이 서버와 같은
  // 스레드에서 돌아서 그동안 dev 서버가 응답하지 않는다. 임포터를 고친 직후에는 캐시가 무효라 성수
  // 기계 파일(203MB) 하나에 1분 가까이 막혀 e2e 가 전부 시간 초과로 실패했다. e2e 는 픽스처만 쓰고,
  // gitignore 인 data/ 에 무엇이 있느냐에 결과가 달라져서도 안 된다.
  plugins: mode === 'e2e' ? [vue()] : [vue(), dataFiles()],

  // 5173 은 ieum-pipeline/web 이 쓴다. 두 화면을 같이 띄우는 일이 잦아서 포트를 비켜 둔다.
  server: { port: 5174 },

  // 임포트 워커가 web-ifc 를 쓴다. dev 서버는 워커의 의존성을 워커가 처음 뜰 때에야 발견하고, 그 자리에서
  // 최적화하느라 페이지를 새로 불러온다. 그러면 막 연 파일의 결과가 사라진다(새로 띄운 서버의 첫 e2e 가
  // 전부 실패했다). 미리 최적화해 둔다. 3D 내보내기 워커의 GLTFExporter 도 같다 — 내보내기를 처음 누른 순간
  // 새로 불러와서 같이 돌던 e2e 15개가 시간 초과로 떨어졌다.
  optimizeDeps: { include: ['web-ifc', 'three/addons/exporters/GLTFExporter.js'] },

  // 자산을 상대 경로로 참조한다. 이 번들은 루트가 아닌 하위 경로에서도 서빙될 수 있고,
  // 절대 경로(`/assets/...`)로 빌드하면 그때 자산이 전부 404 가 되어 화면이 흰 채로 뜬다.
  base: './',

  build: { outDir: 'dist', emptyOutDir: true },

  // vitest 는 src 의 순수 로직만 본다. e2e/ 는 Playwright 것이라 여기서 걸러내지 않으면
  // vitest 가 브라우저 API 를 못 찾고 깨진다. scripts/ 에서는 문서 챗봇(ADR-0001)만 — 나머지(seongsu 등)는
  // 실제 BIM 이 있어야 돌아서 check:sample 쪽 설정이 맡는다.
  test: { include: ['src/**/*.test.ts', 'scripts/docs-*.test.ts'] },
}))
