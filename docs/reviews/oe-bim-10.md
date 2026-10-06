OE-BIM-10 건축+MEP 합치기 — Duplex 기기 40/40 소속 확인

Closes #95
Branch: feature/OE-BIM-10-verify
Ticket: docs/prd/features/E05-BIM/OE-BIM-10.md
Review: docs/reviews/oe-bim-10.md
PRD: prd-review — 요구사항이 바뀌면 다시 본다

## 구현한 것
구현은 이미 있었다(`src/lib/merge.ts`). 수용 기준과 비교해 확인 테스트와 결과를 아래 표에 적었다(티켓 md 는 PM 담당이라 고치지 않는다). 새로 구현한 곳은 없다.

| 요구사항·수용 기준 | 확인 테스트(`scripts/check-sample.test.ts`) | 결과 |
|---|---|---|
| **Duplex 건축+HVAC 기기 40/40 소속** | "건축 + 설비 합치기 (Duplex)" › "…HVAC 기기 40대 전부의 소속을 찾는다" | 40/40(HVAC 혼자서는 0/40) |
| 층 이름(GUID 아님)으로 합침 | 같은 테스트 — 두 모델의 층 GUID 가 다르지만 이름으로 3/3 | 통과 |
| 좌표계 정합 판정, 낮으면 경고 | 같은 테스트(498/498, 경고 없음) · "다른 건물끼리 합치기" (AC20+ifc4Mep 2% 미만, 경고) | 통과 |
| 같은 자리 방은 하나만(MEP Space 사본 제거) | "…설비 판본의 겹친 방을 걷어 내고…" — 설비 모델 42 → 22, 합치면 21 | 통과 |
| 외곽선 없는 방은 다른 모델에서 가져옴(방 번호 기준) | 같은 테스트 — A201·B201 외곽선 가져옴 2 | 통과 |

## 화면
Duplex 건축+HVAC 를 같이 연 요약 — 기기 40, 층 이름으로 3개, 좌표 겹침 100%, 소속 없는 설비 493 → 259(남은 것은 전부 덕트·배관)
![Duplex 건축+HVAC 합치기 보고](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/blob/feature/OE-BIM-10-verify/docs/figures/oe-bim-10-merge-report.png?raw=true)

## 확인 방법
1. 8087 검토 서버(또는 `npm run dev`)에서 `data/NBU_Duplex/NBU_Duplex-Apt_Arch.ifc` 와 `NBU_Duplex-Apt_Eng-HVAC.ifc` 를 같이 선택한다
2. 3D 아래 요약에 "층 3개를 맞췄습니다: 이름으로 3개", "좌표 겹침 100%", "소속 방이 없는 설비: 493대 → 259대"
3. 경고 줄에 "덕트·배관 259대는 소속 물리존을 찾지 못했습니다" — 기기는 여기에 없다(40/40 소속)
4. 다른 건물(`data/AC20-FZK-Haus.ifc` + `data/ifc4Mep_IFC4.ifc`)을 같이 열면 좌표계 경고가 뜬다

## 테스트
- `npm run check:sample -t "합치기 \(Duplex\)|다른 건물끼리 합치기"` — 3 passed
- 코드를 고치지 않아 `npm test`·e2e 는 바뀌지 않는다

## 남은 것
- 소속 없는 덕트·배관 259 는 건축 모델 2층 복도 두 곳에 외곽선이 없어서다(SurfaceModel). MEP 모델을 같이 열면 외곽선을 가져온다
- 성수 건축+기계(2026-10-06 성수 PC, 임시 probe): 층 19/19 를 이름으로 맞춤(높이 차 0) · 좌표 겹침 100%(설비 19,336/19,336) · 기계 모델에 물리존이 없어 걷은 방·빌린 외곽선 0 · 소속 방이 없던 설비 19,336 → 2,984 · 기기마다 소속 방 4,137/4,708(`check:seongsu`). 수용 기준의 "기기 40/40" 은 Duplex 몫이라 성수에 같은 잣대는 없다
