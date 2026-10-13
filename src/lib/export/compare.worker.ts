// 비교 판(ADR-0061)의 내보내기·다시 읽기를 화면과 다른 스레드에서 한다. 받은 모델은 postMessage 가 만든 사본이다.
import { buildCompare, type CompareReading } from './compare'
import type { Model } from '../model'

export type CompareRequest = { seq: number; model: Model }
export type CompareReply = { seq: number; reading: CompareReading } | { seq: number; error: string }

self.onmessage = (event: MessageEvent<CompareRequest>) => {
  const { seq, model } = event.data
  try {
    self.postMessage({ seq, reading: buildCompare(model) } satisfies CompareReply)
  } catch (e) {
    self.postMessage({ seq, error: e instanceof Error ? e.message : String(e) } satisfies CompareReply)
  }
}
