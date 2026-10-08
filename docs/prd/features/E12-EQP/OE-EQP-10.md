---
id: "OE-EQP-10"
epic: "E12"
epic_title: "설비 배치 · 편집"
title: "VAV·토출구 디테일"
prd: "#13"
release: "R1"
priority: "P1"
owner: "tbd"
status: "prd-done"
blocked_by: []
depends: ["OE-ZON-01", "OE-PIP-11", "OE-BIM-18", "OE-EQP-04", "OE-PIP-02"]
---

# OE-EQP-10 VAV·토출구 디테일

## 관련 티켓

- [OE-ZON-01](../E10-ZON/OE-ZON-01.md): 계통 기반 담당 공조존 판정
- [OE-PIP-11](../E13-PIP/OE-PIP-11.md): 수동 배관의 소속 계통
- [OE-BIM-18](../E05-BIM/OE-BIM-18.md): 계통 없는 설비 완전성 위반
- [OE-EQP-04](./OE-EQP-04.md): 플레넘·반자 부착 표시
- [OE-PIP-02](../E13-PIP/OE-PIP-02.md): 소속 계통 지정

## 요구사항

변풍량 유닛(VAV)과 토출구(디퓨저·그릴)는 소속 계통이 필수다. 소속 계통은 담당 공조존 판정의 근거가 된다(OE-ZON-01, OE-PIP-11). 계통이 없는 VAV·토출구는 경고하고 완전성 검사(OE-BIM-18) 위반으로 간주한다. VAV 는 플레넘, 토출구는 반자 부착이다(OE-EQP-04).

## 수용 기준

계통이 없는 VAV 에 경고가 보이고 완전성 검사에 집계된다.

## 검증 (이 repo)

—

## 메모

—
