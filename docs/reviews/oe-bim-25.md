OE-BIM-25 임포트 피처 선택 — 끈 벽·문·창은 0 이 아니라 "읽지 않음"

Closes #110
Branch: feature/OE-BIM-25-verify
Ticket: docs/prd/features/E05-BIM/OE-BIM-25.md
Review: docs/reviews/oe-bim-25.md
PRD: prd-review — 요구사항이 바뀌면 다시 본다

## 구현한 것
구현은 이미 있었다 — 파일 여는 칸의 [읽을 것: 벽·문·창] 체크(`App.vue`)를 끄면 그 요소를 모델에 넣지 않고 `Model.skipped` 에 적는다(`import.ts`).
요약 칸은 0 대신 "– 읽지 않음", 요구사항 보고서는 벽이 필요한 줄을 "잴 수 없음" 으로 둔다(`requirements.ts`). 합칠 때 한쪽이라도 읽지 않았으면
읽지 않은 것으로 본다(`merge.ts`).

테스트는 직접 만든 fixture(`import.test.ts`)와 e2e 요약 칸(`smoke.spec.ts`)뿐이었다. **큰 실제 건축 파일을 끄고 열었을 때**를 확인하는 테스트를 추가했다.

| 요구사항·수용 기준 | 확인 테스트 | 결과 (병원 건축) |
|---|---|---|
| 피처별(벽·문·창)로 읽기를 끌 수 있다 | `check:sample` "병원 건축에서 벽·문·창을 끄면 …"(새로 넣음) · `import.test.ts` | 벽 1,080 · 문·창 307 → 0. 물리존 269 · 기기 102 는 그대로(항상 읽는다) |
| **끈 것은 "읽지 않음"(0 이 아님) — `Model.skipped` 표시** | 같은 새 테스트 · e2e `smoke.spec.ts`(요약 칸 "읽지 않음") | `skipped = [walls, doors, windows]` |
| — 요구사항 보고서 | 같은 새 테스트 · `requirements.test.ts` | R4(문·창의 개구부 관계)·R22 가 "없음" 이 아니라 잴 수 없음. 다 읽으면 잴 수 없음이 아니다 |
| — 합치기 | 같은 새 테스트 | 병원 HVAC 를 같이 열어도 `skipped` 가 유지된다 |
| — 온톨로지 | 같은 새 테스트 | TTL 이 바이트까지 같다(벽·문·창은 GeoJSON 에만 들어간다) |
| — 속도 | 같은 새 테스트 | warm-up 후 770ms → 560~630ms(2회 측정). 벽·문·창 형상을 읽지 않는 만큼 빨라진다 |

저장 위치: `Model.skipped` 는 화면(요약 칸·요구사항 보고서)에만 쓰인다. GeoJSON 에는 벽·문·창 feature 가 없고, 끈 사실은 파일에 남지 않는다.

## 화면
파일 여는 칸의 [읽을 것] 에서 벽·문·창을 끈 화면.
![읽을 것](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/blob/feature/OE-BIM-25-verify/docs/figures/oe-bim-25-options.png?raw=true)

그렇게 연 병원 건축의 요약 칸 — 벽·문·창문이 0 이 아니라 "– 읽지 않음".
![요약 칸](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/blob/feature/OE-BIM-25-verify/docs/figures/oe-bim-25-tiles.png?raw=true)

## 확인 방법
1. 8087 검토 서버(또는 `npm run dev`) 첫 화면의 [읽을 것] 에서 벽·문·창 체크를 끈다
2. `data/NBU_MedicalClinic/NBU_MedicalClinic_Arch.ifc` 를 연다 → 요약 칸 벽·문·창문이 "– 읽지 않음", 물리존 269 · 기기 102
3. [요구사항] 을 펼치면 R4·R22 가 "잴 수 없음"
4. 체크를 다시 켜고 열면 벽 1,080 · 문 249 · 창문 58

## 테스트
- `npm run check:sample -t "OE-BIM-25"` — 1 passed(새로 넣음)
- 코드를 고치지 않아 단위·e2e 는 바뀌지 않는다

## 남은 것
- 끈 사실이 내보낸 파일에 남지 않는다. 받는 쪽이 GeoJSON 에 벽이 없는 것을 "BIM 에 벽이 없다" 로 읽을 수 있다 — 필요하면 GeoJSON 머리에 적는다(needs-pm)
- 성수는 이 PC 에 없어 측정하지 못했다
