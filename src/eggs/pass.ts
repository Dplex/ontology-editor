// S3. 기준선 통과(pass) — 켜 둔 동안 편집으로 완전성 검사 위반이 0 이 되거나 수용 기준선이 미달에서 통과로 바뀌는 순간에 한 번만 튼다(docs/plans/easter-eggs.md).
//
// - 위반 수·기준선 상태를 새로 재지 않고 signals.violations · signals.accepted · signals.storeyViolations 로만 받는다.
// - 빛의 면이 맨 아래층 바닥에서 꼭대기까지 1.2초에 훑고 올라가며, 지나가는 층판은 그 층의 위반이 0 일 때만 잠깐 밝아진다.
//   위반이 남은 층은 그대로 두어 거짓 축하가 되지 않게 한다.
// - 한 파일에 한 세션 동안 한 번이다. 되돌렸다가 다시 통과해도 다시 틀지 않고, 되돌리기로 통과가 풀리면 아무것도 하지 않는다.
// - 움직임 끄기(still())면 3D 훑기를 빼고 HUD 체크 표시만 보인다.
import {
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  Shape,
  ShapeGeometry,
  Vector2,
} from 'three'
import { watch } from 'vue'
import type { Model } from '../lib/model'
import { easeOut } from '../lib/motion'
import type { EggContext, EggHandle } from './types'

const SWEEP_MS = 1200
const PLATE_FADE_MS = 400

/** 한 파일에 한 세션 동안 한 번만 틀기 위한 기록. */
const firedFiles = new Set<string>()

/** 단위 테스트에서 세션 기록을 비울 때 쓴다. */
export function resetPassSession(): void {
  firedFiles.clear()
}

export function fileKeyOf(model: Readonly<Model> | null): string {
  if (!model) return ''
  return `${model.buildingId}:${model.siteName}:${model.storeys.map((s) => s.id).join(',')}`
}

type StoreyPlate = {
  storeyId: string
  elevation: number
  reachMs: number
  meshes: Mesh[]
  materials: MeshBasicMaterial[]
}

export type PassSweep = {
  root: Group
  sweepMesh: Mesh
  sweepMat: MeshBasicMaterial
  minY: number
  maxY: number
  plates: StoreyPlate[]
  zeroStoreyIds: string[]
  dispose(): void
}

