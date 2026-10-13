// Laya 종류 후보(ADR-0057). 종류를 모르는 패밀리의 단서 글(family-clues.ts 의 clueText)을 133 의 Laya 서버에 물어,
// 확률 순서의 종류 후보를 받는다. **정하지 않는다** — kind-suggest.ts 의 후보처럼 사람이 눌러야 붙고, 붙으면 출처는 "편집"이다.
// 서버가 없거나 닿지 않으면 아무것도 보이지 않는다(지금의 후보만 남는다). 임포터는 이것을 부르지 않는다 — 같은 IFC 는
// 언제나 같은 결과여야 해서(이어서 하기·check:sample), 모델 판이 바뀌면 달라지는 값을 임포트 결과에 넣지 않는다.

export type LayaPick = { kind: string; p: number }
export type LayaResult = { ranked: LayaPick[]; confidence: number }
export type LayaStatus = { enabled: boolean; reason?: string; model?: string }

/**
 * 이보다 자신이 없으면 흐리게 "자신 없음" 을 붙인다. **잰 값이 아니라 임시값이다**(ADR-0057). 학습 재료가 패밀리 362줄뿐이라
 * 버틸 만한 보정 집합이 없다. 맞는 라벨이 목록에 없을 때는 높게도 틀린다(Duplex 의 M_Thermostat → 조명 96%).
 */
export const LAYA_SURE = 0.5

/** 이보다 낮은 후보는 보이지 않는다(임시값). */
export const LAYA_MIN = 0.05

/**
 * [설비 더하기] 에서 사람이 친 이름을 Laya 가 읽는 글로. 놓기 전이라 방·계통·이웃은 아직 모르고, 아는 것은 이름과 놓을 면
 * (천장 모드인가)뿐이다. 학습 재료(scripts/laya/export.test.ts)도 이 함수로 만든다 — 줄을 바꾸면 다시 학습한다.
 */
export function newEquipmentText(name: string, ceiling: boolean): string {
  return [`새 설비 이름: ${name.trim()}`, `놓는 면: ${ceiling ? '천장' : '바닥·벽'}`].join('\n')
}

export async function layaStatus(): Promise<LayaStatus> {
  try {
    const r = await fetch('./__laya')
    if (!r.ok) return { enabled: false, reason: `${r.status}` }
    return (await r.json()) as LayaStatus
  } catch (e) {
    return { enabled: false, reason: String(e) }
  }
}

const cache = new Map<string, LayaResult>()

/** 단서 글 → 결과. 이미 물어본 글은 다시 묻지 않는다(편집할 때마다 단서가 다시 계산된다). */
export async function layaKinds(states: readonly string[]): Promise<Map<string, LayaResult>> {
  const ask = [...new Set(states)].filter((s) => !cache.has(s))
  for (let i = 0; i < ask.length; i += 200) {
    const part = ask.slice(i, i + 200)
    const r = await fetch('./__laya/kinds', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ states: part }),
    })
    if (!r.ok) throw new Error(`Laya ${r.status}`)
    const { results } = (await r.json()) as { results: LayaResult[] }
    part.forEach((s, j) => cache.set(s, results[j]))
  }
  return new Map(states.filter((s) => cache.has(s)).map((s) => [s, cache.get(s)!]))
}
