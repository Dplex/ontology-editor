// B. 계통을 따라가는 대기 화면(tour) — 켜 둔 동안 10초 아무 입력이 없으면 UI 를 접고 계통을 따라 카메라가 천천히 간다(docs/plans/easter-eggs.md).
//
// - 넓게 보기(ctx.wide)로 UI 를 접고 위아래 검은 띠(2.39:1)를 내린다. 발표 전 쉬는 시간에 두 판이 나란히 켜져 있을 때를 위한 화면이다.
// - 길은 TTL `brick:feeds` 가 가장 많은 계통이다(readOntologyTTL 로 읽은 feeds 를 보내는 쪽 설비의 계통으로 묶는다). 그 계통의 원천에서 시작해
//   feeds 가 닿는 설비를 가까운 순서로 최대 40곳 들른다(tourPath). 들르는 설비는 모두 파일의 feeds 줄로 원천에 이어진 것이다.
// - 카메라는 그 설비들 위 3m 를 잇는 CatmullRom 곡선을 초속 4m 로 가고, 조금 앞을 본다. 끝에 닿으면 처음부터 다시 간다.
//   지나가는 설비 이름이 화면 아래에 한 줄씩 뜬다.
// - 아무 입력(포인터·키·휠)이 오면 바로 원래 시점과 화면으로 돌아가고, 다시 10초를 센다. 움직임 끄기면 돌지 않는다.
import { CatmullRomCurve3, Vector3 } from 'three'
import { readOntologyTTL } from '../lib/export/read-ttl'
import { modelToTTL } from '../lib/export/ttl'
import type { Model } from '../lib/model'
import { toScene } from '../lib/viewer'
import type { EggContext, EggHandle } from './types'

/** 기다리는 시간. 60초는 켠 사람도 기다리다 지쳐서 10초로 줄였다. e2e 는 1.5초. */
export const IDLE_MS = import.meta.env.MODE === 'e2e' ? 1500 : 10_000
const SPEED = 4
const HEIGHT = 3
const ASPECT = 2.39
const BAR_MS = 500

export type TourPath = { systemId: string; systemName: string; feeds: number; ids: string[] }

/** 들를 설비의 최대 수. 성수 큰 계통은 말단이 수백 개라 다 들르면 한 바퀴가 몇 분이다. */
export const MAX_STOPS = 40
/** 이보다 가까운 다음 설비는 건너뛴다. 같은 자리의 점이 둘이면 곡선 길이가 0 이 되어 자리가 NaN 이 됐다(병원). */
const MIN_STEP_M = 0.5

/**
 * feeds 가 가장 많은 계통과 그 안의 길. 그 계통에서 들어오는 feeds 가 없는 원천 가운데 feeds 를 따라 가장 많은 설비에 닿는 것에서 시작해,
 * 닿는 설비를 가까운 순서로(바로 앞 자리에서 가장 가까운 것) 들른다. 계통은 대개 원천 하나가 말단 수백 개를 먹이는 별 모양이라
 * 가장 긴 사슬은 두세 곳뿐이다(병원 가장 큰 계통: 공조기 → 말단 197). 자리가 있는 설비가 둘 이상이어야 길이다.
 */
export function tourPath(model: Readonly<Model>): TourPath | null {
  const m = model as Model
  const reading = readOntologyTTL(modelToTTL(m))
  const equipment = new Map(m.storeys.flatMap((s) => s.equipment).map((e) => [e.id, e]))
  const bySystem = new Map<string, [string, string][]>()
  for (const e of reading.entities) {
    const sys = equipment.get(e.key)?.systemId
    if (!sys) continue
    for (const t of e.feeds) {
      if (equipment.get(t)?.systemId !== sys) continue
      const list = bySystem.get(sys) ?? []
      list.push([e.key, t])
      bySystem.set(sys, list)
    }
  }
  const ranked = [...bySystem].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
  for (const [systemId, edges] of ranked) {
    const next = new Map<string, string[]>()
    const hasIn = new Set<string>()
    for (const [a, b] of edges) {
      next.set(a, [...(next.get(a) ?? []), b])
      hasIn.add(b)
    }
    let best: string[] = []
    for (const start of next.keys()) {
      if (hasIn.has(start)) continue
      const seen = new Set([start])
      const queue = [start]
      for (let i = 0; i < queue.length; i++) {
        for (const n of next.get(queue[i]) ?? []) {
          if (seen.has(n)) continue
          seen.add(n)
          queue.push(n)
        }
      }
      if (queue.length > best.length) best = queue
    }
    const pos = (id: string) => equipment.get(id)?.position ?? null
    const placed = best.filter((id) => pos(id))
    if (placed.length < 2) continue
    const ids = [placed[0]]
    const left = new Set(placed.slice(1))
    while (left.size && ids.length < MAX_STOPS) {
      const here = pos(ids[ids.length - 1])!
      let pick: string | null = null
      let d = Infinity
      for (const id of left) {
        const p = pos(id)!
        const dd = Math.hypot(p[0] - here[0], p[1] - here[1], p[2] - here[2])
        if (dd < d) {
          d = dd
          pick = id
        }
      }
      left.delete(pick!)
      if (d >= MIN_STEP_M) ids.push(pick!)
    }
    if (ids.length < 2) continue
    const sys = m.systems.find((s) => s.id === systemId)
    return { systemId, systemName: sys?.name ?? systemId, feeds: edges.length, ids }
  }
  return null
}

