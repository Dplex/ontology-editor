import { ref } from 'vue'
import { isConduit } from '../lib/model'
import { findPart, VERTICAL_KIND_LABEL } from '../lib/vertical-object'
import type { HoverTarget } from '../lib/viewer'
import HoverTip from '../components/HoverTip.vue'
import { systemById, whatIs } from './checks'
import { ctxMenu } from './context-menu'
import { editing, model } from './core'
import { exteriorIds, spaceNameOf } from './edit-report'
import { arrowConnections, equipmentById, showRules } from './flow-rules'

// --- 3D 설명 풍선 ------------------------------------------------------------------
//
// 마우스 아래 있는 것이 무엇인지. 누르지 않고도 이름·종류·계통·소속을 본다(연결 화살표면 두 끝과 방향의 출처).
// 내용은 대상이 바뀔 때만 새로 만들고, 같은 대상 위에서는 자리만 옮긴다(HoverTip 주석 참조).
export const hoverTip = ref<InstanceType<typeof HoverTip> | null>(null)
let hoverKey = ''
function hoverText(t: HoverTarget): { title: string; lines: string[] } | null {
  const m = model.value
  if (!m) return null
  const nameOf = (id: string) => {
    const e = equipmentById.value.get(id)
    return e?.name || e?.ifcClass || id
  }
  if (t.kind === 'equipment') {
    const e = equipmentById.value.get(t.id)
    if (!e) return null
    const what = whatIs(e)?.label
    const system = e.systemId ? systemById.value.get(e.systemId)?.name : null
    return {
      title: e.name || what || e.ifcClass,
      lines: [[what, system].filter(Boolean).join(' · '), e.spaceId ? `소속 ${spaceNameOf(e.spaceId)}` : exteriorIds.value.has(e.id) ? '외벽 설비' : '소속 방 없음'].filter(Boolean),
    }
  }
  if (t.kind === 'space') {
    const v = findPart(m, t.id)
    if (v) {
      const { part } = v.object.parts[v.index]
      return { title: part.name || VERTICAL_KIND_LABEL[part.kind], lines: [`${VERTICAL_KIND_LABEL[part.kind]} · 수직 관통 오브젝트`, '층 편집 화면에서는 보기만 합니다'] }
    }
    for (const storey of m.storeys) {
      const sp = storey.spaces.find((x) => x.id === t.id)
      if (!sp) continue
      // 패널과 같은 말로 센다(기기만, 덕트·배관은 빼고).
      const devices = storey.equipment.filter((e) => e.spaceId === sp.id && !isConduit(e.role)).length
      return {
        title: sp.longName || sp.name,
        lines: [
          `물리존 ${sp.name} · ${storey.name} · ${sp.areaM2.toFixed(1)}㎡ · 기기 ${devices}대`,
          editing.value ? '클릭하면 꼭짓점을 고칠 수 있습니다' : '클릭하면 이 방에 든 기기를 봅니다',
        ],
      }
    }
    return null
  }
  const c = arrowConnections.value[Number(t.key)]
  if (!c) return null
  const from = c.directed ? c.from : c.edited ? c.edited.from : c.inferred && showRules.value ? c.inferred.from : null
  const to = from === c.from ? c.to : c.from
  const source = c.directed
    ? '포트 방향(BIM) · 고칠 수 없습니다'
    : c.edited
      ? '직접 정한 방향 · 클릭하면 바꿉니다'
      : c.inferred && showRules.value
        ? `규칙 방향(${c.inferred.confirmed ? '확정' : '추정'}) · 클릭하면 바꿉니다`
        : '방향 모름 · 클릭하면 정합니다'
  return { title: from ? `${nameOf(from)} → ${nameOf(to)}` : `${nameOf(c.from)} — ${nameOf(c.to)}`, lines: [source] }
}
export function onHover(t: HoverTarget | null, at: { x: number; y: number } | null) {
  const tip = hoverTip.value
  if (!tip) return
  // 우클릭 메뉴가 떠 있으면 설명 풍선을 띄우지 않는다 — 메뉴 위를 덮었다(ui-notes 보기 필터).
  if (!t || !at || ctxMenu.value) {
    hoverKey = ''
    tip.hide()
    return
  }
  const key = t.kind === 'arrow' ? `arrow:${t.key}` : `${t.kind}:${t.id}`
  if (key === hoverKey) return tip.move(at)
  hoverKey = key
  const text = hoverText(t)
  if (text) tip.show(t.kind, text.title, text.lines, at)
  else tip.hide()
}
