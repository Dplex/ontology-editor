// B. 방향 큐브 튕기기(cube) — 방향 큐브를 세게 끌다 놓으면 관성으로 돌다가 가장 가까운 면에 스프링처럼 멈춘다(docs/plans/easter-eggs.md).
//
// - 지금 끌기는 그대로 둔다(nav-cube.ts 를 건드리지 않는다). 큐브 canvas 의 포인터 이벤트를 옆에서 듣기만 하고, 놓는 순간의 속도가
//   클 때만 이어서 돈다. 천천히 끌다 놓으면 지금처럼 그 자리에 멈춘다.
// - 도는 것은 큐브 끌기와 같은 회전(ctx.camera.orbit, px)이다. 속도는 0.22초 시간상수로 줄고, 느려지면 가장 가까운 면(위·아래·앞·뒤·좌·우)으로
//   덜 감쇠된 스프링(감쇠비 0.55)이 맞춘다 — 살짝 지나쳤다 돌아온다.
// - 큐브·3D 를 다시 누르거나 휠을 굴리면 그 자리에서 멈춘다. 움직임 끄기면 튕기지 않는다.
import { Spherical, Vector3 } from 'three'
import type { EggContext, EggHandle } from './types'

/** 이보다 빠르게(px/ms) 놓아야 튕긴다. */
export const FLING_MIN = 0.6
/** 관성이 이만큼 느려지면(px/ms) 면 맞추기로 넘어간다. */
const SETTLE_SPEED = 0.06
const DECAY_MS = 220
/** 큐브 끌기와 같은 값(viewer.ts 의 ORBIT_RAD_PER_PX). */
const RAD_PER_PX = Math.PI / 240
const SPRING_K = 60
const SPRING_C = 2 * 0.55 * Math.sqrt(SPRING_K)
const CUBE = 'canvas[aria-label^="방향 큐브"]'
/** 속도를 잴 때 보는 마지막 구간. */
const SAMPLE_MS = 80

/** 눈의 방향(대상에서 눈 쪽, 장면 좌표)에 가장 가까운 면의 구면 좌표(theta·phi). 위·아래면 theta 는 그대로 둔다. */
export function nearestFace(dir: Vector3, theta: number): { theta: number; phi: number } {
  const ax = Math.abs(dir.x)
  const ay = Math.abs(dir.y)
  const az = Math.abs(dir.z)
  // orbit 은 phi 를 0.01 ~ π-0.01 로 묶는다. 같은 값으로 맞춰야 스프링이 끝나지 않고 떨지 않는다.
  if (ay >= ax && ay >= az) return { theta, phi: dir.y > 0 ? 0.01 : Math.PI - 0.01 }
  if (ax >= az) return { theta: dir.x > 0 ? Math.PI / 2 : -Math.PI / 2, phi: Math.PI / 2 }
  return { theta: dir.z > 0 ? 0 : Math.PI, phi: Math.PI / 2 }
}

/** -π..π 로 접는다. */
function wrap(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a))
}

