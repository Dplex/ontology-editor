// PoC 기준 샘플 BIM 을 받는다. 저장소에 넣지 않는 이유는 2.5MB 짜리 남의 파일이라서다.
//
//   AC20-FZK-Haus.ifc — KIT(카를스루에 공대)의 표준 테스트 주택. ArchiCAD 20 이 IFC4 로
//   내보낸 것이고, web-ifc 파서가 자기 테스트에 쓰는 공개 모델이다.
//
// 이게 있어야 `npm run check:sample` 이 실제 BIM 으로 맞춰 본다. 없으면 이유를 찍고 건너뛴다.

import { mkdirSync, writeFileSync } from 'node:fs'

const URL_ = 'https://raw.githubusercontent.com/ThatOpen/engine_web-ifc/main/tests/ifcfiles/public/AC20-FZK-Haus.ifc'
const OUT = 'data/AC20-FZK-Haus.ifc'

const res = await fetch(URL_)
if (!res.ok) throw new Error(`${URL_} 받기 실패: HTTP ${res.status}`)

mkdirSync('data', { recursive: true })
const bytes = new Uint8Array(await res.arrayBuffer())
writeFileSync(OUT, bytes)
console.log(`${OUT} (${(bytes.length / 1024 / 1024).toFixed(1)} MB)`)
