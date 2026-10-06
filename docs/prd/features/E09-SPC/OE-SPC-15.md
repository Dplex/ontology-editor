---
id: "OE-SPC-15"
epic: "E09"
epic_title: "공간 편집"
title: "겹침 차단 UX"
prd: "#9 #10"
release: "R1"
priority: "P1"
owner: "srcn"
status: "prd-review"
blocked_by: []
depends: ["OE-OBJ-16"]
---

# OE-SPC-15 겹침 차단 UX

## 요구사항

이미 오브젝트가 있는 좌표에 배치 시 차단 + 겹친 대상을 붉게 하이라이트 + '이미 오브젝트가 있는 위치입니다' 안내 문구 표시

## 수용 기준

—

## 검증 (이 repo)

- `src/lib/overlap.test.ts`: 상자(IFC 좌표)·맞닿음 여유 1cm·배관 없는 설비 가르기·새 겹침만 막기·미배치 놓기
- `e2e/overlap.spec.ts`: 좌표 없는 온도센서를 조명 자리에 놓으면 막히고, 비켜 놓으면 놓이며, 다시 조명 쪽으로 옮기면 막힌다
- `e2e/conduit-follow.spec.ts` 등 기존 화면 테스트가 그대로 통과(덕트·배관이 붙는 설비는 규칙 밖)
- 화면: `docs/figures/app-overlap-refused.png` (Duplex MEP Level 1, 벽등 #575490 을 #575488 자리로)

## 메모

- 막힌 자리에 두지 않는다. 3D 에서 끌어 놓았으면 형상이 원래 자리로 미끄러져 돌아가고, 좌표 칸은 지금 값으로 되돌아간다.
- 겹친 상대를 3D 에 붉은 상자로 2.6초 짚고(`viewer.markConflict`), 3D 아래 알림 줄에 문구 "이미 오브젝트가 있는 위치입니다" 와 상대 이름을 띄운다.
  툴팁 대신 알림 줄인 것은 막힌 다른 편집(경계 교차, 포트 방향)과 같은 자리라서다.
