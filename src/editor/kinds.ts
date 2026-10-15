import { computed, ref, triggerRef, watch } from 'vue'
import { CONNECTION_CLASS_LABEL, countConnectionClasses } from '../lib/connection-class'
import { familyKeyOf, familyNameOf, kindEdits, setEquipmentSpace, setTypeKind, snapshotEquipment, snapshotType, typeKeyOf, typeNameOf } from '../lib/edit'
import { clueText, type FamilyClue, familyClues as computeFamilyClues } from '../lib/family-clues'
import { newlyDisagreeing } from '../lib/flow-rules'
import { type KindSuggestion, suggestKinds } from '../lib/kind-suggest'
import { EQUIPMENT_KINDS, equipmentKind, roomKind, systemKind } from '../lib/kinds'
import { layaKinds, type LayaResult, layaStatus, type LayaStatus } from '../lib/laya'
import { spaceAssignable, spaceSetState } from '../lib/mapping'
import { type Equipment, isConduit } from '../lib/model'
import { TOLERANCE } from '../lib/topology'
import { systemColors } from '../lib/viewer'
import { systemById } from './checks'
import { nameOfId } from './connections'
import { editing, fileName, model } from './core'
import { spaceNameOf } from './edit-report'
import { shortName } from './equipment-shape'
import { conduitId, equipmentById, flowVersion, ruleReport, selected, selectedId } from './flow-rules'
import { history, mark, remember } from './history'
import { note } from './keyboard'
import { storeyOf } from './multi-select'
import { sceneVersion } from './redraw'
import { systemKindText } from './systems'

