// 에디터의 비교 판(ExportCompare.vue, ADR-0061)이 보일 것. 지금 모델을 내보내기와 같은 함수로 TTL·층 GeoJSON 으로 쓰고,
// 그 글을 **받는 쪽처럼** 다시 읽는다(read-ttl.ts·read-export.ts) — 내보낸 파일 뷰어(viewer.html)가 파일을 읽는 것과 같은 길이다.
// 그래서 판에 보이는 것은 모델이 아니라 DT 가 받을 파일이다. 모델에는 있는데 파일에서 빠진 것은 판에서도 빠진다.
// 성수에서는 쓰고 읽는 데 시간이 걸려 화면 스레드가 아니라 워커(compare.worker.ts)에서 한다.
import type { Model } from '../model'
import { geoFileNames, modelToGeoJSON } from './geojson'
import { readGeoJSON, type ExportFloor } from './read-export'
import { readOntologyTTL, type TtlReading } from './read-ttl'
import { modelToTTL } from './ttl'

export type CompareReading = {
  ttl: TtlReading
  /** 층마다 받는 쪽이 읽은 GeoJSON. 층 id 로 에디터의 층과 짝짓는다. */
  floors: { storeyId: string; floor: ExportFloor }[]
  /** 쓰고 읽는 데 든 시간(ms). */
  ms: number
}

export function buildCompare(model: Model): CompareReading {
  const t0 = performance.now()
  const ttl = readOntologyTTL(modelToTTL(model))
  const names = geoFileNames(model)
  const byName = new Map([...names].map(([id, name]) => [name, id]))
  const floors = modelToGeoJSON(model).map(({ fileName, collection }) => ({
    storeyId: byName.get(fileName) ?? '',
    floor: readGeoJSON(fileName, JSON.stringify(collection)),
  }))
  return { ttl, floors, ms: Math.round(performance.now() - t0) }
}
