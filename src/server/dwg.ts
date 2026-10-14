// 평면도 배경의 DWG 받기(OE-MAN-02). 화면이 보낸 DWG 를 LibreDWG(dwg2dxf)와 ezdxf(scripts/dwg2png.py)로 PNG 로 바꿔 돌려준다.
// PNG·JPG·PDF 는 브라우저가 바로 그리지만 DWG 는 브라우저에서 읽을 길이 없어, 변환기가 있는 서버에서 바꾼다(FBX 와 같은 방식, fbx.ts).
//
// 경로(`/__data` 아래 `/__dwg`):
//   GET              { enabled, reason?, ezdxf?, libredwg? } — 이 서버에서 바꿀 수 있는지. 없으면 화면이 DWG 를 받지 않고 까닭을 보인다
//   POST  몸통 DWG   PNG 바이트. `X-Dwg2png` 머리에 { width, height, extents, unit, metersPerUnit } — 그림이 덮는 도면 좌표 범위와 단위다
//
// 파이썬은 `DWG_PYTHON`(ezdxf·matplotlib 이 든 venv 의 python), dwg2dxf 는 `DWG2DXF` 환경변수다. 55 에 까는 법은 docs/dev/deploy55.md.
// 파일은 OS 임시 폴더에 두고 답한 뒤 지운다 — data/ 에 남기지 않는다.
import { createReadStream, createWriteStream, mkdtempSync, openSync, readSync, closeSync, rmSync, statSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { json, run } from './fbx'

/** 받는 DWG 의 상한. 준공 도면 한 장은 수 MB 다. */
const MAX_BYTES = 200 * 1024 * 1024
/** 변환 하나의 상한. */
const TIMEOUT_MS = 5 * 60 * 1000

export type DwgOptions = {
  /** ezdxf·matplotlib 이 든 파이썬. */
  python?: string
  /** 변환 스크립트. */
  script?: string
}

type Probe = { enabled: true; ezdxf: string; libredwg: string } | { enabled: false; reason: string }

/** DWG 파일 머리는 버전 문자열 `AC10xx` 다(AC1015 = 2000, AC1032 = 2018). */
function isDwg(file: string): boolean {
  const fd = openSync(file, 'r')
  try {
    const head = Buffer.alloc(6)
    return readSync(fd, head, 0, 6, 0) === 6 && /^AC10\d\d$/.test(head.toString('latin1'))
  } finally {
    closeSync(fd)
  }
}

export function dwgConverter(options: DwgOptions = {}) {
  const python = options.python ?? process.env.DWG_PYTHON ?? 'python3'
  const script = options.script ?? resolve('scripts/dwg2png.py')
  let probed: Promise<Probe> | null = null
  /** 처음 물을 때 한 번 잰다. 변환기를 깔았으면 서버를 다시 띄운다. */
  const probe = () =>
    (probed ??= run(python, [script, '--probe'], 60_000).then((r): Probe => {
      const found = /DWG2PNG-PROBE (\{.*\})/.exec(r.out)?.[1]
      if (r.code === 0 && found) return { enabled: true, ...(JSON.parse(found) as { ezdxf: string; libredwg: string }) }
      const why = /DWG2PNG-ERROR (.*)/.exec(r.out)?.[1] ?? r.error ?? `${python} 를 실행하지 못했습니다`
      return { enabled: false, reason: `이 서버에서 DWG 를 바꿀 수 없습니다: ${why}` }
    }))
  /** 앞 변환이 끝나야 다음 변환을 시작한다. */
  let queue: Promise<unknown> = Promise.resolve()

  async function convert(dir: string, res: ServerResponse) {
    const p = await probe()
    if (!p.enabled) return json(res, 503, { error: p.reason })
    const input = join(dir, 'in.dwg')
    const output = join(dir, 'out.png')
    if (!isDwg(input)) return json(res, 400, { error: 'DWG 가 아닙니다(파일 머리에 AC10xx 버전이 없습니다)' })
    const r = await run(python, [script, input, output], TIMEOUT_MS)
    if (r.code !== 0) {
      const why = /DWG2PNG-ERROR (.*)/.exec(r.out)?.[1] ?? r.error ?? r.out.trim().split('\n').slice(-3).join(' ')
      return json(res, 422, { error: `DWG 를 그림으로 바꾸지 못했습니다: ${why}` })
    }
    const stats = /DWG2PNG (\{.*\})/.exec(r.out)?.[1]
    res.statusCode = 200
    res.setHeader('Content-Type', 'image/png')
    res.setHeader('Content-Length', statSync(output).size)
    if (stats) res.setHeader('X-Dwg2png', stats)
    await new Promise<void>((done) => createReadStream(output).on('close', done).on('error', () => done()).pipe(res))
  }

  return function handle(req: IncomingMessage, res: ServerResponse) {
    if (req.method === 'GET') {
      void probe().then((p) => json(res, 200, p))
      return
    }
    if (req.method !== 'POST') return json(res, 405, { error: `${req.method} 은 받지 않습니다` })
    const dir = mkdtempSync(join(tmpdir(), 'oe-dwg-'))
    const cleanup = () => rmSync(dir, { recursive: true, force: true })
    let size = 0
    const out = createWriteStream(join(dir, 'in.dwg'))
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > MAX_BYTES) {
        req.unpipe(out)
        req.destroy()
        out.destroy()
        cleanup()
        if (!res.writableEnded) json(res, 413, { error: 'DWG 가 너무 큽니다(200MB 까지)' })
      }
    })
    req.pipe(out)
    out.on('close', () => {
      if (res.writableEnded) return cleanup()
      if (!size) {
        cleanup()
        return json(res, 400, { error: 'DWG 가 비었습니다' })
      }
      const job = queue.then(() => convert(dir, res)).catch((e) => {
        if (!res.writableEnded) json(res, 500, { error: e instanceof Error ? e.message : String(e) })
      })
      queue = job.finally(cleanup)
    })
  }
}
