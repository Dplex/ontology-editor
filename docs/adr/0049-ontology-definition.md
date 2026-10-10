---
id: "ADR-0049"
title: "우리 온톨로지는 새 스키마가 아니라 Brick 어휘로 적은 건물 데이터(TTL)와 그 형상(GeoJSON)을 id 로 이은 한 쌍으로 정의하고, 정의·어휘·받는 쪽이 읽는 범위는 docs/ontology.md 한 곳에 두어 코드와 시험으로 맞춘다"
status: "제안"
date: "2026-10-10"
deciders: ["정희록"]
prd: ["D5", "D11"]
tickets: ["OE-INT-02", "OE-INT-03", "OE-INT-05", "OE-INT-07", "OE-INT-08"]
criteria: []
code: ["src/lib/export/ttl.ts", "src/lib/export/geojson.ts", "src/lib/capacity.ts", "src/lib/export/read-ttl.ts"]
tests: ["src/lib/ontology-doc.test.ts", "src/lib/export/export.test.ts"]
related: ["ADR-0008", "ADR-0011", "ADR-0023", "ADR-0048"]
supersedes: []
superseded_by: ""
---

# ADR-0049 온톨로지의 정의

## 맥락

이 repo 의 목적이 "DT 온톨로지" 인데 그것이 무엇인지 한 곳에 적힌 정의가 없었다. 조각은 흩어져 있었다 — 두 파일과 id(intent.md
"기하와 의미를 따로 낸다"), 피처 F1~F16(개발 정본 2장), 받는 쪽 파서 규칙(부록 C), 산출물 형식(PRD 1.7·OE-INT-02). 그래서
"온톨로지를 고친다" 가 데이터 편집인지 어휘 추가인지, 받는 쪽이 무엇을 받는지가 문서마다 달리 읽혔다.

2026-10-10 에 샘플 네 쌍(Duplex 건축+MEP·HVAC, 병원 건축+HVAC, 합성 성수)을 내보내 받는 쪽 규칙(`read-ttl.ts`)으로 다시 읽었다.
받는 쪽이 읽는 트리플은 26~29% 였다. 덕트·배관(`fso:`) 주어가 전체 주어의 77~82% 이고, `ex:` 속성 12종은 받는 쪽이 읽지 않는다.
PRD 1.7 의 "술어 4종 · `ttl.go` 가 읽는 것 확인" 과 실제가 다르다. 문·창 1,918개의 GeoJSON 형상은 기본 설정에서 전부 null 이었다.

받는 쪽(Unity 클라이언트)이 실제로 무엇을 읽는지는 2026-10-13 에 회사에서 확인한다.

## 결정

- **정의**: 한 건물의 공간·설비·계통을 Brick 어휘로 적은 인스턴스 그래프(TTL)와 그 노드들의 평면 형상(GeoJSON)을 GlobalId 하나로 이은 한 쌍.
  층마다 한 쌍씩 만들 수 있다. GLB 와 편집 파일은 정의에 들지 않는다.
- **스키마가 아니라 데이터다.** 스키마는 Brick·FSO 이고 우리는 Brick 에 없는 것만 `ex:` 로 적는다. 그래서 "온톨로지를 고친다" 를
  데이터 편집(에디터)과 어휘 추가(받는 쪽 합의)로 나눠 적는다.
- **정의는 `docs/ontology.md` 한 곳.** 정의 · 클래스·술어·feature 표(받는 쪽이 읽나 버리나) · 측정 · 받는 쪽과의 약속 · 아닌 것 ·
  아직 모르는 것(월요일 질문 9개) · PRD 와 다른 곳. 다른 문서는 이것을 가리킨다(CLAUDE.md, intent.md).
- **표는 코드와 맞춘다.** `ontology-doc.test.ts` 가 TTL 접두사, `ex:` 술어, GeoJSON `kind` 를 내보내기 코드와 양쪽으로 견준다.
- **받는 쪽 기준은 잠정이다.** Unity 가 무엇을 읽는지 확인하기 전까지 "받는 쪽" 은 `read-ttl.ts`(ieum-pipeline `ttl.go` 39d1dca)다.
  확인 결과 내보내기 범위를 바꾸면 새 ADR 로 남긴다.

## 고려한 다른 길

- **intent.md 에 절을 더하기.** intent 는 "바꾸면 안 되는 의도" 라 월요일에 바뀔 사실(받는 쪽 범위·측정)과 섞인다.
- **개발 정본(`bim-to-dt-ontology.md`)에 장을 더하기.** 그 문서는 "BIM 이 어디까지 주나" 에 답한다. 113KB 라 정의를 찾는 비용이 이미 크다(ADR-0048).
- **PRD glossary 에 정의.** PM 몫이다. 한 문장 정의를 넣어 주시도록 요청하고, 어휘·측정 같은 개발 사실은 여기 둔다.
- **지금 바로 `ex:` 속성·`fso:` 를 빼거나 파서를 넓히기.** 받는 쪽이 무엇을 쓰는지 모른 채 정하는 일이다. 월요일 확인 뒤로 미룬다.

## 결과

- "온톨로지가 뭐냐" 에 `docs/ontology.md` 첫 절이 답한다. `npm run ctx` 와 챗봇이 이 문서를 색인한다.
- 받는 쪽에 닿지 않는 약 3/4 를 계속 낼지, 문·창 형상 기본값을 바꿀지는 월요일 답에 따른다.
- 되돌리려면 `docs/ontology.md`·`ontology-doc.test.ts` 를 지우고 CLAUDE.md·intent.md 의 가리키는 줄을 뗀다. 내보내기 코드는 바꾸지 않았다.
