// S2. 살아 있는 건물(alive) — TTL 에 brick:feeds 로 나가는 연결 전부가 원천 쪽부터 흐른다(docs/plans/easter-eggs.md).
//
// - 데이터는 xray 와 같은 readOntologyTTL(modelToTTL(model)) 의 feeds 와 model.connections 의 미확정 규칙 방향만 쓴다.
// - 색은 계통 종류(급기·환기·배기·냉수·온수…, flow-type.ts · kinds.ts)별이며, 종류마다 flowPulseMesh 하나씩만 두어
//   그리기 호출이 계통 종류 수만큼이다.
// - 규칙이 짐작했지만 아직 확정하지 않은 방향은 흐르지 않고 옅은 점선으로 멈춰 있다. 계통을 확정(C)하거나 방향을 적용하면
//   modelVersion 이 올라 그 계통이 곧장 흐르기 시작한다.
// - 움직임 끄기(still())면 혜성 꼴로 멈춘 채 두고 매 프레임 다시 그리지 않는다.
import {
  BufferAttribute,
  BufferGeometry,
  Group,
  LineDashedMaterial,
  LineSegments,
  type Mesh,
  type ShaderMaterial,
  Vector3,
} from 'three'
import { watch } from 'vue'
import { modelToGeoJSON } from '../lib/export/geojson'
import { readOntologyTTL } from '../lib/export/read-ttl'
import { modelToTTL } from '../lib/export/ttl'
import { flowPulseMesh, setFlowTime, type FlowSegment } from '../lib/flow-pulse'
import { flowTypeColor, systemFlowType } from '../lib/flow-type'
import { systemKind } from '../lib/kinds'
import type { Model } from '../lib/model'
import { toScene } from '../lib/viewer'
import type { EggContext, EggHandle } from './types'

const FALLBACK_KIND_COLORS: Record<string, number> = {
  domestic_hot_water: 0xf97316,
  domestic_cold_water: 0x3b82f6,
  fire_protection: 0xef4444,
  refrigerant: 0x14b8a6,
  steam: 0xa855f7,
  condensate_return: 0x64748b,
  geothermal_supply: 0x10b981,
  geothermal_return: 0x06b6d4,
  unknown: 0x2f6fed,
}

/** 편집 뒤 다시 짓기까지 모으는 시간. */
export const REBUILD_SETTLE_MS = 250

export type AliveStats = {
  feeds: number
  graphFeeds: number
  unconfirmed: number
  groups: number
}

type BuiltAlive = {
  root: Group
  meshes: Mesh[]
  stats: AliveStats
  setDark(dark: boolean): void
  dispose(): void
}

function resolveKindColor(kind: string | null | undefined, fluid: string | null | undefined): { key: string; color: number; label: string } {
  const code = systemFlowType(kind, fluid)
  const byFlow = flowTypeColor(code)
  const kInfo = systemKind(kind)
  if (code && byFlow !== null) {
    return { key: code, color: byFlow, label: kInfo?.label ?? code }
  }
  const key = kInfo?.kind ?? 'unknown'
  return {
    key,
    color: FALLBACK_KIND_COLORS[key] ?? FALLBACK_KIND_COLORS.unknown,
    label: kInfo?.label ?? '계통 미지정',
  }
}

