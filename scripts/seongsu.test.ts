import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import * as WebIFC from 'web-ifc'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { importIfcWithMeshes } from '../src/lib/ifc/import'
import { isConduit, type Equipment, type Model, type Vec2 } from '../src/lib/model'
import { interiorPoint, locate, pointInPolygon } from '../src/lib/mapping'
import { ALIGNMENT_MIN_RATIO, mergeModels, type MergeReport } from '../src/lib/merge'
import { escapeLocalName, modelToTTL } from '../src/lib/export/ttl'
import { modelToGeoJSON } from '../src/lib/export/geojson'
import { confirmSystemFlow, inferFlowByRules, withInferred, type RuleReport } from '../src/lib/flow-rules'
import { airServices } from '../src/lib/served'
import { completenessChecks } from '../src/lib/checks'
import { EQUIPMENT_KINDS, equipmentKind, systemKind } from '../src/lib/kinds'
import { requirementsReport } from '../src/lib/requirements'
import { profileOf } from '../src/lib/profile'
import {
  addConnection,
  baselineOf,
  connectionBetween,
  familyKeyOf,
  moveEquipment,
  moveSpaceVertex,
  removeConnection,
  renameSpace,
  restore,
  setFlowDirection,
  setTypeKind,
  snapshotConfirm,
  snapshotEquipment,
  snapshotFlow,
  snapshotSpace,
  snapshotType,
  type Snapshot,
} from '../src/lib/edit'
import { applyEdits, exportEdits, parseEditFile } from '../src/lib/edit-file'
import { fuzzEdits } from '../src/lib/edit-fuzz'

// 성수(고객사 실측)로만 도는 검사. 성수 파일이 있는 PC 와 55 에서만 돈다(`npm run check:seongsu`).
//
// check-sample.test.ts 의 성수 묶음은 정본에 적힌 숫자를 대 본다. 여기는 두 가지를 더 한다.
//   1. **불변식** — 파일이 무엇이든 지켜야 하는 것(좌표 없는 설비는 계산 소속이 없다, 편집 파일을 거쳐도 내보내는
//      파일이 같다, 되돌리면 연 때와 같다 …). 손으로 쓴 픽스처에서 통과하는 것을 성수 규모에서 다시 본다.
//   2. **측정** — 정본에 빈칸으로 남은 값. 기대값이 없어 실패하지 않고, 찍은 표를 data/성수/측정-결과.md 에 쓴다.
//      그 파일을 가져와 정본과 docs/seongsu-test.md 의 결과 칸을 채운다.
//
// 파일 이름이 다르면 환경변수로 준다: SEONGSU_ARCH=… SEONGSU_MECH=… npm run check:seongsu
const ARCH = process.env.SEONGSU_ARCH ?? 'data/성수/Factorial_건축.ifc'
const MECH = process.env.SEONGSU_MECH ?? 'data/성수/Factorial_기계.ifc'
const REPORT = join(dirname(ARCH), '측정-결과.md')
const TTL_GO = '../ieum-pipeline/internal/ontology/ttl.go'

const have = existsSync(ARCH) && existsSync(MECH)

