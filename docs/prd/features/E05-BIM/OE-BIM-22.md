---
id: "OE-BIM-22"
epic: "E05"
epic_title: "초기 구축 — BIM 임포트 · 검토 화면"
title: "좌표 정합 경고"
prd: "#6"
release: "R1"
priority: "P1"
owner: "tbd"
status: "prd-review"
status_note: "BIM 간 ✔, 스캔 대조 ✗"
blocked_by: []
depends: ["R7","P4"]
---

# OE-BIM-22 좌표 정합 경고

## 요구사항

BIM 좌표계가 3D 스캔 모델이나 다른 BIM 판본과 원점·회전이 어긋나면 경고한다. 이 어긋남은 오류 없이 통째로 나는 것이라 반드시 사람에게 보인다. 경고와 함께 오프셋 값을 보여 임포트 단계에서 맞출 수 있게 한다(OE-INT-04). 기준점 정의 주체는 P4.

## 수용 기준

원점이 다른 두 파일을 열면 경고와 x·y·회전 오프셋 값이 보인다.

## 검증 (이 repo)

—

## 메모

—
