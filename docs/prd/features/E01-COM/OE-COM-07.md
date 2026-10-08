---
id: "OE-COM-07"
epic: "E01"
epic_title: "공통 · 권한 · 편집 잠금"
title: "잠금 해제 — 비정상 종료"
prd: "#1 #2"
release: "R2"
priority: "P1"
owner: "tbd"
status: "prd-review"
blocked_by: []
depends: ["OE-COM-05","Q1"]
---

# OE-COM-07 잠금 해제 — 비정상 종료

## 요구사항

브라우저 강제 종료·네트워크 단절처럼 정상 종료 없이 접속이 끊기면, 끊긴 시점 기준 60초 뒤에 잠금을 자동으로 푼다. 끊김은 heartbeat 중단으로 감지한다.
heartbeat 를 어느 수준(클라이언트·서버)에서 감지하고 잠금 서버를 어디에 둘지는 Q1(D-INT 종속)이다.

## 수용 기준

편집 중 브라우저를 강제 종료하면 60초 뒤 다른 사용자가 같은 층 편집에 진입할 수 있다. 60초 전에는 진입할 수 없다.

## 검증 (이 repo)

—

## 메모

—
