import { computed, ref, shallowRef, triggerRef, watch } from 'vue'
import { hvacZonesOf } from '../lib/hvac-zone'
import { attachIdf, type IdfAttachReport } from '../lib/idf/attach'
import { confirmState, setConfirmed } from '../lib/idf/confirm'
import type { IdfPlacement } from '../lib/idf/place'
import { ZONE_SERVE_COLOR, ZONE_SERVE_LABEL, zoneDevices, type ZoneServe, zoneServes, zonesOverSpaces } from '../lib/idf/zone-view'
import type { Model } from '../lib/model'
import { wallTone } from '../lib/wall-view'
import { model } from './core'
import { spaceNameOf } from './edit-report'
import { equipmentById, selectedId } from './flow-rules'
import { note } from './keyboard'
import { selectedSystemId } from './kinds'
import { planStorey } from './labels'
import { viewStorey } from './multi-view'
import { idfPlacement, idfSource, meshes, pristine, setIdfPlacement, setPristine } from './open-file'
import { sceneVersion } from './redraw'
import { selectedSpaceId } from './rooms'
import { viewer } from './scene'
import { multiView } from './vertical'

// --- 공조존 (IDF, F12) --------------------------------------------------------------
//
// IDF 를 열거나 덧붙이면 공조존과 담당 관계가 모델에 얹힌다(idf/attach.ts). 읽은 IDF 는 들고 있다가 IFC 를 덧붙여 층·방이
// 바뀌면 다시 얹는다. 3D 에는 외곽선만 그린다(고르지 않는다) — 방을 누르면 그 방의 공조존을 패널이 말한다.
export const isIdf = (name: string) => /\.idf$/i.test(name)
export const idfReport = shallowRef<IdfAttachReport | null>(null)
export const idfPlacementForm = ref<{ dx: number; dy: number; rotation: number } | null>(null)

/**
 * IDF 를 다른 놓는 법으로 지금 모델에 다시 얹는다. IDF 공조존은 편집 대상이 아니라(hvac-zone.ts 의 findHvacZone) 다시 얹어도
 * 사람의 편집과 섞이지 않는다. 연 때 모델(pristine)에도 같이 얹어, 편집을 버리거나 IFC 를 덧붙여도 같은 자리다.
 * `null` 이면 사람이 정한 값을 버리고 다시 찾는다.
 */
export function placeIdf(placement: IdfPlacement | null) {
  if (!idfSource || !model.value) return
  setIdfPlacement(placement)
  const { name, idf } = idfSource
  const strip = (m: Model): Model => ({ ...m, hvac: undefined, warnings: m.warnings.filter((w) => !w.startsWith(`[${name}]`)) })
  // 다시 얹어도 사람이 확인한 존↔방 짝은 남는다(lib/idf/confirm.ts).
  const options = { ...(placement ? { placement } : {}), confirmed: model.value.hvac?.confirmed }
  const done = attachIdf(strip(model.value), idf, name, options)
  if (pristine) setPristine(attachIdf(strip(pristine), idf, name, options).model)
  idfReport.value = done.report
  model.value = done.model
  sceneVersion.value++
  note(placement ? `IDF 를 x ${placement.dx}m · y ${placement.dy}m · ${placement.rotation}° 로 다시 얹었습니다` : 'IDF 놓는 자리를 겹친 넓이로 다시 찾았습니다')
}

/**
 * 존↔물리존 매칭 확인(OE-ZON-07, D13). IDF 공조존의 든 방은 겹친 넓이로 계산한 초안이라 확인한 존만 TTL·GeoJSON 에 나간다.
 * 존 하나나 `null`(이 모델의 모든 존)을 확인하거나 풀어 바뀐 짝 수를 돌려준다. 연 때 모델(pristine)에도 같이 해서, 편집을 버려도 확인은 남는다.
 */
export function confirmZoneMatches(zoneId: string | null, on: boolean): number {
  const m = model.value
  if (!m?.hvac) return 0
  let n = 0
  for (const target of [m, pristine]) {
    if (!target?.hvac) continue
    let changed = 0
    for (const z of target.hvac.zones) if (zoneId === null || z.id === zoneId) changed += setConfirmed(target, z.id, on)
    if (target === m) n = changed
  }
  if (n) {
    triggerRef(model)
    sceneVersion.value++
    note(`존↔물리존 ${n}쌍을 ${on ? '확인했습니다. 온톨로지에 나갑니다' : '확인에서 풀었습니다. 온톨로지에 나가지 않습니다'}`)
  }
  return n
}
export const showZones = ref(true)
/**
 * 물리존 → 담당 공조존들. 물리존과 공조존은 N:M 이라(OE-MAP-03) 한 물리존을 여러 공조존이 담당할 수 있다 — 하나만 담으면 마지막
 * 공조존만 보였다. 출처는 공조존마다 다르다(IDF 공조존, 공조존 도구로 만든 것).
 */
