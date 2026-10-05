OE-MAP-01 설비 → 물리존 자동 판정 — Duplex MEP 정답 대비 95.8% 확인

Closes #158
Branch: feature/OE-MAP-01-verify
Ticket: docs/prd/features/E11-MAP/OE-MAP-01.md
Review: docs/reviews/oe-map-01.md
PRD: prd-review — 요구사항이 바뀌면 다시 본다

## 구현한 것
구현은 이미 있었다(`src/lib/mapping.ts`, 편집 함수 안의 재판정 `src/lib/edit.ts`). 수용 기준과 비교해 확인 테스트와 결과를 아래 표에 적었다(티켓 md 는 PM 담당이라 고치지 않는다). 새로 구현한 곳은 없다.

| 요구사항·수용 기준 | 확인 테스트 | 결과 |
|---|---|---|
| **Duplex MEP 정답 대비 95.8%** | `check:sample` "설비 소속 판정의 정확도 (BIM 이 말한 소속을 정답지로)" | 160/167 = 95.8% |
| K1 외곽선 5cm 여유 | 같은 테스트(여유 0 → 73%, 5cm → 95.8%, 30cm 도 같다) · `mapping.test.ts` "외곽선 바로 위의 점은 그 방에 붙인다" 외 2 | 통과 |
| K2 BIM 명시 소속 우선(경계 밖이어도 유지) | `edit.test.ts` "BIM 이 소속을 말한 설비는 경계를 바꿔도 그대로다" | 통과 |
| 경계 변경 시 사용자 확인 없이 자동 판정 | `edit.test.ts` "경계 밖으로 밀려난 설비의 소속이 바뀐다" — 재판정이 편집 함수 안에 있다 | 통과 |

## 화면
Duplex MEP 주방(A103) 꼭짓점을 끌어 13.0 → 4.5㎡ 로 줄인 직후. 좌표로 판정한 덕트·배관은 37 → 11 로 다시 판정하고, BIM 에 소속이 있는 냉장고·레인지·싱크·콘센트 11대는 경계 밖이어도 주방에 남는다(K2)
![Duplex MEP 주방 경계를 줄인 뒤의 소속](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/blob/feature/OE-MAP-01-verify/docs/figures/oe-map-01-boundary-rejudge.png?raw=true)

## 확인 방법
1. 8087 검토 서버(또는 `npm run dev`)에서 `data/NBU_Duplex/NBU_Duplex-Apt_Eng-MEP.ifc` 를 연다 → [편집] → 층 `Level 1만`
2. 주방(Kitchen A103) 빈 바닥을 누른다 → 패널 "넓이 13.0㎡ · 소속 기기 12대 · 덕트·배관 37개", F 로 시점 맞추기
3. 오른쪽 위 파란 손잡이를 주방 안쪽으로 끈다 → 넓이 4.5㎡, 덕트·배관 11개(다시 판정), 기기 11대(BIM 소속은 남는다)
4. 편집 바의 "바뀐 것 n건" 을 누르면 리포트에 "…: Kitchen → (소속 없음)" 줄이 사용자 확인 없이 바로 적혀 있다. Ctrl+Z 로 되돌린다

## 테스트
- `npm run check:sample -t "설비 소속 판정의 정확도"` — 1 passed(160/167)
- `npx vitest run src/lib/edit.test.ts src/lib/mapping.test.ts -t "경계 밖으로 밀려난|BIM 이 소속을 말한 설비는 경계를|외곽선 바로 위|SNAP 밖은|벽 반대쪽|BIM 이 소속을 말한 설비도 옮기면"` — 6 passed
- 코드를 고치지 않아 `npm test`·e2e 는 바뀌지 않는다

## 남은 것
- 틀린 7대(어느 방에도 속하지 않음 5, 다른 방 2)는 BIM→DT 문서(`docs/bim-to-dt-ontology.md`) §3.3 표에 숫자가 있다. 하나씩 원인을 확인하지는 않았다
- 영향(이상 알림 위치·탐색기)은 수신 측 담당이다. 우리는 TTL `brick:hasLocation` 이 바뀌는 것까지다
- 성수(2026-10-06 성수 PC, 임시 probe): BIM 이 소속을 말한 설비는 건축 모델의 1,033대뿐이다(기계 모델에는 물리존이 없다). 이것을 정답지로 좌표 판정이 **976/1,033 = 94.5%**(벽면 여유 0 이면 942 = 91.2%) · 어느 방에도 안 듦 31 · 다른 방 26. 수용 기준 95.8% 는 Duplex MEP 값이고, 성수는 그보다 1.3%p 낮다
