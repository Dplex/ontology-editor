// 같은 건물의 두 파일(분야별 파일, 또는 판본)을 층 높이로 대 보고 길이 단위가 어긋났는지 본다(OE-BIM-11, 요구사항 R6).
//
// 단위 환산(ifc/units.ts)은 파일이 **선언한** 단위를 믿는다. 선언이 실제 값과 다르면 오류 없이 그 배수로 틀린다 — Duplex COBie(Design)
// 판본은 길이 단위를 밀리미터로 선언하고 층 높이를 미터 값(Level 2 = 3.1)으로 적어서, 3.1mm 로 들어왔다. 파일 하나만 보고는 알 수
// 없지만, 같은 건물의 다른 파일과 같은 이름 층의 높이를 견주면 비가 정확히 단위 배수(1/1000)로 나온다.

/** 길이 단위끼리의 배수. 비가 이 중 하나에 가까우면 단위가 어긋난 것으로 본다. */
const FACTORS: { ratio: number; what: string }[] = [
  { ratio: 1000, what: '밀리미터 ↔ 미터' },
  { ratio: 100, what: '센티미터 ↔ 미터' },
  { ratio: 1 / 0.3048, what: '피트 ↔ 미터' },
  { ratio: 304.8, what: '피트 ↔ 밀리미터' },
  { ratio: 1 / 0.0254, what: '인치 ↔ 미터' },
  { ratio: 12, what: '인치 ↔ 피트' },
]

/** 비가 배수에서 이만큼(상대값) 안이면 같은 배수로 본다. 층 높이는 저작 도구가 float 로 적어 3.0999999 처럼 나온다. */
const RATIO_TOLERANCE = 0.02
/** 0 에 가까운 층(지상 1층)은 비를 잴 수 없다. 이보다 높이가 작은 층은 견주지 않는다(미터). */
const MIN_ELEVATION = 0.5
/** 층간 높이(위아래 층 높이 차의 중앙값)가 이 안이면 미터로 말이 된다. 3.1mm·3000m 층은 밖이다. */
const PLAUSIBLE_STOREY_HEIGHT: [number, number] = [2, 12]

export type ScaleMismatch = {
  /** 둘째 파일의 층 높이 / 첫째 파일의 층 높이. 1000 이면 둘째가 1000배로 들어왔다. */
  ratio: number
  what: string
  /** 견준 층(이름, 첫째 높이, 둘째 높이). */
  storeys: [string, number, number][]
  /**
   * 틀린 쪽으로 보이는 파일. 층간 높이가 한쪽만 말이 되면(2~12m) 다른 쪽이다. 둘 다 되거나(피트 ↔ 미터는 3m ↔ 9.8m) 층이 하나뿐이면
   * null — 어느 쪽인지 말하지 않는다.
   */
  suspect: 'first' | 'second' | null
}

type Level = { name: string; elevation: number }

/**
 * 이름이 같은 층을 짝지어 높이 비를 잰다. 견줄 수 있는 층이 하나 이상이고, **모든** 짝의 비가 같은 단위 배수(또는 그 역수)에
 * 가까울 때만 돌려준다. 한 층만 다르면 단위가 아니라 높이 기준점이 다른 것이다(merge.ts 의 "높이가 다른 층" 경고가 맡는다).
 */
export function storeyScaleMismatch(first: readonly Level[], second: readonly Level[]): ScaleMismatch | null {
  const byName = new Map(first.map((s) => [s.name.trim(), s.elevation]))
  const storeys: [string, number, number][] = []
  for (const s of second) {
    const a = byName.get(s.name.trim())
    if (a === undefined) continue
    // 둘 중 하나라도 0 근처면 비가 뜻이 없다. 큰 쪽으로 걸러야 1/1000 로 줄어든 쪽(3.1mm)도 견준다.
    if (Math.max(Math.abs(a), Math.abs(s.elevation)) < MIN_ELEVATION || a === 0 || s.elevation === 0) continue
    storeys.push([s.name, a, s.elevation])
  }
  if (!storeys.length) return null
  const ratios = storeys.map(([, a, b]) => b / a)
  if (ratios.some((r) => r <= 0)) return null
  for (const f of FACTORS) {
    for (const ratio of [f.ratio, 1 / f.ratio]) {
      if (ratios.every((r) => Math.abs(r / ratio - 1) <= RATIO_TOLERANCE)) return { ratio, what: f.what, storeys, suspect: suspectOf(first, second) }
    }
  }
  return null
}

/** 위아래 층 높이 차의 중앙값. 층이 하나뿐이면 null. */
export function typicalStoreyHeight(levels: readonly Level[]): number | null {
  const zs = [...new Set(levels.map((s) => s.elevation))].sort((a, b) => a - b)
  const gaps = zs.slice(1).map((z, i) => z - zs[i]).sort((a, b) => a - b)
  return gaps.length ? gaps[Math.floor(gaps.length / 2)] : null
}

function suspectOf(first: readonly Level[], second: readonly Level[]): ScaleMismatch['suspect'] {
  const ok = (levels: readonly Level[]) => {
    const h = typicalStoreyHeight(levels)
    return h !== null && h >= PLAUSIBLE_STOREY_HEIGHT[0] && h <= PLAUSIBLE_STOREY_HEIGHT[1]
  }
  const a = ok(first)
  const b = ok(second)
  return a === b ? null : a ? 'second' : 'first'
}

/** 사람이 읽는 배수. 1000 → "1000배", 0.001 → "1/1000", 3.2808 → "3.28배". */
export function ratioLabel(ratio: number): string {
  const fmt = (v: number) => (Math.abs(v - Math.round(v)) < 0.01 ? String(Math.round(v)) : v.toFixed(2))
  return ratio >= 1 ? `${fmt(ratio)}배` : `1/${fmt(1 / ratio)}`
}
