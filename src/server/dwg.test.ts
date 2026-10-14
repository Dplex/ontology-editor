import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { dwgConverter } from './dwg'

// 평면도 배경의 DWG 받기(OE-MAN-02, src/server/dwg.ts). 실제 LibreDWG·ezdxf 로 mm 단위 평면도 DWG 를 PNG 로 바꿔, 그림 크기·도면 범위·단위가 맞는지 잰다.
// 변환기가 없는 PC 에서는 까닭을 찍고 건너뛴다(DWG_PYTHON = ezdxf·matplotlib 이 든 파이썬, DWG2DXF = LibreDWG 의 dwg2dxf).
const PYTHON = process.env.DWG_PYTHON ?? 'python3'
const SCRIPT = resolve('scripts/dwg2png.py')
const have = spawnSync(PYTHON, [SCRIPT, '--probe']).status === 0
if (!have) console.log(`!! DWG 변환기가 없어 DWG 시험을 건너뜁니다 — DWG_PYTHON(ezdxf·matplotlib)과 DWG2DXF(LibreDWG)를 줍니다. 까는 법은 docs/dev/deploy55.md`)
// plan-mm.dwg: mm 단위, 사무실 0..10000 × 0..8000 과 창고 10200..14000 × 0..8000 의 외곽선, 가운데 선, 원, 글자.
const PLAN = readFileSync(resolve('e2e/fixtures/plan-mm.dwg'))

describe.skipIf(!have)('DWG 받기 — LibreDWG + ezdxf', () => {
  let server: Server
  let url: string
  beforeAll(async () => {
    const handle = dwgConverter({ python: PYTHON, script: SCRIPT })
    server = createServer((req, res) => handle(req, res))
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()))
    const a = server.address()
    url = `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}/`
  })
  afterAll(() => new Promise<void>((r) => server.close(() => r())))

  it('쓸 수 있는지 알려 준다', async () => {
    const p = (await (await fetch(url)).json()) as { enabled: boolean; ezdxf?: string; libredwg?: string }
    expect(p.enabled).toBe(true)
    expect(p.ezdxf).toMatch(/^\d+\.\d+/)
    expect(p.libredwg).toMatch(/dwg2dxf/)
  })

  it('DWG 를 PNG 로 바꾸고, 그림이 덮는 도면 범위(외곽선 + 5% 여백)와 단위(mm)를 머리에 준다 [OE-MAN-02#1~]', async () => {
    const r = await fetch(url, { method: 'POST', body: PLAN })
    expect(r.status).toBe(200)
    expect(r.headers.get('content-type')).toBe('image/png')
    const png = Buffer.from(await r.arrayBuffer())
    expect(png.subarray(1, 4).toString('latin1')).toBe('PNG')
    const stats = JSON.parse(r.headers.get('x-dwg2png')!) as { width: number; height: number; extents: number[]; unit: string; metersPerUnit: number }
    // PNG 머리의 가로·세로가 머리값과 같다.
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([stats.width, stats.height])
    expect(stats.width).toBe(4096)
    expect(stats.extents.map((v) => Math.round(v))).toEqual([-700, -400, 14700, 8400])
    expect([stats.unit, stats.metersPerUnit]).toEqual(['mm', 0.001])
  }, 120_000)

  it('DWG 가 아니면 바꾸지 않고, 빈 몸통도 받지 않는다', async () => {
    const bad = await fetch(url, { method: 'POST', body: 'not a dwg file' })
    expect([bad.status, ((await bad.json()) as { error: string }).error]).toEqual([400, 'DWG 가 아닙니다(파일 머리에 AC10xx 버전이 없습니다)'])
    const empty = await fetch(url, { method: 'POST', body: '' })
    expect(empty.status).toBe(400)
  })
})
