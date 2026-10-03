// 합성 고층 BIM — 성수(19층, 건축 84MB·기계 203MB, 설비 절반이 Proxy, 방마다 같은 외곽선의 "공간" 사본)를 이 PC 에서
// 못 구해서, 가진 실제 BIM(병원 건축·기계)을 층으로 쌓고 성수에서 본 버릇을 심어 비슷한 크기·모양의 파일을 만든다.
//
//   node scripts/synth-tower.mjs [--copies 5] [--arch 경로] [--mech 경로] [--out data/합성-성수]
//
// 무엇을 하나
// - **쌓기.** 파일의 엔터티를 통째로 N 벌 복사해 위로 쌓는다. 프로젝트·대지·건물은 하나만 두고, 복사한 층은 원래 건물에
//   묶는다(IfcRelAggregates). 층 배치(IfcLocalPlacement) 아래에 높이만큼 올린 배치를 끼워 넣어 그 층의 방·벽·설비가 같이
//   올라간다. 층 이름은 `[k] 원래 이름`, 바닥 높이도 그만큼 올린다. 두 파일을 같은 높이로 올려 합치면 층이 맞는다.
// - **GUID·요소 ID.** 복사본마다 GUID 끝 두 글자를 바꾸고, 이름 끝의 Revit 요소 ID(`…:1186968`)에 k×10,000,000 을 더한다
//   — 판본 비교·편집 파일이 이름으로 다시 찾는 길이 층마다 갈린다(성수 이름도 요소 ID 로 끝난다).
// - **설비 Proxy.** 기계 파일의 홀수 번째 복사본에서 말단·변환 기기(IfcFlowTerminal·IfcEnergyConversionDevice·
//   IfcFlowMovingDevice·IfcFlowController)를 IfcBuildingElementProxy 로 바꾼다. 포트는 그대로다(성수: 설비 3,472 중 Proxy 1,652).
// - **"공간" 사본.** 건축 파일의 방마다 같은 배치·같은 외곽선에 이름이 기본값("공간")인 방을 하나 더 둔다(성수 건축 934 = 508 + 사본).
//
// 형상의 디테일(LOD)은 늘리지 않는다 — 임포터가 보는 것은 엔터티의 수·관계·이상한 구조이고, 그것을 성수 규모로 만든다.
// 만든 파일은 data/(git 밖)에 둔다.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > 0 ? process.argv[i + 1] : fallback
}
const COPIES = Number(arg('copies', '5'))
const ARCH = arg('arch', 'data/NBU_MedicalClinic/NBU_MedicalClinic_Arch.ifc')
const MECH = arg('mech', 'data/NBU_MedicalClinic/NBU_MedicalClinic_Eng-HVAC.ifc')
const OUT = arg('out', 'data/합성-성수')

const GUID_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz_$'
const PROXY_FROM = new Set(['IFCFLOWTERMINAL', 'IFCENERGYCONVERSIONDEVICE', 'IFCFLOWMOVINGDEVICE', 'IFCFLOWCONTROLLER'])

/** STEP 한 줄 → { id, type, args(최상위 인자 문자열 배열) }. */
function parse(line) {
  const m = /^#(\d+)=\s*([A-Z0-9_]+)\((.*)\);\s*$/.exec(line)
  if (!m) return null
  return { id: Number(m[1]), type: m[2], args: splitArgs(m[3]) }
}
function splitArgs(text) {
  const out = []
  let depth = 0, quote = false, start = 0
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quote) {
      if (c === "'") {
        if (text[i + 1] === "'") i++
        else quote = false
      }
      continue
    }
    if (c === "'") quote = true
    else if (c === '(') depth++
    else if (c === ')') depth--
    else if (c === ',' && depth === 0) {
      out.push(text.slice(start, i))
      start = i + 1
    }
  }
  out.push(text.slice(start))
  return out
}
/** 문자열 밖의 #참조를 바꾼다. */
function mapRefs(text, fn) {
  let out = '', quote = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quote) {
      out += c
      if (c === "'") {
        if (text[i + 1] === "'") out += text[++i]
        else quote = false
      }
      continue
    }
    if (c === "'") {
      quote = true
      out += c
      continue
    }
    if (c === '#') {
      let j = i + 1
      while (j < text.length && text[j] >= '0' && text[j] <= '9') j++
      out += `#${fn(Number(text.slice(i + 1, j)))}`
      i = j - 1
      continue
    }
    out += c
  }
  return out
}
const line = (id, type, args) => `#${id}=${type}(${args.join(',')});`
const str = (s) => `'${s.replace(/'/g, "''")}'`
const unstr = (a) => (a.startsWith("'") ? a.slice(1, -1).replace(/''/g, "'") : null)

