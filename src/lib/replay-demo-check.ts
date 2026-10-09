// [임시 — 리플레이 데모] 뺄 때 지울 곳은 lib/replay-demo.ts 맨 위.
// 데모 편집(replay-demo.ts)을 모델 사본에 하고 리플레이까지 만들어 보는 검사. 테스트만 쓴다(src/lib 의 단위 테스트와
// scripts/check-sample 의 Duplex·성수).

import { exportedContent } from './edit-fuzz'
import { restore } from './edit'
import { ceilingOf, judgeAll } from './ceiling'
import { canMountOn, surfaceOf } from './mount'
import { storeyHeights } from './storey-height'
import type { Model } from './model'
import { buildReplay, type ReplayMessage, type ReplayStep } from './replay'
import { demoStoreys, recordDemo, type DemoContext } from './replay-demo'

/** App 의 ceilingMarks 와 같은 판단(천장 쪽에서 고치는 설비). */
export function ceilingIdsOf(m: Model): Set<string> {
  const heights = storeyHeights(m.storeys)
  const out = new Set<string>()
  for (const r of judgeAll(m, (id) => heights.get(id)?.value ?? null)) {
    const e = r.equipment
    if (!e.position) continue
    const on = r.judged === 'ceiling' || r.judged === 'plenum' || (r.judged === null && !ceilingOf(r.storey) && surfaceOf(e) === 'ceiling')
    if (on && canMountOn(e, 'ceiling')) out.add(e.id)
  }
  return out
}

/** 데모를 사본에 하고, 그 이력으로 리플레이를 만들고, 다 되돌린다. 셋의 내보내기를 견줄 수 있게 낸다. */
export function demoOn(pristine: Model) {
  const m = structuredClone(pristine)
  const ctx: DemoContext = {
    storeyId: null,
    ceilingIds: ceilingIdsOf(m),
    ceilingHeight: (sid) => {
      const st = m.storeys.find((x) => x.id === sid)
      return (st && ceilingOf(st)?.height) ?? 2.7
    },
  }
  const at = demoStoreys(m, ctx)
  if (!at) return null
  const { labels, undo } = recordDemo(m, ctx)
  const input = structuredClone({ model: m, entries: undo.map((snapshot, i) => ({ label: labels[i], time: 0, snapshot })) })
  const messages: ReplayMessage[] = []
  buildReplay(input, (msg) => messages.push(msg))
  const steps = messages.filter((x): x is { type: 'step'; step: ReplayStep } => x.type === 'step').map((x) => x.step)
  const error = messages.find((x) => x.type === 'error')
  const edited = exportedContent(m)
  for (let i = undo.length - 1; i >= 0; i--) restore(m, undo[i])
  return { storeys: [at.main.name, at.other.name], labels, steps, error, edited, replayed: exportedContent(input.model), undone: exportedContent(m) }
}
