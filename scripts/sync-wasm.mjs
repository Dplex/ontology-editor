// web-ifc 의 WASM 을 public/ 으로 복사한다.
//
// 브라우저 빌드는 파서 본체가 .wasm 파일이고, 이건 번들러가 JS 처럼 묶어 주지 않는다.
// public/ 에 놓아야 그대로 서빙된다.
//
// 커밋하지 않고 스크립트로 복사하는 이유: 릴리스 바이트 그대로여야 버전을 올릴 때
// 재배치가 아니라 설치 한 번으로 끝난다. node_modules 가 정본이다.

import { copyFileSync, mkdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const require = createRequire(import.meta.url)
const from = require.resolve('web-ifc/web-ifc.wasm')
const to = join(dirname(new URL(import.meta.url).pathname), '..', 'public', 'web-ifc.wasm')

mkdirSync(dirname(to), { recursive: true })
copyFileSync(from, to)
console.log(`web-ifc.wasm → public/ (${from})`)