// --- 종류 지정 (타입 단위) -----------------------------------------------------------
//
// 사전이 모르는 종류를 사람이 채운다. 한 번에 한 대가 아니라 **같은 타입(Revit 패밀리:유형) 전부**에 붙인다 —
// 병원 HVAC 는 종류 모르는 기기 327대가 타입 6개였다. 종류는 Brick 클래스와 규칙 방향(원천·말단)을 정하므로,
// edit.ts 가 규칙을 다시 돌리고 그 채점표를 돌려준다.
//
// 묶음은 **패밀리**다(edit.ts 의 familyNameOf). 크기만 다른 유형(VAV 150·200·250 mm)을 하나씩 고르지 않게 한다.
export const familyCounts = computed(() => {
  const map = new Map<string, { count: number; types: Set<string> }>()
  for (const s of model.value?.storeys ?? []) {
    for (const e of s.equipment) {
      const key = familyKeyOf(e)
      const row = map.get(key) ?? { count: 0, types: new Set<string>() }
      row.count++
      row.types.add(typeKeyOf(e))
      map.set(key, row)
    }
  }
  return map
})
export const typeLabel = (e: Equipment) => typeNameOf(e) ?? (e.name || e.ifcClass)
export const familyLabel = (e: Equipment) => familyNameOf(e) ?? (e.name || e.ifcClass)
export function setKind(typeKey: string, kind: string | null, label: string) {
  const m = model.value
  if (!m) return
  const snapshot = snapshotType(m, typeKey)
  const at = mark()
  const done = setTypeKind(m, typeKey, kind)
  if (!done) return
  remember(`${label} ${done.count}대 종류 → ${kind ? equipmentKind(kind)!.label : '모름'}`, snapshot, at)
  const worse = newlyDisagreeing(ruleReport.value, done.rules)
  ruleReport.value = done.rules
  triggerRef(model)
  flowVersion.value++
  // 흐름 없는 종류가 되거나 아니게 되어 형상 연결이 빠지거나 돌아왔다(OE-PIP-18). 3D 연결선을 다시 그린다.
  if (done.flowless.removed || done.flowless.restored) {
    sceneVersion.value++
    note(
      done.flowless.removed
        ? `흐름 없는 기기라 형상으로 이은 연결 ${done.flowless.removed}개를 뺐습니다(종류를 되돌리면 돌아옵니다)`
        : `형상으로 이은 연결 ${done.flowless.restored}개를 되살렸습니다(흐름 없는 기기가 아니게 됨)`,
    )
  }
  // remember 가 알림을 지우므로 그 뒤에 건다.
  kindWarning.value = ''
  if (worse.length) {
    const SHOW = 3
    const names = worse
      .slice(0, SHOW)
      .map((w) => `${systemById.value.get(w.systemId)?.name || w.systemId} ${w.agree}/${w.checked}`)
      .join(', ')
    // 3D 아래에는 띄우지 않는다. 종류는 고른 설비 패널이나 종류 목록에서 바꾸고, 알림은 거기 뜬다(둘이 한 화면에
    // 같이 보여 같은 글이 두 번 떴었다).
    kindWarning.value =
      `종류를 바꾼 뒤 규칙 방향이 포트와 어긋나는 계통이 생겼습니다: ${names}` +
      (worse.length > SHOW ? ` 외 ${worse.length - SHOW}개` : '') +
      '. 확정하기 전에 3D에서 흐름을 확인하거나 Ctrl+Z로 되돌리세요.'
  }
}
/** 종류를 바꿔 규칙이 포트와 어긋나기 시작했다는 알림. 3D 아래 알림은 종류 목록에서 안 보여 그 자리에도 둔다. */
export const kindWarning = ref('')
/** 고른 설비 패널의 종류 상자. 고른 뒤 포커스를 놓아 준다 — 상자에 남아 있으면 다음 단축키(U, K)를 상자가 먹는다. */
/** 고른 설비 한 대에만 종류를 정한다(OE-EQP-14 "원하면 설비 한 대씩"). 끄면 같은 패밀리 전부다. 다른 설비를 고르면 끈다. */
export const kindOnlyThis = ref(false)
export function pickKind(event: Event, e: Equipment) {
  const el = event.target as HTMLSelectElement
  if (kindOnlyThis.value) setKind(`#${e.id}`, el.value || null, shortName(e.name))
  else setKind(familyKeyOf(e), el.value || null, familyLabel(e))
  el.blur()
}
/** 종류를 모르는 패밀리 목록의 상자. 고르면 그 줄이 목록에서 빠지고, 포커스는 놓는다(다음 단축키를 상자가 먹지 않게). */
export function pickTypeKind(event: Event, typeKey: string, label: string) {
  const el = event.target as HTMLSelectElement
  setKind(typeKey, el.value || null, label)
  el.blur()
}
/** 종류를 모르는 기기를 패밀리로 묶은 것. 대수가 많은 것부터 — 위에서 몇 개만 고르면 대부분이 찬다. */
export const unknownTypes = computed(() => {
  const rows = new Map<string, { key: string; label: string; ifcClass: string; count: number; types: Set<string>; sampleId: string }>()
  for (const s of model.value?.storeys ?? []) {
    for (const e of s.equipment) {
      if (isConduit(e.role) || equipmentKind(e.kind)) continue
      const key = familyKeyOf(e)
      const row = rows.get(key) ?? { key, label: familyLabel(e), ifcClass: e.ifcClass, count: 0, types: new Set<string>(), sampleId: e.id }
      row.count++
      row.types.add(typeKeyOf(e))
      rows.set(key, row)
    }
  }
  return [...rows.values()].sort((a, b) => b.count - a.count)
})
export const TYPE_LIMIT = 50

/**
 * 종류를 모르는 패밀리마다 종류 후보(kind-suggest.ts). 이름의 낱말이 맞은 종류와, 같은 건물에서 계통·이웃·높이가 닮은
 * 패밀리의 종류다. 정하지 않는다 — 누르면 여느 종류 지정과 같이 패밀리 전체에 붙고(출처 "편집") 되돌리기에 쌓인다.
 */
export const kindSuggestions = computed(() => {
  void flowVersion.value
  const m = model.value
  return m && editing.value && unknownTypes.value.length ? suggestKinds(m) : new Map<string, KindSuggestion[]>()
})
export const suggestionWhy = (s: KindSuggestion) =>
  'name' in s.why ? `이름의 '${s.why.name}'` : `닮은 패밀리: ${s.why.like} (${Math.round(s.score * 100)}%)`

/** 종류를 모르는 패밀리마다 고를 단서(family-clues.ts). 편집 모드에서 보이는 줄에만 잰다. */
export const familyClues = computed(() => {
  void flowVersion.value
  const m = model.value
  if (!m || !editing.value) return new Map<string, FamilyClue>()
  return computeFamilyClues(m, { keys: new Set(unknownTypes.value.slice(0, TYPE_LIMIT).map((t) => t.key)) })
})

