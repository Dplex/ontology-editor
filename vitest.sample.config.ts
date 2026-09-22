import { defineConfig } from 'vitest/config'

// 실제 BIM 으로 맞춰 보는 검사만 돈다. 기본 `npm test` 와 분리한 이유는 입력이 저장소 밖에
// 있기 때문이다 — data/ 는 gitignore 라서, 받지 않은 사람이 돌리면 파일이 없다.
// 그 경우 실패가 아니라 이유를 찍고 건너뛴다.
export default defineConfig({
  test: { include: ['scripts/check-sample.test.ts'], testTimeout: 120_000 },
})
