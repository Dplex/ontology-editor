import { defineConfig } from 'vitest/config'

// 실제 BIM 으로 맞춰 보는 검사만 돈다. 기본 `npm test` 와 분리한 이유는 입력이 저장소 밖에
// 있기 때문이다 — data/ 는 gitignore 라서, 받지 않은 사람이 돌리면 파일이 없다.
// 그 경우 실패가 아니라 이유를 찍고 건너뛴다.
//
// 성수(scripts/seongsu.test.ts)는 건축 84MB·기계 203MB 를 형상까지 읽고 사본을 여럿 만든다. node 기본 힙으로는
// 모자랄 수 있어 늘려 둔다.
export default defineConfig({
  test: {
    include: ['scripts/check-sample.test.ts', 'scripts/seongsu.test.ts', 'scripts/coverage.test.ts', 'scripts/tc-coverage.test.ts'],
    testTimeout: 120_000,
    execArgv: ['--max-old-space-size=12288'],
  },
})
