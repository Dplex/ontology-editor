import { defineConfig, devices } from '@playwright/test'

// E2E 는 백엔드 없이 돈다. 지금은 편집기가 브라우저 안에서만 돌아서 붙일 서버가 아예 없고,
// 나중에 서버가 생겨도 응답은 page.route 로 가로챈다. 검증 대상은 화면이 입력을 받아
// 무엇을 보여주는가이지 서버가 무엇을 돌려주는가가 아니다.
// 다른 checkout 의 dev 서버가 5175 를 잡고 있으면 그 서버에 붙어 남의 코드를 잰다(재사용). 그때는 E2E_PORT 로 비킨다.
const port = Number(process.env.E2E_PORT ?? 5175)

// 실제 시간으로 흘러가는 화면(편집 리플레이 — 장면이 5초마다 넘어간다)을 재는 시험. 병렬로 돌면 CPU 가 밀려 장면을 놓치고,
// 합쳐 2분 걸린다. 기본(npm run e2e)에서는 빼고 npm run e2e:serial 이 하나씩 돌린다(playwright.serial.config.ts).
export const SERIAL = ['**/edit-replay.spec.ts', '**/replay-edge.spec.ts', '**/replay-reduced.spec.ts']

export default defineConfig({
  testDir: './e2e',
  testIgnore: SERIAL,
  fullyParallel: true,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',

  use: {
    baseURL: `http://localhost:${port}`,
    // 실패하면 trace 를 남긴다. 실패 원인을 눈이 아니라 기록으로 좇을 수 있어야 한다.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // 숫자가 굴러 올라가는 동안(components/Roll.vue) 읽으면 값이 아니라 중간값을 읽는다. 값을 재는 시험이라 움직임을 끈다.
    // 움직임 자체는 e2e/motion.spec.ts 가 켜고 본다.
    contextOptions: { reducedMotion: 'reduce' },
  },

  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],

  webServer: {
    // --mode e2e 는 data/ 목록(등급 측정)을 뺀다. 이유는 vite.config.ts. 포트도 dev(5174)와 따로 둔다 —
    // 같은 포트면 켜 둔 dev 서버를 그대로 써서, 목록이 붙은 서버로 e2e 가 돈다.
    command: `npm run dev -- --mode e2e --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
})
