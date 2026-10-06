OE-BIM-19 버전 비교 — GUID 유지율과 "GUID가 바뀐 것" 목록(R13)

Closes #104
Branch: feature/OE-BIM-19-rekeyed
Ticket: docs/prd/features/E05-BIM/OE-BIM-19.md
Review: docs/reviews/oe-bim-19.md
PRD: prd-review — 요구사항이 바뀌면 다시 본다

## 구현한 것
버전 비교는 이미 있었다(`src/lib/versions.ts`, 검토 화면의 "버전 비교" 칸). 이전 버전과 GUID → Revit 요소 ID → 이름 → 위치 순으로 매칭하고, 추가·삭제·이동·소속 변화·이름·넓이 변화를 목록으로 보여 주며, 요구사항 R13 을 그 결과로 확인한다. 수용 기준 **"R13 판정 근거"** 에 못 미친 곳은, GUID 가 바뀐 것이 **숫자로만** 있었다는 점이다("설비 217(Revit 요소 ID로 217개 찾음)"). 어느 요소의 DT id 가 바뀌는지 고객사에 보여 줄 수 없었다. 이 부분을 추가했다.

- `compareVersions` 가 물리존·설비마다 `rekeyed` 를 반환한다 — GUID 가 바뀐 요소 하나하나의 현재 id·이름, 이전 GUID, 무엇으로 찾았나(Revit 요소 ID·이름·위치). 개수는 `by` 와 같다
- 화면 요약표에 **"GUID 유지"** 칸 — 양쪽에 있는 것 중 GUID 가 그대로인 비율
- 목록 탭 맨 앞에 **[GUID가 바뀐 것 n]** — 비교하면 이 목록이 먼저 열린다. 줄마다 "이름으로 찾음 · 이전 GUID 0CRPz_…". 이름을 누르면 3D 와 오른쪽 패널에서 그 요소로 이동한다
- R13 의 요청은 OE-BIM-17 에서 정했다 — "내보내기 설정을 바꿔 달라 — IFC GUID를 요소 매개변수에 저장해 다음 내보내기에도 같은 GUID로"(ADR-0006)

모두 브라우저 안의 비교 결과다. BIM·TTL·GeoJSON 에는 아무것도 남지 않는다.

| 요구사항·수용 기준 | 확인 테스트 | 결과 |
|---|---|---|
| 같은 건물 이전 판과 GUID 유지율·변경 항목 비교 | 기존 `src/lib/versions.test.ts` "판본 짝짓기" 5개 · "두 판본 견주기" · "판본 비교 (mep.ifc → mep-v2.ifc)" | 통과 |
| **R13 판정 근거** — GUID 가 바뀐 것 하나하나 | `versions.test.ts` "GUID 가 바뀐 것을 하나하나 이전 GUID 와 찾은 열쇠로 든다" — 사무실·AHU-1, 둘 다 이름으로 찾음, 개수 = by | 통과 |
| (실제 버전) | `scripts/check-sample.test.ts` "판본 사이의 GUID (Duplex)" — Duplex MEP → MEP-2 에서 설비 217대가 이전 GUID 와 다르고 이름 끝 Revit 요소 ID 가 같다, 방 15개(이름 14·위치 1) | 통과 |
| 화면 | `e2e/versions.spec.ts` — GUID 유지 설비 80%·물리존 0%, [GUID가 바뀐 것 2] 가 먼저 열리고 AHU-1 줄에 "이름으로 찾음 · 이전 GUID" | 통과 |

실제 버전(같은 Revit MEP 2011 로 한 달 반 뒤 다시 export 한 Duplex MEP → MEP-2)에서:

| | 이전 → 지금 | 양쪽에 있는 것 | GUID 유지 | GUID가 바뀐 것 |
|---|---|---|---|---|
| 물리존 | 22 → 24 | 15 | 0% | 15(이름 14 · 위치 1) |
| 설비 | 926 → 487 | 344 | 37% | 217(Revit 요소 ID 217) |

요구사항 R13: 다른 자리 127 · 232 / 359, 요청 "내보내기 설정을 바꿔 달라 — IFC GUID를 요소 매개변수에 저장해 …".

## 화면
Duplex MEP-2 를 열고 이전 버전(MEP)을 비교한 화면 — GUID 유지율과 [GUID가 바뀐 것 232] 목록
![GUID가 바뀐 것](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/blob/feature/OE-BIM-19-rekeyed/docs/figures/oe-bim-19-rekeyed.png?raw=true)

같은 비교의 요구사항 R13 줄
![R13](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/blob/feature/OE-BIM-19-rekeyed/docs/figures/oe-bim-19-r13.png?raw=true)

## 확인 방법
1. 8087 검토 서버(또는 `npm run dev`)에서 `data/NBU_Duplex/NBU_Duplex-Apt_Eng-MEP-2.ifc` 를 연다
2. "버전 비교" 칸을 펼치고 [이전 버전 열기] 로 `data/NBU_Duplex/NBU_Duplex-Apt_Eng-MEP.ifc` 를 선택한다
3. 요약표: 물리존 GUID 유지 0%(15개 바뀜), 설비 37%(217개 바뀜, Revit 요소 ID로 찾음)
4. [GUID가 바뀐 것 232] 가 열려 있고 첫 줄 "Level 1 Living Room (A102) — 이름으로 찾음 · 이전 GUID 0CRPz_SEr94Ah74P8LhwCz". 이름을 누르면 그 방으로 이동한다
5. "요구사항" 의 R13 → 다른 자리 127 · 232 / 359

## 테스트
- `npm test` — 38 files · 605 passed(새로 넣은 것: `versions.test.ts` 1개)
- `npx vue-tsc --noEmit` 통과
- `npm run check:sample -t "판본 사이의 GUID"` — 1 passed
- e2e — `npx playwright test` 102 passed(`e2e/versions.spec.ts` 에 유지율·목록 확인을 추가함)

## 남은 것
- 매칭하지 못한 것(한 key 에 둘 이상이 걸려 새것·없어진 것으로 집계한 것)은 R13 에 포함되지 않는다. Duplex MEP-2 는 같은 자리에 요소 ID 가 다른 설비 9대가 있다 — GUID 가 바뀐 것인지 다른 요소인지 파일만으로는 구분할 수 없다
- 버전 비교는 IFC 하나끼리다. 건축+설비를 합친 모델을 이전 버전의 합친 모델과 비교하는 기능은 없다