export function enable(ctx: EggContext): EggHandle {
  const doc = ctx.overlay.ownerDocument
  const top = doc.createElement('div')
  const bottom = doc.createElement('div')
  const caption = doc.createElement('div')
  for (const bar of [top, bottom]) bar.style.cssText = `position:absolute;left:0;right:0;height:0;background:#000;transition:height ${BAR_MS}ms ease-out`
  top.style.top = '0'
  bottom.style.bottom = '0'
  top.dataset.testid = 'egg-tour-bar'
  bottom.dataset.testid = 'egg-tour-bar'
  caption.dataset.testid = 'egg-tour-caption'
  caption.style.cssText = 'position:absolute;left:50%;transform:translateX(-50%);color:#e5e7eb;font:13px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;white-space:nowrap;opacity:0;transition:opacity 300ms ease-out'
  ctx.overlay.append(top, bottom, caption)

  let timer: ReturnType<typeof setTimeout> | null = null
  let touring = false
  let saved: ReturnType<EggContext['camera']['pose']> | null = null
  let curve: CatmullRomCurve3 | null = null
  let stops: { u: number; name: string }[] = []
  let duration = 0
  let startAt = 0
  let path: TourPath | null = null
  let pathVersion = -1
  let tours = 0
  let lastName = ''
  let why = ''

  function bars(on: boolean) {
    const rect = ctx.overlay.getBoundingClientRect()
    const h = on ? Math.max(0, (rect.height - rect.width / ASPECT) / 2) : 0
    for (const bar of [top, bottom]) {
      bar.style.transition = ctx.still() ? 'none' : `height ${BAR_MS}ms ease-out`
      bar.style.height = `${h}px`
    }
    caption.style.bottom = `${h + 16}px`
    if (!on) caption.style.opacity = '0'
  }

  function prepare(): boolean {
    const m = ctx.model()
    if (!m) return false
    if (pathVersion !== ctx.modelVersion()) {
      path = tourPath(m)
      pathVersion = ctx.modelVersion()
    }
    if (!path) {
      why = 'feeds 로 이어진 계통이 없습니다'
      return false
    }
    const equipment = new Map(m.storeys.flatMap((s) => s.equipment).map((e) => [e.id, e]))
    const pts: Vector3[] = []
    stops = []
    for (const id of path.ids) {
      const e = equipment.get(id)!
      const p = new Vector3(...toScene(e.position!))
      p.y += HEIGHT
      pts.push(p)
    }
    curve = new CatmullRomCurve3(pts, false, 'centripetal')
    const lengths = curve.getLengths(pts.length * 8)
    const total = lengths[lengths.length - 1]
    // 설비 하나하나가 곡선의 어디(0..1)에 있는지. 곡선은 점을 지나므로 점 i 는 i/(n-1) 근처다.
    path.ids.forEach((id, i) => stops.push({ u: i / (path!.ids.length - 1), name: equipment.get(id)!.name }))
    duration = Math.max(10_000, (total / SPEED) * 1000)
    return true
  }

  function start() {
    timer = null
    if (touring || ctx.still() || ctx.signals.replaying.value) return
    if (!prepare()) return
    saved = ctx.camera.pose()
    ctx.wide(true)
    // 넓게 보기로 3D 칸이 커진 뒤에 띠 높이를 잰다.
    requestAnimationFrame(() => requestAnimationFrame(() => touring && bars(true)))
    touring = true
    tours++
    // 시계는 첫 장의 step 에서 건다. rAF 가 주는 시각은 performance.now() 보다 이를 수 있어 여기서 걸면 첫 장의 경과가 음수가 되고
    // 곡선 위치가 0 밖으로 나가 three 가 던졌다(병원).
    startAt = -1
    lastName = ''
  }

  function finish() {
    if (!touring) return
    touring = false
    bars(false)
    ctx.wide(false)
    if (saved) ctx.camera.look(saved.position, saved.target)
    saved = null
  }

  function arm() {
    if (timer) clearTimeout(timer)
    timer = setTimeout(start, IDLE_MS)
  }

  const onInput = (e: Event) => {
    // 화면 배치가 바뀌며 생기는 제자리 pointermove 는 입력이 아니다(넓게 보기로 접을 때).
    if (e instanceof PointerEvent && e.type === 'pointermove' && e.movementX === 0 && e.movementY === 0) return
    finish()
    arm()
  }
  const events = ['pointerdown', 'pointermove', 'keydown', 'wheel'] as const
  for (const type of events) window.addEventListener(type, onInput, { capture: true, passive: true })
  arm()

  const ahead = new Vector3()
  const at = new Vector3()
  ctx.addLayer({
    step(now) {
      if (!touring || !curve) return false
      if (startAt < 0) startAt = now
      const u = (Math.max(0, now - startAt) % duration) / duration
      curve.getPointAt(u, at)
      curve.getPointAt(Math.min(1, u + 0.03), ahead)
      // 조금 앞, 길보다 낮은 곳을 본다(설비가 화면 아래쪽에 지나간다).
      ahead.y -= HEIGHT * 0.8
      if (ahead.distanceTo(at) < 0.01) ahead.set(at.x + 1, at.y - HEIGHT, at.z)
      ctx.camera.look([at.x, at.y, at.z], [ahead.x, ahead.y, ahead.z])
      const passed = [...stops].reverse().find((s) => s.u <= u + 1e-6)
      if (passed && passed.name !== lastName) {
        lastName = passed.name
        caption.textContent = `${path!.systemName} · ${passed.name} · 화면에서만`
        caption.style.opacity = '1'
      }
      return true
    },
  })

  return {
    off() {
      for (const type of events) window.removeEventListener(type, onInput, { capture: true })
      if (timer) clearTimeout(timer)
      finish()
    },
    inspect: () => ({ touring, tours, why, path: path && { system: path.systemName, feeds: path.feeds, stops: path.ids.length }, caption: caption.textContent }),
  }
}
