// 말로 편집 시키기(ADR-0058). [온톨로지] 칸의 gemini 가 답 끝에 편집 계획을 ```oe-edit 블록(JSON 배열)으로 붙이면, 창이 그것을
// 보이고 사람이 [적용] 을 눌러야 화면(App.vue 의 window.__oe.apply)이 여느 편집과 같은 함수로 실행한다. 이 파일은 계획을 읽고,
// 계획이 가리키는 방·설비를 지금 모델에서 찾고, 사람이 읽을 한 줄로 바꾸는 데까지다 — 실행은 App.vue 가 한다(되돌리기·알림·검사).
//
// 대상은 id 로 받는다. gemini 는 온톨로지 도구(onto_find)로 찾은 `ex:…` id 를 쓴다 — TTL 의 id 는 모델 id 를 escapeLocalName 으로
// 바꾼 것이라 거꾸로 맞춘다. 이름도 받지만 그 이름이 하나뿐일 때만이다(같은 이름이 여럿이면 고르지 않고 후보를 돌려준다).
import { escapeLocalName } from './export/ttl'
import { equipmentKind } from './kinds'
import { isConduit, type Model } from './model'

export type EditCommand =
  | { do: 'add_equipment'; space: string; kind: string; name?: string }
  | { do: 'connect'; from: string; to: string }

/** 한 번에 받는 명령 수. 넘으면 계획 전체를 받지 않는다 — 말 한마디로 수십 개가 바뀌면 사람이 미리보기로 볼 수 없다. */
export const MAX_COMMANDS = 10

/** 답 글에서 ```oe-edit 블록을 찾아 명령으로. 블록이 없으면 null, 있는데 틀렸으면 error. */
export function parsePlan(text: string): { commands: EditCommand[] } | { error: string } | null {
  const m = /```oe-edit\s*\n([\s\S]*?)```/.exec(text)
  if (!m) return null
  let raw: unknown
  try {
    raw = JSON.parse(m[1])
  } catch {
    return { error: '편집 계획이 JSON 이 아닙니다' }
  }
  const list = Array.isArray(raw) ? raw : [raw]
  if (!list.length) return { error: '편집 계획이 비었습니다' }
  if (list.length > MAX_COMMANDS) return { error: `편집 계획은 ${MAX_COMMANDS}개까지입니다(${list.length}개)` }
  const commands: EditCommand[] = []
  for (const [i, c] of list.entries()) {
    const at = `${i + 1}번째 명령`
    if (!c || typeof c !== 'object') return { error: `${at}이 객체가 아닙니다` }
    const o = c as Record<string, unknown>
    const str = (k: string) => (typeof o[k] === 'string' && (o[k] as string).trim() ? (o[k] as string).trim() : null)
    if (o.do === 'add_equipment') {
      const space = str('space')
      const kind = str('kind')
      if (!space || !kind) return { error: `${at}(add_equipment)에 space·kind 가 없습니다` }
      if (!equipmentKind(kind)) return { error: `${at}의 종류 ${kind} 를 모릅니다` }
      commands.push({ do: 'add_equipment', space, kind, ...(str('name') ? { name: str('name')! } : {}) })
    } else if (o.do === 'connect') {
      const from = str('from')
      const to = str('to')
      if (!from || !to) return { error: `${at}(connect)에 from·to 가 없습니다` }
      commands.push({ do: 'connect', from, to })
    } else return { error: `${at}의 do 는 add_equipment·connect 만 됩니다(${String(o.do)})` }
  }
  return { commands }
}

export type Resolved = { id: string; label: string; storeyId: string } | { error: string }

/** `ex:` 를 떼고 TTL 이스케이프(`\$`)를 푼다. */
const bare = (ref: string) => ref.trim().replace(/^`|`$/g, '').replace(/^ex:/, '').replace(/\\(.)/g, '$1')

/** 방(물리존) 하나. id·이스케이프한 id·이름(하나뿐일 때) 순으로 찾는다. */
export function resolveSpace(model: Model, ref: string): Resolved {
  const r = bare(ref)
  const all = model.storeys.flatMap((st) => st.spaces.map((sp) => ({ sp, st })))
  const hit = all.find(({ sp }) => sp.id === r || escapeLocalName(sp.id) === ref.replace(/^ex:/, ''))
  if (hit) return { id: hit.sp.id, label: hit.sp.longName || hit.sp.name, storeyId: hit.st.id }
  const named = all.filter(({ sp }) => sp.longName === r || sp.name === r)
  if (named.length === 1) return { id: named[0].sp.id, label: named[0].sp.longName || named[0].sp.name, storeyId: named[0].st.id }
  if (named.length > 1) return { error: `"${r}" 인 방이 ${named.length}개입니다(${named.slice(0, 5).map(({ sp, st }) => `${st.name} ${sp.id}`).join(', ')}) — id 로 가리킵니다` }
  return { error: `방 "${r}" 을 지금 화면에서 찾지 못했습니다` }
}

/** 설비 하나(덕트·배관 구간은 빼지 않는다 — 배관과 잇는 명령도 있다). */
export function resolveEquipment(model: Model, ref: string): Resolved {
  const r = bare(ref)
  const all = model.storeys.flatMap((st) => st.equipment.map((e) => ({ e, st })))
  const hit = all.find(({ e }) => e.id === r || escapeLocalName(e.id) === ref.replace(/^ex:/, ''))
  if (hit) return { id: hit.e.id, label: hit.e.name || hit.e.ifcClass, storeyId: hit.st.id }
  const named = all.filter(({ e }) => e.name === r && !isConduit(e.role))
  if (named.length === 1) return { id: named[0].e.id, label: named[0].e.name, storeyId: named[0].st.id }
  if (named.length > 1) return { error: `"${r}" 인 설비가 ${named.length}대입니다 — id 로 가리킵니다` }
  return { error: `설비 "${r}" 을 지금 화면에서 찾지 못했습니다` }
}

export type Preview = { command: EditCommand; text: string; ok: boolean }

/** 사람이 [적용] 전에 읽을 한 줄씩. 찾지 못한 대상이 있으면 ok=false 이고 [적용] 은 그 명령을 건너뛰지 않고 계획 전체를 막는다. */
export function previewPlan(model: Model, commands: readonly EditCommand[]): Preview[] {
  // 앞 명령에서 더할 설비의 이름. 뒤의 연결이 그 이름으로 가리킬 수 있다("공조기를 더하고 VAV3 과 잇기").
  const pending = new Set<string>()
  const equip = (ref: string): Resolved => (pending.has(bare(ref)) ? { id: '', label: `${bare(ref)}(새로 더할 설비)`, storeyId: '' } : resolveEquipment(model, ref))
  return commands.map((c) => {
    if (c.do === 'add_equipment') {
      const sp = resolveSpace(model, c.space)
      const kind = equipmentKind(c.kind)!.label
      if ('error' in sp) return { command: c, text: `설비 더하기 — ${sp.error}`, ok: false }
      if (c.name) pending.add(c.name)
      const storey = model.storeys.find((s) => s.id === sp.storeyId)!
      return { command: c, text: `${storey.name} ${sp.label} 에 ${kind}${c.name ? ` "${c.name}"` : ''} 더하기`, ok: true }
    }
    const a = equip(c.from)
    const b = equip(c.to)
    if ('error' in a) return { command: c, text: `연결 — ${a.error}`, ok: false }
    if ('error' in b) return { command: c, text: `연결 — ${b.error}`, ok: false }
    return { command: c, text: `${a.label} – ${b.label} 연결`, ok: true }
  })
}
