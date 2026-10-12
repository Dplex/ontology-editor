import { existsSync, mkdtempSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { layouts, type VersionMeta } from './layouts'

// 반영한 레이아웃·버전(OE-WF-10~13·18~20, OE-GEN-05, OE-SYNC-02). 실제 HTTP 로 잰다 — 올리기·반영·되돌리기·1주 보관이 화면이 기대하는 그대로인지.

let root: string
let server: Server
let base: string
/** 시계. 1주 보관을 재려고 바꾼다. */
let clock = new Date('2026-10-09T10:00:00Z')

const url = (q: Record<string, string>) => `${base}/__layouts?${new URLSearchParams(q)}`
const KEY = 'a.ifc'
let stages = 0
/** 한 판을 올리고 반영한다. `skip` 의 파일은 올리지 않는다. */
async function publish(by: string, ttl: string, skip: string[] = []) {
  const stage = `stage${String(++stages).padStart(4, '0')}`
  const files: Record<string, string> = {
    'ontology.ttl': ttl,
    'edits.json': '{}',
    'tree.json': '{"storeys":[]}',
    'geojson/1F.geojson': '{"type":"FeatureCollection","features":[]}',
  }
  for (const [file, body] of Object.entries(files)) {
    if (skip.includes(file)) continue
    const r = await fetch(url({ key: KEY, stage, file }), { method: 'PUT', body })
    expect(r.status).toBe(200)
  }
  return fetch(url({ key: KEY, stage, publish: '' }), { method: 'POST', body: JSON.stringify({ by, floors: ['1F'], summary: { changes: 3 } }) })
}
const list = async () => (await (await fetch(url({ key: KEY }))).json()) as { current: number | null; versions: VersionMeta[] }

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'layouts-'))
  writeFileSync(join(root, 'a.ifc'), 'ISO-10303-21;')
  const handle = layouts(root, { now: () => clock })
  server = createServer((req, res) => {
    const [path, query] = (req.url ?? '').split('?')
    if (path === '/__layouts') handle(req, res, query ?? '')
    else res.writeHead(404).end()
  })
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const addr = server.address()
  base = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}`
})
afterAll(() => {
  server.close()
  rmSync(root, { recursive: true, force: true })
})

describe('반영한 레이아웃과 버전', () => {
  it('첫 반영이 v1 이고, 반영자·일시·대상 층·변경 요약·파일이 버전에 붙으며, 파일을 그 버전에서 받는다 [OE-GEN-05#1] [OE-WF-13#1~]', async () => {
    expect(await list()).toEqual({ current: null, versions: [] })
    const r = await publish('정희록', '# v1')
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({
      version: 1,
      at: '2026-10-09T10:00:00.000Z',
      by: '정희록',
      floors: ['1F'],
      summary: { changes: 3 },
      kind: 'publish',
      files: ['edits.json', 'geojson/1F.geojson', 'ontology.ttl', 'tree.json'],
    })
    expect(await (await fetch(url({ key: KEY, v: '1', file: 'ontology.ttl' }))).text()).toBe('# v1')
    // 건물 목록에 현재 버전이 보인다(모드 자동 분기가 이것을 읽는다).
    expect(await (await fetch(`${base}/__layouts`)).json()).toEqual([{ key: KEY, paths: [KEY], current: 1, at: '2026-10-09T10:00:00.000Z', by: '정희록' }])
  })

  it('빠진 파일이 있으면 반영하지 않고 지금 버전은 그대로다 — 반만 반영된 버전을 만들지 않는다 [OE-SYNC-02#1] [OE-WF-10#1]', async () => {
    const before = await list()
    const r = await publish('정희록', '# 반쪽', ['geojson/1F.geojson'])
    expect(r.status).toBe(400)
    expect((await r.json()).error).toBe('반영하지 않았습니다 — 빠진 파일: geojson/*.geojson. 지금 반영된 버전은 그대로입니다.')
    expect(await list()).toEqual(before)
    // 반영자 없이도 반영하지 않는다.
    expect((await fetch(url({ key: KEY, stage: 'stage9999', publish: '' }), { method: 'POST', body: '{}' })).status).toBe(400)
  })

  it('되돌리기는 옛 버전을 새 버전으로 다시 반영하고 이력은 남는다 [OE-WF-19#1] [OE-WF-10#2] [OE-WF-18#1~]', async () => {
    clock = new Date('2026-10-10T10:00:00Z')
    expect((await publish('김민주', '# v2')).status).toBe(200)
    const r = await fetch(url({ key: KEY, rollback: '1' }), { method: 'POST', body: JSON.stringify({ by: '김민주' }) })
    expect(r.status).toBe(200)
    expect(await r.json()).toMatchObject({ version: 3, kind: 'rollback', from: 1, by: '김민주', floors: ['1F'] })
    const now = await list()
    expect(now.current).toBe(3)
    expect(now.versions.map((v) => [v.version, v.kind])).toEqual([
      [3, 'rollback'],
      [2, 'publish'],
      [1, 'publish'],
    ])
    expect(await (await fetch(url({ key: KEY, v: '3', file: 'ontology.ttl' }))).text()).toBe('# v1')
    // 지금 버전으로는 되돌리지 않는다.
    expect((await fetch(url({ key: KEY, rollback: '3' }), { method: 'POST', body: JSON.stringify({ by: '김민주' }) })).status).toBe(400)
  })

  it('1주일이 지난 버전은 히스토리에서 빠지고 되돌릴 수 없지만 파일은 남는다. 지금 버전은 오래돼도 보인다 [OE-WF-20#1]', async () => {
    clock = new Date('2026-10-16T11:00:00Z')
    const now = await list()
    // v1(10-09)·v2·v3(10-10) 중 v1 만 7일이 넘었다. v3 은 지금 버전이라 보인다.
    expect(now.versions.map((v) => v.version)).toEqual([3, 2])
    const r = await fetch(url({ key: KEY, rollback: '1' }), { method: 'POST', body: JSON.stringify({ by: '정희록' }) })
    expect((await r.json()).error).toBe('v1 은 7일이 지나 되돌릴 수 없습니다')
    clock = new Date('2026-10-30T00:00:00Z')
    expect((await list()).versions.map((v) => v.version)).toEqual([3])
    const dir = join(root, '.layouts', readdirSync(join(root, '.layouts'))[0])
    expect(['v1', 'v2', 'v3'].every((v) => existsSync(join(dir, v)))).toBe(true)
  })

  it('data/ 에 없는 열쇠·위로 올라가는 파일 이름은 받지 않는다', async () => {
    expect((await fetch(url({ key: 'nope.ifc' }))).status).toBe(404)
    expect((await fetch(url({ key: KEY, stage: 'stage0001', file: '../x.ttl' }), { method: 'PUT', body: 'x' })).status).toBe(400)
    expect((await fetch(url({ key: KEY, stage: 'stage0001', file: 'geojson/../../x.geojson' }), { method: 'PUT', body: 'x' })).status).toBe(400)
    expect((await fetch(url({ key: KEY, v: '1', file: '../key.json' }))).status).toBe(404)
  })
})

describe('Windows 에서 폴더 옮기기가 잠깐 막힐 때', () => {
  it('판 폴더째 옮기기가 잠기면(하위 폴더를 누가 감시) 안의 것을 하나씩 옮겨 v1 이 되고, 다른 실패는 번호 탓으로 돌리지 않고 이유를 말한다', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'layouts-busy-'))
    writeFileSync(join(dir, 'b.ifc'), 'ISO-10303-21;')
    // geojson/ 을 dev 서버의 파일 감시가 잡고 있다 — Windows 에서는 판 폴더째 옮기기만 EPERM 이고 안의 것은 옮겨진다.
    let fail: string | null = null
    const moved: string[] = []
    const handle = layouts(dir, {
      rename: (from, to) => {
        if (fail) throw Object.assign(new Error(fail), { code: fail })
        if (basename(from).startsWith('.stage-')) throw Object.assign(new Error('busy'), { code: 'EPERM' })
        moved.push(basename(from))
        renameSync(from, to)
      },
    })
    const srv = createServer((req, res) => {
      const [path, query] = (req.url ?? '').split('?')
      if (path === '/__layouts') handle(req, res, query ?? '')
      else res.writeHead(404).end()
    })
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r))
    const addr = srv.address()
    const at = `http://127.0.0.1:${typeof addr === 'object' && addr ? addr.port : 0}/__layouts`
    const put = async (stage: string) => {
      for (const [file, body] of Object.entries({ 'ontology.ttl': '#', 'edits.json': '{}', 'tree.json': '{}', 'geojson/1F.geojson': '{}' }))
        expect((await fetch(`${at}?${new URLSearchParams({ key: 'b.ifc', stage, file })}`, { method: 'PUT', body })).status).toBe(200)
      return fetch(`${at}?${new URLSearchParams({ key: 'b.ifc', stage, publish: '' })}`, { method: 'POST', body: JSON.stringify({ by: '편집자' }) })
    }
    try {
      const ok = await put('stagebusy01')
      expect(ok.status).toBe(200)
      expect((await ok.json()).version).toBe(1)
      // meta.json 이 맨 끝이다 — 도중에 멈추면 버전으로 세지 않는다. 판 폴더는 남지 않는다.
      expect(moved.at(-1)).toBe('meta.json')
      expect(readdirSync(join(dir, '.layouts', readdirSync(join(dir, '.layouts'))[0])).sort()).toEqual(['current.json', 'key.json', 'v1'])
      fail = 'ENOSPC'
      const bad = await put('stagebusy02')
      expect(bad.status).toBe(500)
      expect((await bad.json()).error).toBe('올린 파일을 버전 폴더로 옮기지 못했습니다(ENOSPC)')
    } finally {
      srv.close()
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
