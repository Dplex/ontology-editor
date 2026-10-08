---
id: "OE-INT-03"
epic: "E20"
epic_title: "DT 연동 · 저장 · ID"
title: "DT 3D 형상 출력"
prd: "1.7"
release: "R1"
priority: "P1"
owner: "tbd"
status: "prd-review"
status_note: "D11"
blocked_by: ["D11"]
depends: ["D11","OE-GEN-06"]
---

# OE-INT-03 DT 3D 형상 출력

## 관련 티켓

- [OE-GEN-06](../E08-GEN/OE-GEN-06.md): D11 결정이 수용 기준을 좌우하는 3D Map 생성

## 요구사항

### User story

구축 담당자가 등록한 온톨로지를 운영 담당자가 Unity 3D Map에서 보려면 GeoJSON만으로 물리존 판·벽·문·창·설비를 그릴 수 있는지, FBX/glTF/IMDF 출력이 더 필요한지와 변환 주체를 정해야 한다(D11). PoC는 IMDF 변환을 범위 밖으로 두고 있으므로, 결정 전에 에디터가 추가 포맷을 지원하겠다고 약속하지 않고 DT팀과 합의한 뒤 수용 기준을 적는다. 결정 결과는 3D Map 생성(OE-GEN-06)의 수용 기준과 에디터 산출물 범위를 좌우하므로, 구축 담당자가 등록 직후 DT에서 보게 될 화면의 품질과 출력 작업량이 이 결정에 달려 있다.

Unity 3D Map 이 GeoJSON 만으로 물리존 판·벽·문·창·설비를 그릴 수 있는지, FBX/glTF 또는 IMDF 출력이 더 필요한지와 변환 주체를 정한다(D11, S7). PoC 입장은 "IMDF 변환은 범위 아님" 이다.

## 수용 기준

D11 결정 후 적는다.

## 검증 (이 repo)

—

## 메모

—
