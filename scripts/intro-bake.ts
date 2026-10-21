// 첫 화면 인트로(public/intro/)가 그릴 장면을 BIM 에서 굽는다.
//
//   npm run intro:bake -- <이름> <건축.ifc> [설비.ifc ...]
//   npm run intro:bake -- seongsu data/성수/Factorial_건축.ifc data/성수/Factorial_기계.ifc --title=성수 Factorial
//
// 성수 원본은 287MB 라 첫 화면에서 열 수 없다(열기 15초·힙 954MB). 에디터가 파일을 열 때와 같은 임포터·합치기로 한 번 읽어
// 층·물리존 외곽선·벽·기기 점·관로 선만 남긴 JSON 을 data/.intro/<이름>.json 에 둔다. 화면의 숫자는 전부 이 파일에서 센다.
// data/ 는 커밋하지 않는다 — 고객사 건물 형상이라 저장소에 두지 않고, 성수가 있는 기계(55)에서 구워 그 서버만 내준다
// (/__data/__intro, src/server/intro.ts).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import * as WebIFC from 'web-ifc'
import { importIfcWithMeshes } from '../src/lib/ifc/import'
import { mergeModels } from '../src/lib/merge'
import { isConduit, segmentPath, type Model, type Vec2, type Vec3 } from '../src/lib/model'
import { gradeCounts } from '../src/lib/grade'
import { profileOf } from '../src/lib/profile'
import { inferFlowByRules } from '../src/lib/flow-rules'

const args = process.argv.slice(2)
// 화면 제목. 없으면 IfcBuilding 이름이다(성수는 "Default" 라 붙여 준다).
const title = args.find((a) => a.startsWith('--title='))?.slice('--title='.length)
const [name, ...files] = args.filter((a) => !a.startsWith('--'))
if (!name || !files.length) {
  console.error('npm run intro:bake -- <이름> <건축.ifc> [설비.ifc]')
  process.exit(1)
}

const cm = (v: number) => Math.round(v * 100) / 100
const ring = (pts: readonly Vec2[]) => pts.map(([x, y]) => [cm(x), cm(y)])

const api = new WebIFC.IfcAPI()
await api.Init()
const t0 = performance.now()
// 벽 외곽선과 관로 축은 형상에서 잰다(import.ts 의 footprintRings·segmentAxisOf). 형상은 모델에 그 값을 남기고 버린다.
const models = files.map((f) => importIfcWithMeshes(api, new Uint8Array(readFileSync(f))).model)
// 셋 이상이면 앞에서부터 차례로 얹는다(에디터에서 파일을 하나씩 더 여는 것과 같다).
let model: Model = models[0]
for (let i = 1; i < models.length; i++) model = mergeModels(model, models[i], { base: basename(files[i - 1]), overlay: basename(files[i]) }).model
// 앱은 열고 나서 규칙 방향을 한 번 더 돌린다(App.vue). 화면 숫자를 같게 하려고 같은 상태에서 센다.
inferFlowByRules(model)

const storeys = [...model.storeys].sort((a, b) => a.elevation - b.elevation)