/**
 * 복사본·새 엔터티의 GUID. 원래 GUID·앞서 만든 GUID 와 **절대 겹치지 않게** 만든다 — Revit GUID 는 앞 20자가 같은 것이 많아서
 * 끝 두 글자만 바꾸면 다른 요소의 GUID 와 겹쳤고(소속 방이 엉뚱한 방을 가리켰다), 겹치면 IFC 가 아니다. 같은 입력이면 같은 GUID 다.
 */
const USED = new Set()
function guid(g, k, salt = 0) {
  for (let n = 0; ; n++) {
    const bytes = createHash('sha1').update(`${g}|${k}|${salt}|${n}`).digest()
    let out = GUID_CHARS[bytes[0] % 4] // GUID 첫 글자는 0~3 이다(128비트를 22자로)
    for (let i = 1; i < 22; i++) out += GUID_CHARS[bytes[i % bytes.length] % 64]
    if (!USED.has(out)) {
      USED.add(out)
      return out
    }
  }
}

function read(path) {
  const text = readFileSync(path, 'latin1') // STEP 은 ASCII 다(\X2\ 로 적은 한글도). 바이트 그대로 다룬다.
  const head = text.slice(0, text.indexOf('DATA;') + 'DATA;'.length)
  const tail = text.slice(text.indexOf('ENDSEC;', text.indexOf('DATA;')))
  const body = text.slice(head.length, text.length - tail.length).split(/\r?\n/).filter(Boolean)
  const ents = body.map(parse)
  if (ents.some((e) => !e)) throw new Error(`${path}: 한 줄에 한 엔터티가 아닌 곳이 있다`)
  for (const e of ents) {
    const g = unstr(e.args[0] ?? '')
    if (g && g.length === 22) USED.add(g)
  }
  const mm = /IFCSIUNIT\(\*,\.LENGTHUNIT\.,\.MILLI\.,\.METRE\.\)/.test(text)
  return { head, tail, ents, unit: mm ? 1000 : 1 }
}

/** 층 높이(미터). 쌓는 간격을 정하는 데 쓴다. */
function storeyLevels(file) {
  return file.ents.filter((e) => e.type === 'IFCBUILDINGSTOREY').map((e) => Number(e.args[9]) / file.unit)
}

