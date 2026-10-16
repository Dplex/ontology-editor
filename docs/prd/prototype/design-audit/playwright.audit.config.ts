import { defineConfig, devices } from '@playwright/test'
// 디자인 진단 전용 설정. 앱 코드는 읽기만 하고, 결과(스샷·JSON)는 .local/design-audit 에 쓴다.
// 실행: npx playwright test -c docs/prd/prototype/design-audit/playwright.audit.config.ts
const port = Number(process.env.AUDIT_PORT ?? 5187)
export default defineConfig({
  testDir: '.', testMatch: '*.spec.ts', fullyParallel: false, retries: 0, reporter: 'list', timeout: 180_000,
  use: { baseURL: `http://localhost:${port}`, ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, channel: process.env.AUDIT_BROWSER_CHANNEL ?? 'msedge',
    contextOptions: { reducedMotion: 'reduce' } },
  webServer: { command: `npm run dev -- --mode e2e --port ${port} --strictPort`, url: `http://localhost:${port}`,
    reuseExistingServer: true, timeout: 90_000, cwd: '../../../..' },
})
