---
id: "OE-XPRD-04"
epic: "E22"
epic_title: "타 PRD 연동"
title: "PRD_009 권한 카탈로그"
prd: ""
release: "R1"
priority: "P1"
owner: "tbd"
status: "prd-review"
blocked_by: []
depends: ["OE-COM-01"]
---

# OE-XPRD-04 PRD_009 권한 카탈로그

## 관련 티켓

- [OE-COM-01](../E01-COM/OE-COM-01.md): 에디터 편집 권한 항목

## 요구사항

### User story

DT2.0 PM이 R2 에디터 권한 제어를 위해 PRD_009 기능 권한 카탈로그에 '에디터 편집 권한' 항목(Admin/Super Admin 가능, Viewer 불가)을 정의한다. 카탈로그에 행이 있어야 회원 관리 화면에서 역할별 편집 가능 여부가 일관되게 표시되고, 에디터가 화면 진입·API 호출에서 같은 권한 값을 참조해 다른 DT 기능과 동일한 권한 체계로 관리된다. 권한 항목이 카탈로그에 있어야 고객사 Super Admin이 회원 관리에서 특정 사용자에게 에디터 편집 권한을 부여·회수할 수 있고, Viewer가 에디터에 진입하려 할 때 일관된 거부 메시지가 보인다.

PRD_009 기능 권한 카탈로그에 에디터 편집 권한 항목(Admin/Super Admin 가능, Viewer 불가)을 정의한다(OE-COM-01).

## 수용 기준

PRD_009 권한 카탈로그에 에디터 편집 권한 행이 있다.

## 검증 (이 repo)

—

## 메모

—