function tower(file, { copies, step, proxy, spaceCopies }) {
  const byId = new Map(file.ents.map((e) => [e.id, e]))
  const maxId = file.ents.reduce((m, e) => (e.id > m ? e.id : m), 0)
  const keep = new Set(file.ents.filter((e) => ['IFCPROJECT', 'IFCSITE', 'IFCBUILDING'].includes(e.type)).map((e) => e.id))
  // 프로젝트·대지를 묶는 관계는 복사하지 않는다(건물→층 관계만 복사본이 원래 건물에 매단다).
  const skip = new Set(
    file.ents
      .filter((e) => e.type === 'IFCRELAGGREGATES')
      .filter((e) => {
        const relating = Number(e.args[4].slice(1))
        return byId.get(relating)?.type === 'IFCPROJECT' || byId.get(relating)?.type === 'IFCSITE'
      })
      .map((e) => e.id),
  )
  for (const id of keep) skip.add(id)
  const storeyPlacements = new Set(file.ents.filter((e) => e.type === 'IFCBUILDINGSTOREY').map((e) => Number(e.args[5].slice(1))))

  const out = file.ents.map((e) => line(e.id, e.type, e.args))
  let next = maxId * copies + 1
  const stats = { proxies: 0, spaces: 0 }
  // 원래 건물(k=0)은 그대로 두고 위에 k=1.. 을 쌓는다.
  for (let k = 1; k < copies; k++) {
    const off = maxId * k
    const ref = (n) => (keep.has(n) ? n : n + off)
    const z = (k * step * file.unit).toFixed(1)
    // 이 복사본의 층을 올리는 배치: (0,0,z).
    const pt = next++, axis = next++
    out.push(line(pt, 'IFCCARTESIANPOINT', [`(0.,0.,${z})`]), line(axis, 'IFCAXIS2PLACEMENT3D', [`#${pt}`, '$', '$']))
    for (const e of file.ents) {
      if (skip.has(e.id)) continue
      let type = e.type
      let args = e.args.map((a) => mapRefs(a, ref))
      {
        const g = unstr(args[0] ?? '')
        if (g && g.length === 22) args[0] = str(guid(g, k))
        // 이름 끝의 Revit 요소 ID 를 층마다 다르게.
        const name = unstr(args[2] ?? '')
        if (name && /:\d{5,}$/.test(name)) args[2] = str(name.replace(/:(\d{5,})$/, (_, d) => `:${Number(d) + k * 10_000_000}`))
        if (type === 'IFCBUILDINGSTOREY') {
          const label = (i) => {
            const v = unstr(args[i])
            if (v !== null) args[i] = str(`[${k + 1}] ${v}`)
          }
          label(2)
          label(7)
          args[9] = (Number(args[9]) + Number(z)).toFixed(1)
        }
        // 층 배치를 올린 배치 아래로.
        if (type === 'IFCLOCALPLACEMENT' && storeyPlacements.has(e.id)) {
          const lift = next++
          out.push(line(lift, 'IFCLOCALPLACEMENT', [args[0], `#${axis}`]))
          args[0] = `#${lift}`
        }
      }
      if (proxy && k % 2 === 1 && PROXY_FROM.has(type) && args.length === 8) {
        type = 'IFCBUILDINGELEMENTPROXY'
        args = [...args, '$']
        stats.proxies++
      }
      out.push(line(e.id + off, type, args))
    }
  }
  // 방마다 같은 배치·같은 외곽선의 "공간" 사본. 원래 방이 든 층에 묶는다.
  if (spaceCopies) {
    const parsed = out.map(parse)
    const storeyOfSpace = new Map()
    for (const e of parsed) {
      if (e.type !== 'IFCRELAGGREGATES') continue
      const relating = Number(e.args[4].slice(1))
      for (const r of e.args[5].replace(/[()]/g, '').split(',')) storeyOfSpace.set(Number(r.trim().slice(1)), relating)
    }
    const dupsByStorey = new Map()
    let n = 0
    for (const e of parsed) {
      if (e.type !== 'IFCSPACE') continue
      const storey = storeyOfSpace.get(e.id)
      if (!storey) continue
      const id = next++
      const args = [...e.args]
      args[0] = str(guid(unstr(args[0]), 31, 17))
      args[2] = str(`${9000 + n++}`)
      args[7] = str('공간'.split('').map((c) => `\\X2\\${c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')}\\X0\\`).join(''))
      out.push(line(id, 'IFCSPACE', args))
      dupsByStorey.set(storey, [...(dupsByStorey.get(storey) ?? []), id])
      stats.spaces++
    }
    let r = 0
    const owner = parsed.find((e) => e.type === 'IFCOWNERHISTORY')?.id
    for (const [storey, ids] of dupsByStorey) {
      out.push(line(next++, 'IFCRELAGGREGATES', [str(guid('0SynthSpaceCopyRel0000', 0, r++)), owner ? `#${owner}` : '$', '$', '$', `#${storey}`, `(${ids.map((i) => `#${i}`).join(',')})`]))
    }
  }
  return { lines: out, next, maxId, stats, head: file.head, tail: file.tail, unit: file.unit }
}

// --- TC 가 대응하는 상황 심기 ------------------------------------------------------------
//
// 복사본(층 묶음)마다 하나씩 성수·다른 BIM 에서 본 버릇을 심는다. 원래 건물(복사본 0)은 그대로 둔다 — 깨끗한 대조군이다.
// 어느 복사본에 무엇을 심었는지는 scripts/tc-coverage.test.ts 가 상황마다 세어 표로 낸다.

/** 한글을 STEP 문자열로(\X2\ 16비트). */
const enc = (s) => s.replace(/[^\x20-\x7e]+/g, (run) => `\\X2\\${[...run].map((c) => c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0')).join('')}\\X0\\`)

/** 줄 배열을 다루는 도구. 복사본 k 의 id 는 원래 id + maxId×k 다. */
function editor(t) {
  const index = new Map()
  t.lines.forEach((l, i) => {
    const m = /^#(\d+)=/.exec(l)
    if (m) index.set(Number(m[1]), i)
  })
  const get = (id) => (index.has(id) ? parse(t.lines[index.get(id)]) : null)
  const set = (e) => (t.lines[index.get(e.id)] = line(e.id, e.type, e.args))
  const add = (type, args) => {
    const id = t.next++
    index.set(id, t.lines.length)
    t.lines.push(line(id, type, args))
    return id
  }
  const copyOf = (id) => Math.floor((id - 1) / t.maxId)
  const each = (k, type, fn) => {
    for (let i = 0; i < t.lines.length; i++) {
      const e = parse(t.lines[i])
      if (!e || e.type !== type || copyOf(e.id) !== k) continue
      if (fn(e) !== false) t.lines[i] = line(e.id, e.type, e.args)
    }
  }
  const drop = (k, types) => {
    t.lines = t.lines.filter((l) => {
      const m = /^#(\d+)=\s*([A-Z0-9_]+)\(/.exec(l)
      return !(m && types.has(m[2]) && copyOf(Number(m[1])) === k)
    })
    index.clear()
    t.lines.forEach((l, i) => {
      const m = /^#(\d+)=/.exec(l)
      if (m) index.set(Number(m[1]), i)
    })
  }
  return { get, set, add, each, drop, copyOf }
}
const refs = (a) => (a.match(/#\d+/g) ?? []).map((r) => Number(r.slice(1)))

function seedArch(t) {
  const ed = editor(t)
  const done = []
  // 복사본 1: IsExternal·LoadBearing 이 없다 → 외벽은 계산으로, 내력은 모름(ArchiCAD 처럼).
  ed.each(1, 'IFCPROPERTYSINGLEVALUE', (e) => {
    const n = unstr(e.args[0])
    if (n !== 'IsExternal' && n !== 'LoadBearing') return false
    e.args[0] = str(`${n}_없앰`)
  })
  done.push('복사본 2: IsExternal·LoadBearing 없음')
  // 복사본 2: 내력벽(LoadBearing 참) · 재료 층이 없는 벽(두께 모름).
  ed.each(2, 'IFCPROPERTYSINGLEVALUE', (e) => {
    if (unstr(e.args[0]) !== 'LoadBearing') return false
    e.args[2] = 'IFCBOOLEAN(.T.)'
  })
  ed.drop(2, new Set(['IFCRELASSOCIATESMATERIAL']))
  done.push('복사본 3: 내력벽 · 재료 없는 벽')
  // 복사본 3: 층 높이를 BIM 이 적는다(BaseQuantities.GrossHeight). 아래 층은 계산과 0.3m 어긋나게.
  const storeys = []
  ed.each(3, 'IFCBUILDINGSTOREY', (e) => {
    storeys.push({ id: e.id, z: Number(e.args[9]) })
    return false
  })
  storeys.sort((a, b) => a.z - b.z)
  storeys.forEach((s, i) => {
    const above = storeys[i + 1]
    if (!above) return
    const h = above.z - s.z + (i === 1 ? 0.3 * t.unit : 0)
    const q = ed.add('IFCQUANTITYLENGTH', [str('GrossHeight'), '$', '$', `${h.toFixed(3)}`])
    const set = ed.add('IFCELEMENTQUANTITY', [str(guid('0SynthQtoStorey0000000', 3, i)), '$', str('BaseQuantities'), '$', '$', `(#${q})`])
    ed.add('IFCRELDEFINESBYPROPERTIES', [str(guid('0SynthQtoStoreyRel0000', 3, i)), '$', '$', '$', `(#${s.id})`, `#${set}`])
  })
  done.push('복사본 4: 층 높이(BaseQuantities) — 한 층은 계산과 0.3m 어긋남')
  // 복사본 4: 방 열에 하나는 이름(LongName)이 없고, 기초 층은 이름이 없다.
  let n = 0
  ed.each(4, 'IFCSPACE', (e) => {
    if (n++ % 10) return false
    e.args[7] = '$'
  })
  ed.each(4, 'IFCBUILDINGSTOREY', (e) => {
    if (!/TOF Footing/.test(unstr(e.args[2]) ?? '')) return false
    e.args[2] = str('')
    e.args[7] = '$'
  })
  done.push('복사본 5: 이름 없는 방 · 이름 없는 층')
  return done
}

function seedMech(t) {
  const ed = editor(t)
  const done = []
  // 복사본 2: System Name 속성이 없다 → 말단이 계통 없이 남는다.
  ed.each(2, 'IFCPROPERTYSINGLEVALUE', (e) => {
    if (unstr(e.args[0]) !== 'System Name') return false
    e.args[0] = str('System Name_없앰')
  })
  done.push('복사본 3: 계통(System Name) 없음')
  // 복사본 3: 말단 15대의 형상이 배치점에서 5m 떨어져 있다(배치점이 층 원점에 찍힌 성수 버릇과 같은 결과).
  let moved = 0
  // 홀수 복사본은 말단이 Proxy 로 바뀌어 있다.
  ed.each(3, 'IFCBUILDINGELEMENTPROXY', (e) => {
    if (moved >= 15) return false
    const shape = ed.get(refs(e.args[6])[0] ?? -1)
    for (const rep of refs(shape?.args[2] ?? '')) {
      for (const item of refs(ed.get(rep)?.args[3] ?? '')) {
        const mapped = ed.get(item)
        if (mapped?.type !== 'IFCMAPPEDITEM') continue
        const pt = ed.add('IFCCARTESIANPOINT', [`(${5 * t.unit}.,0.,0.)`])
        const op = ed.add('IFCCARTESIANTRANSFORMATIONOPERATOR3D', ['$', '$', `#${pt}`, '1.', '$'])
        mapped.args[1] = `#${op}`
        ed.set(mapped)
      }
    }
    moved++
    return false
  })
  done.push(`복사본 4: 형상이 배치점에서 떨어진 말단 ${moved}대`)
  // 복사본 4: 포트에 방향이 없다(SOURCEANDSINK) → 규칙이 방향을 정한다.
  ed.each(4, 'IFCDISTRIBUTIONPORT', (e) => {
    e.args[7] = '.SOURCEANDSINK.'
  })
  done.push('복사본 5: 포트 방향 없음')
  // 복사본 1: 이름으로만 아는 기기를 Proxy 로 더한다(포트 없음) — 분전반·외기 센서·엘리베이터·FCU, 좌표 없는 것, 종류 모르는 것.
  const storeyOf = new Map()
  for (const l of t.lines) {
    if (!l.includes('IFCRELCONTAINEDINSPATIALSTRUCTURE')) continue
    const e = parse(l)
    for (const r of refs(e.args[4])) storeyOf.set(r, Number(e.args[5].slice(1)))
  }
  const hosts = []
  ed.each(2, 'IFCFLOWTERMINAL', (e) => {
    if (hosts.length < 8 && storeyOf.has(e.id)) hosts.push(e)
    return false
  })
  const owner = refs(hosts[0].args[1])[0]
  const named = [
    ['IFCBUILDINGELEMENTPROXY', 'M_Lighting and Appliance Panelboard - 208V MLO:225 A:9000001', true],
    ['IFCBUILDINGELEMENTPROXY', '외기 온도 센서 OA-1', true],
    ['IFCBUILDINGELEMENTPROXY', '외기 습도 센서 OA-2', true],
    ['IFCBUILDINGELEMENTPROXY', 'M_Elevator-Hydraulic:2000 lbs:9000002', true],
    ['IFCBUILDINGELEMENTPROXY', 'FCU-301', true],
    ['IFCBUILDINGELEMENTPROXY', 'FCU-302', false],
    ['IFCFLOWTERMINAL', 'Widget-77:Type:9000003', true],
  ]
  const byStorey = new Map()
  named.forEach(([type, name, placed], i) => {
    const host = hosts[i]
    const args = [str(guid('0SynthNamedDevice00000', 1, i)), `#${owner}`, str(enc(name)), '$', '$', placed ? host.args[5] : '$', '$', '$']
    if (type === 'IFCBUILDINGELEMENTPROXY') args.push('$')
    const id = ed.add(type, args)
    const s = storeyOf.get(host.id)
    byStorey.set(s, [...(byStorey.get(s) ?? []), id])
  })
  let r = 0
  for (const [s, ids] of byStorey) ed.add('IFCRELCONTAINEDINSPATIALSTRUCTURE', [str(guid('0SynthNamedDeviceRel00', 1, r++)), `#${owner}`, '$', '$', `(${ids.map((i) => `#${i}`).join(',')})`, `#${s}`])
  done.push('복사본 3: 이름으로만 아는 기기 7대(분전반·외기 센서 둘·엘리베이터·FCU·좌표 없는 FCU·종류 모르는 말단)')
  return done
}

/** 같은 파일의 판본들. 원래 줄을 고치지 않고 새 줄 배열을 돌려준다. */
const variants = {
  // 같은 Revit 으로 다시 낸 판본 — GUID 가 전부 바뀌고 이름·요소 ID 는 같다.
  next: (lines) => lines.map((l) => {
    const e = parse(l)
    const g = e && unstr(e.args[0] ?? '')
    if (!g || g.length !== 22) return l
    e.args[0] = str(guid(g, 9, 3))
    return line(e.id, e.type, e.args)
  }),
  // 길이 단위를 미터로 잘못 선언한 판본 — 값은 mm 그대로라 1000배로 들어온다.
  unit: (lines) => lines.map((l) => l.replace('IFCSIUNIT(*,.LENGTHUNIT.,.MILLI.,.METRE.)', 'IFCSIUNIT(*,.LENGTHUNIT.,$,.METRE.)')),
  // 포트가 없는 판본 — 연결을 형상으로 추정한다.
  noports: (lines) => lines.filter((l) => !/^#\d+=\s*IFC(RELCONNECTSPORTS|RELCONNECTSPORTTOELEMENT|DISTRIBUTIONPORT)\(/.test(l)),
  // 대지 원점이 300m 어긋난 판본 — 건축과 좌표계가 안 맞는다.
  shifted: (lines, unit) => {
    // 모든 배치가 기대는 뿌리 배치(대지, 그리고 대지에 안 기대는 건물)의 원점을 (300m, 300m) 로 옮긴다.
    const out = [...lines]
    const at = new Map(out.map((l, i) => [Number(/^#(\d+)=/.exec(l)?.[1]), i]))
    let next = [...at.keys()].filter(Number.isFinite).reduce((m, v) => Math.max(m, v), 0)
    const moveRoot = (placementId) => {
      const i = at.get(placementId)
      const p = parse(out[i])
      const pt = ++next, axis = ++next
      out.push(line(pt, 'IFCCARTESIANPOINT', [`(${300 * unit}.,${300 * unit}.,0.)`]), line(axis, 'IFCAXIS2PLACEMENT3D', [`#${pt}`, '$', '$']))
      p.args[1] = `#${axis}`
      out[i] = line(p.id, p.type, p.args)
    }
    // 배치 사슬의 뿌리(PlacementRelTo 가 없는 IfcLocalPlacement)를 전부 옮긴다 — Revit 은 대지·건물을 거치지 않는 배치도 쓴다.
    const roots = out.map(parse).filter((e) => e?.type === 'IFCLOCALPLACEMENT' && e.args[0] === '$').map((e) => e.id)
    for (const r of roots) moveRoot(r)
    return out
  },
  // 깨끗하게 낸 판본 — 방마다 분류 관계(OmniClass), 모든 기기·덕트·배관이 IfcSystem 에, 용량은 표준 Pset 이름으로.
  // 요구사항 줄의 "표준" 을 재는 데 쓴다(병원은 이 셋을 다 Revit 속성으로 적었다).
  clean: (lines, kind) => {
    const out = [...lines]
    let next = 0
    for (const l of out) {
      const m = /^#(\d+)=/.exec(l)
      if (m && Number(m[1]) > next) next = Number(m[1])
    }
    const owner = out.map(parse).find((e) => e?.type === 'IFCOWNERHISTORY')?.id
    const own = owner ? `#${owner}` : '$'
    const ids = (types) => out.map(parse).filter((e) => e && types.has(e.type)).map((e) => e.id)
    const list = (xs) => `(${xs.map((x) => `#${x}`).join(',')})`
    const spaces = ids(new Set(['IFCSPACE']))
    if (spaces.length) {
      const ref = ++next
      out.push(line(ref, 'IFCCLASSIFICATIONREFERENCE', ['$', str('13-11 21 00'), str('Office'), '$']))
      out.push(line(++next, 'IFCRELASSOCIATESCLASSIFICATION', [str(guid('0SynthOmniClassRel0000', 0, 1)), own, '$', '$', list(spaces), `#${ref}`]))
    }
    // 기계: System Name 속성 값마다 IfcSystem 하나, 값이 없는 것은 "기타 계통".
    const parsed = out.map(parse)
    const byId = new Map(parsed.filter(Boolean).map((e) => [e.id, e]))
    const systemName = new Map()
    for (const e of parsed) {
      if (e?.type !== 'IFCRELDEFINESBYPROPERTIES') continue
      const pset = byId.get(Number(e.args[5].slice(1)))
      if (pset?.type !== 'IFCPROPERTYSET') continue
      for (const pr of refs(pset.args[4])) {
        const prop = byId.get(pr)
        if (prop?.type !== 'IFCPROPERTYSINGLEVALUE' || unstr(prop.args[0]) !== 'System Name') continue
        const v = /'(.*)'/.exec(prop.args[2])?.[1]
        if (v) for (const o of refs(e.args[4])) systemName.set(o, v)
      }
    }
    const elements = ids(new Set(['IFCFLOWSEGMENT', 'IFCFLOWFITTING', 'IFCFLOWTERMINAL', 'IFCFLOWCONTROLLER', 'IFCFLOWMOVINGDEVICE', 'IFCENERGYCONVERSIONDEVICE', 'IFCBUILDINGELEMENTPROXY', 'IFCFURNISHINGELEMENT', 'IFCDISTRIBUTIONCONTROLELEMENT', 'IFCFLOWSTORAGEDEVICE', 'IFCFLOWTREATMENTDEVICE']))
    const groups = new Map()
    for (const id of elements) {
      const name = systemName.get(id) ?? '기타 계통'
      groups.set(name, [...(groups.get(name) ?? []), id])
    }
    let g = 0
    for (const [name, members] of groups) {
      const sys = ++next
      out.push(line(sys, 'IFCSYSTEM', [str(guid('0SynthSystem0000000000', 0, g)), own, str(enc(name)), '$', '$']))
      out.push(line(++next, 'IFCRELASSIGNSTOGROUP', [str(guid('0SynthSystemRel0000000', 0, g++)), own, '$', '$', list(members), '$', `#${sys}`]))
    }
    // 용량: 말단·변환·이송 기기와 Proxy 에 표준 이름(AirFlowRate · Pset_AirTerminalOccurrence).
    const devices = ids(new Set(['IFCFLOWTERMINAL', 'IFCFLOWCONTROLLER', 'IFCFLOWMOVINGDEVICE', 'IFCENERGYCONVERSIONDEVICE', 'IFCBUILDINGELEMENTPROXY']))
    const prop = ++next
    out.push(line(prop, 'IFCPROPERTYSINGLEVALUE', [str('AirFlowRate'), '$', 'IFCVOLUMETRICFLOWRATEMEASURE(0.1)', '$']))
    const pset = ++next
    out.push(line(pset, 'IFCPROPERTYSET', [str(guid('0SynthCapacityPset0000', 0, 1)), own, str('Pset_AirTerminalOccurrence'), '$', `(#${prop})`]))
    out.push(line(++next, 'IFCRELDEFINESBYPROPERTIES', [str(guid('0SynthCapacityRel00000', 0, 1)), own, '$', '$', list(devices), `#${pset}`]))
    return out
  },
}

mkdirSync(OUT, { recursive: true })
const arch = read(ARCH)
const mech = read(MECH)
const levels = [...storeyLevels(arch), ...storeyLevels(mech)]
const step = Math.ceil((Math.max(...levels) - Math.min(...levels)) * 1.2 + 3)
const a = tower(arch, { copies: COPIES, step, proxy: false, spaceCopies: true })
const m = tower(mech, { copies: COPIES, step, proxy: true, spaceCopies: false })
const seeded = [...seedArch(a).map((s) => `건축 ${s}`), ...seedMech(m).map((s) => `기계 ${s}`)]
const write = (name, t, lines) => writeFileSync(join(OUT, name), `${t.head}\n${lines.join('\n')}\n${t.tail}`, 'latin1')
write('건축.ifc', a, a.lines)
write('기계.ifc', m, m.lines)
write('기계-다음판.ifc', m, variants.next(m.lines))
write('기계-단위틀림.ifc', m, variants.unit(m.lines))
write('기계-포트없음.ifc', m, variants.noports(m.lines))
write('기계-어긋남.ifc', m, variants.shifted(m.lines, m.unit))
write('건축-표준.ifc', a, variants.clean(a.lines, 'arch'))
write('기계-표준.ifc', m, variants.clean(m.lines, 'mech'))
// 구문이 깨진 파일(받는 쪽이 못 여는 것) — 앞 2,000 줄에 닫히지 않은 줄 하나.
writeFileSync(join(OUT, '건축-깨짐.ifc'), `${a.head}\n${a.lines.slice(0, 2000).join('\n')}\n#99999999=IFCWALL('0Broken',$,'unterminated\n${a.tail}`, 'latin1')
console.log(`${COPIES}벌, 층 간격 ${step}m · 건축 공간 사본 ${a.stats.spaces} · 기계 Proxy ${m.stats.proxies} → ${OUT}`)
for (const s of seeded) console.log(`  ${s}`)