/** 측정 결과. 끝나면 파일 하나로 쓴다. */
const lines: string[] = []
const timings: [string, number][] = []
function section(title: string, body: string[]) {
  lines.push(`## ${title}`, '', ...body, '')
  console.log(`\n## ${title}\n${body.join('\n')}`)
}
function table(head: string[], rows: (string | number)[][]): string[] {
  return [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.join(' | ')} |`)]
}
function timed<T>(label: string, fn: () => T): T {
  const t = performance.now()
  const out = fn()
  timings.push([label, (performance.now() - t) / 1000])
  return out
}
function top<T>(items: T[], key: (x: T) => string, n = 15): [string, number][] {
  const m = new Map<string, number>()
  for (const x of items) m.set(key(x), (m.get(key(x)) ?? 0) + 1)
  return [...m].sort((a, b) => b[1] - a[1]).slice(0, n)
}

const allEquipment = (m: Model) => m.storeys.flatMap((s) => s.equipment)
const devicesOf = (m: Model) => allEquipment(m).filter((e) => !isConduit(e.role))
const exportsOf = (m: Model) => ({ ttl: modelToTTL(m), geo: JSON.stringify(modelToGeoJSON(m)) })

let pristine: Model
let merged: Model
let mergeReport: MergeReport
let mechTTL = ''
let mechDeviceIds: string[] = []
let openRules: RuleReport

beforeAll(async () => {
  if (!have) return
  const api = new WebIFC.IfcAPI()
  await api.Init()
  const arch = timed('건축 열기(형상 포함)', () => importIfcWithMeshes(api, new Uint8Array(readFileSync(ARCH))).model)
  const mech = timed('기계 열기(형상 포함)', () => importIfcWithMeshes(api, new Uint8Array(readFileSync(MECH))).model)
  mechTTL = timed('기계만 TTL', () => modelToTTL(mech))
  mechDeviceIds = devicesOf(mech).map((e) => e.id)
  const done = timed('건축 + 기계 합치기', () => mergeModels(arch, mech, { base: basename(ARCH), overlay: basename(MECH) }))
  merged = done.model
  mergeReport = done.report
  // 앱은 합친 뒤 규칙을 한 번 더 돌린다(App.vue). 같은 상태에서 잰다.
  openRules = timed('규칙 방향 다시 돌리기', () => inferFlowByRules(merged))
  pristine = structuredClone(merged)
}, 1_800_000)

afterAll(() => {
  if (!have) return
  section('걸린 시간 (node, 이 PC)', table(['단계', '초'], timings.map(([k, v]) => [k, v.toFixed(1)])))
  writeFileSync(REPORT, [`# 성수 측정 결과`, '', `${new Date().toISOString()} · \`npm run check:seongsu\``, '', ...lines].join('\n'))
  console.log(`\n측정 결과를 ${REPORT} 에 썼다.`)
})

