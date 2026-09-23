// 브라우저에서 IFC 임포트를 화면과 다른 스레드에서 돌린다.
//
// **왜 워커인가.** 임포트는 동기 함수라 화면 스레드에서 돌면 끝날 때까지 화면이 한 번도 다시 그려지지
// 않는다. 진행 막대를 그려 두어도 성수(건축 84MB + 기계 203MB)를 읽는 수십 초 동안 멈춘 그림일 뿐이다.
// 여기서 돌리면 화면은 진행 알림을 받아 막대를 움직인다. 임포트 코드는 node 테스트·55 등급 측정과 같은
// 것을 그대로 쓴다.
//
// 형상(Float32Array)은 복사하지 않고 넘긴다(transfer). 성수는 설비 1만 8천 개의 형상이라 복사하면
// 그만큼 메모리가 두 배로 잠깐 뛴다.

import * as WebIFC from 'web-ifc'
import { importIfcWithMeshes, type ImportOptions } from './import'

let ready: Promise<WebIFC.IfcAPI> | null = null

self.onmessage = async (event: MessageEvent<{ bytes: ArrayBuffer; wasmBase: string; options?: ImportOptions }>) => {
  const { bytes, wasmBase, options } = event.data
  try {
    ready ??= (async () => {
      const api = new WebIFC.IfcAPI()
      // 워커의 위치(assets/)가 아니라 페이지 기준 경로에서 wasm 을 찾게 한다. 화면이 절대 주소로 넘긴다.
      api.SetWasmPath(wasmBase, true)
      await api.Init()
      return api
    })()
    const result = importIfcWithMeshes(
      await ready,
      new Uint8Array(bytes),
      (p) => {
        self.postMessage({ type: 'progress', progress: p })
      },
      options,
    )
    const meshes = [...result.meshes]
    const transfer = meshes.flatMap(([, m]) => [m.positions.buffer, m.normals.buffer, m.indices.buffer])
    self.postMessage({ type: 'done', model: result.model, meshes }, { transfer })
  } catch (e) {
    self.postMessage({ type: 'error', message: e instanceof Error ? e.message : String(e) })
  }
}
