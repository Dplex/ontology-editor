import { defineConfig, devices } from '@playwright/test'

// 성수 BIM 으로 화면을 재는 e2e(docs/seongsu-test.md 의 B~O). 성수 파일이 있는 PC 와 55 에서만 돌고, 없으면 이유를
// 찍고 건너뛴다. 동작 논리는 e2e/(픽스처)가 보고, 여기는 크기에서 달라지는 것(걸린 시간, 표를 쓸 만한지, 수)을 본다.
// 잰 값은 data/성수/화면-결과.md 에 적는다.
//
// **GPU 로 그린다.** 헤드리스 크롬의 기본 WebGL 은 CPU(SwiftShader)라서 3D 가 열 배 느리게 재진다(CLAUDE.md).
// 리눅스는 gl, 윈도는 d3d11 이다. 다른 것을 쓰려면 ANGLE=... 로 준다.
const angle = process.env.ANGLE ?? (process.platform === 'win32' ? 'd3d11' : 'gl')

export default defineConfig({
  testDir: './e2e-seongsu',
  // 두 파일(287MB)을 한 번 열고 한 페이지에서 차례로 돈다. 병렬로 돌리면 메모리가 모자라고 서로의 시간을 늘린다.
  workers: 1,
  timeout: 600_000,
  expect: { timeout: 60_000 },
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    baseURL: process.env.BASE_URL ?? 'http://localhost:5176',
    // 동작 하나가 1분을 넘으면 실패다. 없으면 못 찾는 자리에서 시험 제한(10분)까지 기다린다.
    actionTimeout: 60_000,
    viewport: { width: 1600, height: 1000 },
    launchOptions: { args: [`--use-angle=${angle}`, '--ignore-gpu-blocklist', '--enable-gpu'] },
    // 트레이스는 끈다. 켜면 동작마다 화면을 떠서 메인 스레드를 잡고, 멈춤·프레임 간격을 재는 항목이 두세 배로 재진다.
    trace: 'off',
    screenshot: 'only-on-failure',
  },
  webServer: {
    // e2e 모드라야 3D 를 짚는 window.__viewer 가 열린다. data/ 목록(등급 측정)은 붙지 않는다 — 파일은 파일 칸으로 연다.
    command: 'npm run dev -- --mode e2e --port 5176 --strictPort',
    url: 'http://localhost:5176',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
})
