import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import * as WebIFC from 'web-ifc'
import { beforeAll, describe, expect, it } from 'vitest'
import { importIfc } from '../ifc/import'
import type { Model } from '../model'
import { modelToGeoJSON, storeyToGeoJSON } from './geojson'
import { escapeLocalName, modelToTTL } from './ttl'

let model: Model

beforeAll(async () => {
  const api = new WebIFC.IfcAPI()
  await api.Init()
  const path = fileURLToPath(new URL('../ifc/fixtures/two-rooms.ifc', import.meta.url))
  model = importIfc(api, new Uint8Array(readFileSync(path)))
}, 60_000)

describe('GeoJSON', () => {
  it('층마다 파일 하나가 나온다', () => {
    expect(modelToGeoJSON(model).map((f) => f.fileName)).toEqual(['floor-1F.geojson', 'floor-2F.geojson'])
  })

  it('다각형 고리를 닫아서 내보낸다', () => {
    const fc = storeyToGeoJSON(model.storeys[0])
    const meeting = fc.features.find((f) => f.properties.name === '101')!
    const ring = (meeting.geometry as { coordinates: number[][][] }).coordinates[0]
    expect(ring[0]).toEqual(ring[ring.length - 1])
    expect(ring).toHaveLength(5)
  })

  it('외곽선이 없는 공간도 geometry: null 로 남긴다', () => {
    // 빼 버리면 온톨로지에는 있는데 지도에는 없는 공간이 생긴다.
    const fc = storeyToGeoJSON(model.storeys[1])
    expect(fc.features).toHaveLength(1)
    expect(fc.features[0].geometry).toBe(null)
  })
})

describe('Brick TTL', () => {
  it('IFC GUID 의 $ 를 이스케이프한다', () => {
    // 안 하면 그 줄만 다르게 읽혀서 주어가 조용히 갈라진다.
    expect(escapeLocalName('0PoC$Space$Meeting$000')).toBe('0PoC\\$Space\\$Meeting\\$000')
  })

  it('계층을 hasPart 로 잇는다', () => {
    const ttl = modelToTTL(model)
    expect(ttl).toContain('a brick:Building ;')
    expect(ttl).toContain('a brick:Floor ;')
    expect(ttl).toContain('a brick:Room ;')
    expect(ttl).toContain('brick:hasPart ex:0PoC\\$Storey\\$1F\\$00000, ex:0PoC\\$Storey\\$2F\\$00000 .')
  })

  it('기하를 담지 않는다', () => {
    // WKT 문자열로 새어 들어가면 이 PoC 의 전제가 깨진다.
    const ttl = modelToTTL(model)
    expect(ttl).not.toMatch(/POLYGON|coordinates|wkt/i)
  })

  it('한글 이름을 라벨로 넣는다', () => {
    expect(modelToTTL(model)).toContain('rdfs:label "회의실" ;')
  })
})

describe('두 파일을 잇는 id', () => {
  it('GeoJSON feature id 가 TTL 주어와 같다', () => {
    const ttl = modelToTTL(model)
    const ids = modelToGeoJSON(model).flatMap((f) => f.collection.features.map((x) => x.id))

    expect(ids).toHaveLength(3)
    for (const id of ids) {
      expect(ttl).toContain(`ex:${escapeLocalName(id)} a brick:Room`)
    }
  })
})
