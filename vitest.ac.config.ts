import { defineConfig } from 'vitest/config'

// 수용 기준 ↔ 시험 보고서만 쓴다(scripts/ac-report.test.ts). 기본 `npm test` 는 파일을 쓰지 않게 따로 둔다.
export default defineConfig({ test: { include: ['scripts/ac-report.test.ts'] } })
