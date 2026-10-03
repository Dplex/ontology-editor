---
id: "ADR-0008"
title: "계산한 관계의 출처는 GeoJSON 속성의 *Source(bim·calc)로 export 한다 — TTL 출처 predicate 는 수신 측과 합의(OE-INT-07)할 때까지 export 하지 않는다"
status: "제안"
date: "2026-10-03"
prd: []
tickets: ["OE-INT-09", "OE-INT-07"]
supersedes: []
superseded_by: ""
---

# ADR-0008 계산한 관계의 출처는 GeoJSON 속성의 *Source(bim·calc)로 export 한다 — TTL 출처 predicate 는 수신 측과 합의(OE-INT-07)할 때까지 export 하지 않는다

## 맥락

PRD 부록 C S4 는 "계산·추정 관계의 출처(BIM/계산/사전/사람/외부)를 소비 시스템이 구별 가능" 이다. 그 방법을 정하는 OE-INT-07 은
"TTL 에 담을지(새 술어) 또는 화면·JSON 리포트로만" 을 결정하지 않은 상태다.

OE-INT-09(각 S 마다 테스트)를 진행하며 export 한 파일을 수신 측처럼 다시 읽어 보니, 화면에는 출처 칩이 있지만(`components/Src.vue`) 파일에서는
**설비가 어느 방에 있는지(F11, 이상 알림의 발생 위치)의 출처가 없었다.** Duplex 건축+MEP 를 합치면 소속 656건 중 167건은 BIM 에 있는 것
(`IfcRelContainedInSpatialStructure`), 489건은 좌표로 계산한 것인데 TTL 은 둘 다 같은 `brick:hasLocation` 이다. 문이 잇는 방
(`connectsSource`)과 벽의 외벽 여부(`externalSource`, ADR-0002)는 이미 GeoJSON 속성에 `bim`·`calc` 로 export 되고 있었다.

TTL 에 새 predicate(관계·값을 나타내는 이름) 를 넣으면 수신 측(ttl.go)은 모르는 predicate 라 버린다. 읽게 하려면 수신 측 코드를 바꿔야 하고, 그건 OE-INT-07 에서 합의할 일이다.

## 결정

- 출처가 BIM·계산으로 섞이는 관계는 **그 feature 의 GeoJSON 속성에 `…Source: 'bim' | 'calc'`** 로 적는다. 이미 있는 두 가지에 설비 소속
  `spaceSource` 를 추가한다(방이 없으면 null). 사람이 옮긴 설비도 좌표로 다시 판정하므로 `calc` 다
- 출처가 항상 하나인 관계는 속성으로 적지 않고 BIM→DT 문서(`docs/bim-to-dt-ontology.md`) 부록 C 에 적는다 — 공조존·커스텀존이 포함하는 방(겹친 넓이로 계산), IDF 설비의 `feeds`(외부),
  공기 원천이 급기를 보내는 방(방향과 소속으로 계산). 사람이 만든 것은 id 가 `U_`, IDF 출신은 `Z_`·`I_` 다
- TTL 에는 출처 predicate 를 export 하지 않는다. 설비끼리의 `feeds` 는 BIM 포트·사람이 정한 방향·사람이 확정한 규칙만 들어가고 확정 전 추정은 들어가지
  않는다(K14) — 셋을 구분하는 표시는 없다. OE-INT-07 이 정해지면 그때 export 한다

## 결과

- 수신 측이 GeoJSON 을 읽으면 소속이 BIM 인지 계산인지 알 수 있다. TTL 만 읽는 Agent 는 여전히 알 수 없다
- 설비끼리 `feeds` 의 출처(포트·사람·확정 규칙)는 파일에서 구분할 수 없다. GeoJSON 에는 관계(선)가 없어 적을 곳도 없다 — OE-INT-07
- 되돌리려면: `src/lib/export/geojson.ts` 의 `spaceSource` 한 줄을 지우고, `src/lib/requirements-s.test.ts` S4 첫 테스트와 check:sample
  "요구조건 S" 의 S4 줄을 지운다
