---
id: "ADR-0025"
title: "방의 BIM 면적은 NetFloorArea → GrossFloorArea → GSA BIM Area → Revit 치수 Area 순으로 읽고, 외곽선을 그리면 ±20%·겹침 0.05㎡ 를 넘을 때 경고만 한다"
status: "제안"
date: "2026-10-09"
deciders: ["정희록"]
prd: []
tickets: ["OE-MAN-03"]
supersedes: []
superseded_by: ""
---

# ADR-0025 방의 BIM 면적과 외곽선 채우기의 경고

## 맥락

OE-MAN-03 은 외곽선 없는 물리존 목록에 BIM 면적을 보이고, 사람이 그린 외곽선이 BIM 면적과 ±20% 넘게 다르면 경고하라고 한다(기준값은
결정 필요). 이 저장소는 방의 넓이를 외곽선으로만 쟀고 BIM 이 적은 면적은 읽지 않았다. 가진 BIM 에서 면적이 적힌 자리는 이렇다(2026-10-09).

| 파일 | 자리 | BIM 면적 ÷ 외곽선 넓이(가운데 값) | ±20% 안 |
|---|---|---|---|
| AC20 · Institute | 기준 물량 `NetFloorArea` | 0.97 · 0.97 | 6/7 · 80/82 |
| Duplex 건축 · 병원 건축 · Office | Revit `PSet_Revit_Dimensions.Area`(같은 값의 `GSA BIM Area` 도 있다) | 1.15 · 1.08 · 1.07 | 13/19 · 259/266 · 99/99 |
| 성수 건축 | 없음 | — | — |

## 결정

- **BIM 면적은 ① `NetFloorArea` ② `GrossFloorArea` ③ `GSA BIM Area` ④ Revit 치수 세트의 `Area` 순으로 읽는다.** 바닥 면적을 말하는 것을
  앞에 둔다. `Area` 는 이름이 흔해서 세트 이름이 Revit 치수 세트(`PSet_Revit_Dimensions`·`Dimensions`)일 때만 읽는다. 단위는 프로젝트의
  `AREAUNIT` 이고, 없으면 길이 단위의 제곱이다(`units.ts` 의 `areaScale`).
- **그린 뒤의 경고는 막지 않는다.** ±20% 는 PRD 의 값을 그대로 쓴다. BIM 이 그린 외곽선끼리 견줘도 Duplex 는 19개 중 6개가 이 밖이라
  (Revit 면적과 방 경계의 기준선이 다를 수 있다) 막으면 맞게 그린 것도 막힌다. 다른 물리존과 0.05㎡ 넘게 겹치면 상대 이름과 겹친 넓이를,
  스스로 교차하면 그것을 알린다. 벽 두께 안에서 찍은 점이 이웃 방에 조금 들어가는 것은 흔해서 그보다 작은 것은 세지 않는다.
- 리포트에서 물리존이 없는 소속은 "(1F 층까지만)" 처럼 층으로 적는다. TTL 이 그 설비의 위치를 층으로 적는 것과 같다.

## 결과

- 성수처럼 면적 속성이 없는 파일은 목록에 "BIM 면적 없음" 이고 넓이 경고가 없다. 겹침·자기교차 경고는 있다.
- 기준값을 바꾸려면 `outline-fill.ts` 의 `AREA_WARN_RATIO`·`OVERLAP_WARN_M2` 를 고친다. BIM 면적은 TTL·GeoJSON 으로 나가지 않는다(`ex:areaM2` 는
  지금처럼 외곽선으로 잰 넓이다).
