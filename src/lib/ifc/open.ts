// 브라우저에서 web-ifc 를 띄운다.
//
// WASM 을 한 번만 초기화해 두고 재사용한다. 파일을 열 때마다 Init 을 부르면 1.6MB 짜리
// 모듈을 매번 다시 컴파일한다.
//
// 경로는 BASE_URL 을 따른다. vite 설정이 `base: './'` 라서 빌드 결과가 하위 경로에서도
// 열리는데, WASM 경로만 절대 경로로 박으면 그때 404 가 난다.

import * as WebIFC from 'web-ifc'

let ready: Promise<WebIFC.IfcAPI> | null = null

export function ifcApi(): Promise<WebIFC.IfcAPI> {
  if (!ready) {
    ready = (async () => {
      const api = new WebIFC.IfcAPI()
      api.SetWasmPath(import.meta.env.BASE_URL, true)
      await api.Init()
      return api
    })()
  }
  return ready
}
