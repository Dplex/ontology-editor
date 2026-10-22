// 첫 화면 인트로(public/intro/)가 쓰는 three.js 를 public/intro/three/ 로 복사한다.
//
// 인트로의 kit(public/intro/lab-kit.js, machine-skill)은 앱 번들 밖의 한 장짜리 페이지라 import map 으로 three 를 받는다.
// 원본은 jsDelivr 를 가리키지만 사내망 브라우저는 CDN 에 못 닿는다. 그래서 앱과 같은 node_modules/three 를 옮겨 둔다
// (web-ifc.wasm 을 sync-wasm 이 옮기는 것과 같은 이유 — node_modules 가 정본이고 커밋하지 않는다).
// kit·앞머리(prologue.js)가 가져오는 addon 에서 시작해 import 를 따라가며 필요한 파일만 옮긴다. examples/jsm 전체는 20MB 가 넘는다.

import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, normalize, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const three = dirname(dirname(require.resolve('three')))
const here = dirname(fileURLToPath(import.meta.url))
const pages = ['lab-kit.js', 'prologue.js'].map((f) => join(here, '..', 'public', 'intro', f))
const out = join(here, '..', 'public', 'intro', 'three')

const IMPORT = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]/g
const specs = (file) => [...readFileSync(file, 'utf8').matchAll(IMPORT)].map((m) => m[1] ?? m[2])

const todo = []
for (const s of pages.flatMap(specs)) {
  if (s === 'three') todo.push(join(three, 'build', 'three.module.js'))
  else if (s.startsWith('three/addons/')) todo.push(join(three, 'examples', 'jsm', s.slice('three/addons/'.length)))
}
const seen = new Set()
while (todo.length) {
  const file = normalize(todo.pop())
  if (seen.has(file)) continue
  if (!existsSync(file)) throw new Error(`없는 three 파일: ${relative(three, file)}`)
  seen.add(file)
  for (const s of specs(file)) {
    if (s === 'three') todo.push(join(three, 'build', 'three.module.js'))
    else if (s.startsWith('.')) todo.push(join(dirname(file), s))
  }
}

// 폴더를 지우고 다시 만들지 않는다. 떠 있는 dev 서버가 그 사이의 404 를 기억해(public 파일 목록) 인트로가 three 를 못 받았다.
// 바뀐 파일만 덮고, 이번에 필요 없는 파일만 지운다.
seen.add(join(three, 'LICENSE'))
const want = new Set([...seen].map((f) => join(out, relative(three, f))))
const walk = (dir) => (existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(join(dir, d.name)) : [join(dir, d.name)])) : [])
for (const f of walk(out)) if (!want.has(f)) rmSync(f)
let copied = 0
for (const file of seen) {
  const to = join(out, relative(three, file))
  if (existsSync(to) && readFileSync(to).equals(readFileSync(file))) continue
  mkdirSync(dirname(to), { recursive: true })
  copyFileSync(file, to)
  copied++
}
console.log(`three ${JSON.parse(readFileSync(join(three, 'package.json'), 'utf8')).version} → public/intro/three/ (${seen.size}개, 바꾼 것 ${copied}개)`)