/** 모델의 층 바닥과 외곽선으로 1.2초 스캔 면과 위반 0 인 층의 밝아지는 판을 짓는다. */
export function buildPassSweep(model: Readonly<Model>, storeyViolations: ReadonlyMap<string, number>): PassSweep {
  let minX = Infinity
  let maxX = -Infinity
  let minY = Infinity
  let maxY = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity

  const touch = (x: number, y: number) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }

  for (const s of model.storeys) {
    if (s.elevation < minZ) minZ = s.elevation
    if (s.elevation > maxZ) maxZ = s.elevation
    for (const sp of s.spaces) {
      for (const p of sp.footprint) touch(p[0], p[1])
    }
    for (const e of s.equipment) {
      if (e.position) touch(e.position[0], e.position[1])
    }
  }

  if (!Number.isFinite(minX)) {
    minX = -6
    maxX = 6
    minY = -6
    maxY = 6
  }
  if (!Number.isFinite(minZ)) {
    minZ = 0
    maxZ = 3
  }
  const topZ = Math.max(maxZ + 3.2, minZ + 3.2)
  const width = Math.max(8, (maxX - minX) * 1.16)
  const depth = Math.max(8, (maxY - minY) * 1.16)
  const cx = (minX + maxX) / 2
  const cy = (minY + maxY) / 2

  const root = new Group()
  const disposables: { dispose(): void }[] = []

  const sweepGeo = new PlaneGeometry(width, depth)
  sweepGeo.rotateX(-Math.PI / 2)
  const sweepMat = new MeshBasicMaterial({
    color: 0x34d399,
    transparent: true,
    opacity: 0,
    side: DoubleSide,
    depthWrite: false,
  })
  const sweepMesh = new Mesh(sweepGeo, sweepMat)
  sweepMesh.position.set(cx, minZ, -cy)
  sweepMesh.renderOrder = 18
  root.add(sweepMesh)
  disposables.push(sweepGeo, sweepMat)

  const plates: StoreyPlate[] = []
  const zeroStoreyIds: string[] = []
  const ordered = [...model.storeys].sort((a, b) => a.elevation - b.elevation)

  for (const s of ordered) {
    const vCount = storeyViolations.get(s.id) ?? 0
    if (vCount > 0) continue
    zeroStoreyIds.push(s.id)
    const meshes: Mesh[] = []
    const materials: MeshBasicMaterial[] = []
    const validSpaces = s.spaces.filter((sp) => sp.footprint.length >= 3)

    if (validSpaces.length > 0) {
      for (const sp of validSpaces) {
        const ring =
          sp.footprint.length > 3 &&
          sp.footprint[0][0] === sp.footprint[sp.footprint.length - 1][0] &&
          sp.footprint[0][1] === sp.footprint[sp.footprint.length - 1][1]
            ? sp.footprint.slice(0, -1)
            : sp.footprint
        if (ring.length < 3) continue
        const shape = new Shape(ring.map((p) => new Vector2(p[0], p[1])))
        const geo = new ShapeGeometry(shape)
        geo.rotateX(-Math.PI / 2)
        const mat = new MeshBasicMaterial({
          color: 0x34d399,
          transparent: true,
          opacity: 0,
          side: DoubleSide,
          depthWrite: false,
        })
        const m = new Mesh(geo, mat)
        m.position.y = s.elevation + 0.14
        m.renderOrder = 17
        root.add(m)
        meshes.push(m)
        materials.push(mat)
        disposables.push(geo, mat)
      }
    } else {
      const geo = new PlaneGeometry(width * 0.85, depth * 0.85)
      geo.rotateX(-Math.PI / 2)
      const mat = new MeshBasicMaterial({
        color: 0x34d399,
        transparent: true,
        opacity: 0,
        side: DoubleSide,
        depthWrite: false,
      })
      const m = new Mesh(geo, mat)
      m.position.set(cx, s.elevation + 0.14, -cy)
      m.renderOrder = 17
      root.add(m)
      meshes.push(m)
      materials.push(mat)
      disposables.push(geo, mat)
    }

    const ratio = topZ > minZ ? Math.max(0, Math.min(1, (s.elevation - minZ) / (topZ - minZ))) : 0
    plates.push({
      storeyId: s.id,
      elevation: s.elevation,
      reachMs: ratio * SWEEP_MS,
      meshes,
      materials,
    })
  }

  return {
    root,
    sweepMesh,
    sweepMat,
    minY: minZ,
    maxY: topZ,
    plates,
    zeroStoreyIds,
    dispose() {
      for (const d of disposables) d.dispose()
    },
  }
}

