// 엔티티 key(GeoJSON feature id · 층 id)가 어느 층에 속하나. xray·alive 가 한 층만 볼 때 그 층 것만 그리려고 쓴다.
//
// modelToGeoJSON 은 층마다 한 묶음을 model.storeys 와 같은 순서로 낸다. 그래서 묶음의 번호가 곧 층이다.
// 묶음에 없는 key(계통·건물, BIM 과 안 이어진 IDF 설비)는 어느 층에도 넣지 않는다 — 한 층만 볼 때는 그리지 않는다.
import type { FeatureCollection } from '../lib/export/geojson'
import type { Model } from '../lib/model'

export function storeyOfKeys(model: Readonly<Model>, geo: readonly { collection: FeatureCollection }[]): Map<string, string> {
  const out = new Map<string, string>()
  model.storeys.forEach((s, i) => {
    out.set(s.id, s.id)
    for (const f of geo[i]?.collection.features ?? []) out.set(String(f.id), s.id)
    for (const sp of s.spaces) out.set(sp.id, s.id)
    for (const e of s.equipment) out.set(e.id, s.id)
  })
  return out
}
