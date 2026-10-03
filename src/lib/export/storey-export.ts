// 층 하나의 온톨로지(OE-GEN-11 층 단위 생성). 그 층의 GeoJSON 과 TTL 한 쌍이다.
//
// GeoJSON 은 원래 층마다 한 파일이라 건물 전체로 낼 때와 같은 파일을 쓴다(이름도 같다 — 층 이름이 겹치면 붙는 번호까지).
// TTL 은 그 층 몫만 낸다(ttl.ts 의 storeyScope). 다른 층을 가리키는 줄은 id 로 남아서, 층 파일을 다 모으면 건물 전체 TTL 과
// 같은 트리플이 된다(ADR-0011). 받는 쪽은 층 파일을 하나씩 받아 쌓으면 된다.

import type { Model } from '../model'
import { modelToGeoJSON } from './geojson'
import { modelToTTL } from './ttl'

export type StoreyFiles = {
  /** `floor-1F.geojson` */
  geojsonName: string
  geojson: string
  /** `floor-1F.ttl` — GeoJSON 과 같은 이름 줄기라 두 파일이 짝인 것이 이름에서 보인다. */
  ttlName: string
  ttl: string
}

export function storeyFiles(model: Model, storeyId: string): StoreyFiles | null {
  const index = model.storeys.findIndex((s) => s.id === storeyId)
  if (index < 0) return null
  const geo = modelToGeoJSON(model)[index]
  return {
    geojsonName: geo.fileName,
    geojson: JSON.stringify(geo.collection, null, 2),
    ttlName: geo.fileName.replace(/\.geojson$/, '.ttl'),
    ttl: modelToTTL(model, { storeyId }),
  }
}
