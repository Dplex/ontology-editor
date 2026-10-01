// 3D 내보내기(GLB·OBJ)를 화면과 다른 스레드에서 만든다.
//
// **왜 워커인가.** 성수(꼭짓점 1천만 개)에서 화면 스레드로 만들면 GLB 는 3초, OBJ 는 조각마다 비켜 줘도 마지막에
// 683MB 를 Blob 으로 잇는 데서 4초가 한 번에 멈췄다. 여기서 만들면 화면이 멈추는 것은 형상을 넘기는 복사뿐이다.
// 형상은 화면도 계속 쓰므로 넘길 때는 복사하고(transfer 하면 3D 가 빈다), 돌려줄 때는 transfer 한다.

import type { ElementMesh } from '../ifc/import'
import type { Model } from '../model'
import { disposeScene, modelToScene, sceneToGLB, sceneToOBJ } from './mesh3d'

export type Mesh3dRequest = { format: 'glb' | 'obj'; model: Model; pristine: Model | null; meshes: [string, ElementMesh][] }
/** 진행은 단계(장면 → 파일)로 알린다. 얼마나 했는지는 OBJ 만 안다(꼭짓점 수). GLB 는 three 의 GLTFExporter 가 알려 주지 않는다. */
export type Mesh3dReply =
  | { type: 'progress'; stage: string; step: number; steps: number; done?: number; total?: number }
  | { type: 'done'; parts: ArrayBuffer[] }
  | { type: 'error'; message: string }

const post = (m: Mesh3dReply, transfer: Transferable[] = []) => self.postMessage(m, { transfer })

self.onmessage = async (event: MessageEvent<Mesh3dRequest>) => {
  const { format, model, pristine, meshes } = event.data
  post({ type: 'progress', stage: '장면 만드는 중', step: 1, steps: 2 })
  const scene = modelToScene(model, new Map(meshes), { pristine })
  try {
    let parts: ArrayBuffer[]
    if (format === 'glb') {
      post({ type: 'progress', stage: 'GLB 쓰는 중', step: 2, steps: 2 })
      parts = [await sceneToGLB(scene)]
    } else {
      // 조각마다 바로 바이트로 바꿔 둔다. 글자로 모아 두면 돌려줄 때 683MB 를 또 복사한다.
      const encoder = new TextEncoder()
      const progress = (done: number, total: number) => post({ type: 'progress', stage: 'OBJ 쓰는 중(꼭짓점)', step: 2, steps: 2, done, total })
      post({ type: 'progress', stage: 'OBJ 쓰는 중(꼭짓점)', step: 2, steps: 2 })
      parts = await sceneToOBJ(scene, progress, (s) => encoder.encode(s).buffer as ArrayBuffer)
    }
    post({ type: 'done', parts }, parts)
  } catch (e) {
    post({ type: 'error', message: e instanceof Error ? e.message : String(e) })
  } finally {
    disposeScene(scene)
  }
}