// ---------------------------------------------------------------- 흐름: 연결마다 방향과 그 출처
// 가이드의 흐름 랩(public/intro/index.html?focus=flow)이 연결을 따라 입자를 흘린다. 기기는 배치점, 관로는 두 끝 가운데에서 시작해
// 두 요소가 가장 가까이 닿는 점을 지나 다음 요소로 간다. 방향의 출처는 TTL 이 brick:feeds 를 내는 순서와 같게 가린다.
//   0 BIM 포트가 말한 방향(directed) · 1 사람이 정한 방향(edited) · 2 규칙 방향(inferred, 재검토 중이 아닌 것) · 3 방향 모름
type V3 = Vec3
const where = new Map<string, { at: V3; ends: readonly V3[]; storey: number }>()
const mid = (a: V3, b: V3): V3 => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2]
const dist = (a: V3, b: V3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
storeys.forEach((s, si) => {
  for (const e of s.equipment) {
    const p = segmentPath(e)
    if (p && 'path' in p) where.set(e.id, { at: mid(p.path[0], p.path[1]), ends: p.path, storey: si })
    else if (e.position) where.set(e.id, { at: e.position, ends: [e.position], storey: si })
  }
})
const near = (a: readonly V3[], b: readonly V3[]) => {
  let best: [V3, V3] = [a[0], b[0]]
  for (const p of a) for (const q of b) if (dist(p, q) < dist(...best)) best = [p, q]
  return mid(...best)
}
const flows: number[][][] = storeys.map(() => [])
for (const c of model.connections) {
  const dir: [string, string, number] = c.directed
    ? [c.from, c.to, 0]
    : c.edited
      ? [c.edited.from, c.edited.to, 1]
      : c.inferred && !c.inferred.recheck
        ? [c.inferred.from, c.inferred.to, 2]
        : [c.from, c.to, 3]
  const a = where.get(dir[0]), b = where.get(dir[1])
  if (!a || !b) continue
  // 10cm 로 줄인다. 성수는 연결이 2만 개라 cm 로 두면 장면이 1MB 넘게 는다.
  flows[a.storey].push([...a.at, ...near(a.ends, b.ends), ...b.at].map((v) => Math.round(v * 10) / 10).concat(dir[2]))
}
const scene = {
  name,
  building: model.buildingName || model.siteName || name,
  title: title ?? (model.buildingName || model.siteName || name),
  files: files.map((f) => basename(f)),
  bakedAt: new Date().toISOString(),
  counts: gradeCounts(model),
  tiers: profileOf(model).tiers.map((t) => ({ key: t.key, label: t.label, have: t.have, of: t.of, level: t.level })),
  systems: model.systems.length,
  connections: model.connections.length,
  storeys: storeys.map((s, i) => {
    const next = storeys[i + 1]
    const height = next ? next.elevation - s.elevation : (s.declaredHeight?.gross ?? 4)
    const devices = s.equipment.filter((e) => e.position && !isConduit(e.role))
    // 관로는 GeoJSON 의 LineString 과 같은 길(segmentPath)로 세계 좌표 두 끝을 얻는다. axis 는 배치점에서 잰 상대 좌표다.
    const conduits = s.equipment.flatMap((e) => {
      const p = segmentPath(e)
      return p && 'path' in p ? [p.path] : []
    })
    return {
      name: s.name,
      elevation: cm(s.elevation),
      height: cm(Math.max(2.4, Math.min(height, 12))),
      spaces: s.spaces.filter((p) => p.footprint.length >= 4).map((p) => ({ kind: p.kind ?? null, ring: ring(p.footprint) })),
      walls: s.walls.flatMap((w) => (w.footprint ?? []).filter((r) => r.length >= 4).map((r) => ({ h: cm(w.height ?? height), ring: ring(r) }))),
      // [x, y, z, 소속 있음(1/0)]. 종류 이름은 화면에 쓰지 않아 뺀다.
      devices: devices.map((e) => [cm(e.position![0]), cm(e.position![1]), cm(e.position![2]), e.spaceId ? 1 : 0]),
      conduits: conduits.map(([a, b]) => [...a.map(cm), ...b.map(cm)]),
      // [x1, y1, z1, 닿는 점 x, y, z, x2, y2, z2, 출처]. 출처는 위의 0~3.
      flows: flows[i],
    }
  }),
}

mkdirSync(join('data', '.intro'), { recursive: true })
const out = join('data', '.intro', `${name}.json`)
const json = JSON.stringify(scene)
writeFileSync(out, json)
const c = scene.storeys.reduce((a, s) => ({ spaces: a.spaces + s.spaces.length, walls: a.walls + s.walls.length, devices: a.devices + s.devices.length, conduits: a.conduits + s.conduits.length }), { spaces: 0, walls: 0, devices: 0, conduits: 0 })
console.log(`${out} · ${(json.length / 1e6).toFixed(1)}MB · ${((performance.now() - t0) / 1000).toFixed(1)}초`)
const byKind = [0, 1, 2, 3].map((k) => scene.storeys.reduce((n, s) => n + s.flows.filter((f) => f[9] === k).length, 0))
console.log(`흐름 BIM ${byKind[0]} · 사람 ${byKind[1]} · 규칙 ${byKind[2]} · 모름 ${byKind[3]}`)
console.log(`층 ${scene.storeys.length} · 물리존 ${c.spaces} · 벽 ${c.walls} · 기기 ${c.devices} · 관로 ${c.conduits} · 계통 ${scene.systems} · 연결 ${scene.connections}`)
