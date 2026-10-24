// B. 방 이름 자막(title) — 비행 모드(G)에서 방 경계를 넘어 들어서면 화면 아래 3분의 1 자리에 그 방의 이름이 떴다 사라진다
// (docs/plans/easter-eggs.md). 게임에서 새 지역에 들어설 때 뜨는 지역 이름에 바치는 오마주다.
//
// - 첫 줄 `3F · 회의실 301`, 둘째 줄 `42.3㎡ · 설비 7대`. 0.4초에 떠서 2초 머물고 0.4초에 사라진다. 같은 방에 10초 안에 다시 들어가면 띄우지 않는다.
// - 눈 자리의 층·물리존은 점-다각형 판정으로 초당 5번까지 본다. 눈이 움직일 때만(3D 를 다시 그릴 때만) 본다.
// - 면적은 외곽선으로 잰 값(areaM2), 설비 수는 TTL `brick:hasLocation` 이 그 방인 설비 수다. TTL 을 짓지 않고 같은 규칙(덕트·배관이 아닌
//   설비의 소속 물리존)으로 센다 — 단위 테스트가 readOntologyTTL 의 수와 대 본다.
// - 손짓은 비행 중 Q·E 를 0.12초 안에 같이 누르는 것이다(editor/eggs.ts). 움직임 끄기면 떴다 사라지는 움직임만 뺀다.
import { type PerspectiveCamera, Vector3 } from 'three'
import { isConduit, type Model, type Storey, type Vec2 } from '../lib/model'
import type { EggContext, EggHandle } from './types'

export const FADE_MS = 400
export const HOLD_MS = 2000
export const AGAIN_MS = 10_000
const SAMPLE_MS = 200

/** 점이 고리 안에 있나(짝수-홀수 규칙). */
function inside(p: Vec2, ring: readonly Vec2[]): boolean {
  let hit = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) hit = !hit
  }
  return hit
}

/** 눈의 층: 바닥 높이가 눈 높이 이하인 층 가운데 가장 높은 것. */
export function storeyAt(model: Readonly<Model>, eyeZ: number): Storey | null {
  let best: Storey | null = null
  for (const s of model.storeys) if (s.elevation <= eyeZ + 0.05 && (!best || s.elevation > best.elevation)) best = s
  return best
}

export type RoomTitle = { spaceId: string; storey: string; room: string; area: number; devices: number }

/** 눈 자리(IFC 좌표 x·y·z)의 방과 자막에 쓸 값. 방 밖이면 null. */
export function roomAt(model: Readonly<Model>, eye: readonly [number, number, number]): RoomTitle | null {
  const st = storeyAt(model, eye[2])
  if (!st) return null
  const sp = st.spaces.find((s) => s.footprint.length >= 3 && inside([eye[0], eye[1]], s.footprint))
  if (!sp) return null
  const names = [sp.longName, sp.name].filter((n, i, a) => n && a.indexOf(n) === i)
  return {
    spaceId: sp.id,
    storey: st.name,
    room: names.join(' ') || sp.id,
    area: sp.areaM2,
    devices: devicesIn(st, sp.id),
  }
}

/** TTL 에서 `brick:hasLocation` 이 이 방인 설비 수. 덕트·배관(fso:)은 받는 쪽이 읽지 않는 블록이라 뺀다. */
export function devicesIn(storey: Storey, spaceId: string): number {
  return storey.equipment.filter((e) => !isConduit(e.role) && e.spaceId === spaceId).length
}

export function enable(ctx: EggContext): EggHandle {
  const box = ctx.overlay.ownerDocument.createElement('div')
  box.dataset.testid = 'egg-title'
  box.style.cssText =
    'position:absolute;left:50%;top:66%;transform:translate(-50%,-50%);text-align:center;opacity:0;color:#fff;text-shadow:0 1px 3px rgba(0,0,0,.65),0 0 18px rgba(0,0,0,.35);white-space:nowrap'
  const line1 = box.ownerDocument.createElement('div')
  line1.style.cssText = 'font-size:22px;font-weight:600;letter-spacing:0.02em'
  const line2 = box.ownerDocument.createElement('div')
  line2.style.cssText = 'margin-top:0.2rem;font-size:13px;opacity:0.85'
  box.append(line1, line2)
  ctx.overlay.append(box)

  let lastCheck = 0
  let current: string | null = null
  const seenAt = new Map<string, number>()
  let shown = 0
  let hideTimer: ReturnType<typeof setTimeout> | null = null
  let last: RoomTitle | null = null

  function show(t: RoomTitle) {
    shown++
    last = t
    line1.textContent = `${t.storey} · ${t.room}`
    line2.textContent = `${t.area > 0 ? `${t.area.toFixed(1)}㎡` : '면적 없음'} · 설비 ${t.devices.toLocaleString()}대 · 화면에서만`
    const still = ctx.still()
    box.style.transition = still ? 'none' : `opacity ${FADE_MS}ms ease-out`
    box.style.opacity = '1'
    if (hideTimer) clearTimeout(hideTimer)
    hideTimer = setTimeout(() => {
      box.style.opacity = '0'
      hideTimer = null
    }, (still ? 0 : FADE_MS) + HOLD_MS)
  }

  function check(cam: PerspectiveCamera) {
    const m = ctx.model()
    if (!m) return
    // 장면 좌표(x, y 위, -z) → IFC(x, y, z 위).
    const p = cam.position
    const t = roomAt(m, [p.x, -p.z, p.y])
    const id = t?.spaceId ?? null
    if (id === current) return
    current = id
    if (!t) return
    const now = performance.now()
    const before = seenAt.get(t.spaceId)
    seenAt.set(t.spaceId, now)
    if (before !== undefined && now - before < AGAIN_MS) return
    show(t)
  }

  // 카메라는 그리는 자리에서 받아 두고, 보기는 매 프레임의 step 에서 초당 5번까지 한다. 눈이 멈춘 마지막 자리도 놓치지 않는다
  // (멈추면 다시 그리지 않으니 afterRender 만으로는 마지막 0.2초 안의 자리를 못 본다).
  let cam: PerspectiveCamera | null = null
  const lastPos = new Vector3(Infinity, 0, 0)
  ctx.addLayer({
    step(now) {
      if (!ctx.signals.flying.value) {
        current = null
        return false
      }
      if (!cam || now - lastCheck < SAMPLE_MS || cam.position.equals(lastPos)) return false
      lastCheck = now
      lastPos.copy(cam.position)
      check(cam)
      return false
    },
    afterRender({ camera }) {
      cam = camera
    },
  })

  return {
    off() {
      if (hideTimer) clearTimeout(hideTimer)
    },
    inspect: () => ({ current, shown, last, visible: box.style.opacity === '1' }),
  }
}
