---
id: "ADR-0067"
title: "BIM 덕트·배관의 Flow Type 은 저장하지 않고 계통 종류·유체로 계산하며, 정하지 못한 구간은 사람이 구간마다 고르고 그 값만 편집 파일에 남긴다"
status: "제안"
date: "2026-10-14"
deciders: ["정희록"]
prd: ["#14-B"]
tickets: ["OE-PIP-14", "OE-OBJ-12"]
criteria: ["OE-PIP-14#1"]
code: ["src/lib/flow-type.ts", "src/lib/export/geojson.ts", "src/lib/edit-file.ts", "src/App.vue"]
tests: ["src/lib/flow-type-bim.test.ts", "e2e/flow-type-bim.spec.ts", "scripts/check-sample.test.ts"]
related: ["ADR-0008", "ADR-0030"]
---

# ADR-0067 BIM 배관의 Flow Type 은 계통으로 계산한다

## 맥락

OE-PIP-14 는 BIM 배관을 "원본 경로와 Flow Type 에 따라" 표시하라고 한다. 사람이 그린 배관은 그릴 때 Flow Type(SA·CHWS 등)을 고르지만,
BIM 배관에는 Flow Type 칸이 없다. IFC 가 주는 것은 배관이 든 계통(`IfcDistributionSystem`)과 그 종류·유체다. 공급·환수를 가르는 값은
계통 종류에 있고(급기·순환수 공급 …), 냉수·온수·냉각수는 순환수 계통의 유체다(OE-PIP-03).

2026-10-14 에 가진 BIM 다섯 개에서 계통 종류·유체로 Flow Type 을 정해 보았다. 덕트·배관 구간 중 정해진 수는 ifc4Mep 1,895개 중 1,461개,
Duplex HVAC 458개 중 322개, Duplex MEP 785개 중 615개, 병원 HVAC 3,138개 중 3,135개, 병원 MEP 12,645개 중 9,834개다. 정하지 못한 구간은
계통이 없거나(병원 MEP 65개), 계통 종류를 모르거나(Revit 기본 계통처럼 공급·환수가 한 계통에 섞인 것, 병원 MEP 2,746개), 유체를 모르는 순환수다.

## 결정

- **BIM 덕트·배관의 Flow Type 은 저장하지 않고 쓸 때 계산한다**(`flow-type.ts` 의 `conduitFlowType`). 계통 종류가 Flow Type 을 정하고,
  순환수만 유체가 더 필요하다(순환수 공급 + 냉수 = CHWS). 사람이 계통 종류·유체를 고치면 그 계통의 배관이 같이 바뀐다 — 저장했다면 계통을
  고칠 때마다 배관 수천 개를 다시 써야 한다.
- **정하지 못하면 비운다.** 유체를 모르는 순환수에 CHWS 를 찍거나, 공급·환수가 섞인 계통에 하나를 고르지 않는다.
- **사람이 구간마다 고른 값(`flowTypeSet`)이 계산보다 앞선다.** 섞인 계통의 배관을 사람이 가른다. 범례에 없는 값, 덕트에 물 매체·배관에 공기
  매체는 막는다. 고른 값만 편집 파일의 설비 줄 `flowType` 에 남고, 되돌리기에 쌓인다. 사람이 그린 배관은 그릴 때 정한 값(`flowType`)을 그대로 쓴다.
- **GeoJSON 덕트·배관 feature 에 `flowType` 과 `flowTypeSource` 를 적는다.** 출처는 `edit`(사람이 그렸거나 고름) · `calc`(BIM 이나 사람이
  정한 계통 종류·유체로 계산) · `dict`(이름 사전·원천 기기로 짐작한 종류·유체로 계산)다. 정하지 못한 구간에는 두 키가 없다. 다른 출처 속성과
  같은 낱말이다(ADR-0008).
- 3D 의 Flow Type 별 색은 이 결정에 들지 않는다. 색 값은 PM 이 정한다(#53).

## 고려한 다른 길

- **임포트 때 계산해 `flowType` 에 저장하기.** 그 칸은 "사람이 그린 배관" 표시로도 쓰여(그린 배관의 3D 만들기, 편집 파일의 새 배관 줄) BIM
  배관에 채우면 두 뜻이 섞인다. 계통 종류를 고칠 때 따라 바뀌지도 않는다.
- **계통 이름에서 공급·환수를 다시 읽기.** 계통 종류를 정하는 이름 사전(OE-PIP-03)이 이미 하는 일이라 두 번 읽지 않는다.

## 결과

- 화면의 설비 패널에 Flow Type 줄이 생기고, 편집 모드에서 BIM 구간마다 고를 수 있다. 첫 선택지가 "계산: SA 급기" 처럼 계산 값이다.
- 계통 종류가 사전으로 짐작한 것이면 Flow Type 도 `dict` 다. 가진 BIM 은 대부분 `dict` 다(`calc` 인 것은 ifc4Mep 의 209개뿐이다).
- 되돌리려면(저장하는 방식으로 바꾸려면) `conduitFlowType` 을 임포트에서 한 번 불러 `flowTypeSet` 과 다른 칸에 적고, GeoJSON 이 그 칸을 읽게 한다.
  Flow Type 을 내보내지 않으려면 `geojson.ts` 의 `flowType` 줄을 사람이 그린 배관만으로 되돌린다.