export const zonesOfSpace = computed(() => {
  void sceneVersion.value
  const map = new Map<string, { id: string; name: string; source: 'idf' | 'edit' | 'calc'; share?: number }[]>()
  for (const z of model.value ? hvacZonesOf(model.value) : [])
    for (const id of new Set(z.spaceIds)) map.set(id, [...(map.get(id) ?? []), { id: z.id, name: z.name, source: z.source === 'edit' ? 'edit' : 'idf' }])
  // IDF 공조존과 겹치기만 한 방(존 여럿이 나누는 방). 몫은 계산이다(ADR-0069). 든 존은 위에서 이미 넣었다.
  for (const [id, list] of zonesOverSpaces(model.value?.hvac?.zones ?? []))
    for (const z of list) if (!map.get(id)?.some((x) => x.id === z.id)) map.set(id, [...(map.get(id) ?? []), { id: z.id, name: z.name, source: 'calc', share: z.share }])
  return map
})

// --- 공조존 고르기 (IDF 와 BIM 겹쳐 보기, ADR-0069) -------------------------------------------------
// 공조존 표의 줄이나 평면도의 존 이름을 누르면 그 존의 층으로 가서 3D·평면도에 존을 칠하고, 존을 담당하는 BIM 기기(말단과 그 위의
// 원천)를 짚는다. 설비·물리존·계통을 고르면 풀린다 — 한 번에 하나만 칠한다.
export const selectedZoneId = ref<string | null>(null)
const zoneServe = computed(() => {
  void sceneVersion.value
  return model.value ? zoneServes(model.value) : new Map<string, ZoneServe>()
})
export const selectedZone = computed(() => {
  void sceneVersion.value
  const id = selectedZoneId.value
  const z = id ? model.value?.hvac?.zones.find((x) => x.id === id) : null
  if (!z || !model.value) return null
  const devices = zoneDevices(model.value, z.id)
  const serve = zoneServe.value.get(z.id) ?? 'none'
  return {
    zone: z,
    serve,
    storey: model.value.storeys.find((s) => s.id === z.storeyId)?.name ?? '(층 모름)',
    devices,
    overlaps: (z.overlaps ?? []).map((o) => ({ name: spaceNameOf(o.spaceId), share: o.spaceShare, zoneShare: o.zoneShare })),
  }
})
export function selectZone(id: string | null) {
  selectedZoneId.value = selectedZoneId.value === id ? null : id
  if (!selectedZoneId.value) return
  selectedId.value = null
  selectedSystemId.value = null
  selectedSpaceId.value = null
  const z = model.value?.hvac?.zones.find((x) => x.id === id)
  if (z?.storeyId && !multiView.value) viewStorey.value = z.storeyId
}
/** 평면도에 그릴 이 층의 IDF 공조존. */
export const planZones = computed(() => {
  const st = planStorey.value
  if (!st || !showZones.value) return []
  return (model.value?.hvac?.zones ?? [])
    .filter((z) => z.storeyId === st.id)
    .map((z) => ({ id: z.id, name: z.name, rings: z.footprint, color: ZONE_SERVE_COLOR[zoneServe.value.get(z.id) ?? 'none'], chosen: z.id === selectedZoneId.value }))
})
/** 공조존 표 위의 범례. 이 모델에 있는 담당 방식만. */
export const zoneLegend = computed(() => {
  const n = new Map<ZoneServe, number>()
  for (const v of zoneServe.value.values()) n.set(v, (n.get(v) ?? 0) + 1)
  return (Object.keys(ZONE_SERVE_LABEL) as ZoneServe[]).filter((k) => n.get(k)).map((k) => ({ key: k, label: ZONE_SERVE_LABEL[k], color: ZONE_SERVE_COLOR[k], count: n.get(k)! }))
})
/** 공조존 표. 담당은 존을 직접 공급하는 설비(말단)와 그 위의 원천(공조기·실외기)이다. */
export const zoneRows = computed(() => {
  const hvac = model.value?.hvac
  if (!hvac) return []
  const storeyName = new Map((model.value?.storeys ?? []).map((s) => [s.id, s.name]))
  const upstream = new Map<string, string[]>()
  for (const e of hvac.equipment) for (const t of e.feeds) upstream.set(t, [...(upstream.get(t) ?? []), e.id])
  const byId = new Map(hvac.equipment.map((e) => [e.id, e]))
  const label = (id: string) => {
    const e = byId.get(id)
    if (!e) return id
    // 존 안의 BIM 기기 여럿으로 푼 IDF 존 설비(ADR-0069). 첫 대 이름과 대수를 보인다.
    if (e.bimIds?.length) return `${equipmentById.value.get(e.bimIds[0])?.name ?? e.bimIds[0]}${e.bimIds.length > 1 ? ` 등 ${e.bimIds.length}대` : ''}(BIM)`
    const bim = e.bimId ? equipmentById.value.get(e.bimId) : null
    return bim ? `${bim.name}(BIM)` : e.name
  }
  return hvac.zones.map((z) => {
    const terminals = upstream.get(z.id) ?? []
    const sources = [...new Set(terminals.flatMap((t) => upstream.get(t) ?? []))]
    return {
      id: z.id,
      name: z.name,
      storey: z.storeyId ? (storeyName.get(z.storeyId) ?? '') : '(층 모름)',
      area: z.areaM2,
      declared: z.declaredAreaM2,
      // 방을 다 덮지 않으면 몫을 붙인다(넓이로 잰다, idf/attach.ts).
      spaces: z.spaceIds.map((id) => {
        const share = z.spaceShares?.[id]
        return share !== undefined && share < 0.995 ? `${spaceNameOf(id)} ${Math.round(share * 100)}%` : spaceNameOf(id)
      }),
      // 든 방(절반 넘게 덮음) 말고 겹친 방. 방이 존보다 커서 존 여럿이 나누는 것이 여기 있다. 몫은 방 바닥 중 이 존의 몫이다.
      overlaps: (z.overlaps ?? []).filter((o) => !z.spaceIds.includes(o.spaceId)).map((o) => `${spaceNameOf(o.spaceId)} ${Math.round(o.spaceShare * 100)}%`),
      // 확인한 방 수 / 든 방 수. 확인한 방만 TTL·GeoJSON 에 나간다(OE-ZON-07).
      match: model.value ? confirmState(model.value, z) : { confirmed: 0, total: 0 },
      airflow: z.idfAirflowCMH ?? null,
      serve: zoneServe.value.get(z.id) ?? 'none',
      terminals: terminals.map(label),
      sources: sources.map(label),
    }
  })
})
export const ZONE_LIMIT = 200

