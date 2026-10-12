// 3D 형상 FBX 내보내기(OE-INT-03, ADR-0052). 화면이 만든 GLB 를 받아 Blender(scripts/glb2fbx.py)로 FBX 로 바꿔 돌려준다.
// GLB·OBJ 는 브라우저가 만들지만 FBX 는 three 에 내보내기가 없고 형식 문서도 없어, 검증된 작성기(Blender)가 있는 서버에서 바꾼다.
//
// 경로(`/__data` 아래 `/__fbx`):
//   GET              { enabled, reason?, version? } — 이 서버에 Blender 가 있는지. 없으면 화면이 FBX 단추를 막고 까닭을 보인다
//   POST  몸통 GLB   FBX 바이트. 한 번에 하나씩 바꾼다(성수가 46초·메모리 4GB 라 둘이 겹치면 서버가 버겁다)
//
// Blender 는 `BLENDER` 환경변수의 경로, 없으면 PATH 의 `blender` 다. 파일은 OS 임시 폴더에 두고 답한 뒤 지운다 — data/ 에 남기지 않는다.
import { spawn } from 'node:child_process'
import { createReadStream, createWriteStream, mkdtempSync, openSync, readSync, closeSync, rmSync, statSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

/** 받는 GLB 의 상한. 반영에 올리는 GLB 와 같다(layouts.ts). 성수가 333MB 다. */
const MAX_BYTES = 1024 * 1024 * 1024
/** 변환 하나의 상한. 이 PC 에서 성수가 46초다. 55 가 느려도 넉넉하게. */
const TIMEOUT_MS = 15 * 60 * 1000

export type FbxOptions = {
  /** Blender 실행 파일. */
  blender?: string
  /** 변환 스크립트. */
  script?: string
}

type Probe = { enabled: true; version: string } | { enabled: false; reason: string }

function json(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(body))
}

/** 명령을 돌려 종료 코드와 출력을 모은다. 시간을 넘기면 죽인다. */
function run(cmd: string, args: string[], timeoutMs: number): Promise<{ code: number | null; out: string; error?: string }> {
  return new Promise((done) => {
    let out = ''
    let child
    try {
      child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (e) {
      return done({ code: null, out, error: e instanceof Error ? e.message : String(e) })
    }
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs)
    const keep = (c: Buffer) => {
      // Blender 는 출력이 많다. 마지막 64KB 만 둔다(까닭을 찾는 줄은 끝에 있다).
      out = (out + c.toString('utf-8')).slice(-64 * 1024)
    }
    child.stdout.on('data', keep)
    child.stderr.on('data', keep)
    child.on('error', (e) => {
      clearTimeout(timer)
      done({ code: null, out, error: e.message })
    })
    child.on('close', (code, signal) => {
      clearTimeout(timer)
      done({ code, out, error: signal ? `${signal} 로 멈췄습니다(${Math.round(timeoutMs / 60000)}분 상한)` : undefined })
    })
  })
}

function isGlb(file: string): boolean {
  const fd = openSync(file, 'r')
  try {
    const head = Buffer.alloc(4)
    return readSync(fd, head, 0, 4, 0) === 4 && head.toString('latin1') === 'glTF'
  } finally {
    closeSync(fd)
  }
}

export function fbxConverter(options: FbxOptions = {}) {
  const blender = options.blender ?? process.env.BLENDER ?? 'blender'
  const script = options.script ?? resolve('scripts/glb2fbx.py')
  let probed: Promise<Probe> | null = null
  /** 처음 물을 때 한 번 잰다. Blender 를 깔았으면 서버를 다시 띄운다. */
  const probe = () =>
    (probed ??= run(blender, ['-b', '--factory-startup', '--version'], 60_000).then((r): Probe => {
      const version = /Blender\s+(\S+)/.exec(r.out)?.[1]
      if (r.code === 0 && version) return { enabled: true, version }
      return { enabled: false, reason: `이 서버에 Blender 가 없습니다(${blender}${r.error ? `: ${r.error}` : ''}). BLENDER 환경변수로 경로를 줍니다` }
    }))
  /** 앞 변환이 끝나야 다음 변환을 시작한다. */
  let queue: Promise<unknown> = Promise.resolve()

  async function convert(dir: string, res: ServerResponse) {
    const p = await probe()
    if (!p.enabled) return json(res, 503, { error: p.reason })
    const input = join(dir, 'in.glb')
    const output = join(dir, 'out.fbx')
    if (!isGlb(input)) return json(res, 400, { error: 'GLB 가 아닙니다' })
    const r = await run(blender, ['-b', '--factory-startup', '--python-exit-code', '1', '--python', script, '--', input, output], TIMEOUT_MS)
    if (r.code !== 0) {
      const why = /GLB2FBX-ERROR (.*)/.exec(r.out)?.[1] ?? r.error ?? r.out.trim().split('\n').slice(-3).join(' ')
      return json(res, 500, { error: `FBX 로 바꾸지 못했습니다: ${why}` })
    }
    const stats = /GLB2FBX (\{.*\})/.exec(r.out)?.[1]
    res.statusCode = 200
    res.setHeader('Content-Type', 'application/octet-stream')
    res.setHeader('Content-Length', statSync(output).size)
    if (stats) res.setHeader('X-Glb2fbx', stats)
    await new Promise<void>((done) => createReadStream(output).on('close', done).on('error', () => done()).pipe(res))
  }

  return function handle(req: IncomingMessage, res: ServerResponse) {
    if (req.method === 'GET') {
      void probe().then((p) => json(res, 200, p))
      return
    }
    if (req.method !== 'POST') return json(res, 405, { error: `${req.method} 은 받지 않습니다` })
    const dir = mkdtempSync(join(tmpdir(), 'oe-fbx-'))
    const cleanup = () => rmSync(dir, { recursive: true, force: true })
    let size = 0
    const out = createWriteStream(join(dir, 'in.glb'))
    req.on('data', (c: Buffer) => {
      size += c.length
      if (size > MAX_BYTES) {
        req.unpipe(out)
        req.destroy()
        out.destroy()
        cleanup()
        if (!res.writableEnded) json(res, 413, { error: 'GLB 가 너무 큽니다' })
      }
    })
    req.pipe(out)
    out.on('close', () => {
      if (res.writableEnded) return cleanup()
      if (!size) {
        cleanup()
        return json(res, 400, { error: 'GLB 가 비었습니다' })
      }
      const job = queue.then(() => convert(dir, res)).catch((e) => {
        if (!res.writableEnded) json(res, 500, { error: e instanceof Error ? e.message : String(e) })
      })
      queue = job.finally(cleanup)
    })
  }
}