export function enable(ctx: EggContext): EggHandle {
  const hud = ctx.hud
  hud.style.cssText =
    'position:absolute;left:0.75rem;bottom:0.75rem;display:none;align-items:center;gap:0.45rem;padding:0.4rem 0.65rem;border:1px solid var(--line);border-radius:6px;background:color-mix(in srgb,var(--surface) 92%,transparent);font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--fg)'

  const container = new Group()
  let sweep: PassSweep | null = null
  let triggered = false
  let sweeping = false
  let triggerAt = 0
  let zeroStoreys: string[] = []
  const litStoreys = new Set<string>()

  let lastKey = fileKeyOf(ctx.model())
  let lastViolations = ctx.signals.violations.value
  let lastAccepted = ctx.signals.accepted.value

  function renderHud(violations: number) {
    const text =
      violations === 0
        ? '완전성 검사 위반 0 · 화면에서만'
        : `수용 기준선 통과 · 완전성 검사 위반 ${violations} · 화면에서만`
    hud.style.display = 'inline-flex'
    const doc = hud.ownerDocument ?? (typeof document !== 'undefined' ? document : null)
    if (!doc) {
      hud.textContent = text
      return
    }
    hud.replaceChildren()
    const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg')
    svg.setAttribute('width', '15')
    svg.setAttribute('height', '15')
    svg.setAttribute('viewBox', '0 0 16 16')
    svg.setAttribute('aria-hidden', 'true')
    const path = doc.createElementNS('http://www.w3.org/2000/svg', 'path')
    path.setAttribute('d', 'M3 8.5L6.5 12L13 4.5')
    path.setAttribute('fill', 'none')
    path.setAttribute('stroke', '#10b981')
    path.setAttribute('stroke-width', '2')
    path.setAttribute('stroke-linecap', 'round')
    path.setAttribute('stroke-linejoin', 'round')
    if (!ctx.still()) {
      path.style.strokeDasharray = '18'
      path.style.strokeDashoffset = '18'
      path.style.transition = 'stroke-dashoffset 300ms ease-out'
      requestAnimationFrame(() => {
        path.style.strokeDashoffset = '0'
      })
    }
    svg.append(path)
    const label = doc.createElement('span')
    label.textContent = text
    hud.append(svg, label)
  }

  function clearSweep() {
    if (!sweep) return
    container.remove(sweep.root)
    sweep.dispose()
    sweep = null
    sweeping = false
  }

  function trigger(violations: number) {
    const m = ctx.model()
    if (!m) return
    triggered = true
    litStoreys.clear()
    renderHud(violations)
    clearSweep()
    const built = buildPassSweep(m, ctx.signals.storeyViolations.value)
    zeroStoreys = built.zeroStoreyIds
    if (ctx.still()) {
      for (const id of zeroStoreys) litStoreys.add(id)
      built.dispose()
      return
    }
    sweep = built
    container.add(built.root)
    triggerAt = performance.now()
    sweeping = true
  }

  const stopWatch = watch(
    [ctx.signals.violations, ctx.signals.accepted, () => fileKeyOf(ctx.model())],
    ([v, acc, key]) => {
      if (key !== lastKey) {
        lastKey = key
        lastViolations = v
        lastAccepted = acc
        triggered = false
        zeroStoreys = []
        litStoreys.clear()
        clearSweep()
        hud.style.display = 'none'
        hud.textContent = ''
        return
      }
      const zeroNow = v === 0 && lastViolations > 0
      const gateNow = acc === true && lastAccepted === false
      lastViolations = v
      lastAccepted = acc
      if ((zeroNow || gateNow) && key && !firedFiles.has(key)) {
        firedFiles.add(key)
        trigger(v)
      }
    },
    { flush: 'sync' },
  )

  ctx.addLayer({
    object: container,
    step(now) {
      if (!sweeping || !sweep || ctx.still()) return false
      const elapsed = now - triggerAt
      if (elapsed > SWEEP_MS + PLATE_FADE_MS) {
        sweep.sweepMesh.visible = false
        for (const p of sweep.plates) {
          for (const mat of p.materials) mat.opacity = 0
        }
        sweeping = false
        return true
      }
      const t = Math.min(1, Math.max(0, elapsed / SWEEP_MS))
      const y = sweep.minY + (sweep.maxY - sweep.minY) * easeOut(t)
      sweep.sweepMesh.visible = t < 1
      sweep.sweepMesh.position.y = y
      sweep.sweepMat.opacity = t < 0.8 ? 0.36 : 0.36 * Math.max(0, (1 - t) / 0.2)

      for (const p of sweep.plates) {
        const dt = (elapsed - p.reachMs) / PLATE_FADE_MS
        if (dt >= 0 && dt <= 1) {
          const op = Math.sin(dt * Math.PI) * 0.42
          for (const mat of p.materials) mat.opacity = op
          litStoreys.add(p.storeyId)
        } else {
          for (const mat of p.materials) mat.opacity = 0
        }
      }
      return true
    },
    dispose() {
      clearSweep()
      container.clear()
    },
  })

  return {
    off() {
      stopWatch()
    },
    inspect() {
      return {
        triggered,
        sweeping,
        violations: ctx.signals.violations.value,
        accepted: ctx.signals.accepted.value,
        zeroStoreys,
        litStoreys: [...litStoreys],
        hud: hud.textContent,
      }
    },
  }
}
