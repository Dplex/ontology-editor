// 편집 리플레이를 화면과 다른 스레드에서 만든다(replay.ts). 받은 모델은 postMessage 가 만든 사본이라 마음껏 되돌려도
// 화면의 모델은 그대로다. 단계마다 TTL 을 쓰므로 성수에서는 화면 스레드로 하면 멈춘다.

import { buildReplay, type ReplayInput, type ReplayMessage } from './replay'

self.onmessage = (event: MessageEvent<ReplayInput>) => {
  const post = (m: ReplayMessage) => self.postMessage(m)
  try {
    buildReplay(event.data, post)
  } catch (e) {
    post({ type: 'error', message: e instanceof Error ? e.message : String(e) })
  }
}