// 보기 모드 3D 에 벽을 켜고 끈다(#599). 기본은 켠 것이다 — 끄면 방이 뚫려 보인다. 끈 것은 다음에 열 때도 남는다.
export const showWalls = ref(
  (() => {
    try {
      return localStorage.getItem('oe-show-walls') !== '0'
    } catch {
      return true
    }
  })(),
)
// 3D 에 그려지는 벽만 센다(wall-view.ts). 형상도 외곽선도 없는 벽(손으로 쓴 픽스처, COBie 판본)은 켜도 보일 것이 없다.
// meshes 는 반응형이 아니지만 늘 model 과 같이 바뀌므로 model 을 따라 다시 센다.
export const drawnWalls = computed(() => {
  if (!model.value) return null
  const n = { loadBearing: 0, unknown: 0, ordinary: 0 }
  for (const storey of model.value.storeys) {
    for (const wall of storey.walls) {
      if (!meshes.has(wall.id) && !wall.footprint?.length) continue
      n[wallTone(wall)]++
    }
  }
  return n.loadBearing + n.unknown + n.ordinary > 0 ? n : null
})

/** 화면이 붙을 때 한 번 — 이 모듈의 watch·이벤트·타이머. App.vue 가 부른다. */
export function setupIdfZones() {
  watch(idfReport, (r) => {
    idfPlacementForm.value = r?.placement ? { dx: r.placement.dx, dy: r.placement.dy, rotation: r.placement.rotation } : null
  })
  watch(showWalls, (on) => {
    viewer?.setWallsVisible(on)
    try {
      localStorage.setItem('oe-show-walls', on ? '1' : '0')
    } catch {
      /* 저장이 막힌 창이면 이번 탭에서만 */
    }
  })
}
