import { defineConfig, devices } from '@playwright/test'
export default defineConfig({
  testDir: './e2e', testMatch: 'platform.spec.ts', fullyParallel: false, retries: 0, reporter: 'list',
  use: { baseURL: 'http://localhost:5186', trace: 'retain-on-failure', screenshot: 'only-on-failure',
    ...devices['Desktop Chrome'], channel:process.env.PLATFORM_BROWSER_CHANNEL, viewport: {width:1440,height:1000}, reducedMotion: 'reduce',
    launchOptions: {args:['--use-angle=d3d11','--ignore-gpu-blocklist']} },
  webServer: {command:'npm run dev -- --mode e2e --port 5186 --strictPort', url:'http://localhost:5186', reuseExistingServer:false, timeout:120000},
})
