import { defineConfig } from '@playwright/test'
import base, { SERIAL } from './playwright.config'

// 실제 시간에 묶인 시험만 하나씩 돌린다(npm run e2e:serial). 무엇이 여기 드는지와 왜인지는 playwright.config.ts 의 SERIAL.
export default defineConfig({
  ...base,
  testIgnore: undefined,
  testMatch: SERIAL,
  fullyParallel: false,
  workers: 1,
})
