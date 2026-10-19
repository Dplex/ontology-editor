import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { diagnoseFailure } from '../lib/checks'
import { familyKeyOf } from '../lib/edit'
import { withInferred } from '../lib/flow-rules'
import { warningCode } from '../lib/issue-code'
import { suggestKinds } from '../lib/kind-suggest'
import { equipmentKind, ifcClassLabel } from '../lib/kinds'
import { type Equipment, isConduit, unplacedOf } from '../lib/model'
import { outlinelessSpaces } from '../lib/outline-fill'
import type { RequirementRow, RequirementState } from '../lib/requirements'
import { needsSystem } from '../lib/served'
import { systemCandidates } from '../lib/system-suggest'
import { selectAndShow } from './chat-view'
import { applyFix, checks } from './checks'
import { editing, fileName, mode, model } from './core'
import { scrollInDrawer } from './shell'
import { exteriorIds } from './edit-report'
import { selectedElementId } from './equipment-edit'
import { shortName } from './equipment-shape'
import { selectedElement } from './export-compare'
import { airServiceList } from './flow-map'
import { confirmRule, equipmentById, flowVersion, hasRules, selected, selectedId, selectedRule, showRules } from './flow-rules'
import { runShortcut } from './keyboard'
import { familyLabel, legend, setKind } from './kinds'
import { group, groupItems, storeyOf } from './multi-select'
import { storeysByHeight, viewStorey } from './multi-view'
import { currentRequirements, warnings } from './open-file'
import { editBlock } from './people'
import { placing, startDraw, startPlace, stopPlace } from './place'
import { currentBox, sceneVersion } from './redraw'
import { selectedRoom, selectedRoomId, selectedSpaceId } from './rooms'
import { viewer } from './scene'
import { selectedCustomZone, selectedCustomZoneId } from './space-edit'
import { selectedObject, selectedObjectId, selectedSpace } from './space-objects'
import { applySystem } from './systems'
import { multiView, selectedVertical, selectedVerticalId, verticalCreate } from './vertical'
import { unknownFamilies } from './view-filter'

// --- 우측 패널 구역 탭 · 계통 범례 검색 · 하단 진단/경고 대시보드 ---
type SideTab = 'all' | 'inspector' | 'floor' | 'systems'
export const sideTab = ref<SideTab>('all')
export const legendOpen = ref(true)
export const legendSearch = ref('')
export const filteredLegend = computed(() => {
  const q = legendSearch.value.trim().toLowerCase()
  return q ? legend.value.filter((s) => s.name.toLowerCase().includes(q) || s.id.toLowerCase().includes(q)) : legend.value
})
export const hasInspectorSelection = computed(
  () =>
    !!(
      groupItems.value.length >= 2 ||
      selected.value ||
      selectedElement.value ||
      verticalCreate.value ||
      selectedVertical.value ||
      selectedObject.value ||
      selectedRoom.value ||
      selectedCustomZone.value ||
      selectedSpace.value
    ),
)
export const inspectorBadge = computed(() => {
  if (groupItems.value.length >= 2) return `다중 설비 (${groupItems.value.length})`
  if (selected.value) return isConduit(selected.value.role) ? '덕트·배관' : '설비'
  if (selectedElement.value) return selectedElement.value.wall ? '벽' : selectedElement.value.opening?.kind === 'door' ? '문' : '창문'
  if (verticalCreate.value || selectedVertical.value) return '수직 관통'
  if (selectedObject.value) return '공간 오브젝트'
  if (selectedRoom.value) return '룸'
  if (selectedCustomZone.value) return '커스텀존'
  if (selectedSpace.value) return '물리존'
  return '파일 개요'
})
export function clearInspectorSelection() {
  group.value = []
  selectedId.value = null
  selectedElementId.value = null
  selectedVerticalId.value = null
  selectedObjectId.value = null
  selectedRoomId.value = null
  selectedCustomZoneId.value = null
  selectedSpaceId.value = null
}

