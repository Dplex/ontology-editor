// 긴 선택 목록 줄이기. 계통이 1,037개(성수)인 상자에서 쓴다.

export type Option = { id: string; label: string }

/**
 * 찾는 말이 든 것만, 많으면 앞의 `limit` 개만 남긴다. **지금 고른 것은 늘 남긴다** — 상자가 지금 값을 잃으면 브라우저가 첫
 * 줄을 고른 것처럼 보여서, 사람이 아무것도 안 했는데 다른 계통에 든 것으로 읽힌다. 대소문자는 가리지 않는다.
 */
export function narrowOptions(options: readonly Option[], query: string, current: string | null, limit: number): { options: Option[]; hidden: number } {
  const q = query.trim().toLowerCase()
  const hit = q ? options.filter((o) => o.label.toLowerCase().includes(q) || o.id === current) : [...options]
  if (hit.length <= limit) return { options: hit, hidden: 0 }
  const head = hit.slice(0, limit)
  const cur = current && !head.some((o) => o.id === current) ? hit.find((o) => o.id === current) : undefined
  return { options: cur ? [cur, ...head] : head, hidden: hit.length - head.length }
}