export function enable(ctx: EggContext): EggHandle {
  const samples: { t: number; x: number; y: number }[] = []
  let dragging = false
  let moved = false
  let mode: 'idle' | 'coast' | 'snap' = 'idle'
  let vx = 0
  let vy = 0
  let last = 0
  const spring = { theta: 0, phi: 0, vt: 0, vp: 0, target: { theta: 0, phi: 0 } }
  let flings = 0
  let snaps = 0
  const s = new Spherical()
  const off = new Vector3()

  function stop() {
    mode = 'idle'
  }

  function currentAngles() {
    const { position, target } = ctx.camera.pose()
    off.set(position[0] - target[0], position[1] - target[1], position[2] - target[2])
    s.setFromVector3(off)
    return { dir: off.clone().normalize(), theta: s.theta, phi: s.phi }
  }

  function beginSnap() {
    const a = currentAngles()
    spring.target = nearestFace(a.dir, a.theta)
    // 관성의 남은 속도를 각속도로 이어받는다(orbit 은 theta -= dx·k, phi -= dy·k).
    spring.vt = -vx * RAD_PER_PX * 1000
    spring.vp = -vy * RAD_PER_PX * 1000
    mode = 'snap'
  }

  const onDown = (e: PointerEvent) => {
    stop()
    if (!(e.target instanceof Element) || !e.target.closest(CUBE) || e.button !== 0) return
    dragging = true
    moved = false
    samples.length = 0
    samples.push({ t: e.timeStamp, x: e.clientX, y: e.clientY })
  }
  const onMove = (e: PointerEvent) => {
    if (!dragging) return
    moved = true
    samples.push({ t: e.timeStamp, x: e.clientX, y: e.clientY })
    while (samples.length > 2 && e.timeStamp - samples[0].t > SAMPLE_MS) samples.shift()
  }
  const onUp = (e: PointerEvent) => {
    if (!dragging) return
    dragging = false
    if (!moved || ctx.still() || samples.length < 2) return
    // 놓기 전 잠깐 멈췄다면(마지막 움직임이 오래전) 튕기지 않는다.
    const a = samples[0]
    const b = samples[samples.length - 1]
    const dt = Math.max(1, b.t - a.t)
    if (e.timeStamp - b.t > SAMPLE_MS) return
    vx = (b.x - a.x) / dt
    vy = (b.y - a.y) / dt
    if (Math.hypot(vx, vy) < FLING_MIN) return
    flings++
    mode = 'coast'
    last = performance.now()
  }
  const onWheel = () => stop()

  window.addEventListener('pointerdown', onDown, { capture: true, passive: true })
  window.addEventListener('pointermove', onMove, { capture: true, passive: true })
  window.addEventListener('pointerup', onUp, { capture: true, passive: true })
  window.addEventListener('wheel', onWheel, { capture: true, passive: true })

  ctx.addLayer({
    step(now) {
      if (mode === 'idle') return false
      const dtMs = Math.min(50, now - last)
      last = now
      if (mode === 'coast') {
        ctx.camera.orbit(vx * dtMs, vy * dtMs)
        const k = Math.exp(-dtMs / DECAY_MS)
        vx *= k
        vy *= k
        if (Math.hypot(vx, vy) < SETTLE_SPEED) beginSnap()
        return true
      }
      // 면으로 맞추는 스프링. 오차는 지금 각도에서 매번 다시 잰다 — 다른 무엇이 시점을 바꿔도 따라간다.
      const a = currentAngles()
      const et = wrap(spring.target.theta - a.theta)
      const ep = spring.target.phi - a.phi
      const dt = dtMs / 1000
      spring.vt += (SPRING_K * et - SPRING_C * spring.vt) * dt
      spring.vp += (SPRING_K * ep - SPRING_C * spring.vp) * dt
      let dTheta = spring.vt * dt
      let dPhi = spring.vp * dt
      const done = Math.abs(et) < 0.002 && Math.abs(ep) < 0.002 && Math.abs(spring.vt) < 0.02 && Math.abs(spring.vp) < 0.02
      if (done) {
        dTheta = et
        dPhi = ep
        mode = 'idle'
        snaps++
      }
      ctx.camera.orbit(-dTheta / RAD_PER_PX, -dPhi / RAD_PER_PX)
      return true
    },
  })

  return {
    off() {
      window.removeEventListener('pointerdown', onDown, { capture: true })
      window.removeEventListener('pointermove', onMove, { capture: true })
      window.removeEventListener('pointerup', onUp, { capture: true })
      window.removeEventListener('wheel', onWheel, { capture: true })
      stop()
    },
    inspect: () => ({ flings, snaps, mode, ...(() => { const a = currentAngles(); return { dir: a.dir.toArray().map((v) => Math.round(v * 1000) / 1000) } })() }),
  }
}
