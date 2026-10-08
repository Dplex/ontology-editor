---
id: "OE-IDF-08"
epic: "E04"
epic_title: "초기 구축 — IDF 임포트"
title: "IDF 설비 ↔ BIM 설비 연결"
prd: "#5"
release: "R2"
priority: "P1"
owner: "tbd"
status: "prd-done"
blocked_by: []
depends: ["OE-EQP-02", "OE-BIM-07"]
---

# OE-IDF-08 IDF 설비 ↔ BIM 설비 연결

## 관련 티켓

- [OE-EQP-02](../E12-EQP/OE-EQP-02.md): 미연결 설비 미배치 목록
- [OE-BIM-07](../E05-BIM/OE-BIM-07.md): 연결 대상 BIM 설비

## 요구사항

IDF 설비와 BIM 설비를 이름으로 잇는다. 기호·공백을 뗀 이름이 BIM 설비 하나와만 일치하면 연결하고, 둘 이상이거나 없으면 잇지 않는다. 이 경우 사용자가 직버 확인하고 IDF 설비와 BIM 설비를 연동한다. 
연결된 설비는 BIM 의 좌표와 IDF 의 용량·담당을 합쳐 가진다.
연결되지 않은 IDF 설비는 좌표 없이 TTL 에만 나간다(미배치 목록, OE-EQP-02).

## 수용 기준

- 연결 수와 미연결 IDF 설비 목록이 검토 화면에 보인다.
- 이름이 둘 이상의 BIM 설비와 일치하는 IDF 설비는 연결되지 않는다.

## 검증 (이 repo)

—

## 메모

—
