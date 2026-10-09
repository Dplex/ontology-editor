// 편집 리플레이(PoC)의 진행. P 로 열고, 이번 세션의 편집(되돌리기 이력)을 3D 위에서 고친 순서대로 다시 튼다.
// App.vue 는 useReplay 를 한 번 부르고 자기 것(모델·이력·되돌리기·고른 것…)을 ReplayPlayerHost 로 빌려준다. 리플레이의 진행은
// 전부 여기 있고, App.vue 에는 "리플레이 중이면 이것은 건너뛴다" 같은 꽂는 자리만 남는다 — `replayOpen`·`replay.` 로 찾으면 다 나온다.
// main 으로 옮길 때 이 파일은 그대로 가져가고, App.vue 는 그 꽂는 자리만 맞춘다. 3D 연출은 replay-viewer.ts, 화면 위의 HUD 는
// components/ReplayHud.vue, 장면 카드 계산은 replay.ts(워커).
//
// P 로 연다. 3D 를 창 전체로 키우고(극장), 이번 세션의 편집을 되돌리기로 한 번에 처음까지 돌린 뒤 다시 하기로 하나씩 다시 한다.
// 3D 에서 설비가 미끄러져 옮겨 가고 방이 번쩍이는 것은 되돌리기·다시 하기가 원래 하는 일이라, 리플레이는 순서와 카메라만
// 맡는다. 장면마다 그 층만 보이고 그 자리로 카메라를 보낸 뒤 다시 하고, 그 편집이 TTL·GeoJSON 의 어디를 바꿨는지를 카드로
// 띄운다(components/ReplayHud.vue, 워커가 모델 사본으로 계산 — lib/replay.ts). 닫으면 남은 편집을 다시 해서 연 때 상태로 돌아온다.
// 카메라 비행(1.5초) 뒤에 다시 하고, 설비가 미끄러져(1.1초) 충격파가 퍼지고 카드가 다 써질 때까지 둔다.

import { computed, nextTick, onBeforeUnmount, ref, shallowRef, toRaw, watch, type ComputedRef, type Ref, type ShallowRef } from 'vue'
import { isConduit, type Connection, type Equipment, type Model, type Storey, type Vec2, type Vec3 } from './model'
import { labelPoint } from './polygon'
import { roomKind } from './kinds'
import type { Snapshot } from './edit'
import type { Arrow, Viewer } from './viewer'
import { CATEGORY_COLOR, type ReplayMessage, type ReplayStart, type ReplayStep } from './replay'

/**
 * 리플레이가 열려 있나. App 의 여러 곳이 "리플레이 중이면 건너뛴다" 로 읽어서 모듈에 둔다(useReplay 를 부르기 전에 선언된
 * computed·watch 도 읽는다). 앱은 하나라 하나면 된다.
 */
export const replayOpen = ref(false)

/** 벽·문·창 장면이 나온 뒤로는 그 외곽선 층을 켜 둔다(평소에는 편집 모드의 벽·문·창 모드에서만 그린다). 고른 것은 그 장면의 요소. */
export const replayArch = ref(false)
export const replayElement = ref<string | null>(null)

/**
 * 편집 리플레이 동안 마지막 값을 그대로 두는 computed. 옆 패널(계통 표·완전성 검사·설치면 판정)은 극장에 가려 안 보이는데, 모델이
 * 장면마다 바뀌면 그 접이 판들이 스스로 다시 그리며 모델 전체를 다시 훑어 화면이 끊겼다. 리플레이 동안은 replayOpen 만 보고,
 * 닫으면 한 번 새로 센다.
 */
export function pausedInReplay<T>(fn: () => T) {
  let last: { v: T } | null = null
  return computed(() => {
    if (replayOpen.value && last) return last.v
    last = { v: fn() }
    return last.v
  })
}

/**
 * 극장 뒤에 가려진 패널의 v-memo. 리플레이 동안은 늘 같은 값이라 그 패널을 다시 그리지 않고(그 안의 표·요약 계산도 안 돈다),
 * 평소에는 그릴 때마다 새 값이라 그대로 다시 그린다. 성수에서 장면마다 App 을 다시 그리는 데 0.2초가 들어 리플레이가 끊겼다.
 */
const REPLAY_FROZEN = [true]
export const replayMemo = () => (replayOpen.value ? REPLAY_FROZEN : [{}])

/** n 프레임 기다린다. */
export const frames = (n = 2) => new Promise<void>((r) => (n <= 1 ? requestAnimationFrame(() => r()) : requestAnimationFrame(() => void frames(n - 1).then(r))))

/** App.vue 가 빌려주는 것. */
export type ReplayPlayerHost = {
  readonly viewer: Viewer | null
  model: ShallowRef<Model | null>
  fileName: Ref<string>
  history: ShallowRef<readonly { label: string; time: number; snapshot: Snapshot }[]>
  future: ShallowRef<readonly unknown[]>
  undo: () => void
  redo: () => void
  viewStorey: Ref<string | null>
  selectedId: Ref<string | null>
  selectedSpaceId: Ref<string | null>
  activeTab: Ref<'3d' | 'plan'>
  editing: ComputedRef<boolean>
  dark: Ref<boolean>
  equipmentById: ComputedRef<Map<string, Equipment>>
  arrowConnections: ComputedRef<Connection[]>
  arrowOf: (c: Connection, key: string, active: boolean) => Arrow
  activeArrow: Ref<number | null>
  shortName: (name: string | undefined | null) => string
  flushNudge: () => void
  note: (text: string) => void
}

