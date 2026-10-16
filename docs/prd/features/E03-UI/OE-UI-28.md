---
id: "OE-UI-28"
epic: "E03"
epic_title: "진입점 · 화면 구성 · 편집 도구"
title: "그리는 중 길이 · 각도 입력"
prd: "#4"
release: "R1"
priority: "P2"
owner: "tbd"
status: "prd-done"
blocked_by: []
depends: ["OE-SPC-12", "OE-MAN-03", "OE-PIP-11", "OE-INT-04", "OE-UI-08", "OE-UI-06", "OE-UI-18", "OE-MAN-01"]
---

# OE-UI-28 그리는 중 길이 · 각도 입력

## 관련 티켓

- [OE-SPC-12](../E09-SPC/OE-SPC-12.md): 벽 그리기
- [OE-MAN-03](../E07-MAN/OE-MAN-03.md): 외곽선 그리기
- [OE-PIP-11](../E13-PIP/OE-PIP-11.md): 배관 그리기
- [OE-INT-04](../E20-INT/OE-INT-04.md): 단위 m
- [OE-UI-08](./OE-UI-08.md): 치수 표시
- [OE-UI-06](./OE-UI-06.md): 스냅
- [OE-UI-18](./OE-UI-18.md): 단계 안내
- [OE-MAN-01](../E07-MAN/OE-MAN-01.md): 배경 위 수동 작성

## 요구사항
> User story : 구축 담당자는 벽 · 물리존 외곽선 · 배관을 그리는 도중 커서 옆 칸에 길이와 각도를 숫자로 쳐서 정확한 자리에 다음 점을 놓을 수 있다. 각도는 0 · 15 · 45 · 90° 근처에서 끌려가 반듯하게 그려지고, "6" 을 치고 Enter 를 누르면 정확히 6 m 벽이 생긴다. 평면도 배경을 보고 도면 치수를 옮겨 그릴 때 눈대중 대신 숫자로 맞춘다.

벽(OE-SPC-12) · 물리존 외곽선(OE-MAN-03) · 배관(OE-PIP-11)을 그리는 도구에서, 첫 점을 찍은 뒤 커서 옆에 길이 · 각도 칸을 보인다.
- 칸에는 지금 커서까지의 길이(m, OE-INT-04)와 각도가 실시간으로 보이고(OE-UI-08 과 같은 값), 숫자를 치면 그 값이 고정된다. Tab 으로 길이 ↔ 각도 칸을 옮기고 Enter 로 그 자리에 다음 점을 놓는다.
- 각도 끌림: 0 · 15 · 45 · 90° 근처에서 그 각도로 붙고 안내선을 보인다. Shift 를 누르는 동안 끈다. 스냅(OE-UI-06)이 함께 걸리면 인접 오브젝트 스냅이 먼저다.
- Backspace 는 마지막 점을 지우고, Esc 는 그리기를 취소한다. 단계 안내(OE-UI-18)에 칸 사용법을 보인다.
- 평면도 배경 위 수동 작성(OE-MAN-01)에서 같은 칸을 쓴다.

## 수용 기준

- **AC1** 벽 그리기에서 첫 점을 찍고 길이 칸에 6 을 쳐 Enter 를 누르면 길이 6.00 m 벽이 생긴다.
- **AC2** 커서를 44° 쯤으로 옮기면 45° 로 붙고, Shift 를 누르면 커서 각도 그대로 간다.
- **AC3** Tab 으로 각도 칸으로 옮겨 90 을 치면 수직 방향으로 고정된다.

## 메모

- 2026-10-16 Revit·AutoCAD 벤치마킹(docs/presentation/editor-benchmark-2026-10-15.html, 브랜치 bim-editor-benchmarking)에서 뽑았다. 원조: AutoCAD Dynamic Input · Polar Tracking, Revit 임시 치수. 벤치마킹 카드 ⑤. BIM 이 있는 층은 새로 그릴 일이 적어 P2.
