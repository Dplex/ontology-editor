---
id: "OE-OBJ-10"
epic: "E02"
epic_title: "편집 오브젝트 정의 및 분류"
title: "배관 없는 설비"
prd: "#3"
release: "R1"
priority: "P2"
owner: "tbd"
status: "prd-done"
status_note: "E5~E7"
blocked_by: []
depends: ["OE-EQP-06"]
---

# OE-OBJ-10 배관 없는 설비

## 요구사항

배관 없는 설비는 센서·조명·CCTV·엘리베이터·에스컬레이터 등 별도 배관이 연결되지 않은 독립 설비를 말한다. 
배관 없는 설비는 배치 · 이동 · 삭제 · 명칭 수정이 가능하다. 
배관 없는 설비는 서로 겹쳐서 배치할 수 없다(OE-OBJ-16).

## 수용 기준

—

## 검증 (이 repo)

- `src/lib/overlap.test.ts`: 상자(IFC 좌표)·맞닿음 여유 1cm·배관 없는 설비 가르기·새 겹침만 막기·미배치 놓기
- `e2e/overlap.spec.ts`: 좌표 없는 온도센서를 조명 자리에 놓으면 막히고, 비켜 놓으면 놓이며, 다시 조명 쪽으로 옮기면 막힌다
- `e2e/conduit-follow.spec.ts` 등 기존 화면 테스트가 그대로 통과(덕트·배관이 붙는 설비는 규칙 밖)
- 화면: `docs/figures/app-overlap-refused.png` (Duplex MEP Level 1, 벽등 #575490 을 #575488 자리로)

## 메모

- "배관 없는 설비" 는 종류(kinds.ts)에 공기·물 흐름이 없는 것이다(조명·감지기·CCTV·분전반·콘센트·욕실 부속·소화기함). 종류를 모르면
  IFC 클래스로 가른다(Sensor·LightFixture·Alarm·Outlet·ElectricDistributionBoard·통신·승강기). 덕트·배관이 붙는 설비(FCU·디퓨저·VAV)는
  이음쇠와 형상이 맞물리는 것이 정상이라 규칙 밖이다.
- 배치·이동·삭제·명칭 수정은 E5~E7 로 이미 있다. 겹침 막기는 설비를 옮기는 모든 길(3D 끌기·방향키·좌표 칸·미배치 놓기·검사의 "방 안으로")이
  거치는 `relocate` 한 곳에 있다.
- 실제 BIM 에서 이미 겹쳐 있는 배관 없는 설비 쌍: ifc4Mep 0 · Duplex MEP 0 · Office_A 0 · 성수 기계 0 · dental_clinic 1(거울과
  손잡이) · 성수 건축 16(같은 자리의 CCTV 등). 원본이 겹치게 둔 것은 막지 않고, 편집이 새로 만드는 겹침만 막는다.
