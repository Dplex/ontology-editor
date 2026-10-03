import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as WebIFC from 'web-ifc'
import { describe, expect, it } from 'vitest'
import { importIfc } from './import'
import { mergeModels } from '../merge'

// OE-BIM-02 층 높이 속성 읽기. 가진 BIM 중 값이 있는 것은 미터 단위 AC20(BaseQuantities) 뿐이고, COBie Storey Height 는 Duplex 판본이
// 전부 0.0 이다. 그래서 밀리미터 파일(fixtures/millimetre.ifc — 2층 바닥 3000)에 두 자리를 손으로 넣어 본다.
const withQuantities = (extra: string) => {
  const text = readFileSync(fileURLToPath(new URL('./fixtures/millimetre.ifc', import.meta.url)), 'utf8')
  const at = text.lastIndexOf('ENDSEC;')
  return new TextEncoder().encode(`${text.slice(0, at)}${extra}\n${text.slice(at)}`)
}

describe('층 높이 속성 (OE-BIM-02)', () => {
  it('기준 물량 GrossHeight·NetHeight 는 파일의 길이 단위로 읽어 미터로 바꾼다', async () => {
    const api = new WebIFC.IfcAPI()
    await api.Init()
    const model = importIfc(
      api,
      withQuantities(
        [
          `#900= IFCQUANTITYLENGTH('GrossHeight',$,$,3000.,$);`,
          `#901= IFCQUANTITYLENGTH('NetHeight',$,$,2700.,$);`,
          `#902= IFCELEMENTQUANTITY('0PoC$Qto$1F$000000000',$,'BaseQuantities',$,$,(#900,#901));`,
          `#903= IFCRELDEFINESBYPROPERTIES('0PoC$Rel$Qto$1F$000000',$,$,$,(#16),#902);`,
        ].join('\n'),
      ),
    )
    expect(model.storeys.find((s) => s.name === '1F')!.declaredHeight).toEqual({ gross: 3, net: 2.7, property: 'BaseQuantities.GrossHeight' })
  })

  it('COBie 의 Storey Height 도 층고(gross)로 읽는다', async () => {
    const api = new WebIFC.IfcAPI()
    await api.Init()
    const model = importIfc(
      api,
      withQuantities(
        [
          `#900= IFCPROPERTYSINGLEVALUE('Storey Height',$,IFCLENGTHMEASURE(3000.),$);`,
          `#901= IFCPROPERTYSET('0PoC$Pset$COBie$1F$0000',$,'COBie_Floor',$,(#900));`,
          `#902= IFCRELDEFINESBYPROPERTIES('0PoC$Rel$COBie$1F$00000',$,$,$,(#16),#901);`,
        ].join('\n'),
      ),
    )
    expect(model.storeys.find((s) => s.name === '1F')!.declaredHeight).toEqual({ gross: 3, net: null, property: 'COBie_Floor.Storey Height' })
  })

  it('합치면 바탕 파일 값을 쓰고, 바탕에 없을 때만 덧붙인 파일 값을 가져온다', async () => {
    const api = new WebIFC.IfcAPI()
    await api.Init()
    const gross = (mm: number) =>
      importIfc(
        api,
        withQuantities(
          [
            `#900= IFCQUANTITYLENGTH('GrossHeight',$,$,${mm}.,$);`,
            `#902= IFCELEMENTQUANTITY('0PoC$Qto$1F$000000000',$,'BaseQuantities',$,$,(#900));`,
            `#903= IFCRELDEFINESBYPROPERTIES('0PoC$Rel$Qto$1F$000000',$,$,$,(#16),#902);`,
          ].join('\n'),
        ),
      )
    const first = (m: ReturnType<typeof gross>) => m.storeys.find((s) => s.name === '1F')!.declaredHeight?.gross ?? null
    expect(first(mergeModels(gross(3000), gross(3500)).model)).toBe(3)
    const bare = importIfc(api, withQuantities(''))
    expect(first(mergeModels(bare, gross(3500)).model)).toBe(3.5)
  })
})
