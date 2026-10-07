---
id: "OE-BIM-11"
epic: "E05"
epic_title: "초기 구축 — BIM 임포트 · 검토 화면"
title: "단위 환산·교차 확인"
prd: "#6"
release: "R1"
priority: "P1"
owner: "tbd"
status: "prd-review"
blocked_by: []
depends: ["R6"]
---

# OE-BIM-11 단위 환산·교차 확인

## 요구사항

IfcUnitAssignment 를 읽어 모든 길이를 m 로 환산한다(K9, R6). 같은 건물의 판본끼리는 층 높이로 단위가 맞는지 교차 확인하고, 다르면 경고한다.

## 수용 기준

mm·ft 단위 파일이 m 로 들어와 같은 건물의 다른 판본과 층 높이가 맞는다.

## 검증 (이 repo)

- `scripts/check-sample.test.ts` "Duplex HVAC 판본 (밀리미터)": 밀리미터를 미터로 환산해서 읽는다
- `scripts/check-sample.test.ts` "판본 사이의 GUID (Duplex)" 의 "mm·ft 로 낸 판본도 m 로 들어와 건축과 층 높이가 같고, 단위를 잘못 선언한 COBie 판본만 1/1000 로 잡는다"
- `src/lib/requirements.test.ts` "단위 선언 교차 확인 (OE-BIM-11)": 합치면 이름이 같은 층의 높이 비로 잡아 경고하고 R6 을 일부로 내린다 · 제대로 선언한 mm·ft 파일은 조용하다
- `src/lib/unit-check.test.ts`: 1/1000·피트·인치·센티미터 배수, 한 층만 다르면 단위가 아니라 기준점 차이
- `e2e/versions.spec.ts` "이전 판본과 층 높이가 단위 배수로 다르면 경고하고 R6 을 일부로 내린다"
- 픽스처: `src/lib/ifc/fixtures/millimetre.ifc`, `foot.ifc`

## 메모

- 교차 확인은 합칠 때와 판본 비교 때 이름이 같은 층의 높이 비로 한다. 파일 하나만 열면 선언이 틀렸는지 알 수 없어 R6 을 표준으로 둔다.
