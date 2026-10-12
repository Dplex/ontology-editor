---
id: "ADR-0023"
title: "룸과 추가 공간 오브젝트는 3D Map 용으로 GeoJSON 에만 내보내고, TTL 에는 넣지 않으며 설비 소속은 물리존 그대로 둔다"
status: "제안"
date: "2026-10-09"
deciders: ["정희록"]
prd: ["#3", "D15"]
tickets: ["OE-OBJ-03", "OE-OBJ-09", "OE-SPC-11", "OE-SPC-14"]
supersedes: []
superseded_by: ""
---

# ADR-0023 룸과 추가 공간 오브젝트는 GeoJSON 에만 내보낸다

## 맥락

룸(OE-OBJ-03, #378)과 추가 공간 오브젝트(OE-OBJ-09, #379)는 편집 파일에만 남고 온톨로지로 나가지 않았다(ADR-0016 의 마지막 결정).
PM 이 #45·#51 에서 "TTL·GeoJSON 으로 내보냄" 을 고르면서 쓰임을 이렇게 적었다(2026-10-08).

- 룸: DT 는 설비를 **물리존** 단위로 조회한다. 3D Map 에서 룸이 보여야 한다. 룸은 DT 탐색기에서 조회되거나 설비 위치로 참조되지 않는다.
- 추가 공간 오브젝트: 3D Map 에서 보여야 한다. 뷰어마스터에서 조회할 필요는 없다.

TTL 은 탐색기 트리와 관계(`hasPart`·`hasLocation`·`feeds`)를 만드는 쪽이고, GeoJSON 은 지도에 그리는 기하다(BIM→DT 문서 부록 C).
PM 이 말한 쓰임은 전부 그리기다.

## 결정

**둘 다 층 GeoJSON 에 feature 하나씩으로 적고, TTL 에는 넣지 않는다.**

- 룸: `kind: "room"`, 바닥 사각형(Polygon), `spaceId`(든 물리존), `areaM2`
- 추가 공간 오브젝트: `kind: "spaceObject"`, 바닥 사각형(Polygon), `size`(가로·세로·높이 m), `height`, `item`(라이브러리 항목 열쇠), `itemName`
- 설비 소속(`brick:hasLocation`, GeoJSON `spaceId`)은 물리존 그대로다. 룸 안 설비를 룸에 두지 않는다.

TTL 에 `brick:Room` 으로 넣으면 탐색기 트리에 물리존 아래 단계가 생기고, 설비 위치를 룸으로 둘지 정해야 한다. PM 답은 둘 다
아니라서 넣지 않았다. 받는 쪽 대조(`read-export.ts` 의 `IN_TTL`)도 두 kind 를 "TTL 에 주어가 있어야 하는 것" 에 넣지 않는다.

## 결과

- 3D Map 은 룸을 바닥 외곽선으로, 오브젝트를 바닥 사각형을 `height` 만큼 세운 상자로 그릴 수 있다. 실제 모양(내장 항목의 조각, 사람이 넣은
  glb)은 아직 넘기지 않는다 — `item` 으로 같은 모델을 받는 쪽이 갖고 있어야 한다. 모델 파일을 넘길지는 PM 확인을 기다린다.
- 되돌리려면(TTL 에도 넣으려면) `ttl.ts` 에 두 kind 의 주어를 더하고 `IN_TTL` 에 kind 를 더한다. GeoJSON 쪽은 그대로 둔다.
- ADR-0016 의 "온톨로지로는 아직 내보내지 않는다" 는 이 결정으로 바뀌었다. 모양·겹침·모델 저장 결정은 그대로다.
