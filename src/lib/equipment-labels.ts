// 3D 위 설비 라벨(V4, 에테리온 데모의 "기기마다 MAPPED·SENSOR 배지"). 층 하나를 볼 때 설비마다 이름과 두 배지를 띄운다.
//   소속 — 설비가 든 물리존을 누가 정했나(BIM 이 말함 · 좌표로 계산 · 사람이 지정 · 없음). TTL 의 brick:hasLocation 이 이것이다.
//   종류 — Brick 클래스가 어디서 왔나(BIM 의 IFC 타입 · 이름 사전 · 사람이 정함 · 모름). TTL 의 `a brick:…` 가 이것이다.
// 둘 다 이미 패널에 있는 값을 3D 위로 옮긴 것이다. 화면이 넘치지 않게 고른 것·화면 가운데에 가까운 것부터 겹치지 않는 만큼만 둔다.
import type { Equipment } from './model'

export type LabelBadge = { text: string; tone: 'ok' | 'warn' | 'muted'; title: string }

/** 소속·종류 배지. 출처 낱말은 화면의 출처 칩(BIM·계산·사전·사람)과 같게 쓴다. */
export function labelBadges(e: Pick<Equipment, 'spaceId' | 'spaceSource' | 'kind' | 'kindSource' | 'kindEdited' | 'added'>): { space: LabelBadge; kind: LabelBadge } {
  const space: LabelBadge = !e.spaceId
    ? { text: '소속 없음', tone: 'warn', title: '든 물리존이 없습니다 — TTL 에 brick:hasLocation 이 나가지 않습니다' }
    : e.spaceSource === 'bim'
      ? { text: '소속 BIM', tone: 'ok', title: 'BIM 이 이 설비가 든 물리존을 말했습니다(IfcRelContainedInSpatialStructure)' }
      : e.spaceSource === 'edit'
        ? { text: '소속 사람', tone: 'ok', title: '사람이 물리존을 지정했습니다' }
        : { text: '소속 계산', tone: 'ok', title: '좌표가 든 물리존 외곽선으로 계산했습니다' }
  const kind: LabelBadge = !e.kind
    ? { text: '종류 모름', tone: 'warn', title: '사전에 없는 종류입니다 — Brick 클래스가 IFC 클래스에서 나옵니다' }
    : e.kindEdited || e.added
      ? { text: '종류 사람', tone: 'ok', title: '사람이 종류를 정했습니다' }
      : e.kindSource === 'bim'
        ? { text: '종류 BIM', tone: 'ok', title: 'IFC 타입(PredefinedType)에서 읽었습니다' }
        : { text: '종류 사전', tone: 'muted', title: '이름 사전으로 읽었습니다' }
  return { space, kind }
}

export type LabelCandidate = { id: string; x: number; y: number; w: number; h: number; first?: boolean }

/**
 * 겹치지 않는 라벨만 고른다. 고른 것(`first`)이 먼저, 그다음 화면 가운데(cx, cy)에 가까운 순이다. 라벨은 점 위쪽에 놓이고
 * (x 가운데, 아래 끝이 y − gap) 서로 겹치면 뒤의 것을 뺀다. 많아야 `max` 개.
 */
export function placeLabels(items: readonly LabelCandidate[], center: { x: number; y: number }, max: number, gap = 14): LabelCandidate[] {
  const order = [...items].sort((a, b) => Number(!!b.first) - Number(!!a.first) || Math.hypot(a.x - center.x, a.y - center.y) - Math.hypot(b.x - center.x, b.y - center.y))
  const placed: { l: number; t: number; r: number; b: number }[] = []
  const out: LabelCandidate[] = []
  for (const it of order) {
    if (out.length >= max) break
    const box = { l: it.x - it.w / 2, r: it.x + it.w / 2, b: it.y - gap, t: it.y - gap - it.h }
    if (placed.some((p) => box.l < p.r && box.r > p.l && box.t < p.b && box.b > p.t)) continue
    placed.push(box)
    out.push(it)
  }
  return out
}