/**
 * Laya 종류 후보(laya.ts, ADR-0057). 편집 모드에 들어갈 때 133 의 서버가 있는지 한 번 보고, 있으면 보이는 줄의 단서 글을
 * 묻는다. 정하지 않는다 — 지금의 후보처럼 눌러야 붙는다. 서버가 없으면 이 줄이 보이지 않는다.
 */
export const layaState = ref<LayaStatus | null>(null)
export const layaResults = ref(new Map<string, LayaResult>())
let layaAsk = 0
export const layaPicks = (key: string) => (layaResults.value.get(key)?.ranked ?? []).filter((s) => equipmentKind(s.kind)).slice(0, 3)
export const kindEditLines = computed(() => {
  void flowVersion.value
  const m = model.value
  if (!m) return []
  const sample = new Map(m.storeys.flatMap((s) => s.equipment).map((e) => [typeKeyOf(e), e]))
  const name = (k: string | null) => (k ? (equipmentKind(k)?.label ?? k) : '모름')
  // 편집은 타입마다 적히지만(edit-file 도 타입 단위로 저장한다) 리포트는 패밀리 한 줄로 접는다.
  const rows = new Map<string, { key: string; label: string; count: number; types: number; from: string; to: string }>()
  const byId = equipmentById.value
  for (const k of kindEdits(m)) {
    // 한 대만 따로 정한 것(`#id`, OE-EQP-14)은 그 설비 이름으로 한 줄이다.
    const single = k.typeKey.startsWith('#') ? byId.get(k.typeKey.slice(1)) : undefined
    const e = single ?? sample.get(k.typeKey)
    const family = single ? k.typeKey : e ? familyKeyOf(e) : k.typeKey
    const key = `${family}|${k.from}|${k.to}`
    const label = single ? `${shortName(single.name)} (한 대만)` : e ? familyLabel(e) : k.typeKey
    const row = rows.get(key) ?? { key, label, count: 0, types: 0, from: name(k.from), to: name(k.to) }
    row.count += k.count
    row.types++
    rows.set(key, row)
  }
  return [...rows.values()]
})
// Proxy 는 IFC 가 역할을 말하지 않아서, 역할도 이름 사전의 종류에서 나온다.
export const roleSrc = (e: Equipment) => (e.added ? 'edit' : e.ifcClass === 'BuildingElementProxy' ? 'dict' : 'bim')
export const positionSrc = (e: Equipment) =>
  e.positionSource === 'edited' ? 'edit' : e.positionSource === 'geometry' || e.positionSource === 'panel' ? 'calc' : 'bim'
