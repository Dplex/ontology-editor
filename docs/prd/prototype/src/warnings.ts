// 규칙 기반 경고(OE-P3-01~04). 경고는 반영을 막지 않는다 — 미리보기에 보이고 반영은 된다.
import type { Model, Space, Storey } from '../../../../src/lib/model'
import { hvacZonesOf } from '../../../../src/lib/hvac-zone'

export type WarnOpts = { minArea: number; w02: boolean; w03: boolean }
export const DEFAULT_WARN: WarnOpts = { minArea: 3, w02: true, w03: true }
export type FloorWarnings = { w01: Space[]; w02: Space[]; w03: Space[] }

export function warningsFor(model: Model, floor: Storey, o: WarnOpts): FloorWarnings {
  const zones = hvacZonesOf(model).filter(z => z.storeyId === floor.id)
  const inZone = new Set(zones.flatMap(z => z.spaceIds))
  return {
    // W-01 물리존 최소 면적: 기준 N ㎡ 보다 작은 물리존. 외곽선 없는 방은 넓이를 모르니 셈에서 뺀다.
    w01: floor.spaces.filter(s => s.footprint.length >= 4 && s.areaM2 < o.minArea),
    // W-02 설비 0개 물리존.
    w02: o.w02 ? floor.spaces.filter(s => !floor.equipment.some(e => e.spaceId === s.id)) : [],
    // W-03 공조존 미매핑 물리존(Z-01 대상). 층에 공조존이 하나도 없으면 세지 않는다 — 아직 안 만든 층이다.
    w03: o.w03 && zones.length ? floor.spaces.filter(s => !inZone.has(s.id)) : [],
  }
}
