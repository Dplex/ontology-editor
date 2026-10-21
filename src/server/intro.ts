// 첫 화면 인트로의 장면(`/__data/__intro`). scripts/intro-bake.ts 가 data/.intro/<이름>.json 으로 구워 둔 것을 내준다.
//   GET /__data/__intro            → [{ name, building, files, bakedAt }] (성수가 있으면 맨 앞)
//   GET /__data/__intro?name=<이름> → 그 장면 JSON
// 장면이 하나도 없으면 빈 목록이고, 화면은 인트로를 띄우지 않는다. 고객사 건물이라 저장소가 아니라 서버의 data/ 에만 둔다.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'

const NAME = /^[\w-]+$/

export function intro(root: string, req: IncomingMessage, res: ServerResponse, query: string): void {
  const dir = join(root, '.intro')
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405
    res.end()
    return
  }
  const name = new URLSearchParams(query).get('name')
  if (name) {
    const file = join(dir, `${name}.json`)
    if (!NAME.test(name) || !existsSync(file)) {
      res.statusCode = 404
      res.end()
      return
    }
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Content-Length', statSync(file).size)
    res.end(readFileSync(file))
    return
  }
  const scenes = (() => {
    try {
      return readdirSync(dir)
        .filter((f) => f.endsWith('.json') && NAME.test(f.slice(0, -5)))
        .map((f) => {
          const s = JSON.parse(readFileSync(join(dir, f), 'utf8'))
          return { name: f.slice(0, -5), building: s.building, files: s.files, bakedAt: s.bakedAt }
        })
        .sort((a, b) => Number(b.name === 'seongsu') - Number(a.name === 'seongsu') || a.name.localeCompare(b.name))
    } catch {
      return []
    }
  })()
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(scenes))
}