/** 모델의 TTL feeds 와 미확정 규칙 방향을 읽어 계통 종류별 흐르는 빛 메시와 점선 메시를 짓는다. */
export function buildAliveScene(model: Readonly<Model>, dark: boolean): BuiltAlive {
  const ttl = modelToTTL(model as Model)
  const reading = readOntologyTTL(ttl)
  const geo = modelToGeoJSON(model as Model)

  const posByKey = new Map<string, Vector3>()
  for (const { collection } of geo) {
    for (const f of collection.features) {
      const g = f.geometry
      const elev = typeof f.properties.elevation === 'number' ? f.properties.elevation : 0
      if (!g) continue
      if (g.type === 'Point') {
        const [x, y, z = elev] = g.coordinates
        posByKey.set(String(f.id), new Vector3(...toScene([x, y, z])))
      } else if (g.type === 'LineString' && g.coordinates.length >= 2) {
        const a = g.coordinates[0]
        const b = g.coordinates[g.coordinates.length - 1]
        posByKey.set(
          String(f.id),
          new Vector3(...toScene([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, ((a[2] ?? elev) + (b[2] ?? elev)) / 2])),
        )
      } else if (g.type === 'Polygon' || g.type === 'MultiPolygon') {
        const ring = g.type === 'Polygon' ? g.coordinates[0] : g.coordinates[0]?.[0]
        if (!ring || ring.length < 3) continue
        const n = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? ring.length - 1 : ring.length
        let sx = 0
        let sy = 0
        for (let i = 0; i < n; i++) {
          sx += ring[i][0]
          sy += ring[i][1]
        }
        posByKey.set(String(f.id), new Vector3(...toScene([sx / n, sy / n, elev + 0.15])))
      }
    }
  }

  for (const s of model.storeys) {
    if (!posByKey.has(s.id)) posByKey.set(s.id, new Vector3(...toScene([0, 0, s.elevation + 0.5])))
    for (const e of s.equipment) {
      if (!posByKey.has(e.id) && e.position) posByKey.set(e.id, new Vector3(...toScene(e.position)))
    }
  }

  // 자리가 없는 엔티티(미배치 설비, BIM 과 안 이어진 IDF 설비 등)도 빠지지 않게 소속 방·층 둘레에 놓는다(xray 와 같은 방식).
  // 원점에 두면 건물 밖 엉뚱한 곳으로 빛이 흐른다.
  const entityByKey = new Map(reading.entities.map((e) => [e.key, e] as const))
  const anyStorey = model.storeys[0] ? posByKey.get(model.storeys[0].id) : undefined
  const ensurePos = (key: string, idx: number): Vector3 => {
    const had = posByKey.get(key)
    if (had) return had
    const loc = entityByKey.get(key)?.locations[0]
    const base = (loc ? posByKey.get(loc) : undefined) ?? anyStorey ?? new Vector3()
    const angle = idx * 2.399963229728653
    const v = new Vector3(base.x + Math.cos(angle) * 0.5, base.y + 0.3 + (idx % 5) * 0.1, base.z + Math.sin(angle) * 0.5)
    posByKey.set(key, v)
    return v
  }
  reading.entities.forEach((e, i) => ensurePos(e.key, i + 1))

  const occupied = new Set<string>()
  let nudgeIdx = 1
  for (const [, v] of posByKey) {
    const snap = `${Math.round(v.x * 200)},${Math.round(v.y * 200)},${Math.round(v.z * 200)}`
    if (occupied.has(snap)) {
      const a = nudgeIdx * 2.399963229728653
      v.x += Math.cos(a) * 0.04
      v.y += 0.02 * ((nudgeIdx % 5) + 1)
      v.z += Math.sin(a) * 0.04
      nudgeIdx++
    } else {
      occupied.add(snap)
    }
  }

  const systemById = new Map(model.systems.map((s) => [s.id, s] as const))
  const equipSystem = new Map<string, string | null>()
  for (const s of model.storeys) {
    for (const e of s.equipment) equipSystem.set(e.id, e.systemId)
  }
  for (const s of model.systems) {
    for (const id of s.memberIds) if (!equipSystem.get(id)) equipSystem.set(id, s.id)
  }

  const groups = new Map<string, { color: number; segments: FlowSegment[] }>()
  let feedsCount = 0

  for (const e of reading.entities) {
    if (!e.feeds.length) continue
    const fromPos = ensurePos(e.key, feedsCount + 100)
    const sysId = equipSystem.get(e.key) ?? null
    const sys = sysId ? systemById.get(sysId) : undefined
    for (const target of e.feeds) {
      const toPos = ensurePos(target, feedsCount + 1000)
      const targetSys = !sys ? (equipSystem.get(target) ? systemById.get(equipSystem.get(target)!) : undefined) : sys
      const { key, color } = resolveKindColor(targetSys?.kind, targetSys?.fluid)
      let g = groups.get(key)
      if (!g) {
        g = { color, segments: [] }
        groups.set(key, g)
      }
      g.segments.push({ from: e.key, to: target, strong: true, a: fromPos, b: toPos })
      feedsCount++
    }
  }

  // 규칙이 짐작했지만 아직 확정하지 않은 연결(미확정 또는 재검토 중)은 옅은 점선으로 멈춰 둔다.
  const dashedPositions: number[] = []
  let unconfirmedCount = 0
  for (const c of model.connections) {
    if (c.directed || c.edited || !c.inferred) continue
    if (c.inferred.confirmed && c.inferred.recheck === undefined) continue
    const a = posByKey.get(c.inferred.from)
    const b = posByKey.get(c.inferred.to)
    if (!a || !b) continue
    dashedPositions.push(a.x, a.y, a.z, b.x, b.y, b.z)
    unconfirmedCount++
  }

  const root = new Group()
  const meshes: Mesh[] = []
  const disposables: { dispose(): void }[] = []
  let graphFeeds = 0

  for (const { color, segments } of groups.values()) {
    const mesh = flowPulseMesh(segments, color, dark)
    if (!mesh) continue
    root.add(mesh)
    meshes.push(mesh)
    graphFeeds += (mesh.userData.flowSegments as number | undefined) ?? 0
    disposables.push(mesh.geometry, mesh.material as ShaderMaterial)
  }

  let dashedMat: LineDashedMaterial | null = null
  if (dashedPositions.length) {
    const dashedGeo = new BufferGeometry()
    dashedGeo.setAttribute('position', new BufferAttribute(new Float32Array(dashedPositions), 3))
    dashedMat = new LineDashedMaterial({
      color: dark ? 0x7c8494 : 0xa3acb7,
      dashSize: 0.35,
      gapSize: 0.25,
      transparent: true,
      opacity: 0.55,
      depthTest: false,
    })
    const line = new LineSegments(dashedGeo, dashedMat)
    line.computeLineDistances()
    line.renderOrder = 12
    root.add(line)
    disposables.push(dashedGeo, dashedMat)
  }

  return {
    root,
    meshes,
    stats: {
      feeds: feedsCount,
      graphFeeds,
      unconfirmed: unconfirmedCount,
      groups: meshes.length,
    },
    setDark(isDark: boolean) {
      for (const m of meshes) {
        ;(m.material as ShaderMaterial).uniforms.uDark.value = isDark ? 1 : 0
      }
      if (dashedMat) dashedMat.color.setHex(isDark ? 0x7c8494 : 0xa3acb7)
    },
    dispose() {
      for (const d of disposables) d.dispose()
    },
  }
}

