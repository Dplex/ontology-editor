// 실측용 공개 BIM 샘플을 받는다. 저장소에 넣지 않는 이유는 남의 파일이고 크기 때문이다.
//
// 이 세 개가 각각 다른 것을 증명한다.
//
//   AC20-FZK-Haus     건축만 있는 IFC4. 공간 골격이 어디까지 나오는지 본다.
//   ifc4Mep_IFC4      설비만 있는 IFC4. 계통과 포트가 든 파일이 어떻게 생겼는지 본다.
//   NBU_Duplex        건축과 설비가 따로 있는 실제 프로젝트. 둘을 합쳐야 하는 이유를 본다.
//
// 받은 뒤 `npm run check:sample` 로 기준값과 대조한다.

import { mkdirSync, writeFileSync, existsSync } from 'node:fs'

const GH = 'https://raw.githubusercontent.com'

const SAMPLES = [
  {
    out: 'data/AC20-FZK-Haus.ifc',
    url: `${GH}/ThatOpen/engine_web-ifc/main/tests/ifcfiles/public/AC20-FZK-Haus.ifc`,
    note: 'KIT 표준 테스트 주택. IFC4, 건축만',
  },
  {
    out: 'data/ifc4Mep_IFC4.ifc',
    url: `${GH}/opensourceBIM/TestFiles/master/TestData/data/ifc4Mep%20export%2017-12-2013_IFC4.ifc`,
    note: 'DDS-CAD 이 내보낸 설비 모델. IFC4, 계통 37 · 포트 4232',
  },
  {
    out: 'data/NBU_Duplex_ifc.zip',
    url: 'https://tib.eu/data/duraark/BuildingData/01_IFC/NBU_Duplex_ifc.zip',
    note: 'NIBS Duplex Apartment(DURAARK 아카이브 경유). 건축·MEP·HVAC·COBie 판본',
    unzip: 'data/NBU_Duplex',
  },
]

for (const sample of SAMPLES) {
  if (existsSync(sample.out)) {
    console.log(`건너뜀  ${sample.out} (이미 있음)`)
    continue
  }
  process.stdout.write(`받는 중 ${sample.out} … `)
  const res = await fetch(sample.url)
  if (!res.ok) {
    console.log(`실패 HTTP ${res.status}`)
    console.log(`         ${sample.url}`)
    continue
  }
  mkdirSync('data', { recursive: true })
  const bytes = new Uint8Array(await res.arrayBuffer())
  writeFileSync(sample.out, bytes)
  console.log(`${(bytes.length / 1048576).toFixed(1)} MB  — ${sample.note}`)
  // 압축은 풀지 않는다. 의존성을 하나 더 들이는 값이 명령 한 줄을 적는 값보다 크다.
  if (sample.unzip) console.log(`         풀려면: unzip -o ${sample.out} -d data/`)
}
