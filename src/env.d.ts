/// <reference types="vite/client" />

// vue-tsc 가 .vue 파일을 모듈로 인정하게 하는 선언이다. 이게 없으면 main.ts 의
// `import App from './App.vue'` 가 타입 검사에서 막힌다.
declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<Record<string, never>, Record<string, never>, unknown>
  export default component
}