/** 종류가 빈 설비를 한 문장으로. IFC 클래스로 큰 갈래(센서·조명)는 아는데 사전의 세부 종류를 안 정한 것과, 아무것도 모르는 것을 가른다. */
function kindGap(e: Equipment): string {
  const ifc = ifcClassLabel(e.declaredType) ?? ifcClassLabel(e.ifcClass)
  return ifc ? `IFC 클래스로 '${ifc}' 까지만 알고, 세부 종류는 정하지 않은 설비입니다.` : '종류를 모르는 설비입니다.'
}
type SmartInsight = {
  key: string
  tone: 'warn' | 'info'
  text: string
  actionLabel?: string
  run?: () => void
}
/** 도메인 지식이 없는 사용자도 선택된 설비의 문제 원인과 해결책을 한눈에 파악하고 원클릭으로 고칠 수 있도록 돕는 가이드. */
export const selectedInsights = computed((): SmartInsight[] => {
  void flowVersion.value
  void sceneVersion.value
  const m = model.value
  const e = selected.value
  if (!m || !e) return []
  const list: SmartInsight[] = []

  // 1. 미배치 설비 (좌표 없음)
  if (!e.position) {
    list.push({
      key: 'unplaced',
      tone: 'warn',
      text: 'BIM 에 좌표가 없어 3D 에 놓이지 않은 설비입니다. 바닥을 눌러 놓을 수 있습니다.',
      actionLabel: !editBlock.value ? (placing.value === e.id ? '놓기 취소 (Esc)' : '3D 바닥에 놓기') : undefined,
      run: !editBlock.value
        ? () => {
            if (!editing.value) mode.value = 'edit'
            if (placing.value === e.id) stopPlace()
            else placeFromList(e.id)
          }
        : undefined,
    })
  }

  // 2. 소속 방(물리존) 누락
  if (e.position && !e.spaceId && !exteriorIds.value.has(e.id)) {
    const diag = diagnoseFailure('equipment-space', e.id, {
      model: m,
      connections: showRules.value && hasRules.value ? withInferred(m.connections) : m.connections,
      services: airServiceList.value,
      boxOf: currentBox,
      label: (id) => shortName(equipmentById.value.get(id)?.name || id),
    })
    const fix = diag?.fix
    if (fix && fix.kind === 'move-into') {
      list.push({
        key: 'space-near',
        tone: 'warn',
        text: `${diag.text} — '${fix.spaceName}' 안으로 옮기면 그 방 소속이 됩니다.`,
        actionLabel: !editBlock.value ? `${fix.spaceName} 안으로 옮기기` : undefined,
        run: !editBlock.value ? () => applyFix(e.id, fix) : undefined,
      })
    } else {
      list.push({
        key: 'space-missing',
        tone: 'warn',
        text: '어느 물리존(방)에도 들지 않아 소속이 비어 있습니다. 편집에서 방 안으로 옮기거나 소속을 직접 고릅니다.',
        actionLabel: !editing.value && !editBlock.value ? '편집 모드 열기 (E)' : undefined,
        run: !editing.value && !editBlock.value ? () => (mode.value = 'edit') : undefined,
      })
    }
  }

  // 3. 종류 모름 — U 로 도는 목록(unknownTypes)과 같은 판정이다. IFC 클래스로 종류가 서는 설비(Sensor → 센서)는 모름이 아니다.
  if (unknownFamilies.value.has(familyKeyOf(e))) {
    const topSug = suggestKinds(m).get(familyKeyOf(e))?.[0]
    const sugLabel = topSug ? equipmentKind(topSug.kind)?.label : null
    if (topSug && sugLabel) {
      list.push({
        key: 'kind-suggest',
        tone: 'info',
        text: `${kindGap(e)} 이름과 비슷한 패밀리로 보면 '${sugLabel}' 후보가 가장 앞섭니다. 정하면 같은 패밀리 전체에 붙습니다.`,
        actionLabel: !editBlock.value ? `'${sugLabel}' 로 정하기` : undefined,
        run: !editBlock.value
          ? () => {
              if (!editing.value) mode.value = 'edit'
              setKind(familyKeyOf(e), topSug.kind, familyLabel(e))
            }
          : undefined,
      })
    } else {
      list.push({
        key: 'kind-missing',
        tone: 'warn',
        text: `${kindGap(e)} 고르면 같은 패밀리 설비 전체에 붙습니다.`,
        actionLabel: !editBlock.value ? '종류 고르기 (K)' : undefined,
        run: !editBlock.value
          ? () => {
              if (!editing.value) mode.value = 'edit'
              void nextTick(() => runShortcut('kind'))
            }
          : undefined,
      })
    }
  }

  // 4. VAV·말단 설비의 계통 누락
  if (needsSystem(e) && !e.systemId) {
    const topSys = e.position ? systemCandidates(m, e.id)[0] : null
    if (topSys) {
      list.push({
        key: 'system-suggest',
        tone: 'warn',
        text: `계통이 없는 VAV·공기 말단입니다. 가장 가까운 계통은 '${topSys.system.name}'(${topSys.distance.toFixed(1)}m)입니다.`,
        actionLabel: !editBlock.value ? `'${topSys.system.name}' 에 넣기` : undefined,
        run: !editBlock.value
          ? () => {
              if (!editing.value) mode.value = 'edit'
              applySystem(e.id, topSys.system.id)
            }
          : undefined,
      })
    } else {
      list.push({
        key: 'system-missing',
        tone: 'warn',
        text: '계통이 없는 VAV·공기 말단입니다. 편집에서 아래 계통 칸으로 고릅니다.',
        actionLabel: !editing.value && !editBlock.value ? '편집 모드 열기 (E)' : undefined,
        run: !editing.value && !editBlock.value ? () => (mode.value = 'edit') : undefined,
      })
    }
  }

  // 5. 규칙으로 추정한 흐름 방향 미확정
  const rule = selectedRule.value
  if (rule && !rule.confirmed && rule.count > 0) {
    list.push({
      key: 'rule-confirm',
      tone: 'info',
      text: `'${rule.name}' 계통의 흐름 방향 ${rule.count}개는 설비 역할로 짐작한 것(사전)입니다. 확정해야 TTL 의 brick:feeds 로 나갑니다.`,
      actionLabel: !editBlock.value ? '이 계통 방향 확정 (C)' : undefined,
      run: !editBlock.value
        ? () => {
            if (!editing.value) mode.value = 'edit'
            confirmRule(rule.systemId, rule.name)
          }
        : undefined,
    })
  }

  return list
})