export function useReplay(host: ReplayPlayerHost) {
  const { model, history, future, undo, redo, viewStorey, selectedId, selectedSpaceId, activeTab, equipmentById, arrowConnections, arrowOf, activeArrow, shortName, flushNudge, note } = host

  const REPLAY_AIM_MS = 1800
  const REPLAY_STEP_MS = 5200
  /** 오프닝. 건물 전체를 보며 제목을 띄우고, 그동안 층이 아래부터 쌓이며 건물이 솟아오른다(host.viewer.buildUp — 0.3초 납작하게 두었다가 2.7초). */
  const REPLAY_INTRO_MS = 3000
  const replayTotal = ref(0)
  /** opening: 열고 첫 장면 전(편집 전 상태로 되돌려 두고 건물이 솟아오르는 동안). */
  const replayPhase = ref<'opening' | 'play' | 'done'>('play')
  const replayPlaying = ref(true)
  const replaySpeed = ref(1)
  /** 카메라가 다음 편집 자리로 가는 중이면 그 번호. */
  const replayAiming = ref<number | null>(null)
  const replayStart = shallowRef<ReplayStart | null>(null)
  const replaySteps = shallowRef<ReplayStep[]>([])
  const replayError = ref('')
  /** 지금까지 다시 한 장면 수의 최댓값. 카드를 눌러 앞 장면으로 돌아가도 그 뒤 카드를 남기는 데 쓴다. 처음으로 돌리면 0. */
  const replaySeen = ref(0)
  /** 카드·시간줄을 눌러 반복해 보는 장면. Space 를 누르면 그 다음 장면부터 이어서 튼다. */
  const replayLoop = ref<number | null>(null)
  watch(
    () => history.value.length,
    (n) => {
      if (replayOpen.value && replayPhase.value !== 'opening') replaySeen.value = Math.max(replaySeen.value, n)
    },
  )
  /**
   * 밤 다이오라마의 방 표시(이름 · 면적 · 종류). 한 층만 보이면 그 층의 넓은 방부터 ROOM_TAGS 개와 지금 장면에서 바뀐 방(강조).
   * 건물 전체를 볼 때(오프닝·끝 화면)는 비운다 — 오프닝은 솟아오르는 건물이, 끝 화면은 장면 번호 이름표가 주인공이다.
   */
  const ROOM_TAGS = 36
  const replayRoomTags = computed(() => {
    const m = model.value
    if (!m || !replayOpen.value || replayPhase.value === 'opening') return []
    const stepAt = replayAiming.value ?? history.value.length - 1
    const sceneRooms = new Set((replaySteps.value[stepAt]?.changes ?? []).filter((c) => c.key.startsWith('sp:') && c.after).map((c) => c.key.slice(3)))
    const tag = (storey: Storey, sp: Storey['spaces'][number], hot: boolean) => {
      const at = labelPoint(sp.footprint)
      if (!at) return []
      const kind = roomKind(sp.kind)?.label
      return [{ id: sp.id, storeyId: storey.id, at: [at[0], at[1], storey.elevation] as Vec3, title: sp.longName || sp.name || '물리존', sub: `${sp.areaM2.toFixed(1)} m²${kind ? ` · ${kind}` : ''}`, hot }]
    }
    const storey = viewStorey.value ? m.storeys.find((st) => st.id === viewStorey.value) : m.storeys.length === 1 && replayPhase.value === 'play' ? m.storeys[0] : null
    if (!storey) return []
    const big = [...storey.spaces].filter((sp) => sp.footprint.length >= 3).sort((a, b) => b.areaM2 - a.areaM2).slice(0, ROOM_TAGS)
    const list = [...new Set([...big, ...storey.spaces.filter((sp) => sceneRooms.has(sp.id))])]
    return list.flatMap((sp) => tag(storey, sp, sceneRooms.has(sp.id)))
  })
  watch(replayRoomTags, (tags) => host.viewer?.setRoomTags(tags))
  /** 3D 에 한 층만 보이면 그 층(장면이 그 층만 보이게 한다 — replayAim). 층이 하나뿐인 파일도 그 층이다. */
  const replayStorey = computed(() => {
    const m = model.value
    const id = viewStorey.value ?? (m?.storeys.length === 1 ? m.storeys[0].id : null)
    const st = id ? m?.storeys.find((x) => x.id === id) : null
    return st ? { name: st.name, elevation: st.elevation } : null
  })
  /** 반복 한 바퀴: 되돌린 모습을 잠깐 보이고(앞), 다시 한 뒤 둔다(뒤). */
  const REPLAY_LOOP_BEFORE_MS = 900
  const REPLAY_LOOP_AFTER_MS = 2200
  /** 조작(멈춤·앞뒤·닫기)마다 바꾼다. 도는 중인 장면은 이것이 바뀌면 그 자리에서 멈춘다. */
  let replayToken = 0
  let replayWorker: Worker | null = null
  let replaySaved: { selectedId: string | null; selectedSpaceId: string | null; viewStorey: string | null; activeTab: '3d' | 'plan' } | null = null

  /** ms 만큼(배속 반영) 기다린다. 조작으로 장면이 끊기면 false. */
  function replayWait(ms: number, token: number): Promise<boolean> {
    const t0 = performance.now()
    return new Promise((r) => {
      const tick = () => {
        if (token !== replayToken || !replayOpen.value) return r(false)
        if (performance.now() - t0 >= ms / replaySpeed.value) return r(true)
        window.setTimeout(tick, 30)
      }
      tick()
    })
  }

  async function openReplay() {
    const m = model.value
    const n = history.value.length
    if (!m || !host.viewer) return
    if (!n) {
      note('리플레이할 편집이 없습니다 — 이번 세션에서 한 편집(되돌리기 이력)만 틉니다')
      return
    }
    flushNudge()
    replaySaved = { selectedId: selectedId.value, selectedSpaceId: selectedSpaceId.value, viewStorey: viewStorey.value, activeTab: activeTab.value }
    replayTotal.value = n
    replaySteps.value = []
    replayStart.value = null
    replayError.value = ''
    replayAiming.value = null
    replayLoop.value = null
    replaySeen.value = 0
    replayFilter.value = null
    replayPhase.value = 'opening'
    replayPlaying.value = true
    activeTab.value = '3d'
    // 장면 카드(TTL·GeoJSON 변화)는 지금 모델과 이력의 사본으로 따로 계산한다. 처음으로 돌리기 전에 넘긴다 — 워커는 편집을 다 한 모델에서 시작한다.
    replayWorker?.terminate()
    replayWorker = new Worker(new URL('./replay.worker.ts', import.meta.url), { type: 'module' })
    replayWorker.onmessage = (e: MessageEvent<ReplayMessage>) => {
      const msg = e.data
      if (msg.type === 'start') replayStart.value = msg.start
      else if (msg.type === 'step') replaySteps.value = [...replaySteps.value, msg.step]
      else if (msg.type === 'error') replayError.value = msg.message
      else if (msg.type === 'done') {
        replayWorker?.terminate()
        replayWorker = null
      }
    }
    try {
      replayWorker.postMessage({ model: toRaw(m), entries: history.value.map((h) => ({ label: h.label, time: h.time, snapshot: toRaw(h.snapshot) })) })
    } catch (err) {
      replayError.value = err instanceof Error ? err.message : String(err)
    }
    replayOpen.value = true
    host.viewer.setEditMode(false)
    host.viewer.setArrowsShown(true)
    // 극장 바탕이 어두워서 라이트 테마의 진한 화살표가 묻힌다.
    host.viewer.setDark(true)
    host.viewer.setCinema(true)
    host.viewer.setDiorama(true)
    host.viewer.onSpotClick(replaySpotClick)
    selectedId.value = null
    selectedSpaceId.value = null
    const token = ++replayToken
    // 편집 전 상태로 한 번에 되돌린다(되감는 장면은 보이지 않는다). 그 상태의 건물이 오프닝에서 솟아오른다.
    replayRewind()
    await nextTick()
    await frames()
    // 오프닝: 건물 전체를 보며 제목, 그동안 납작한 평면도에서 건물이 솟아오른다.
    viewStorey.value = null
    await nextTick()
    host.viewer.frameAll()
    host.viewer.buildUp()
    // 건물이 다 솟을 즈음 해가 지고 방 불이 아래층부터 켜진다(첫 장면으로 넘어가는 순간까지).
    host.viewer.nightFall(REPLAY_INTRO_MS - 700)
    if (!(await replayWait(REPLAY_INTRO_MS, token))) return
    replayPhase.value = 'play'
    void replayRun(token)
  }

  /** 편집 전 상태로 한 번에 되돌린다. 되돌리기 몇 번이라 순간이다(카드 계산은 열 때 따로 시작한 워커가 한다). */
  function replayRewind() {
    replayAiming.value = null
    replayLoop.value = null
    replaySeen.value = 0
    host.viewer?.spotlight([], [], 0)
    while (history.value.length > 0) undo()
  }

  /** 단계 i 의 카드 자료. 워커가 아직이면 기다린다(성수 편집 5건에 0.8초). */
  async function replayStepInfo(i: number, token: number): Promise<ReplayStep | null> {
    for (let t = 0; t < 400 && token === replayToken; t++) {
      if (replaySteps.value[i]) return replaySteps.value[i]
      if (replayError.value) return null
      await new Promise((r) => window.setTimeout(r, 50))
    }
    return replaySteps.value[i] ?? null
  }

  /**
   * 다음 편집 자리로 시점을 맞춘다: 그 층만 보이고, 바뀐 설비(없으면 물리존)에 카메라를 맞추고 고른다. `camera` 가 false 면
   * 카메라·층은 두고 비추기·고르기만 한다(장면 반복의 두 번째 바퀴부터 — 사람이 다가가 보는 시점을 빼앗지 않는다). 바뀐 것은 워커가 낸 평면
   * 변화(열쇠 eq:·sp:·cn:)에서 읽는다 — 편집 종류마다 대상을 따로 셈하지 않아도 된다.
   */
  async function replayAim(step: ReplayStep | null, camera = true) {
    const m = model.value
    if (!m || !host.viewer) return
    const storeyId = step?.storeyIds[0] ?? null
    // 층을 바꾸면 watch(viewStorey) 가 건물 전체로 시점을 옮긴다. 카메라를 두는 때는 층도 그대로 둔다.
    // 건물 전체에서 한 층으로 들어갈 때는 단면 자르기로: 자르는 면이 위에서 그 층까지 내려와 위층을 걷어낸 뒤 층을 바꾼다.
    let cut = false
    if (camera && storeyId && m.storeys.length > 1 && viewStorey.value !== storeyId) {
      if (viewStorey.value === null && replayOpen.value) {
        await host.viewer.sectionTo(storeyId)
        cut = true
      }
      viewStorey.value = storeyId
    }
    const equipment: string[] = []
    const spaces: string[] = []
    const walls: string[] = []
    for (const c of step?.changes ?? []) {
      if (c.key.startsWith('eq:')) equipment.push(c.key.slice(3))
      else if (c.key.startsWith('sp:')) spaces.push(c.key.slice(3))
      else if (c.key.startsWith('wl:')) walls.push(c.key.slice(3))
      else if (c.key.startsWith('cn:')) equipment.push(...c.key.slice(3).replace(/#\d+$/, '').split('>'))
    }
    const byId = equipmentById.value
    const devices = [...new Set(equipment)].filter((id) => byId.has(id) && !isConduit(byId.get(id)!.role))
    const any = [...new Set(equipment)].filter((id) => byId.has(id))
    const newcomers = (step?.changes ?? []).flatMap((c) => (c.after?.t === 'equip' && c.after.at && !c.after.conduit && !byId.has(c.after.id) ? [c.after] : []))
    // 층을 바꾼 watch(frameAll) 뒤에 맞춘다.
    await nextTick()
    // 다른 층이 숨은 뒤라 자르는 면을 풀어도 위층이 다시 보이지 않는다.
    if (cut) host.viewer.clearSection()
    const color = replayColor(step)
    const lit = (ids: string[]) => ids.filter((id) => byId.has(id) && !isConduit(byId.get(id)!.role)).slice(0, 4).map((id) => ({ id, label: shortName(byId.get(id)!.name) }))
    const arch = replayArchOf(step, 'before')
    if (arch && (step?.category === '벽·문·창' || (!spaces.length && !any.length))) {
      // 벽·문·창은 3D 형상이 아니라 외곽선 층에 그려진다. 그 층을 켜고, 바뀐 벽·문·창 자리(옮겼으면 전·후 둘 다)로 간다.
      replayArch.value = true
      replayElement.value = arch.id
      selectedId.value = null
      selectedSpaceId.value = null
      if (camera) host.viewer.framePoints([...arch.frame, ...(replayArchOf(step, 'after')?.frame ?? [])], 3)
      host.viewer.spotlight([], [], color, { points: arch.points, rings: arch.rings })
    } else if (spaces.length) {
      // 물리존 편집은 물리존을 본다. 같이 바뀐 설비(소속이 풀린 것)는 결과라서, 멀리 있는 하나가 시점을 끌고 가면 안 된다.
      if (camera) host.viewer.frameSpace(spaces[0])
      selectedId.value = null
      selectedSpaceId.value = spaces[0]
      host.viewer.spotlight([], spaces, color)
    } else if (devices.length || any.length) {
      // 첫 설비와 그 근처(12m)만 담는다. 계통 확정처럼 층 전체에 흩어진 편집도 한 자리를 크게 본다. 흐름 편집은 바뀐 연결이
      // 짧은 덕트 마디라 바짝 다가가야 화살표가 보인다.
      const flow = step?.category === '흐름 방향' || step?.category === '연결'
      const list = flow ? any : devices.length ? devices : any
      const at = byId.get(list[0])?.position
      const near = at ? list.filter((id) => { const p = byId.get(id)?.position; return !p || Math.hypot(p[0] - at[0], p[1] - at[1]) < 12 }) : list
      if (camera) host.viewer.frame(near.slice(0, 80), flow ? 1 : 4)
      selectedSpaceId.value = null
      selectedId.value = devices[0] ?? null
      // 흐름 장면의 주인공은 바뀐 연결의 화살표다. 빛기둥은 시작 설비 하나만.
      host.viewer.spotlight(flow ? lit(near).slice(0, 1) : lit(devices.length ? devices : near), [], color)
    } else if (newcomers.length) {
      // 더하기 장면: 다시 하기 전에는 설비가 아직 없어서 3D 에서 찾을 수 없다. 들어설 자리로 가서 그 자리를 비춘다.
      const at = newcomers.map((it): Vec3 => [it.at![0], it.at![1], m.storeys.find((st) => st.id === it.storeyId)?.elevation ?? 0])
      if (camera) host.viewer.framePoints(at, 3)
      selectedId.value = null
      selectedSpaceId.value = null
      // 기둥은 세우지 않는다 — 그 자리에서 납작한 발자국이 솟아 형체를 드러낸다(replayLand 의 revealElements).
      host.viewer.spotlight([], [], color, { points: newcomers.slice(0, 4).map((it, k) => ({ key: `eq:${it.id}`, at: at[k], label: shortName(it.name), bare: true })) })
    } else if (walls.length) {
      const room = m.storeys.flatMap((st) => st.spaces).find((sp) => sp.boundedBy.includes(walls[0]))
      if (camera && room) host.viewer.frameSpace(room.id)
      else if (camera) host.viewer.frameAll()
      host.viewer.spotlight([], room ? [room.id] : [], color)
    } else {
      if (camera) host.viewer.frameAll()
      host.viewer.spotlight([], [], color)
    }
  }

  /**
   * 장면의 벽·문·창 변화를 비출 자리로. `side` 는 편집 전(카메라를 보낼 때)·후(다시 한 뒤). 후에는 옮긴 문·창이 옛 자리에서
   * 미끄러져 오게 from 을 붙인다. 바뀐 벽·문·창이 없으면 null.
   */
  function replayArchOf(step: ReplayStep | null, side: 'before' | 'after') {
    const m = model.value
    if (!m) return null
    const changes = (step?.changes ?? []).filter((c) => c.key.startsWith('op:') || c.key.startsWith('wl:'))
    if (!changes.length) return null
    const elevation = (sid: string) => m.storeys.find((s) => s.id === sid)?.elevation ?? 0
    const names = new Map(m.storeys.flatMap((s) => s.openings).map((o) => [o.id, o.name]))
    const frame: Vec3[] = []
    const points: { key: string; at: Vec3; from?: Vec3; label?: string }[] = []
    const rings: { key: string; ring: Vec2[]; elevation: number }[] = []
    for (const c of changes.slice(0, 6)) {
      const it = side === 'before' ? c.before : c.after
      const was = c.before
      if (!it) continue
      const z = elevation(it.storeyId)
      if (it.t === 'opening' && it.at) {
        const at: Vec3 = [it.at[0], it.at[1], z]
        const from = side === 'after' && was?.t === 'opening' && was.at && (was.at[0] !== it.at[0] || was.at[1] !== it.at[1]) ? ([was.at[0], was.at[1], z] as Vec3) : undefined
        frame.push(at)
        points.push({ key: c.key, at, from, label: names.get(it.id) ? shortName(names.get(it.id)!) : it.kind === 'door' ? '문' : '창' })
      } else if (it.t === 'wall') {
        for (const ring of it.rings) {
          frame.push(...ring.map((p): Vec3 => [p[0], p[1], z]))
          rings.push({ key: `${c.key}:${rings.length}`, ring, elevation: z })
        }
      }
    }
    const first = (changes[0].after ?? changes[0].before)!
    return { id: first.t === 'opening' || first.t === 'wall' ? first.id : null, frame, points, rings }
  }

  const replayColor = (step: ReplayStep | null) => parseInt((step ? CATEGORY_COLOR[step.category] : '#5ef2c2').slice(1), 16)

  /**
   * 다시 하기 바로 전. 이 편집이 지우는 것(설비·벽·문·창·물리존·룸)을 붉은 윤곽으로 비춰 가라앉히며 지운다 — 4D 시뮬레이션의
   * "철거" 처럼. 다시 하면 뚝 사라져서 무엇이 지워졌는지 안 보였다. 설비 상자는 아직 3D 에 있을 때 재야 해서 다시 하기 전에 부른다.
   */
  function replayDemolish(step: ReplayStep | null) {
    const m = model.value
    if (!m || !host.viewer) return
    const elevation = (sid: string) => m.storeys.find((s) => s.id === sid)?.elevation ?? 0
    type Gone = Parameters<Viewer['demolish']>[0][number]
    const items = (step?.changes ?? []).flatMap((c): Gone[] => {
      const it = c.before
      if (!it || c.after) return []
      const z = elevation(it.storeyId)
      if (it.t === 'equip') return it.conduit ? [] : [{ key: c.key, id: it.id }]
      if (it.t === 'wall') return it.rings.map((ring, k) => ({ key: `${c.key}:${k}`, ring, elevation: z, height: 2.6 }))
      if (it.t === 'opening' && it.at) return [{ key: c.key, at: [it.at[0], it.at[1], z] as Vec3 }]
      if (it.t === 'space' || it.t === 'zone') return [{ key: c.key, ring: it.ring, elevation: z, height: 0.4 }]
      return []
    })
    if (items.length) host.viewer.demolish(items.slice(0, 24))
  }

  /** 다시 한 뒤. 물리존은 모양이 바뀌었으니 울타리를 새 모양으로 다시 세운다(옛 것은 옅어진다). */
  function replayLand(step: ReplayStep | null) {
    // 새로 생긴 것(벽·문·창·설비·공간 오브젝트)은 납작한 2D 발자국에서 3D 형체를 드러낸다. 덕트·배관은 빼고.
    const born = (step?.changes ?? []).flatMap((c) => {
      const it = c.after
      if (c.before || !it) return []
      if (it.t === 'wall' || it.t === 'opening' || (it.t === 'equip' && !it.conduit) || (it.t === 'zone' && it.zone === 'object')) return [it.id]
      return []
    })
    host.viewer?.revealElements(born)
    replayFlash(step)
    void replayArrows(step)
    const spaces = (step?.changes ?? []).filter((c) => c.key.startsWith('sp:')).map((c) => c.key.slice(3))
    const arch = replayArch.value ? replayArchOf(step, 'after') : null
    // 새로 생긴 문·창 자리에는 기둥을 세우지 않는다 — 기둥이 솟아오르는 문·창을 가린다.
    const points = arch?.points.map((p) => (born.includes(p.key.slice(3)) ? { ...p, bare: true } : p))
    if (arch && (arch.points.length || arch.rings.length)) host.viewer?.spotlight([], [], replayColor(step), { points, rings: arch.rings })
    else if (spaces.length) host.viewer?.spotlight([], spaces, replayColor(step))
  }

  /**
   * 카드·시간줄을 눌러 고른 장면 하나를 반복해서 튼다: 그 편집 앞까지 되돌리거나 다시 하고, 카메라를 보낸 뒤 다시 하고, 잠깐
   * 두었다가 되돌려 또 다시 한다. 그 뒤 장면의 카드는 남는다(replaySeen). 다른 조작을 하면 멈추고, Space 는 그 다음 장면부터
   * 이어서 튼다(replayToggle).
   */
  async function replayScene(i: number) {
    if (replayPhase.value === 'opening' || i < 0 || i >= replayTotal.value) return
    const token = ++replayToken
    replayPlaying.value = false
    replayPhase.value = 'play'
    replayLoop.value = i
    // 장면 제목·카드가 앞 장면으로 깜빡이지 않게 되돌리기 전에 그 장면을 가리킨다(ReplayHud 의 upcoming).
    replayAiming.value = i
    for (let round = 0; token === replayToken; round++) {
      while (history.value.length > i) undo()
      while (history.value.length < i && future.value.length) redo()
      await frames()
      const step = await replayStepInfo(i, token)
      if (token !== replayToken) return
      replayAiming.value = i
      // 카메라는 첫 바퀴에만 그 자리로 보낸다. 그 뒤는 사람이 돌리고 다가간 시점 그대로 두고, 저절로 도는 것도 멈춘다.
      await replayAim(step, round === 0)
      if (round === 0) host.viewer?.setAutoRotate(false)
      void replayArrows(step)
      if (!(await replayWait(round ? REPLAY_LOOP_BEFORE_MS : REPLAY_AIM_MS, token))) return
      replayDemolish(step)
      redo()
      replayLand(step)
      if (!(await replayWait(REPLAY_LOOP_AFTER_MS, token))) return
    }
  }

  /** 반복을 끝낸다. 반복하던 장면은 다시 한 상태로 둔다 — 그 다음 장면부터 잇는다. */
  function replayEndLoop() {
    const i = replayLoop.value
    if (i === null) return
    replayToken++
    replayLoop.value = null
    replayAiming.value = null
    host.viewer?.setAutoRotate(true)
    while (history.value.length <= i && future.value.length) redo()
  }

  /**
   * 끝: 건물 전체로 물러나 고친 자리마다 장면 번호를 단 빛기둥을 세우고 돈다. 설비 장면은 그 설비에, 물리존·룸·커스텀존은 그
   * 안쪽 점에, 벽·문·창은 그 자리에 선다. 빛기둥·이름표를 누르면 카드를 누른 것처럼 그 장면을 되풀이한다(replaySpotClick).
   */
  function replayFinale() {
    const m = model.value
    const byId = equipmentById.value
    const devices: { id: string; label: string }[] = []
    const points: { key: string; at: Vec3; label: string }[] = []
    const spaces = new Set<string>()
    replaySpotScenes.clear()
    const elevation = (sid: string) => m?.storeys.find((st) => st.id === sid)?.elevation ?? 0
    for (const s of replaySteps.value) {
      const tag = `#${String(s.index + 1).padStart(2, '0')}`
      for (const c of s.changes) if (c.key.startsWith('sp:') && c.after) spaces.add(c.key.slice(3))
      const id = s.changes.map((c) => c.key).find((k) => k.startsWith('eq:') && byId.has(k.slice(3)) && !isConduit(byId.get(k.slice(3))!.role))?.slice(3)
      if (id) {
        if (devices.some((d) => d.id === id)) continue
        devices.push({ id, label: `${tag} ${shortName(byId.get(id)!.name)}` })
        replaySpotScenes.set(id, s.index)
        continue
      }
      // 설비가 없는 장면: 바뀐 것(지금 있는 쪽) 하나의 자리.
      for (const c of s.changes) {
        const it = c.after
        if (!it || it.t === 'link' || it.t === 'equip') continue
        const z = elevation(it.storeyId)
        let at: Vec2 | null = null
        let name = s.label
        if (it.t === 'space' || it.t === 'zone') {
          at = labelPoint(it.ring)
          name = it.name || s.label
        } else if (it.t === 'opening') at = it.at
        else if (it.t === 'wall' && it.rings[0]?.length) {
          const r = it.rings[0]
          at = [r.reduce((n, p) => n + p[0], 0) / r.length, r.reduce((n, p) => n + p[1], 0) / r.length]
        }
        if (!at) continue
        const key = `scene:${s.index}`
        // 장면 이름 안의 Revit 이름("Basic Wall:Interior - …:189074 옮김")도 "Basic Wall #189074 옮김" 으로 줄인다.
        const short = name.replace(/([^:\s][^:]*):[^:]+:(\d+)/, '$1 #$2')
        points.push({ key, at: [at[0], at[1], z], label: `${tag} ${short}` })
        replaySpotScenes.set(key, s.index)
        break
      }
    }
    host.viewer?.frameAll()
    host.viewer?.spotlight(devices, [...spaces], 0x5ef2c2, { points })
  }

  /** 빛기둥 열쇠(설비 id 또는 scene:번호) → 장면 번호. 끝 화면에서 채운다. 장면 중의 빛기둥은 그 장면의 바뀐 것에서 찾는다. */
  const replaySpotScenes = new Map<string, number>()
  function replaySpotClick(key: string) {
    if (!replayOpen.value || replayPhase.value === 'opening') return
    let i = replaySpotScenes.get(key)
    if (i === undefined) {
      const upTo = Math.max(replayAiming.value ?? -1, history.value.length - 1)
      i = replaySteps.value
        .slice(0, upTo + 1)
        .reverse()
        .find((st) => st.changes.some((c) => c.key === `eq:${key}` || c.key === key || key.startsWith(`${c.key}:`)))?.index
    }
    if (i !== undefined) void replayScene(i)
  }

  /**
   * 흐름이 바뀐 편집(방향·확정·잇기)은 그 연결들을 화살표로 그린다. 평소 화살표는 편집 모드에서 고른 설비의 이웃 연결뿐이라
   * 계통 확정처럼 수백 개가 바뀐 것은 안 보인다. 연결이 안 바뀐 장면이면 평소 화살표로 돌린다.
   */
  async function replayArrows(step: ReplayStep | null) {
    // 고른 설비가 바뀌면 평소 화살표 watch 가 다음 틱에 다시 그린다. 그 뒤에 그린다.
    await nextTick()
    const m = model.value
    if (!m || !host.viewer) return
    const keys = new Set((step?.changes ?? []).filter((c) => c.key.startsWith('cn:')).map((c) => c.key.slice(3).replace(/#\d+$/, '')))
    if (!keys.size) {
      host.viewer.setFlows([])
      return void host.viewer.setArrows(arrowConnections.value.map((c, i) => arrowOf(c, String(i), false)))
    }
    const list = m.connections.filter((c) => keys.has(`${c.from}>${c.to}`)).slice(0, 150)
    // 바뀐 연결이라 출처와 상관없이 강조색 실선으로 그린다. 방향(화살촉)은 지금 상태 그대로다.
    const arrows = list.map((c, i) => ({ ...arrowOf(c, `replay${i}`, false), source: 'edit' as const }))
    host.viewer.setArrows(arrows)
    // 연결·흐름 방향 장면에서만, 방향을 아는 연결에 빛 알갱이가 상류에서 하류로 흐른다(TTL 의 brick:feeds 가 눈에 보이게).
    // 설비를 옮긴 장면도 붙은 연결이 바뀐 것으로 잡히는데, 거기서 흘리면 따라온 배관 마디마다 알갱이가 날뛴다.
    const flowScene = step?.category === '연결' || step?.category === '흐름 방향'
    host.viewer.setFlows(flowScene ? arrows.flatMap((a) => (a.from ? [{ a: a.a, b: a.b, from: a.from }] : [])) : [])
  }

  /** 물리존 경계·이름은 3D 에서 미끄러지지 않고 바로 바뀐다. 바뀐 방 바닥을 한 번 번쩍여 어디가 바뀌었는지 보인다. */
  function replayFlash(step: ReplayStep | null) {
    const spaces = (step?.changes ?? []).filter((c) => c.key.startsWith('sp:')).map((c) => c.key.slice(3))
    if (spaces.length) host.viewer?.pulseSpaces(spaces.slice(0, 12))
  }

  /** 이력 끝까지 한 장면씩 다시 한다. */
  /**
   * 갈래 거르기. 끝 화면의 요약에서 갈래(계통 · 물리존 …)를 누르면 그 갈래 장면만 처음부터 튼다. 다른 갈래의 편집은 연출 없이
   * 다시 하기만 해서 지나간다 — 상태는 차례대로 쌓여야 하므로 건너뛸 수는 없다. 긴 세션에서 "계통 편집만 다시 보기" 같은 검토용.
   */
  const replayFilter = ref<ReplayStep['category'] | null>(null)
  function replaySetFilter(c: ReplayStep['category'] | null) {
    if (replayPhase.value === 'opening') return
    replayFilter.value = c
    void replayJump('restart')
  }
  /** 거르는 중이면 다른 갈래 편집을 연출 없이 다시 해 넘긴다. 다음 장면이 거른 갈래면(또는 거르지 않으면) false. */
  async function replaySkipOthers(token: number): Promise<boolean> {
    const f = replayFilter.value
    if (!f) return false
    let skipped = false
    while (token === replayToken && history.value.length < replayTotal.value) {
      const step = await replayStepInfo(history.value.length, token)
      if (token !== replayToken || !step || step.category === f) break
      redo()
      skipped = true
      // 한 프레임은 그리게 둔다 — 큰 파일에서 수십 개를 한 번에 다시 하면 화면이 멈춘다.
      await frames(1)
    }
    return skipped
  }

  async function replayRun(token: number) {
    while (token === replayToken && replayPlaying.value && history.value.length < replayTotal.value) {
      await replaySkipOthers(token)
      if (token !== replayToken || history.value.length >= replayTotal.value) break
      const i = history.value.length
      const step = await replayStepInfo(i, token)
      if (token !== replayToken) return
      replayAiming.value = i
      await replayAim(step)
      void replayArrows(step)
      if (!(await replayWait(REPLAY_AIM_MS, token)) || !replayPlaying.value) return
      replayDemolish(step)
      redo()
      replayAiming.value = null
      replayLand(step)
      if (!(await replayWait(REPLAY_STEP_MS - REPLAY_AIM_MS, token))) return
    }
    if (token === replayToken && history.value.length >= replayTotal.value) {
      replayPhase.value = 'done'
      replayPlaying.value = false
      selectedId.value = null
      selectedSpaceId.value = null
      viewStorey.value = null
      await nextTick()
      replayFinale()
    }
  }

  function replayToggle() {
    if (replayPhase.value === 'opening') return
    if (replayLoop.value !== null) {
      // 반복하던 장면은 다시 한 상태로 두고 그 다음 장면부터. 마지막 장면이었으면 replayRun 이 바로 끝 화면을 띄운다.
      replayEndLoop()
      replayPlaying.value = true
      return void replayRun(replayToken)
    }
    if (replayPlaying.value) {
      replayPlaying.value = false
      replayAiming.value = null
      replayToken++
      return
    }
    replayPlaying.value = true
    if (history.value.length >= replayTotal.value) return void replayJump('restart')
    replayPhase.value = 'play'
    void replayRun(++replayToken)
  }

  /** 앞뒤로 한 편집, 또는 처음부터. 되돌리기·다시 하기 한 번이라 3D 도 그만큼 움직인다. */
  async function replayJump(to: 'prev' | 'next' | 'restart') {
    if (replayPhase.value === 'opening') return
    replayEndLoop()
    const token = ++replayToken
    replayAiming.value = null
    if (to === 'restart') {
      replayPlaying.value = true
      replayRewind()
      replayPhase.value = 'play'
      await frames()
      return void replayRun(token)
    }
    if (to === 'prev' && history.value.length > 0) {
      undo()
      replayPhase.value = 'play'
    } else if (to === 'next' && history.value.length < replayTotal.value) {
      await replaySkipOthers(token)
      if (token !== replayToken) return
      if (history.value.length < replayTotal.value) {
        const step = replaySteps.value[history.value.length] ?? null
        await replayAim(step)
        replayDemolish(step)
        redo()
        replayLand(step)
      }
    }
    if (history.value.length >= replayTotal.value) {
      replayPhase.value = 'done'
      replayPlaying.value = false
    } else if (replayPlaying.value) {
      if (await replayWait(REPLAY_STEP_MS - REPLAY_AIM_MS, token)) void replayRun(token)
    }
  }

  /**
   * 시간줄을 끌어 그 편집 수의 상태로 간다(0 이면 편집 전, total 이면 다 한 뒤). 끄는 동안 계속 불려서 마지막 목표만 쫓는다 —
   * 큰 파일은 되돌리기 한 번에 수백 ms 라, 지나간 목표를 하나씩 다 들르면 손을 놓은 뒤에도 한참 따라온다. 카메라·비추기는
   * 하지 않는다(변경 단위로 훑어보는 것이라 장면 연출이 끼면 늦다). 멈춘 채로 둔다 — Space 로 그 다음 장면부터 이어서 튼다.
   */
  let seekTarget: number | null = null
  async function replaySeek(n: number) {
    if (replayPhase.value === 'opening') return
    const busy = seekTarget !== null
    seekTarget = Math.max(0, Math.min(replayTotal.value, Math.round(n)))
    if (busy) return
    replayEndLoop()
    replayToken++
    replayPlaying.value = false
    replayAiming.value = null
    host.viewer?.spotlight([], [], 0)
    host.viewer?.setFlows([])
    while (seekTarget !== null && history.value.length !== seekTarget) {
      if (history.value.length > seekTarget) undo()
      else if (future.value.length) redo()
      else break
      // 한 걸음마다 화면을 한 번 그리게 둔다 — 끄는 손을 따라 3D 가 변하는 것이 보인다.
      await frames(1)
    }
    seekTarget = null
    replaySeen.value = Math.max(replaySeen.value, history.value.length)
    replayPhase.value = history.value.length >= replayTotal.value ? 'done' : 'play'
    void replayArrows(replaySteps.value[history.value.length - 1] ?? null)
  }

  /**
   * 녹화. 이 탭을 화면 공유로 잡아(브라우저가 한 번 묻는다) 처음부터 끝 화면까지 틀고 webm 으로 내려받는다 — 4D 시뮬레이션의 영상
   * 내보내기처럼, 리플레이를 PM 보고·공유에 그대로 쓴다. 3D 캔버스만 찍으면 장면 제목·카드(HTML)가 빠져서 탭을 통째로 잡고, 되면
   * 극장(.viewport)만 잘라 낸다(Region Capture). 끝 화면이 다 그려지면(REPLAY_RECORD_TAIL_MS) 멈추고 내려받는다. 닫거나 다시
   * 누르면 그때까지를 내려받는다.
   */
  const REPLAY_RECORD_TAIL_MS = 4000
  const replayRecording = ref<{ since: number } | null>(null)
  let recorder: MediaRecorder | null = null
  async function replayRecord() {
    if (recorder) return void recorder.stop()
    if (replayPhase.value === 'opening' || !navigator.mediaDevices?.getDisplayMedia) return
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: false, preferCurrentTab: true } as DisplayMediaStreamOptions)
    } catch {
      // 사람이 공유를 거절했다.
      return
    }
    const track = stream.getVideoTracks()[0]
    const theater = document.querySelector('.viewport.theater')
    const crop = (globalThis as { CropTarget?: { fromElement(e: Element): Promise<unknown> } }).CropTarget
    if (theater && crop && 'cropTo' in track) await (track as unknown as { cropTo(t: unknown): Promise<void> }).cropTo(await crop.fromElement(theater)).catch(() => {})
    // mp4(H.264)가 되면 그것으로 — 파워포인트·윈도우 기본 재생기에서 바로 열린다. 안 되면 webm.
    const type = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm'].find((x) => MediaRecorder.isTypeSupported(x)) ?? ''
    const ext = type.startsWith('video/mp4') ? 'mp4' : 'webm'
    const chunks: Blob[] = []
    const rec = new MediaRecorder(stream, type ? { mimeType: type, videoBitsPerSecond: 8_000_000 } : undefined)
    recorder = rec
    rec.ondataavailable = (e) => e.data.size && chunks.push(e.data)
    rec.onstop = () => {
      for (const tr of stream.getTracks()) tr.stop()
      recorder = null
      replayRecording.value = null
      const a = document.createElement('a')
      a.href = URL.createObjectURL(new Blob(chunks, { type: type || 'video/webm' }))
      a.download = `replay-${host.fileName.value.replace(/\.ifc\b/gi, '').replace(/[^\w가-힣.-]+/g, '_') || 'edit'}.${ext}`
      a.click()
      window.setTimeout(() => URL.revokeObjectURL(a.href), 10_000)
    }
    // 사용자가 브라우저의 "공유 중지" 를 누르면 거기까지.
    track.addEventListener('ended', () => rec.state !== 'inactive' && rec.stop())
    rec.start(1000)
    replayRecording.value = { since: performance.now() }
    replayFilter.value = null
    await replayJump('restart')
  }
  // 끝 화면이 다 그려지면 녹화를 멈춘다.
  watch(replayPhase, (phase) => {
    if (phase !== 'done' || !recorder) return
    const rec = recorder
    window.setTimeout(() => rec.state !== 'inactive' && rec.stop(), REPLAY_RECORD_TAIL_MS)
  })

  /**
   * 변경 지도. 끝 화면에서 D(요약판의 버튼도)로 켜고 끈다. 연 때 평면과 다 한 뒤 평면을 견줘 더한·고친·지운 것을 3D 에 색으로
   * 한꺼번에 칠한다(BIM 버전 비교 도구의 색 표시처럼). 애니메이션은 순서를, 이것은 "어디가 몇 개" 를 보인다. 고친 것에는 물리존을
   * 고쳐 소속이 바뀐 설비도 든다(TTL 의 hasLocation 이 바뀌었다). 덕트·배관과 연결은 빼고 센다 — 따라온 관 조각이 수백이다.
   * 켜는 동안 끝 화면의 빛기둥은 걷고, 끄면 다시 세운다.
   */
  type DiffItem = Parameters<Viewer['setDiffMap']>[0] extends readonly (infer T)[] | null ? T : never
  const replayDiff = ref<{ added: number; modified: number; removed: number } | null>(null)
  function diffItems() {
    const start = replayStart.value
    const m = model.value
    if (!start || !m) return null
    const before = new Map(start.plan.map((p) => [p.key, p]))
    const after = new Map(before)
    const touched = new Set<string>()
    for (const s of replaySteps.value) {
      for (const c of s.changes) {
        touched.add(c.key)
        if (c.after) after.set(c.key, c.after)
        else after.delete(c.key)
      }
    }
    const elevation = (sid: string) => m.storeys.find((s) => s.id === sid)?.elevation ?? 0
    const items: DiffItem[] = []
    const count = { added: 0, modified: 0, removed: 0 }
    for (const key of touched) {
      const b = before.get(key)
      const a = after.get(key)
      if (!b && !a) continue
      if (b && a && JSON.stringify(b) === JSON.stringify(a)) continue
      const state = !b ? 'added' : !a ? 'removed' : 'modified'
      const it = (a ?? b)!
      if (it.t === 'link' || (it.t === 'equip' && it.conduit)) continue
      count[state]++
      const z = elevation(it.storeyId)
      if (it.t === 'equip') {
        if (state !== 'removed') items.push({ key, state, id: it.id })
        else if (it.at) items.push({ key, state, at: [it.at[0], it.at[1], z] })
      } else if (it.t === 'wall') for (const ring of it.rings) items.push({ key, state, ring, elevation: z, height: 2.6 })
      else if (it.t === 'opening') {
        if (it.at) items.push({ key, state, at: [it.at[0], it.at[1], z], size: 0.9, tall: 2.1 })
      } else items.push({ key, state, ring: it.ring, elevation: z, height: 0.4 })
    }
    return { items, count }
  }
  function replayToggleDiff() {
    if (replayDiff.value) {
      replayDiff.value = null
      host.viewer?.setDiffMap(null)
      if (replayPhase.value === 'done') replayFinale()
      return
    }
    if (replayPhase.value !== 'done') return
    const d = diffItems()
    if (!d) return
    host.viewer?.spotlight([], [], 0)
    host.viewer?.setDiffMap(d.items)
    replayDiff.value = d.count
  }
  // 끝 화면을 떠나면(처음부터·앞 장면·끌기·반복) 변경 지도도 걷는다 — 지금 상태와 맞지 않는다.
  watch(replayPhase, (phase) => {
    if (phase !== 'done' && replayDiff.value) {
      replayDiff.value = null
      host.viewer?.setDiffMap(null)
    }
  })

  /** 닫는다. 아직 다시 하지 않은 편집을 마저 다시 해서 리플레이 전 상태(이력·다시 하기 목록까지)로 돌아온다. */
  function closeReplay() {
    if (!replayOpen.value) return
    replayDiff.value = null
    if (recorder?.state === 'recording') recorder.stop()
    compareEnd()
    replayToken++
    replayLoop.value = null
    while (history.value.length < replayTotal.value && future.value.length) redo()
    replayWorker?.terminate()
    replayWorker = null
    replayAiming.value = null
    replayOpen.value = false
    host.viewer?.setEditMode(host.editing.value)
    host.viewer?.setArrowsShown(false)
    host.viewer?.setCinema(false)
    host.viewer?.setDiorama(false)
    host.viewer?.setRoomTags([])
    host.viewer?.onSpotClick(null)
    replayArch.value = false
    replayElement.value = null
    host.viewer?.setDark(host.dark.value)
    host.viewer?.setArrows(arrowConnections.value.map((c, i) => arrowOf(c, String(i), i === activeArrow.value)))
    const saved = replaySaved
    replaySaved = null
    if (saved) {
      activeTab.value = saved.activeTab
      viewStorey.value = saved.viewStorey
      selectedId.value = saved.selectedId
      selectedSpaceId.value = saved.selectedSpaceId
    }
  }

  /**
   * 편집 전·후 비교. B 를 누르고 있는 동안 지금 장면의 편집 하나를 되돌려 편집 전 모습을 보이고, 떼면 다시 한다(사진 앱의
   * 원본 보기처럼). 카메라는 그대로라 같은 자리에서 무엇이 바뀌었는지 눈으로 견준다. 재생 중이었으면 멈춘다.
   */
  const replayComparing = ref(false)
  /** ? 를 누른 횟수. HUD 가 바뀔 때마다 단축키 안내를 켜고 끈다. */
  const replayHelp = ref(0)
  function compareStart() {
    if (replayPhase.value === 'opening' || replayComparing.value || seekTarget !== null) return
    replayEndLoop()
    replayToken++
    replayPlaying.value = false
    replayAiming.value = null
    if (!history.value.length) return
    undo()
    replayComparing.value = true
  }
  function compareEnd() {
    if (!replayComparing.value) return
    replayComparing.value = false
    if (future.value.length) redo()
  }
  const onKeyUp = (e: KeyboardEvent) => {
    if (e.code === 'KeyB') compareEnd()
  }
  // 누른 채 창을 벗어나면 keyup 이 오지 않는다 — 그때도 편집 후로 돌린다.
  const onBlur = () => compareEnd()
  watch(replayOpen, (open) => {
    if (open) {
      window.addEventListener('keyup', onKeyUp)
      window.addEventListener('blur', onBlur)
    } else {
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  })
  onBeforeUnmount(() => {
    window.removeEventListener('keyup', onKeyUp)
    window.removeEventListener('blur', onBlur)
  })

  function replayKey(e: KeyboardEvent): boolean {
    if (e.code === 'KeyB') {
      if (!e.repeat) compareStart()
      return true
    }
    if (replayComparing.value) return true
    if (e.key === '?') replayHelp.value++
    else if (e.code === 'KeyD') replayToggleDiff()
    else if (e.code === 'KeyR') void replayRecord()
    else if (e.code === 'Space') replayToggle()
    else if (e.code === 'ArrowRight') void replayJump('next')
    else if (e.code === 'ArrowLeft') void replayJump('prev')
    else if (e.code === 'Home') void replayJump('restart')
    else if (e.code === 'Escape' || e.code === 'KeyP') closeReplay()
    else return false
    return true
  }
  onBeforeUnmount(() => replayWorker?.terminate())

  /** ReplayHud 에 넘기는 값과 받는 것. App 템플릿은 v-bind·v-on 으로 이 둘만 건넨다. */
  const hud = computed(() => ({
    title: host.fileName.value,
    total: replayTotal.value,
    at: history.value.length,
    phase: replayPhase.value,
    playing: replayPlaying.value,
    speed: replaySpeed.value,
    aiming: replayAiming.value,
    start: replayStart.value,
    steps: replaySteps.value,
    error: replayError.value,
    seen: replaySeen.value,
    loop: replayLoop.value,
    storey: replayStorey.value,
    comparing: replayComparing.value,
    filter: replayFilter.value,
    recording: replayRecording.value?.since ?? null,
    helpToggles: replayHelp.value,
    diff: replayDiff.value,
  }))
  const hudOn = {
    toggle: replayToggle,
    prev: () => void replayJump('prev'),
    next: () => void replayJump('next'),
    restart: () => void replayJump('restart'),
    speed: (v: number) => (replaySpeed.value = v),
    close: closeReplay,
    scene: (i: number) => void replayScene(i),
    seek: (n: number) => void replaySeek(n),
    filter: (c: ReplayStep['category'] | null) => replaySetFilter(c),
    record: () => void replayRecord(),
    diff: () => replayToggleDiff(),
  }

  return { open: openReplay, close: closeReplay, key: replayKey, hud, hudOn }
}