export function enable(ctx: EggContext): EggHandle {
  const hud = ctx.hud
  hud.style.cssText =
    'padding:0.4rem 0.6rem;border:1px solid var(--line);border-radius:6px;background:color-mix(in srgb,var(--surface) 90%,transparent);font:12px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--muted)'

  const container = new Group()
  let built: BuiltAlive | null = null
  let builtVersion = -1
  let frames = 0

  function rebuild() {
    const m = ctx.model()
    if (!m) return
    const v = ctx.modelVersion()
    if (built && builtVersion === v) return
    if (built) {
      container.remove(built.root)
      built.dispose()
    }
    built = buildAliveScene(m, ctx.dark())
    builtVersion = v
    container.add(built.root)
    const { feeds, unconfirmed } = built.stats
    hud.textContent =
      unconfirmed > 0
        ? `살아 있는 건물 · 흐르는 feeds ${feeds.toLocaleString()} · 미확정 규칙 방향 ${unconfirmed.toLocaleString()} · 화면에서만`
        : `살아 있는 건물 · 흐르는 feeds ${feeds.toLocaleString()} · 화면에서만`
  }

  rebuild()

  // 편집 뒤 0.25초 모았다가 한 번 다시 짓는다. 성수에서 한 번에 0.35~0.4초 걸려서, 방향키를 누를 때마다 지으면 그때마다 멈췄다.
  let timer: ReturnType<typeof setTimeout> | null = null
  const stopModelWatch = watch(
    () => ctx.modelVersion(),
    () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        rebuild()
      }, REBUILD_SETTLE_MS)
    },
  )
  const stopThemeWatch = watch(
    () => ctx.dark(),
    (d) => built?.setDark(d),
  )

  ctx.addLayer({
    object: container,
    step(now) {
      if (ctx.still()) return false
      if (!built || built.meshes.length === 0) return false
      const sec = now / 1000
      for (const mesh of built.meshes) setFlowTime(mesh, sec)
      frames++
      return true
    },
    dispose() {
      built?.dispose()
      built = null
      container.clear()
    },
  })

  return {
    off() {
      stopModelWatch()
      stopThemeWatch()
      if (timer) clearTimeout(timer)
    },
    inspect() {
      // 여기서 다시 짓지 않는다. 지으면 편집을 따라가지 못하는 버그를 e2e 가 못 본다.
      return {
        ...(built?.stats ?? { feeds: 0, graphFeeds: 0, unconfirmed: 0, groups: 0 }),
        builtVersion,
        modelVersion: ctx.modelVersion(),
        frames,
        hud: hud.textContent,
      }
    },
  }
}
