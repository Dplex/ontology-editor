---
id: "ADR-0065"
title: "R25 설비 태그는 인스턴스 속성 Mark 만 세고, 자리표시값(N/A·매개변수 이름)과 설비끼리 겹친 값은 없는 것으로 보며, Revit 이 요소 ID 를 넣는 IFC Tag 는 세지 않는다"
status: "제안"
date: "2026-10-13"
deciders: []
prd: ["D14"]
tickets: ["OE-REQ-05", "OE-BIM-17"]
criteria: ["OE-REQ-05#1", "OE-REQ-05#2", "OE-REQ-05#3", "OE-REQ-05#4"]
code: ["src/lib/ifc/import.ts", "src/lib/requirements.ts"]
tests: ["src/lib/requirements.test.ts", "src/lib/requirements-ids.test.ts", "e2e/requirements-report.spec.ts"]
related: ["ADR-0006"]
---

# ADR-0065 R25 설비 태그는 Mark 로 잰다

## 맥락

D14(2026-10-10)로 R25 "설비 태그(Mark·자산번호)에 BAS 관제점과 매핑할 식별자" 를 권장 요구로 채택했다(OE-REQ-05). 어느 칸을 태그로 볼지는
PRD 가 정하지 않았다. 가진 BIM 을 재 보면 칸마다 쓸 수 있는 정도가 다르다.
- `IfcElement.Tag`: Revit 은 모든 요소에 요소 ID(이름 끝의 `:578433` 과 같은 숫자)를 넣는다(Duplex HVAC 40/40, 병원 HVAC 400/400). 하나뿐인 값이지만
  모델러가 정한 태그가 아니다. ifc4Mep 은 3대에 `A001` 같은 이름을 넣었다.
- 인스턴스 속성 `Mark`(Revit Identity Data): 병원 HVAC 기기 566대가 모두 서로 다른 값(`VAV-32`·`CH-1` …)이다. Duplex HVAC 는 40대가 값 31종을 나눠 써서
  18대가 다른 설비와 같은 값이다.
- `AssetIdentifier`·`TagNumber`·`SerialNumber`·`BarCode`: Revit 이 빈 매개변수를 `N/A`(Duplex HVAC 40개 전부)나 매개변수 이름 그대로(Duplex MEP 141개 전부
  `AssetIdentifier`) 낸다.

## 결정

- **표준 자리는 인스턴스 속성 `Mark` 다.** 어느 속성 세트에 있든 이름이 `Mark` 인 인스턴스 속성을 읽는다(`Type Mark` 는 같은 종류 설비가 같은 값을 나눠 가져 읽지 않는다).
- **자리표시값은 없는 것이다.** 빈 값, `N/A`·`NA`·`-`·`none`·`null`·`TBD`·`?`, 매개변수 이름과 같은 값(`isPlaceholderTag`).
- **설비끼리 겹친 값은 세지 않는다.** 관제점이 어느 설비 것인지 정할 수 없어 없는 것과 같다. 상태는 없음·일부이고 요청은 "설비 태그에 BAS 식별자를 넣어 달라(Mark,
  설비마다 다른 값)" 다. 설명에 겹친 설비 수와 값 종류 수를 적는다.
- **`IfcElement.Tag` 는 세지 않는다.** Revit 이 넣는 요소 ID 와 같으면 버리고, 그 밖의 값이 있으면 설명에만 "Mark 가 없고 IFC Tag 속성에만 이름이 있습니다" 로
  적는다. 그 칸이 BAS 키인지는 모델마다 달라 단정하지 않는다.
- **판정에만 쓴다.** `Equipment.mark`·`ifcTag` 에 두고 TTL·GeoJSON 에는 내보내지 않는다. 권장이라 등급·생성 게이트에 들지 않는다.

## 고려한 다른 길

- **`IfcElement.Tag` 를 표준 자리로.** IFC 가 태그를 두라는 자리지만 Revit 파일에서는 언제나 요소 ID 라, 모든 Revit 파일이 표준으로 통과해 R25 가 아무것도 묻지 않는다.
- **`AssetIdentifier` 도 센다.** 가진 파일에서는 전부 자리표시값이었다. 값이 들어 있는 파일이 생기면 "다른 자리" 로 더할 수 있다.
- **겹친 값도 센다.** IDS 처럼 값의 유무만 보면 Duplex HVAC 가 40/40 으로 통과하지만, 같은 Mark 를 나눠 가진 18대는 BAS 와 이을 수 없다.

## 결과

- 정본 4.2 표와 `docs/requirements.ids` 에 R25 를 더했다(정본 4장의 "일부만 옮겼다" 줄). IDS 는 개체별 `Mark` 속성이 있는지를 검사하고, 값이 설비끼리 겹치는지는 보고서가 함께 잰다.
- 되돌리려면 `requirements.ts` 의 R25 묶음과 `REQUIREMENTS` 의 R25 줄, `import.ts` 의 `marks`·`ifcTagOf` 를 걷는다.
