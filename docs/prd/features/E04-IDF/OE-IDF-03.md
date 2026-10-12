---
id: "OE-IDF-03"
epic: "E04"
epic_title: "초기 구축 — IDF 임포트"
title: "존 설계 급기 풍량"
prd: "#5"
release: "R2"
priority: "P1"
owner: "tbd"
status: "prd-done"
blocked_by: []
depends: ["OE-ZON-06", "K9", "OE-ZON-05", "OE-IDF-11", "Q16", "U8"]
---

# OE-IDF-03 존 설계 급기 풍량

## 관련 티켓

- [OE-ZON-06](../E10-ZON/OE-ZON-06.md): 설계 풍량 선택·단위 환산
- [OE-ZON-05](../E10-ZON/OE-ZON-05.md): 용량 검증 Z-03
- [OE-IDF-11](./OE-IDF-11.md): 기준값 없는 존 표시

## 요구사항
> User story : R2에서 구축 담당자는 IDF에 숫자로 적힌 존별 설계 급기 풍량을 용량 검증의 1순위 기준값으로 쓸 수 있다. 설계 풍량이 숫자로 적힌 존만 읽으며, 시뮬레이션이 계산하도록 되어 있어 숫자가 없는 존은 지어내지 않고 '기준값 없음'으로 두고 그 이유를 보인다. 시뮬레이션 결과 파일은 읽지 않는다. 사용자는 IDF 검토 화면에서 기준값 없는 존 목록을 확인하고 BIM 값이나 직접 입력으로 보완할 수 있어야 한다. 냉방·난방 중 큰 값을 쓰는 것과 단위 통일은 용량 검증 입력값 규칙을 따르며, 외기량은 읽지 않는다.

`Sizing:Zone` 에서 존별 설계 급기 풍량을 읽어, 용량 검증 Z-03 의 IDF 입력값으로 둔다(OE-ZON-06 설계 풍량 1순위, 공조존 단위). 출처는 'IDF' 다.
Cooling/Heating Design Air Flow Method 가 `Flow/Zone` 이라 풍량 숫자가 적힌 경우만 읽는다. `DesignDay`(기본값)·`DesignDayWithLimit` 처럼 EnergyPlus 가 설계일 시뮬레이션으로 계산하는 값은 IDF 에 숫자가 없으므로, 지어내지 않고 "기준값 없음" 으로 두며 이유("IDF 가 시뮬레이션으로 계산하는 값")를 보인다. 시뮬레이션 결과 파일(`.eio`·sizing 리포트)은 읽지 않는다. 삼성 IDF 의 Method 가 무엇인지는 U8 에서 확인한다.
냉방·난방 설계 풍량의 선택(둘 다 있으면 큰 값)과 단위 환산(m³/s → CMH)은 OE-ZON-06 을 따른다(Q16, K9).
외기량(`DesignSpecification:OutdoorAir`)은 읽지 않는다 — 존 외기량이 아니라 1인당·면적당 단위 값이라 계산이 들어가고, 용량 검증 Z-03 이 쓰지 않는다.

## 수용 기준

- **AC1** Method 가 `Flow/Zone` 인 존은 그 값으로 Z-03 이 판정되고, 기준값 출처가 'IDF' 로 보인다.
- **AC2** Method 가 `DesignDay` 인 존은 IDF 검토 화면(OE-IDF-11)의 "기준값 없음" 목록에 이유와 함께 보이고, BIM·사용자 입력도 없으면 Z-03 이 "판정 불가" 다.
- **AC3** 한 존에 냉방·난방 설계 풍량이 둘 다 있으면 큰 값이 쓰인다.

## 메모

—
