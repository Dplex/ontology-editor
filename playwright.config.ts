import { defineConfig, devices } from '@playwright/test'

// E2E 는 백엔드 없이 돈다. 지금은 편집기가 브라우저 안에서만 돌아서 붙일 서버가 아예 없고,
// 나중에 서버가 생겨도 응답은 page.route 로 가로챈다. 검증 대상은 화면이 입력을 받아
// 무엇을 보여주는가이지 서버가 무엇을 돌려주는가가 아니다.
export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',

  use: {
    baseURL: 'http://localhost:5175',
    // 실패하면 trace 를 남긴다. 실패 원인을 눈이 아니라 기록으로 좇을 수 있어야 한다.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: {
    // --mode e2e 는 data/ 목록(등급 측정)을 뺀다. 이유는 vite.config.ts. 포트도 dev(5174)와 따로 둔다 —
    // 같은 포트면 켜 둔 dev 서버를 그대로 써서, 목록이 붙은 서버로 e2e 가 돈다.
    command: 'npm run dev -- --mode e2e --port 5175 --strictPort',
    url: 'http://localhost:5175',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
})
