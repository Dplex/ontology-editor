OE-REQ-03 어휘 표 — 코드·IDS·BIM→DT 문서를 양방향으로 비교

Closes #113
Branch: feature/OE-REQ-03-verify
Ticket: docs/prd/features/E06-REQ/OE-REQ-03.md
Review: docs/reviews/oe-req-03.md
PRD: prd-review — 요구사항이 바뀌면 다시 본다

## 구현한 것
구현은 이미 있었다. 어휘의 원본은 코드(`src/lib/kinds.ts` 의 `ifc`·`SYSTEM_IFC`·`ROOM_KINDS`, `src/lib/capacity.ts`)이고 사본이 둘이다 — 고객사에 주는 `docs/requirements.ids` 와 BIM→DT 문서(`docs/bim-to-dt-ontology.md` — 테스트 이름·PRD 의 '정본') 4장 "종류·계통·용량의 이름" 표. 기존 테스트(`src/lib/requirements-ids.test.ts`)는 대부분 **IDS → 코드** 한 방향만 확인했고, BIM→DT 문서 표는 확인하는 테스트가 없었다. 빠진 방향을 추가했다.

| 어휘 | IDS ↔ 코드 | BIM→DT 문서 표 ↔ 코드 |
|---|---|---|
| 종류(R24) `클래스.PredefinedType` | 기존 테스트 "R24 의 설비 종류는 kinds.ts 의 ifc 표와 같은 어휘다"(양쪽) | **새로** "정본 4장의 어휘 표(종류·계통·방 분류)가 kinds.ts 와 같다" — 21개 |
| 계통(R16) PredefinedType·약어 | 기존 테스트 "R16 의 계통 약어는 kinds.ts 의 SYSTEM_IFC 와 같다" | **새로** 같은 테스트 — PredefinedType 8 · 약어 7 |
| 방 분류(R14) OmniClass | 기존 테스트 "R14 의 방 분류는 … 같은 체계다"(IDS 는 패턴이라 체계만) | **새로** 같은 테스트 — 코드 10개 |
| 용량 이름(R21) | 기존 테스트는 IDS → 코드만. **새로** "R21 이 요구하는 용량 이름은 capacity.ts 의 표준 이름과 같다 — 양쪽으로" — 6개 | — (BIM→DT 문서는 문단이라 표가 없다) |
| 용량을 요구하는 클래스(R21) | **새로** "R21 이 용량을 요구하는 클래스는 capacity.ts 의 CAPACITY_KINDS 와 같다" — 8개 클래스 | — |

보완한 것: BIM→DT 문서 표의 VAV 값이 `…INDEPENDANT` 로 줄여 적혀 있어 테스트가 사본을 정확히 비교할 수 없었다. 전체 이름(`VARIABLEFLOWPRESSUREINDEPENDANT`)으로 고쳤다. BIM→DT 문서는 개발 저장소의 문서라 PRD 가 아니다.

**수용 기준 "불일치 시 테스트 실패" 를 일부러 확인했다.** 한 군데씩 바꾸고 테스트를 돌린 뒤 되돌렸다.

| 바꾼 것 | 실패한 테스트 |
|---|---|
| 코드: FCU 에 `UnitaryEquipment.CHILLEDBEAM` 추가 | R24 어휘 · BIM→DT 문서 어휘 표 |
| IDS: R24 에서 `GRILLE` 빼기 | R24 어휘 |
| 코드: `TotalCoolingCapacity` 를 표준으로 | R21 용량 이름(새 테스트만) |
| 코드: 공기 계통 약어 `SUA` 추가 | R16 약어 · BIM→DT 문서 어휘 표 |
| 코드: 방 분류 코드 `13-75 11 21` 추가 | BIM→DT 문서 어휘 표(새 테스트만) |
| 코드: 용량 요구 종류에 보일러 추가 | R21 클래스(새 테스트만) |

이 중 "새 테스트만" 셋은 이전 테스트로는 통과해 버렸다 — IDS 는 방 분류를 패턴(`13-…`)으로 받고, 용량 쪽은 IDS 이름이 코드에 있는지만 봤기 때문이다.

## 화면
어휘를 한 군데씩 어긋나게 바꿨을 때 실패하는 테스트
![어긋남을 잡는 테스트](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/blob/feature/OE-REQ-03-verify/docs/figures/oe-req-03-mutations.png?raw=true)

## 확인 방법
1. `npx vitest run src/lib/requirements-ids.test.ts` → 11 passed
2. `src/lib/capacity.ts` 의 `CAPACITY_KINDS` 에 `'boiler'` 를 추가하고 다시 돌린다 → "R21 이 용량을 요구하는 클래스는 capacity.ts 의 CAPACITY_KINDS 와 같다" 가 IFCBOILER 를 원인으로 실패한다
3. `docs/bim-to-dt-ontology.md` 4장 방 분류 표에서 한 줄을 지우고 돌린다 → "정본 4장의 어휘 표…" 가 빠진 코드를 원인으로 실패한다

## 테스트
- `npm test` — 38 files · 601 passed(새로 넣은 것: `requirements-ids.test.ts` 3개)
- `npx vue-tsc --noEmit` 통과
- 어휘를 어긋나게 바꾼 6가지 — 모두 실패(위 표)

## 남은 것
- 용량 이름의 BIM→DT 문서 쪽 사본은 표가 아니라 문단(`DT_Capacity.NominalAirFlowRate` 등)이라 테스트하지 않았다
- 클래스만으로 종류가 정해지는 줄(`IfcBoiler` …)은 값이 없어 BIM→DT 문서 표 테스트에서 뺐다. 그 목록은 kinds.ts 의 `ifc` 에 `.` 없는 항목과 같아야 하지만, BIM→DT 문서는 "…" 로 일부만 적는다