type WarnFilter = 'all' | 'A' | 'B' | 'C' | 'X' | 'other'
export const warnFilter = ref<WarnFilter>('all')
export const warnSearch = ref('')
export const warningsCollapsed = ref(false)
export const warnCounts = computed(() => {
  const c = { all: warnings.value.length, A: 0, B: 0, C: 0, X: 0, other: 0 }
  for (const w of warnings.value) {
    const code = warningCode(w)
    if (code && (code.cls === 'A' || code.cls === 'B' || code.cls === 'C' || code.cls === 'X')) c[code.cls]++
    else c.other++
  }
  return c
})
export const filteredWarnings = computed(() => {
  const q = warnSearch.value.trim().toLowerCase()
  return warnings.value.filter((w) => {
    if (warnFilter.value !== 'all') {
      const cls = warningCode(w)?.cls ?? 'other'
      if (cls !== warnFilter.value) return false
    }
    return !q || w.toLowerCase().includes(q)
  })
})
/** 경고 한 줄을 [파일명] · 핵심 문장 · 부연 설명으로 나누되 원문 글자 순서는 그대로 유지한다(E2E toContainText 호환). */
export function splitWarning(w: string): { prefix: string; main: string; rest: string } {
  const m = /^(\[[^\]]+\]\s*)(.*)$/s.exec(w)
  const prefix = m ? m[1] : ''
  const body = m ? m[2] : w
  const dot = body.indexOf('. ')
  if (dot > 0 && dot < body.length - 2) {
    return { prefix, main: body.slice(0, dot + 1), rest: body.slice(dot + 1) }
  }
  return { prefix, main: body, rest: '' }
}
export const failedCheckRules = computed(() => checks.value.filter((c) => !c.skipped && c.total > 0 && c.failed.length > 0))
export const failedChecksTotal = computed(() => failedCheckRules.value.reduce((sum, c) => sum + c.failed.length, 0))
export function jumpToSection(selector: string) {
  const el = document.querySelector<HTMLElement>(selector)
  if (!el) return
  if (el.classList.contains('fold') && !el.classList.contains('open')) {
    el.querySelector<HTMLButtonElement>('.fold-head')?.click()
  }
  // 기준 · 검증 드로어 안이면 드로어 안에서만 스크롤한다 — scrollIntoView 는 페이지까지 옆으로 밀었다(shell.ts 의 scrollInDrawer).
  if (!scrollInDrawer(el)) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

// 미배치 목록(OE-BIM-07). BIM 에 좌표가 없어 3D·평면에 그려지지 않는 설비. 임포트 경고는 연 때의 수만 말하고, 이 목록은
// 놓을 때마다 줄어든다. 설비 표의 빈 좌표 칸으로는 수천 행 사이에서 찾을 수 없었고, 완전성 검사는 방이 없는 파일에서
// 건너뛴다(ifc4Mep 28대). 많으면 앞의 UNPLACED_SHOWN 대만 그린다.
export const unplaced = computed(() => (model.value ? unplacedOf(model.value) : []))
/** 외곽선 없는 물리존(OE-MAN-03). 3D 에 없고 소속 판정에 쓰이지 않는다. 검토 화면에서 골라 그린다. */
export const outlineless = computed(() => (model.value ? outlinelessSpaces(model.value) : []))
/** 검토 화면의 목록에서 고른 물리존의 외곽선을 그린다. 편집 모드가 아니면 들어간다. */
export async function drawOutlineFromList(spaceId: string) {
  if (mode.value !== 'edit') {
    mode.value = 'edit'
    await nextTick()
  }
  startDraw(spaceId)
}
/** 팔레트의 미배치 목록. 한 층만 보는 중이면 그 층 것만. */
export const unplacedHere = computed(() => unplaced.value.filter((u) => !viewStorey.value || u.storey.id === viewStorey.value))

// --- 층별 칩 ---
// 3D 오른쪽 가장자리에 층마다(위층이 위) 손볼 것의 수를 쌓는다. 어느 층부터 고칠지 한눈에 보고, 누르면 그 층만 본다.
// 값은 새로 재지 않는다 — 미배치(unplacedOf)·완전성 검사(checks)가 이미 센 것을 층으로 나눈다.
//   미배치 = 좌표가 없는 설비 · 소속 없음 = 기기마다 소속 방 검사(device-space)에 걸린 기기 · 위반 = 그 밖의 검사에 걸린 설비·물리존(중복 없이)
export const storeyChips = computed(() => {
  const m = model.value
  if (!m || m.storeys.length < 2) return []
  // 검사에 걸리는 것은 설비와 물리존이다. 둘 다 제 층으로 센다.
  const home = new Map(m.storeys.flatMap((s) => [...s.equipment.map((e) => [e.id, s.id] as const), ...s.spaces.map((sp) => [sp.id, s.id] as const)]))
  const noSpace = new Set(checks.value.find((c) => c.key === 'device-space' && !c.skipped)?.failed ?? [])
  // 소속 없음은 따로 세니 위반에서 뺀다 — 같은 설비가 두 칩에 겹쳐 더해 읽히지 않게.
  const failed = new Set(checks.value.filter((c) => !c.skipped && c.key !== 'device-space').flatMap((c) => c.failed))
  const count = (ids: Iterable<string>) => {
    const n = new Map<string, number>()
    for (const id of ids) {
      const st = home.get(id)
      if (st) n.set(st, (n.get(st) ?? 0) + 1)
    }
    return n
  }
  const un = new Map<string, number>()
  for (const u of unplaced.value) un.set(u.storey.id, (un.get(u.storey.id) ?? 0) + 1)
  const ns = count(noSpace)
  const fl = count(failed)
  return [...storeysByHeight.value].reverse().map((st) => ({ id: st.id, name: st.name, unplaced: un.get(st.id) ?? 0, noSpace: ns.get(st.id) ?? 0, failed: fl.get(st.id) ?? 0 }))
})
export function pickStoreyChip(id: string) {
  if (multiView.value) return
  viewStorey.value = viewStorey.value === id ? null : id
}
// 층이 많으면(성수 19개 층) 목록이 굴러 지금 층 칩이 밖에 있을 수 있다. 층이 바뀌면 그 칩이 보이게 굴린다.
export const storeyChipList = ref<HTMLElement | null>(null)
function revealStoreyChip() {
  // scrollIntoView 는 페이지까지 굴린다(아래 표를 보다가 층을 바꾸면 화면이 튄다). 목록 안에서만 굴린다.
  const list = storeyChipList.value
  const on = list?.querySelector<HTMLElement>('button.on')
  if (!list || !on) return
  if (on.offsetTop < list.scrollTop) list.scrollTop = on.offsetTop
  else if (on.offsetTop + on.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = on.offsetTop + on.offsetHeight - list.clientHeight
}
// 연 직후에는 3D 칸 높이가 몇 번 바뀌어 목록이 나중에야 넘친다. 목록 크기가 바뀔 때도 지금 층 칩이 보이게 맞춘다.
const chipListSize = new ResizeObserver(() => revealStoreyChip())

// --- 성능 표(개발용, ` 키) ---
export const perfOn = ref(false)
export const perfStats = ref<{ fps: number; renderMs: number; calls: number; triangles: number } | null>(null)
let perfTimer: number | undefined
export const unplacedOpen = ref(false)
export const UNPLACED_SHOWN = 200
/** 목록에서 바로 놓는다. 편집 모드로 들어가 고르고, 다른 층만 보고 있었다면 설비의 층으로 바꾼 뒤 바닥을 누르게 한다. */
export function placeFromList(id: string) {
  if (!editing.value) mode.value = 'edit'
  selectAndShow(id)
  const home = storeyOf(id)
  // 놓을 층의 바닥이 보이게 그 층만 본다([설비 더하기] 와 같다). 모든 층을 보던 중이어도 바꾼다.
  if (home && (model.value?.storeys.length ?? 0) > 1 && viewStorey.value !== home.id) viewStorey.value = home.id
  startPlace(id)
}

export const REQUIREMENT_STATE: Record<RequirementState, string> = {
  standard: '표준 자리',
  elsewhere: '다른 자리',
  partial: '일부',
  missing: '없음',
  none: '해당 없음',
  unmeasured: '측정 불가',
}
// 접힌 칸의 제목 옆에 붙는 한 줄. 고객사에 할 말이 셋으로 갈린다 — 할 말 없음, 설정을 바꿔 달라, 값을 넣어 달라.
// 파일 하나로 잴 수 없는 것(R12·R13)을 분모에 넣으면 필수가 반쯤 빠진 것처럼 읽힌다. 잰 것만 센다.
export const requirementGroups = computed(() =>
  (['필수', '권장'] as const).map((level) => ({ level, rows: currentRequirements.value.filter((r) => r.level === level) })),
)
export const requirementsMeta = computed(() => {
  const count = (list: RequirementRow[], states: RequirementState[]) => list.filter((r) => states.includes(r.state)).length
  return requirementGroups.value
    .map(({ level, rows }) => {
      const parts = [
        [`표준 ${count(rows, ['standard'])}`],
        count(rows, ['elsewhere']) ? [`다른 자리 ${count(rows, ['elsewhere'])}`] : [],
        count(rows, ['missing', 'partial']) ? [`없음·일부 ${count(rows, ['missing', 'partial'])}`] : [],
        // 해당 없음·측정 불가는 미충족(없음·일부)과 따로 센다(OE-BIM-17). 섞으면 이 파일이 할 수 없는 것이 고객사가 빠뜨린 것처럼 읽힌다.
        count(rows, ['none']) ? [`해당 없음 ${count(rows, ['none'])}`] : [],
        count(rows, ['unmeasured']) ? [`측정 불가 ${count(rows, ['unmeasured'])}`] : [],
      ].flat()
      return `${level} ${rows.length}개: ${parts.join(' · ')}`
    })
    .join(' / ')
})

/** 화면이 붙을 때 한 번 — 이 모듈의 watch·이벤트·타이머. App.vue 가 부른다. */
export function setupPanels() {
  watch(hasInspectorSelection, (has) => {
    if (has && (sideTab.value === 'floor' || sideTab.value === 'systems')) sideTab.value = 'all'
  })
  watch(fileName, () => {
    warnFilter.value = 'all'
    warnSearch.value = ''
    warningsCollapsed.value = false
    legendSearch.value = ''
    sideTab.value = 'all'
  })
  watch(storeyChipList, (el, was) => {
    if (was) chipListSize.unobserve(was)
    if (el) chipListSize.observe(el)
  })
  onBeforeUnmount(() => chipListSize.disconnect())
  watch(viewStorey, async () => {
    await nextTick()
    revealStoreyChip()
  })
  watch(perfOn, (on) => {
    window.clearInterval(perfTimer)
    perfStats.value = null
    if (!on) return
    const read = () => (perfStats.value = viewer?.stats() ?? null)
    read()
    perfTimer = window.setInterval(read, 500)
  })
  onBeforeUnmount(() => window.clearInterval(perfTimer))
}
