import { defineConfig } from 'vitest/config'

// Laya 재료 뽑기만 돈다(scripts/laya/export.test.ts). 성수를 형상까지 읽어서 힙을 늘린다.
export default defineConfig({
  test: {
    include: ['scripts/laya/export.test.ts'],
    testTimeout: 900_000,
    execArgv: ['--max-old-space-size=16384'],
    fileParallelism: false,
  },
})