describe.skipIf(!have)('성수 불변식', () => {
  it('좌표 없는 설비는 좌표로 판정한 소속이 없다 ("모름" 이 "원점" 이 되지 않는다)', () => {
    const bad = allEquipment(merged).filter((e) => e.position === null && e.spaceSource === 'computed')
    expect(bad.map((e) => e.name)).toEqual([])
    const nan = allEquipment(merged).filter((e) => e.position && e.position.some((v) => !Number.isFinite(v)))
    expect(nan.map((e) => e.name)).toEqual([])
  })

  it('좌표로 정한 소속은 자기 층의 방이고, 다시 판정해도 같은 방(겹치면 가장 작은 방)이다', () => {
    const wrong: string[] = []
    for (const storey of merged.storeys) {
      const ids = new Set(storey.spaces.map((s) => s.id))
      for (const e of storey.equipment) {
        if (e.spaceSource !== 'computed') continue
        if (!ids.has(e.spaceId!)) wrong.push(`${e.name}: 다른 층의 방`)
        else if (locate([e.position![0], e.position![1]], storey.spaces) !== e.spaceId) wrong.push(`${e.name}: 다시 재면 다른 방`)
      }
    }
    expect(wrong.slice(0, 20)).toEqual([])
  })

  it('방향은 포트만 말한다: 추정 연결은 방향이 없고, 규칙 방향은 방향 없는 연결에만, 연 때는 확정·사람 방향이 없다', () => {
    const c = merged.connections
    expect(c.filter((x) => x.source !== 'port' && x.directed)).toHaveLength(0)
    expect(c.filter((x) => x.directed && x.inferred)).toHaveLength(0)
    expect(c.filter((x) => x.edited || x.inferred?.confirmed)).toHaveLength(0)
    // 규칙 방향의 두 끝은 그 연결의 두 끝이다.
    const flipped = c.filter((x) => x.inferred && !(
      (x.inferred.from === x.from && x.inferred.to === x.to) || (x.inferred.from === x.to && x.inferred.to === x.from)))
    expect(flipped).toHaveLength(0)
    // 연결이 가리키는 설비는 모델에 있다.
    const ids = new Set(allEquipment(merged).map((e) => e.id))
    expect(c.filter((x) => !ids.has(x.from) || !ids.has(x.to)).length).toBe(0)
  })

  it('규칙 방향은 결정적이다 — 두 번 돌려도 같다(되돌리기가 이 전제에 기댄다)', () => {
    const m = structuredClone(pristine)
    const a = inferFlowByRules(m)
    const first = JSON.stringify(m.connections.map((c) => c.inferred ?? null))
    const b = inferFlowByRules(m)
    expect(JSON.stringify(m.connections.map((c) => c.inferred ?? null))).toBe(first)
    expect(b).toEqual(a)
    expect(a).toEqual(openRules)
  })

  it('TTL 에 기하가 없고, GeoJSON 의 물리존·기기 id 가 전부 TTL 주어다', () => {
    const { ttl, geo } = exportsOf(merged)
    // 단어만 찾으면 GUID 에 우연히 든 'wkt' 에 걸린다(병원 MEP 의 `…FzwktWSC`). 기하가 들어가는 모양으로 찾는다.
    expect(ttl).not.toMatch(/POLYGON\s*\(|"coordinates"|asWKT|wktLiteral/i)
    const ids = (JSON.parse(geo) as ReturnType<typeof modelToGeoJSON>).flatMap((f) =>
      f.collection.features.filter((x) => x.properties.kind === 'space' || x.properties.kind === 'equipment').map((x) => x.id))
    const conduits = new Set(allEquipment(merged).filter((e) => isConduit(e.role)).map((e) => e.id))
    const missing = ids.filter((id) => !ttl.includes(`ex:${escapeLocalName(id)} a `) && !conduits.has(id))
    expect(missing.slice(0, 20)).toEqual([])
  }, 300_000)

  it('합친 두 파일의 좌표계가 맞는다(기계 설비 대부분이 건축 방 범위 안)', () => {
    // 덧붙인 파일에 좌표 있는 설비가 없으면(구조 파일 등) 잴 것이 없다.
    if (!mergeReport.alignment) return
    expect(mergeReport.alignment.ratio).toBeGreaterThanOrEqual(ALIGNMENT_MIN_RATIO)
  })

  it('포트(BIM)가 말한 연결은 끊지 못한다', () => {
    const m = structuredClone(pristine)
    const port = m.connections.find((c) => c.source === 'port')
    if (!port) return
    expect(removeConnection(m, port)).toBeNull()
    expect(m.connections).toContain(port)
  })

  // --- 편집: 앱과 같은 순서로 고치고, 편집 파일·되돌리기를 거쳐도 내보내는 파일이 같은지 -------------------------
  it('여러 편집을 한 뒤 편집 파일로 저장·불러오면 내보내는 파일이 같고, 전부 되돌리면 연 때와 같다', () => {
    const before = exportsOf(pristine)
    const m = structuredClone(pristine)
    const baseline = baselineOf(m)
    const undo: Snapshot[] = []
    const did: string[] = []

    // 1) 설비를 같은 층 다른 방으로 옮긴다(E5). 소속은 옮긴 자리를 다시 잰 방이어야 한다.
    //    그런 층이 없는 파일(설비가 없거나 방이 한 개)은 이 단계를 건너뛴다.
    const storey = m.storeys.find((s) => s.spaces.filter((x) => x.footprint.length >= 4).length >= 2 &&
      s.equipment.some((e) => !isConduit(e.role) && e.position && e.spaceSource === 'computed'))
    const mover = storey?.equipment.find((e) => !isConduit(e.role) && e.position && e.spaceSource === 'computed')
    const target = storey?.spaces.find((x) => x.id !== mover?.spaceId && x.footprint.length >= 4 && x.areaM2 > 2)
    const p = target && interiorPoint(target.footprint)
    if (storey && mover && target && p) {
      undo.push(snapshotEquipment(m, mover.id)!)
      timed('편집: 설비 옮기기 1회', () => moveEquipment(m, mover.id, [p[0], p[1], mover.position![2]]))
      expect(mover.spaceId).toBe(locate(p, storey.spaces))
      did.push(`설비 ${mover.name} → ${target.longName || target.name}`)
    }

    // 2) 물리존 이름(E1)과 꼭짓점(E2).
    const room = m.storeys.flatMap((s) => s.spaces).find((x) => x.footprint.length >= 4 && x.id !== target?.id)
    if (room) {
      undo.push(snapshotSpace(m, room.id)!)
      renameSpace(m, room.id, `${room.longName || room.name} (편집)`)
      undo.push(snapshotSpace(m, room.id)!)
      const v = room.footprint[0]
      const moved = timed('편집: 꼭짓점 옮기기 1회', () => moveSpaceVertex(m, room.id, 0, [v[0] + 0.2, v[1] + 0.2] as Vec2))
      if (!moved) undo.pop()
      did.push(`물리존 ${room.name} 이름${moved ? '·꼭짓점' : ''}`)
    }

    // 3) 종류 모르는 패밀리 하나에 종류를 준다(규칙을 다시 돌린다).
    const unknown = devicesOf(m).find((e) => !e.kind)
    if (unknown) {
      const key = familyKeyOf(unknown)
      const kind = EQUIPMENT_KINDS.find((k) => k.manual)!.kind
      undo.push(snapshotType(m, key))
      timed('편집: 패밀리 종류 정하기 1회', () => setTypeKind(m, key, kind))
      did.push(`종류 ${key} → ${kind}`)
    }

    // 4) 규칙 방향이 가장 많은 계통을 확정한다.
    const bySystem = top(m.connections.filter((c) => c.inferred && !c.inferred.confirmed), (c) => c.inferred!.systemId, 1)
    if (bySystem.length) {
      const [systemId] = bySystem[0]
      undo.push(snapshotConfirm(m, systemId))
      confirmSystemFlow(m, systemId)
      did.push(`계통 확정 ${m.systems.find((s) => s.id === systemId)?.name} (${bySystem[0][1]}개)`)
    }

    // 5) 포트가 방향을 말하지 않은 연결 하나에 사람이 방향을 준다.
    const free = m.connections.find((c) => !c.directed && !c.inferred)
    if (free) {
      undo.push(snapshotFlow(free))
      setFlowDirection(free, free.to)
      did.push('연결 방향 하나')
    }

    // 6) 가까운 기기 둘을 잇는다.
    const others = (storey ?? m.storeys[0]).equipment.filter((e) => !isConduit(e.role) && e.position && e.id !== mover?.id)
    const a = others[0]
    const b = a && others.slice(1).filter((e) => !connectionBetween(m, a.id, e.id))
      .sort((x, y) => dist(x, a) - dist(y, a))[0]
    if (a && b) {
      const added = timed('편집: 잇기 1회(규칙 다시 돌리기 포함)', () => addConnection(m, a.id, b.id))!
      undo.push({ kind: 'connection', connection: added.connection, present: false, index: m.connections.length - 1 })
      did.push(`잇기 ${a.name}–${b.name}`)
    }

    const edited = exportsOf(m)
    if (did.length) expect(edited.ttl).not.toBe(before.ttl)

    // 편집 파일로 나갔다 들어온다(자동 저장과 [편집 저장]이 같은 파일이다).
    const file = timed('편집 파일 만들기', () => exportEdits(m, baseline, `${basename(ARCH)} + ${basename(MECH)}`))
    const json = JSON.stringify(file)
    const parsed = parseEditFile(json)
    if (typeof parsed === 'string') throw new Error(parsed)
    const fresh = structuredClone(pristine)
    const result = timed('편집 파일 불러오기', () => applyEdits(fresh, parsed))
    expect(result.missing).toEqual({ equipment: 0, spaces: 0, kinds: 0, flows: 0, systems: 0, connections: 0, elements: 0 })
    const reloaded = exportsOf(fresh)
    expect(reloaded.ttl === edited.ttl).toBe(true)
    expect(reloaded.geo === edited.geo).toBe(true)

    // 거꾸로 되돌린다(Ctrl+Z).
    const t = performance.now()
    for (const s of undo.reverse()) restore(m, s)
    timings.push([`되돌리기 ${undo.length}번`, (performance.now() - t) / 1000])
    const after = exportsOf(m)
    expect(after.ttl === before.ttl).toBe(true)
    expect(after.geo === before.geo).toBe(true)
    const left = exportEdits(m, baseline, 'x')
    expect([left.equipment, left.spaces, left.kinds, left.flows, left.confirmedSystems].map((x) => x.length)).toEqual([0, 0, 0, 0, 0])

    section('편집 왕복에 쓴 편집', did.map((d) => `- ${d}`))
    section('편집 파일 크기', [`- 위 편집: ${(json.length / 1024).toFixed(1)} KB`])
  }, 1_800_000)

  it('편집을 무작위로 섞어도(물리존 구조·벽·문·창·설비 더하기·계통 포함) 저장·불러오기와 되돌리기가 맞는다', () => {
    // 위 왕복은 고른 편집 몇 개다. 틀린 것은 늘 편집 둘이 만나는 곳에서 나와서 순서를 무작위로 섞는다(edit-fuzz.ts).
    // 성수는 사본 하나가 크니 씨앗 셋만 돈다. 틀리면 씨앗과 편집 목록이 찍힌다.
    const failed: string[] = []
    const t = performance.now()
    for (let seed = 1; seed <= 3; seed++) {
      const r = fuzzEdits(pristine, seed, 30)
      if (!r.reloadSame || r.missing || !r.undoSame) {
        failed.push(`seed ${seed} 불러오기 ${r.reloadSame ? '같음' : '다름'} · 못 찾음 ${r.missing} · 되돌리기 ${r.undoSame ? '같음' : '다름'} :: ${r.log.join(' | ')}\n${r.detail ?? ''}`)
      }
    }
    timings.push(['무작위 편집 30개 × 씨앗 3', (performance.now() - t) / 1000])
    expect(failed).toEqual([])
  }, 1_800_000)

  it('계통을 전부 확정해도 편집 파일이 브라우저 자동 저장(localStorage 약 5MB)에 들어간다', () => {
    const m = structuredClone(pristine)
    const baseline = baselineOf(m)
    const systems = new Set(m.connections.filter((c) => c.inferred).map((c) => c.inferred!.systemId))
    for (const id of systems) confirmSystemFlow(m, id)
    const json = JSON.stringify(exportEdits(m, baseline, `${basename(ARCH)} + ${basename(MECH)}`))
    // localStorage 는 UTF-16 이라 글자 수 × 2 바이트로 센다.
    const mb = (json.length * 2) / 1024 / 1024
    section('편집 파일 크기 (계통 전부 확정)', [`- 계통 ${systems.size}개: ${(json.length / 1024).toFixed(1)} KB (localStorage 로는 약 ${mb.toFixed(2)} MB)`])
    expect(mb).toBeLessThan(5)
  }, 600_000)
})

function dist(a: Equipment, b: Equipment): number {
  return Math.hypot(a.position![0] - b.position![0], a.position![1] - b.position![1], a.position![2] - b.position![2])
}

// --- 받는 쪽(ttl.go)에서 성수가 읽히는가 ---------------------------------------------------------------
let hasGo = false
try {
  execFileSync('go', ['version'])
  hasGo = true
} catch {
  // go 가 없으면 이 묶음을 건너뛴다.
}

describe.skipIf(!have || !existsSync(TTL_GO) || !hasGo)('성수 TTL 을 ieum-pipeline 의 ttl.go 가 읽는가', () => {
  type Parsed = { Key: string; BrickClass: string; Label: string; Feeds: string[] | null; Locations: string[] | null; Parts: string[] | null }
  let bin = ''
  beforeAll(() => {
    const dir = mkdtempSync(join(tmpdir(), 'ttlgo-'))
    mkdirSync(join(dir, 'ontology'))
    copyFileSync(TTL_GO, join(dir, 'ontology', 'ttl.go'))
    writeFileSync(join(dir, 'go.mod'), 'module ttlcheck\n\ngo 1.22\n')
    writeFileSync(join(dir, 'main.go'), [
      'package main',
      'import ("encoding/json"; "os"; "ttlcheck/ontology")',
      'func main() {',
      '  ents, err := ontology.Parse(os.Stdin)',
      '  if err != nil { panic(err) }',
      '  json.NewEncoder(os.Stdout).Encode(ents)',
      '}',
    ].join('\n'))
    bin = join(dir, process.platform === 'win32' ? 'ttlcheck.exe' : 'ttlcheck')
    execFileSync('go', ['build', '-o', bin, '.'], { cwd: dir })
  }, 300_000)
  const parse = (ttl: string): Parsed[] => JSON.parse(execFileSync(bin, { input: ttl, maxBuffer: 1 << 30 }).toString())
  const unescapeKey = (key: string) => key.replace(/\\(.)/g, '$1')

  it('기계만 열어도 모든 기기가 위치(층)를 갖고 받는 쪽에 닿는다', () => {
    const ents = parse(mechTTL)
    const byKey = new Map(ents.map((e) => [unescapeKey(e.Key), e]))
    const noLocation = mechDeviceIds.filter((id) => !(byKey.get(id)?.Locations?.length))
    section('ttl.go (기계만)', [`- 엔티티 ${ents.length} · 위치가 없는 기기 ${noLocation.length}`])
    expect(noLocation.length).toBe(0)
  }, 600_000)

  it('건축+기계: 기기→기기 흐름이 전부 닿고, 소속이 있는 기기는 그 방을 위치로 갖는다', () => {
    const ents = parse(modelToTTL(pristine))
    const byKey = new Map(ents.map((e) => [unescapeKey(e.Key), e]))
    // 기기 → (덕트·배관) → 기기. 받는 쪽은 덕트를 엔티티로 읽지 않으니 기기끼리 닿는지가 계약이다.
    const role = new Map(allEquipment(pristine).map((e) => [e.id, e.role]))
    const out = new Map<string, string[]>()
    for (const c of withInferred(pristine.connections, true)) if (c.directed) out.set(c.from, [...(out.get(c.from) ?? []), c.to])
    const want = new Set<string>()
    for (const [id, r] of role) {
      if (isConduit(r)) continue
      const stack = [...(out.get(id) ?? [])]
      const seen = new Set(stack)
      while (stack.length) {
        const cur = stack.pop()!
        // 덕트 고리를 돌아 자기에게 돌아오는 것은 흐름 쌍이 아니다(TTL 도 자기 자신을 feeds 로 적지 않는다).
        if (!isConduit(role.get(cur) ?? null)) { if (cur !== id) want.add(`${id}>${cur}`); continue }
        for (const n of out.get(cur) ?? []) if (!seen.has(n)) seen.add(n), stack.push(n)
      }
    }
    const got = new Set(ents.flatMap((e) => (e.Feeds ?? []).map((t) => `${unescapeKey(e.Key)}>${unescapeKey(t)}`)))
    const lost = [...want].filter((p) => !got.has(p))
    const wrongRoom = devicesOf(pristine).filter((e) => e.spaceId && !byKey.get(e.id)?.Locations?.map(unescapeKey).includes(e.spaceId))
    const dollar = ents.filter((e) => e.Key.includes('\\$')).length
    // 이름에 큰따옴표가 든 기기(성수 `Water_meter-…DN50:3/4":…` 같은 인치 표기). TTL 에는 \" 로 바르게 적히지만
    // ttl.go 의 라벨 정규식이 이스케이프를 몰라 따옴표 앞에서 자른다. 엔티티·위치·흐름은 그대로다.
    const quoted = devicesOf(pristine).filter((e) => (e.name ?? '').includes('"'))
    const cut = quoted.filter((e) => byKey.get(e.id)?.Label !== e.name)
    section('ttl.go (건축+기계)', [
      `- 엔티티 ${ents.length} · 기기→기기 흐름 ${want.size} 중 못 닿은 것 ${lost.length}`,
      `- 소속 방을 위치로 못 읽은 기기 ${wrongRoom.length}`,
      `- 키에 \\$ 가 남은 엔티티 ${dollar} (ttl.go 가 이스케이프를 풀지 않아 GeoJSON id 와 안 이어진다 — 알고 둔 어긋남)`,
      `- 이름에 큰따옴표가 든 기기 ${quoted.length} 중 ttl.go 가 라벨을 잘라 읽은 것 ${cut.length} (예: ${quoted[0]?.name ?? '-'} → ${byKey.get(quoted[0]?.id ?? '')?.Label ?? '-'}) — 알고 둔 어긋남`,
    ])
    expect(lost.slice(0, 5)).toEqual([])
    expect(wrongRoom.length).toBe(0)
  }, 900_000)
})

// --- 측정: 정본에 빈칸으로 남은 값. 실패하지 않는다 ----------------------------------------------------------
describe.skipIf(!have)('성수 측정', () => {
  it('방 종류의 출처 (정본 방 종류 행: "코드를 읽은 뒤 다시 재지 못했다")', () => {
    const spaces = merged.storeys.flatMap((s) => s.spaces)
    const by = (f: (s: (typeof spaces)[number]) => boolean) => spaces.filter(f).length
    section('방 종류', [
      ...table(['', '수'], [
        ['물리존', spaces.length],
        ['이름 사전으로', by((s) => s.kindSource === 'dict')],
        ['OmniClass 코드로 (출처 BIM)', by((s) => s.kindSource === 'bim')],
        ['모름', by((s) => !s.kind)],
        ['OmniClass 코드가 있는 방 (표준 분류 관계)', by((s) => s.omniclassSource === 'classification')],
        ['OmniClass 코드가 있는 방 (Revit Category Code 속성)', by((s) => s.omniclassSource === 'property')],
        ['외곽선이 없는 방 (3D 에서 그릴 대상)', by((s) => s.footprint.length < 3)],
      ]),
      '',
      '종류를 모르는 방 이름 상위:',
      ...table(['이름', '수'], top(spaces.filter((s) => !s.kind), (s) => s.longName || s.name)),
    ])
  })

  it('기기 종류의 출처와 모르는 패밀리', () => {
    const devices = devicesOf(merged)
    const systemName = new Map(merged.systems.map((s) => [s.id, systemKind(s.kind)?.label ?? '모름']))
    const unknown = devices.filter((e) => !e.kind)
    section('기기 종류', [
      ...table(['', '수'], [
        ['기기', devices.length],
        ['IFC 가 말한 종류 (출처 BIM)', devices.filter((e) => e.kindSource === 'bim').length],
        ['이름 사전으로', devices.filter((e) => e.kindSource === 'dict').length],
        ['모름', unknown.length],
        ['Proxy 로 받은 기기', devices.filter((e) => e.ifcClass === 'BuildingElementProxy').length],
        ['좌표 없는 기기 (3D 에서 놓을 대상)', devices.filter((e) => !e.position).length],
        ['용량이 있는 기기', devices.filter((e) => e.capacity !== null).length],
      ]),
      '',
      '종류를 모르는 패밀리 상위 (사람이 패밀리 단위로 고를 대상, U 키):',
      ...table(['패밀리', '대수', 'IFC 클래스', '계통 종류'], top(unknown, familyKeyOf, 25).map(([k, n]) => {
        const e = unknown.find((x) => familyKeyOf(x) === k)!
        return [k.replace(/\|/g, '/'), n, e.ifcClass, e.systemId ? systemName.get(e.systemId) ?? '-' : '-']
      })),
      '',
      'IFC 가 말한 종류(declaredType) 상위:',
      ...table(['declaredType', '수'], top(devices.filter((e) => e.kindSource === 'bim'), (e) => e.declaredType ?? '-')),
      '',
      'IFC 가 값을 말했는데 표에 없어 안 읽은 것 상위:',
      ...table(['declaredType', '수'], top(devices.filter((e) => e.declaredType && e.kindSource !== 'bim' && !e.kind), (e) => e.declaredType!)),
      '',
      '용량을 읽은 속성 이름:',
      ...table(['속성', '수'], top(devices.filter((e) => e.capacityProperty), (e) => e.capacityProperty!)),
    ])
  })

  it('규칙 방향의 계통 종류별 일치율과 가장 많이 어긋난 계통 (천장 배기팬 보류 건)', () => {
    const r = openRules
    const systems = new Map(merged.systems.map((s) => [s.id, s]))
    const byKind = new Map<string, { oriented: number; agree: number; disagree: number; n: number }>()
    for (const [id, x] of Object.entries(r.bySystem)) {
      const k = systemKind(systems.get(id)?.kind)?.label ?? '모름'
      const acc = byKind.get(k) ?? { oriented: 0, agree: 0, disagree: 0, n: 0 }
      acc.oriented += x.oriented; acc.agree += x.agree; acc.disagree += x.disagree; acc.n++
      byKind.set(k, acc)
    }
    const pct = (a: number, d: number) => (a + d ? `${((a / (a + d)) * 100).toFixed(1)}%` : '-')
    const equipment = new Map(allEquipment(merged).map((e) => [e.id, e]))
    const sourcesOf = (systemId: string) => {
      const s = systems.get(systemId)!
      const medium = systemKind(s.kind)?.medium
      return top(s.memberIds.map((id) => equipment.get(id)).filter((e): e is Equipment =>
        !!e && !!medium && equipmentKind(e.kind)?.flow[medium] === 'source'), familyKeyOf, 3).map(([k, n]) => `${k} ×${n}`).join(', ') || '(계통 안에 원천 없음)'
    }
    const worst = Object.entries(r.bySystem).filter(([, x]) => x.disagree > 0).sort((a, b) => b[1].disagree - a[1].disagree).slice(0, 20)
    section('규칙 방향', [
      `- 규칙을 돌린 계통 ${r.systems} · 원천 못 찾음 ${r.noSource} · 방향 준 연결 ${r.oriented} · 충돌 ${r.conflicts}`,
      `- 포트와 대 봄 ${r.agree + r.disagree} · 일치 ${pct(r.agree, r.disagree)} (기준 83.8%)`,
      '',
      ...table(['계통 종류', '계통 수', '방향 준 연결', '포트와 일치'], [...byKind].map(([k, x]) => [k, x.n, x.oriented, `${pct(x.agree, x.disagree)} (${x.agree}/${x.agree + x.disagree})`])),
      '',
      '포트와 가장 많이 어긋난 계통 (배기에 흡입구 일체형 팬이 원천으로 걸려 있는지 본다):',
      ...table(['계통', '종류', '일치/대 봄', '계통 안의 원천 패밀리'], worst.map(([id, x]) => {
        const s = systems.get(id)
        return [(s?.name ?? id).replace(/\|/g, '/'), systemKind(s?.kind)?.label ?? '모름', `${x.agree}/${x.agree + x.disagree}`, sourcesOf(id).replace(/\|/g, '/')]
      })),
    ])
  })

  it('계통 종류와 순환수의 유체 (TODO 의 유체 종류)', () => {
    // 순환수 공급·환수가 냉수인지 온수인지. PredefinedType(IFC4) 이 먼저고 없으면 이름이다. 성수는 IFC2x3 이라 이름뿐이다.
    const rows = top(merged.systems, (s) => {
      const k = systemKind(s.kind)?.label ?? '모름'
      return s.fluid === undefined ? k : `${k} · ${s.fluid ?? '유체 모름'}${s.fluidSource ? ` (${s.fluidSource})` : ''}`
    }, 30)
    const water = merged.systems.filter((s) => s.fluid !== undefined)
    section('계통 종류와 유체', [
      `- 계통 ${merged.systems.length} · 순환수 ${water.length} · 유체를 안 것 ${water.filter((s) => s.fluid).length}`,
      '',
      ...table(['종류 · 유체 (출처)', '계통 수'], rows),
      '',
      '유체를 모르는 순환수 계통 이름(상위 15):',
      ...table(['이름', '수'], top(water.filter((s) => !s.fluid), (s) => s.name.replace(/\d+/g, '#').replace(/\|/g, '/'))),
    ])
  })

  it('소속·합치기·완전성 검사·요구사항·등급', () => {
    const devices = devicesOf(merged)
    // 같은 층 방이 겹친 자리에 든 기기(가장 작은 방 규칙이 고른 것).
    let overlapped = 0
    for (const storey of merged.storeys) {
      for (const e of storey.equipment) {
        if (isConduit(e.role) || e.spaceSource !== 'computed') continue
        const pt: Vec2 = [e.position![0], e.position![1]]
        if (storey.spaces.filter((s) => pointInPolygon(pt, s.footprint)).length > 1) overlapped++
      }
    }
    const checks = completenessChecks(merged, airServices(merged, withInferred(merged.connections)))
    const reqs = requirementsReport(merged, mergeReport)
    const profile = profileOf(merged)
    section('소속', table(['', '수'], [
      ['기기', devices.length],
      ['BIM 이 말한 소속', devices.filter((e) => e.spaceSource === 'bim').length],
      ['좌표로 판정한 소속', devices.filter((e) => e.spaceSource === 'computed').length],
      ['그중 방이 겹친 자리 (가장 작은 방으로)', overlapped],
      ['소속 없음 · 좌표 없음', devices.filter((e) => !e.spaceId && !e.position).length],
      ['소속 없음 · 어느 방에도 안 듦', devices.filter((e) => !e.spaceId && e.position).length],
    ]))
    section('합치기', [
      `- 좌표계: 설비 ${mergeReport.alignment?.placed} 중 ${mergeReport.alignment?.inside} 가 건축 범위 안 (${((mergeReport.alignment?.ratio ?? 0) * 100).toFixed(1)}%)`,
      `- 물리존: 버림 ${mergeReport.spaces.dropped} · 받음 ${mergeReport.spaces.kept} · 외곽선 빌림 ${mergeReport.spaces.borrowed} · 같은 GUID ${mergeReport.duplicateIds}`,
      `- 기계 설비 미소속: 합치기 전 ${mergeReport.unlocated.before} → 후 ${mergeReport.unlocated.after}`,
      '',
      ...table(['기계 층', '짝지은 건축 층', '어떻게', '높이 차(m)'], mergeReport.storeys.map((s) => [s.name, s.matchedTo ?? '(없음 — 새 층)', s.by ?? '-', s.elevationDelta?.toFixed(3) ?? '-'])),
    ])
    section('완전성 검사 (규칙 방향 포함)', table(['규칙', '통과/대상'], checks.map((c) => [c.rule, c.skipped ? `잴 수 없음: ${c.skipped}` : `${c.total - c.failed.length}/${c.total}`])))
    section('요구사항 보고서', table(['R', '등급', '요구', '상태', '표준/다른 자리/대상'], reqs.map((r) =>
      [r.id, r.level, r.title, r.state, r.counts ? `${r.counts.standard}/${r.counts.elsewhere}/${r.counts.of}` : '-'])))
    section('등급 칩', table(['등급', '채움'], profile.tiers.map((t) => [t.label, `${t.have}/${t.of}`])))
    section('임포트 경고', [`- ${merged.warnings.length}건`, ...merged.warnings.slice(0, 20).map((w) => `  - ${w.replace(/\n/g, ' ')}`)])
  })
})
