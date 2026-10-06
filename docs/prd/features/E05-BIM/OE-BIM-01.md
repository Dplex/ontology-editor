---
id: "OE-BIM-01"
epic: "E05"
epic_title: "초기 구축 — BIM 임포트 · 검토 화면"
title: "IFC 파싱"
prd: "#6"
release: "R1"
priority: "P1"
owner: "tbd"
status: "prd-review"
blocked_by: []
depends: ["R0","P5"]
---

# OE-BIM-01 IFC 파싱

## 요구사항

IFC2x3 와 IFC4 파일을 브라우저 안에서 WASM(web-ifc)으로 파싱한다. 백엔드 서버 없이 동작한다. IFC2x3 도 등급 0~2 를 만족할 수 있으므로 스키마로 분기하지 않는다(PRD 1.6).
파일 크기 상한과 분할 제출 단위는 P5 에 따른다.

## 수용 기준

성수 건축(84MB)+기계(203MB) 파일이 16초 안에 열린다.

## 검증 (이 repo)

—

## 메모

—