export const spaceSrc = (e: Equipment) => (e.spaceSource === 'bim' ? 'bim' : e.spaceSource === 'edit' ? 'edit' : 'calc')
export const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`

// --- 사람의 소속 지정 (OE-MAP-01 · K17) ------------------------------------------------------
// 기계가 확신하지 못한 설비(소속 허용 거리로 붙었거나 소속 없음)만 사람이 소속 물리존을 정한다. 기계가 확신하게 되면 지정은 남되
// 쓰이지 않고 "사람 지정 해제" 로 보인다. 설비를 옮기면 지정이 지워진다.
export const ASSIGN_RELEASE_REASON = { bim: 'BIM 이 적은 소속', inside: '외곽선 안', gone: '지정한 물리존이 없어짐' } as const
export const assignInfo = computed(() => {
  const e = selected.value
  const storey = e && model.value ? storeyOf(e.id) : null
  if (!e || !storey) return null
  return { storey, can: spaceAssignable(e, storey.spaces), state: spaceSetState(e, storey.spaces) }
})
export function applyAssign(id: string, raw: string) {
  const m = model.value
  if (!m) return
  const name = nameOfId(id)
  const snapshot = snapshotEquipment(m, id)
  const at = mark()
  const done = setEquipmentSpace(m, id, raw || null)
  if (!done) return
  if (typeof done === 'object') {
    note(done.refused)
    return
  }
  remember(raw ? `${shortName(name)} 소속 지정` : `${shortName(name)} 소속 지정 지우기`, snapshot, at)
  triggerRef(model)
  note(raw ? `${name}의 소속을 ${spaceNameOf(raw)}(으)로 정했습니다(출처 사람). 옮기면 지정이 지워집니다` : `${name}의 소속 지정을 지웠습니다. 좌표로 다시 판정합니다`)
}
/** 리포트의 사람 지정 줄. BIM 에는 사람 지정이 없으니 지정이 있는 설비가 전부 편집이다. */
export const assignLines = computed(() =>
  (model.value?.storeys ?? []).flatMap((st) =>
    st.equipment.flatMap((e) => {
      const state = spaceSetState(e, st.spaces)
      if (!state) return []
      return [state.state === 'applied'
        ? { id: e.id, name: e.name, released: false as const, from: e.spaceSet!, to: e.spaceId, reason: '' }
        : { id: e.id, name: e.name, released: true as const, from: state.from, to: e.spaceId, reason: ASSIGN_RELEASE_REASON[state.reason] }]
    }),
  ),
)

/**
 * Proxy 로 들어온 기기. IFC 가 설비라고 말하지 않은 것을 우리가 받은 것이다. 받은 근거가 둘이라 나눠 센다 —
 * 포트가 달려 연결망에 물려 있으면 BIM 의 연결로 판단한 것(계산), 포트 없이 이름만 사전에 있으면 사전이다.
 */
export const proxyDevices = computed(() => {
  const m = model.value
  if (!m) return { ported: 0, named: 0 }
  const ported = new Set(m.connections.filter((c) => c.source === 'port').flatMap((c) => [c.from, c.to]))
  let p = 0
  let n = 0
  for (const s of m.storeys) {
    for (const e of s.equipment) {
      if (e.ifcClass !== 'BuildingElementProxy' || isConduit(e.role)) continue
      if (ported.has(e.id)) p++
      else n++
    }
  }
  return { ported: p, named: n }
})

/**
 * 연결 수를 근거별로(OE-BIM-09, connection-class.ts). 포트는 BIM 이 말한 것이고 방향을 말했는지(명시 · 양방향/미지정)로 다시 가른다.
 * 형상 추정은 우리가 맞닿음으로 계산한 미확정 후보, 사람이 이은 것은 편집이다.
 */
export const connectionSources = computed(() => {
  const n = countConnectionClasses(model.value?.connections ?? [])
  return { ...n, port: n['port-directed'] + n['port-undirected'], kinds: [n['port-directed'] > 0, n['port-undirected'] > 0, n.geometry > 0, n.manual > 0].filter(Boolean).length }
})

// --- 종류와 관제점 후보 --------------------------------------------------------------
//
// 이름 사전(kinds.ts)으로 읽은 것을 한 칸에 모은다. IFC2x3·Proxy 파일에서는 설비 종류와 Brick 클래스가
// 여기서만 나오므로, 무엇을 알아봤고 무엇을 몰랐는지가 한눈에 보여야 사전을 고칠 수 있다.
export const kindSummary = computed(() => {
  const m = model.value
  if (!m) return null
  const devices = m.storeys.flatMap((s) => s.equipment).filter((e) => !isConduit(e.role))
  const byKind = new Map<string, { label: string; brick: string; count: number; located: number; point: boolean }>()
  let unknown = 0
  for (const e of devices) {
    const info = equipmentKind(e.kind)
    if (!info) {
      unknown++
      continue
    }
    const row = byKind.get(info.kind) ?? { label: info.label, brick: info.brick ?? '(ex:)', count: 0, located: 0, point: !!info.point }
    row.count++
    if (e.spaceId) row.located++
    byKind.set(info.kind, row)
  }
  const order = new Map(EQUIPMENT_KINDS.map((k, i) => [k.label, i]))
  const kinds = [...byKind.values()].sort((a, b) => b.count - a.count || (order.get(a.label)! - order.get(b.label)!))
  const spaces = m.storeys.flatMap((s) => s.spaces)
  const rooms = new Map<string, number>()
  let roomsFromBim = 0
  for (const sp of spaces) {
    const label = roomKind(sp.kind)?.label
    if (label) rooms.set(label, (rooms.get(label) ?? 0) + 1)
    if (label && sp.kindSource === 'bim') roomsFromBim++
  }
  const systems = new Map<string, number>()
  for (const sy of m.systems) {
    const label = sy.kind ? systemKindText(sy.kind, sy.fluid) : '(종류 모름)'
    systems.set(label, (systems.get(label) ?? 0) + 1)
  }
  return {
    devices: devices.length,
    unknown,
    kinds,
    points: kinds.filter((k) => k.point),
    roomsKnown: [...rooms.values()].reduce((a, b) => a + b, 0),
    roomsFromBim,
    roomsTotal: spaces.length,
    rooms: [...rooms].sort((a, b) => b[1] - a[1]),
    systems: [...systems].sort((a, b) => b[1] - a[1]),
  }
})

// 형상으로 이은 연결에 거리를 붙여 보여 준다. 기본 판정에서 붙은 것과 고립된 요소를
// 살리려고 넓혀서 붙인 것은 확신의 정도가 달라서, 검토하는 사람이 구별할 수 있어야 한다.
// 형상 추정은 미확정 연결 후보다(OE-BIM-09) — 포트가 말한 연결과 같은 무게로 읽히지 않게 이름에 적는다.
export const sourceLabel = (tolerance: number | null) =>
  tolerance !== null && tolerance > TOLERANCE ? `${CONNECTION_CLASS_LABEL.geometry} (${Math.round(tolerance * 1000)}mm 간격)` : CONNECTION_CLASS_LABEL.geometry

// 계통 범례. 색은 3D 와 같은 자리에서 가져온다.
//
// 수는 구성원 수다 — 고른 계통 패널의 "구성 N개", 3D 에서 칠하는 것과 같은 것을 센다. 설비의 `systemId` 로 세면 두 계통에
// 든 설비(성수 FCU 가 순환수 공급과 기계 급기에 같이 든다)가 한쪽에서만 세여, 범례 1400 · 패널 1537 처럼 어긋났다.
//
// 줄에는 종류(급기·순환수 공급)를 이름 앞에 두고, 숫자는 기기 대수다. 이름(`기계 급기 287`)은 BIM 이 붙인 번호라 그것만으로는 무엇인지
// 모르고, 구성원 수는 대부분 덕트·배관 조각이라 "급기 계통 48" 의 48 이 무엇인지 안 읽혔다. 구성원 수는 툴팁에 나눠 적는다.
export const legend = computed(() => {
  if (!model.value) return []
  const colors = systemColors(model.value)
  return model.value.systems
    .map((s) => {
      const devices = s.memberIds.filter((id) => !conduitId(id)).length
      return {
        id: s.id,
        name: s.name || '(이름 없는 계통)',
        kind: systemKind(s.kind)?.label ?? null,
        source: s.source,
        count: s.memberIds.length,
        devices,
        title: `${s.name || '(이름 없는 계통)'} — 구성원 ${s.memberIds.length}개(기기 ${devices} · 덕트·배관 ${s.memberIds.length - devices})`,
        color: `#${(colors.get(s.id) ?? 0).toString(16).padStart(6, '0')}`,
      }
    })
    .sort((a, b) => b.count - a.count)
})

