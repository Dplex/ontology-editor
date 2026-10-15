// PRD 프로토타입 전용 설정. 개발 코드(src/)는 읽기만 하고 고치지 않는다 — 저장소 루트에서
// `npx vite --config docs/prd/prototype/vite.config.ts --port 5176` 로 띄운다.
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'

const here = fileURLToPath(new URL('.', import.meta.url))
const repo = fileURLToPath(new URL('../../../', import.meta.url))

export default defineConfig({
  root: here,
  plugins: [vue()],
  base: './',
  publicDir: existsSync(repo + '.local/prototype-public') ? repo + '.local/prototype-public' : repo + 'public', // web-ifc.wasm (sync-wasm 이 없으면 .local/prototype-public 에 둔 사본)
  server: { port: 5176, fs: { allow: [repo] } },
  optimizeDeps: { include: ['web-ifc', 'three/addons/exporters/GLTFExporter.js'] },
  build: { outDir: repo + 'dist-prototype', emptyOutDir: true },
})
