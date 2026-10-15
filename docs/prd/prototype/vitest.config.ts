import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'
// 프로토타입 상태 로직 시험. 저장소 루트에서 `npx vitest run -c docs/prd/prototype/vitest.config.ts`.
export default defineConfig({ root: fileURLToPath(new URL('.', import.meta.url)), test: { include: ['src/**/*.test.ts'], environment: 'node' } })
