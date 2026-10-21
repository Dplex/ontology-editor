import { defineConfig, devices } from '@playwright/test'

// E2E 는 백엔드 없이 돈다. 지금은 편집기가 브라우저 안에서만 돌아서 붙일 서버가 아예 없고,
// 나중에 서버가 생겨도 응답은 page.route 로 가로챈다. 검증 대상은 화면이 입력을 받아
// 무엇을 보여주는가이지 서버가 무엇을 돌려주는가가 아니다.
// 다른 checkout 의 dev 서버가 5175 를 잡고 있으면 그 서버에 붙어 남의 코드를 잰다(재사용). 그때는 E2E_PORT 로 비킨다.
const port = Number(process.env.E2E_PORT ?? 5175)

// 실제 시간으로 흘러가는 화면(편집 리플레이 — 장면이 5초마다 넘어간다)을 재는 시험. 병렬로 돌면 CPU 가 밀려 장면을 놓치고,
// 합쳐 2분 걸린다. 기본(npm run e2e)에서는 빼고 npm run e2e:serial 이 하나씩 돌린다(playwright.serial.config.ts).
// flow-cascade 는 확정한 연결이 물결로 퍼지는 단계를 프레임마다 센다. 병렬로 돌면 Duplex 렌더가 4fps 까지 떨어져 단계가 뭉친다.
// intro 는 첫 화면 인트로(machine-skill kit)가 소프트웨어 GL 에서 한 프레임에 몇 초씩 걸려, 병렬로 돌면 숫자가 바뀌기 전에 시간을 넘긴다.
export const SERIAL = ['**/edit-replay.spec.ts', '**/replay-edge.spec.ts', '**/replay-reduced.spec.ts', '**/flow-cascade.spec.ts', '**/intro.spec.ts']

export default defineConfig({
  testDir: './e2e',
  testIgnore: SERIAL,
  fullyParallel: true,
  // 기본(코어 절반, 이 PC 에서 10개)으로 돌리면 Duplex · 병원 3D 를 동시에 그리느라 렌더가 몇 fps 로 떨어져 애니메이션 · 카메라 비행을
  // 기다리는 시험 9개가 번갈아 흔들렸다. 6개면 전체가 같은 7~8분에 흔들림 없이 돈다(2026-10-20).
  workers: 6,
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

  // 편집 화면 뼈대(design-system.md 4장)는 1600×900 을 기준으로 짰다(#715). 기본 1280×720 에서는 캔버스가 좁아 작은 모델이 왼쪽 위 레이어
  // 패널 밑에 깔리고, 3D 를 누르면 패널이 클릭을 받는다.
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1600, height: 900 } } }],

  webServer: {
    // --mode e2e 는 data/ 목록(등급 측정)을 뺀다. 이유는 vite.config.ts. 포트도 dev(5174)와 따로 둔다 —
    // 같은 포트면 켜 둔 dev 서버를 그대로 써서, 목록이 붙은 서버로 e2e 가 돈다.
    command: `npm run dev -- --mode e2e --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
})
