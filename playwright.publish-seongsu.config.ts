import { mkdirSync } from 'node:fs'
import { defineConfig } from '@playwright/test'
import base from './playwright.seongsu.config'

// 성수 크기 반영 시험(e2e-seongsu/publish-seongsu.spec.ts). 화면 시험과 같은 GPU 설정에, data/ 목록(진짜 data-catalog)을 붙인 dev 서버를
// 따로 띄운다. 목록 폴더는 시험이 매번 비우고 성수 두 파일을 하드 링크로 둔다.
export const PUBLISH_ROOT = 'data/.e2e-publish'
mkdirSync(PUBLISH_ROOT, { recursive: true })
const port = 5177

export default defineConfig({
  ...base,
  testIgnore: [],
  testMatch: 'publish-seongsu.spec.ts',
  timeout: 1_200_000,
  use: { ...base.use, baseURL: `http://localhost:${port}` },
  webServer: {
    command: `npm run dev -- --mode e2e --port ${port} --strictPort`,
    url: `http://localhost:${port}`,
    env: { OE_DATA_ROOT: PUBLISH_ROOT },
    reuseExistingServer: false,
    timeout: 60_000,
  },
})
