---
id: "ADR-0004"
title: "커스텀존은 brick:Zone 으로 export 하고, 포함하는 방은 hasPart, 안의 설비는 hasLocation 을 하나 더 연결한다"
status: "제안"
date: "2026-10-03"
prd: ["Q4"]
tickets: ["OE-OBJ-01", "OE-SPC-06", "OE-SPC-07", "OE-SPC-08", "OE-SPC-09", "OE-SPC-10"]
supersedes: []
superseded_by: ""
---

# ADR-0004 커스텀존은 brick:Zone 으로 export 하고, 포함하는 방은 hasPart, 안의 설비는 hasLocation 을 하나 더 연결한다

## 맥락

커스텀존(F14, OE-OBJ-01)은 운영자가 물리존 위에 다각형으로 정하는 운영 단위다(임원석·식당·사무석). BIM 에 없고, 서로 겹쳐도
되며(OE-OBJ-01), Agent 가 "커스텀존 기준으로 온도·에너지·설비 위치" 를 묻는다(OE-SPC-10). PRD 에는 온톨로지에 어떤 형태로 export 할지,
물리존·공조존과 어떻게 "매핑" 할지(OE-SPC-09)가 없다.

제약:
- predicate(관계·값을 나타내는 이름) 는 `feeds`·`hasLocation`·`hasPart`·`hasPoint` 4개다 — 수신 측 `ieum-pipeline/internal/ontology/ttl.go` 가 이것만 읽는다.
- TTL 에 좌표를 넣지 않는다(기하·의미 분리, `export.test.ts`).
- 수신 측은 공간(Zone·Floor)을 설비로 저장하지 않고, **설비의 hasLocation 은 목록으로 받아 줄마다 저장한다**
  (`ttl.go` 의 `Locations []string`, `sink/postgres/ontology_store.go`).
- 커스텀존은 방 경계와 맞지 않는 경우가 흔하다 — 넓은 사무실 한쪽 구석을 "임원석" 으로 덮는 식이다. 방 단위 매핑만으로는 그 안의 설비를
  찾을 수 없다.

## 결정

- 커스텀존은 층마다 둔다(`Storey.customZones`). TTL 에서 `brick:Zone` 이고 이름(별명)이 `rdfs:label`, `ex:zoneKind "custom"` 으로
  공조존·물리존과 구분한다. 층이 `brick:hasPart` 로 포함한다.
- **포함하는 방**: 바닥의 절반 넘게 덮이는 방을 `brick:hasPart` 로 연결한다 — 공조존 → 방과 같은 기준(`idf/attach.ts`).
- **안의 설비**: 좌표가 다각형 안인 설비(덕트·배관 제외)가 `brick:hasLocation` 을 하나 더 갖는다(`ex:fcu1 brick:hasLocation
  ex:office, ex:U_exec`). 방 일부만 덮는 존에서도 Agent 가 설비를 찾을 수 있다. 수신 측이 목록으로 저장하므로 문제가 없다.
- **공조존과의 매핑**은 따로 적지 않는다. 같은 방을 포함하는 것(공조존 hasPart 방, 커스텀존 hasPart 방)으로 연결된다. 커스텀존 →
  공조존 predicate 를 새로 만들면 수신 측이 읽지 못한다.
- 매핑은 **저장하지 않고 export 할 때 계산한다**(`custom-zone.ts`, `vertical.ts`·`exterior.ts` 와 같다). 방을 나누거나 설비를 옮기면
  다음 export 에 바로 반영된다 — OE-SPC-09 "수정 시 매핑 갱신" 을 따로 구현할 필요가 없고, 재판정을 호출하는 쪽에 맡길 필요도 없다.
- 다각형과 포함하는 방·포함된 설비 목록은 GeoJSON `kind: 'customZone'` feature 에 있다(id 는 TTL subject 와 같다).
- 별명은 하나다. OE-OBJ-01(prd-done)은 "커스텀 존 당 1개", 용어집·OE-SPC-06(prd-review)은 "별명 복수" 라 어긋나서 prd-done 을 따랐다.
- 합치기는 변이 맞닿았거나(벽 두께 `MERGE_GAP` 안) 한쪽이 다른 쪽을 포함할 때만 된다. 일부만 겹친 둘은 합친 모양이 하나의 ring 으로
  닫히지 않는 경우가 있어 막는다(물리존 합치기와 같은 `unionRings`).

## 고려한 대안

- **커스텀존 hasPart 설비** — Brick 에서 Location 의 hasPart 는 Location 이다. 설비 → 위치는 hasLocation 이 맞다.
- **방 단위로만 매핑(hasPart 방)** — 임원석처럼 방 일부만 덮는 존은 비어 버린다. 직접 그린 테스트에서 사무실 200㎡ 중 20㎡ 를 덮는 존이
  포함하는 방 0, 포함된 설비 1 이었다(`custom-zone.test.ts`).
- **매핑을 모델에 저장** — 물리존·설비 편집마다 다시 계산해야 하고, 빠뜨리면 오래된 매핑이 그대로 export 된다.

## 결과

- 수신 측은 존을 방·층처럼 **타입 없는 논리 엔티티**로 저장한다(관계의 object 로 쓰기 위해, `ttl.go` 의 equipClass 주석). 실제 `ttl.go` 로
  읽어 보면 엔티티가 존 수만큼 늘고 존은 `BrickClass: Zone` 이며, 존 안 기기의 Locations 가 `[방(또는 층), 존]` 이다(check:sample).
- 수신 측에서 설비 한 대가 hasLocation 을 둘 이상 가진다(방 + 커스텀존). 위치를 하나로 가정하는 소비자가 있으면 object 클래스
  (`brick:Zone` + `ex:zoneKind "custom"`)로 필터링해야 한다.
- 되돌리려면: `export/ttl.ts` 에서 설비의 hasLocation 에 존을 추가하는 줄을 빼면 방 단위 매핑(hasPart)만 남는다.
