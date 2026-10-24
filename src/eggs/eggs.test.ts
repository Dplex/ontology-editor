import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, normalize, relative } from 'node:path'
import { describe, expect, it } from 'vitest'
import { EGGS } from './registry'

// 숨은 연출의 금지선 중 코드로 막을 수 있는 것(docs/plans/easter-eggs.md 2장 G4). 모델·TTL 이 그대로인지(G3)는
// e2e/eggs.spec.ts 가 목록의 egg 를 하나씩 켜고 끄며 잰다 — 3D·DOM 이 있어야 egg 가 켜진다.

const HERE = 'src/eggs'

/**
 * egg 가 import 해도 되는 lib 모듈. 모델을 고치는 함수가 없거나, 있어도 egg 가 쓸 까닭이 없는 것만 둔다.
 * 새 lib 을 쓰려면 여기 한 줄을 더하고 PR 에 그 모듈이 모델을 고치지 않는다는 근거를 적는다 — 리뷰가 이 줄을 본다.
 */
const LIB_ALLOWED = new Set([
  'src/lib/model', // 형 · 넓이 같은 순수 계산
  'src/lib/viewer', // ViewerLayer 형 · toScene
  'src/lib/motion', // still · easeOut
  'src/lib/export/ttl', // modelToTTL · classOf — 문자열을 만들 뿐이다
  'src/lib/export/read-ttl', // 받는 쪽처럼 읽기
  'src/lib/export/geojson', // modelToGeoJSON — 문자열을 만들 뿐이다
  'src/lib/flow-pulse', // 흐르는 빛 메시
  'src/lib/flow-type', // 계통 종류·색
  'src/lib/kinds', // 종류 사전
])

const files = readdirSync(HERE).filter((f) => /\.ts$/.test(f) && !f.endsWith('.test.ts'))

function importsOf(text: string): string[] {
  const out: string[] = []
  const re = /\bfrom\s*['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)|^\s*import\s*['"]([^'"]+)['"]/gm
  for (const m of text.matchAll(re)) out.push(m[1] ?? m[2] ?? m[3])
  return out
}

/** 어긴 import 하나의 이유. 괜찮으면 null. */
function refusal(file: string, spec: string): string | null {
  if (spec === 'vue' || spec === 'three' || spec.startsWith('three/')) return null
  if (!spec.startsWith('.')) return `바깥 패키지 '${spec}' — 사내망이라 새 의존성을 들이지 않는다`
  const target = normalize(join(dirname(join(HERE, file)), spec)).replace(/\\/g, '/').replace(/\.(ts|js)$/, '')
  if (target.startsWith(`${HERE}/`)) return null
  if (target.startsWith('src/editor/') || target.startsWith('src/components/') || target === 'src/App') return `편집기 상태 '${spec}' — EggContext 로 받는다`
  if (target.startsWith('src/lib/') && !LIB_ALLOWED.has(target)) return `'${relative('src', target)}' 는 허용 목록(LIB_ALLOWED)에 없다`
  return target.startsWith('src/lib/') ? null : `'${spec}'`
}

describe('숨은 연출 — 금지선', () => {
  it('src/eggs/ 는 편집기 상태·고치는 모듈·바깥 패키지를 import 하지 않는다(G4)', () => {
    const bad = files.flatMap((f) =>
      importsOf(readFileSync(join(HERE, f), 'utf8'))
        .map((spec) => [f, refusal(f, spec)] as const)
        .filter(([, why]) => why)
        .map(([file, why]) => `${file}: ${why}`),
    )
    expect(bad).toEqual([])
  })

  it('import 훑기가 실제로 잡는다 — 편집기·고치는 lib·바깥 패키지', () => {
    expect(refusal('x.ts', '../editor/core')).toMatch(/편집기 상태/)
    expect(refusal('x.ts', '../lib/edit')).toMatch(/허용 목록/)
    expect(refusal('x.ts', '../lib/replay-player')).toMatch(/허용 목록/)
    expect(refusal('x.ts', 'gsap')).toMatch(/바깥 패키지/)
    expect(refusal('x.ts', './types')).toBeNull()
    expect(refusal('x.ts', '../lib/export/ttl')).toBeNull()
    expect(importsOf(`import a from './a'\nimport type { B } from "../lib/edit"\nconst c = () => import('./c')\nimport './d.css'`)).toEqual(['./a', '../lib/edit', './c', './d.css'])
  })

  it('목록의 이름은 겹치지 않는 소문자 한 단어이고, 모듈 파일이 있다', () => {
    const ids = EGGS.map((e) => e.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const e of EGGS) {
      expect(e.id).toMatch(/^[a-z]+$/)
      expect(e.title.trim()).not.toBe('')
      expect(files).toContain(`${e.id}.ts`)
    }
  })

  it('e2e 밖의 목록에는 시험용 probe 가 없다', () => {
    expect(EGGS.map((e) => e.id)).not.toContain('probe')
  })
})