/** 범례에서 고른 계통. 설비 선택과 배타다 — 둘을 겹쳐 칠하면 무엇이 강조된 건지 모른다. */
export const selectedSystemId = ref<string | null>(null)
export const selectedSystem = computed(() => (selectedSystemId.value ? (systemById.value.get(selectedSystemId.value) ?? null) : null))

/** 화면이 붙을 때 한 번 — 이 모듈의 watch·이벤트·타이머. App.vue 가 부른다. */
export function setupKinds() {
  watch([history, fileName], () => {
    // 되돌리거나 다른 편집을 하면 그 알림은 지난 이야기다.
    if (!history.value.at(-1)?.label.includes('종류 →')) kindWarning.value = ''
  })
  watch(selectedId, () => (kindOnlyThis.value = false))
  // 편집 모드에 들어갈 때마다 다시 본다 — 133 이 잠깐 꺼졌다 켜져도 다음 편집부터 다시 보인다.
  watch(editing, (on) => {
    if (on) void layaStatus().then((s) => (layaState.value = s))
  })
  watch(
    () => [familyClues.value, layaState.value] as const,
    async ([clues, state]) => {
      // 늦게 온 답이 새 단서의 답을 덮지 않게 번호를 본다.
      const ask = ++layaAsk
      if (!state?.enabled || !clues.size) return
      const texts = new Map([...clues].map(([key, c]) => [key, clueText(c)]))
      try {
        const got = await layaKinds([...texts.values()])
        if (ask === layaAsk) layaResults.value = new Map([...texts].filter(([, t]) => got.has(t)).map(([key, t]) => [key, got.get(t)!]))
      } catch {
        // 한 번 실패로 끄지 않는다(성수처럼 한 번에 많이 물으면 시간 초과가 날 수 있다). 이번 줄만 비우고 다음 편집 때 다시 묻는다.
        if (ask === layaAsk) layaResults.value = new Map()
      }
    },
  )
}
