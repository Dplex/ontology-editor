OE-REQ-02 IDS 검사 파일 — 옮긴 R 목록·IDS 스키마·ifctester 결과 확인

Closes #112
Branch: feature/OE-REQ-02-verify
Ticket: docs/prd/features/E06-REQ/OE-REQ-02.md
Review: docs/reviews/oe-req-02.md
PRD: prd-review — 요구사항이 바뀌면 다시 본다

## 구현한 것
구현은 이미 있었다(`docs/requirements.ids`, BIM→DT 문서(`docs/bim-to-dt-ontology.md` — 테스트 이름·PRD 의 '정본') 4장). 기존 테스트(`requirements-ids.test.ts`)는 등급·어휘만 확인했다. 수용 기준의 R 목록, IDS 1.0 형식, 고객사가 실제로 돌리는 ifctester 결과를 확인하는 테스트를 추가했다. IDS 는 고치지 않았다.

| 요구사항·수용 기준 | 확인 테스트 | 결과 |
|---|---|---|
| **옮긴 R: R1 R3 R6 R14 R16 R19 R21 R22 R23 R24 · 일부 R2 R4 R7 R9 R11 R17** | `src/lib/requirements-ids.test.ts` "옮긴 R 번호가 정본 4장의 '옮겼다·일부만 옮겼다' 와 같고…" — IDS 의 `identifier` 집합 = BIM→DT 문서 표 두 줄의 합, "옮기지 못했다"(R0 R5 R8 R10 R12 R13 R15 R18 R20)는 없음, 세 줄이 R0~R24 를 한 번씩 포함, 이름의 R 번호 = identifier | 16개 R, 수용 기준 목록과 같음 |
| IDS 1.0 명세 | `scripts/check-sample.test.ts` "IDS 를 ifctester 로 (OE-REQ-02)" — `ifctester.ids.open(validate=True)` 가 ifctester 에 포함된 IDS 1.0 XSD 로 검사 | 통과, 명세 38개 |
| 고객사가 ifctester 로 자체 검사 | 같은 테스트 — `scripts/ids-check.py` 로 보유 샘플 BIM 6개를 ifctester 0.8.5 로 검사해 명세마다 대상·통과 수를 BIM→DT 문서 4장 "가진 파일로 확인한 결과" 표와 비교한다 | 6개 파일 모두 표와 같음 |

ifctester 로 확인한 값(필수만 — 권장까지는 테스트에 있다):

| 파일 | R1 | R2 | R3 | R3 기본 이름 | R4 | R6 | R7 | R9 | R11 |
|---|---|---|---|---|---|---|---|---|---|
| AC20 | 2/2 | 7/7 | 14/14 | 0 | 16/16 | 1/1 | 없음 | 없음 | – |
| ifc4Mep | 5/5 | 없음 | 없음 | – | – | 1/1 | 없음 | 307 | 285/307 |
| Duplex 건축 | 4/4 | 21/21 | 42/42 | **1** | 38/38 | 1/1 | (IFC2x3) | 없음 | – |
| Duplex HVAC | 3/3 | 1/1 | 2/2 | 0 | – | 1/1 | (IFC2x3) | 40 | 40/40 |
| 병원 건축 | 4/4 | 269/269 | 538/538 | 0 | **302/312** | 1/1 | (IFC2x3) | 102 | 102/102 |
| 병원 HVAC | 4/4 | 263/263 | 526/526 | 0 | – | 1/1 | (IFC2x3) | 566 | 566/566 |

보완한 것: BIM→DT 문서 4장 표에 "안 잼" 으로 되어 있던 병원 두 파일의 `R3 기본 이름`·`R19 공조존`·`R19 기본 존` 을 측정해서 채웠다(0 · 0/269·0/263 · 0). 손으로 채우던 표를 이제 테스트가 확인하므로, 명세나 표 한쪽만 고치면 실패한다.

ifctester 0.8.5 는 ifc4Mep 의 풍량 범위(파생 단위)를 환산하다 예외(exception)를 던진다. BIM→DT 문서에 적힌 대로 그 환산만 건너뛰도록 `ids-check.py` 가 처리한다 — 검사 도구 쪽 문제다.

## 화면
Duplex 건축을 ifctester 로 검사한 HTML 보고서(`python -m ifctester docs/requirements.ids NBU_Duplex-Apt_Arch.ifc -r Html -o 보고서.html`) — 명세 33/38 통과
![ifctester 보고서](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/blob/feature/OE-REQ-02-verify/docs/figures/oe-req-02-ifctester.png?raw=true)

## 확인 방법
1. `pip install ifctester`
2. `python -m ifctester docs/requirements.ids data/NBU_Duplex/NBU_Duplex-Apt_Arch.ifc -r Html -o 보고서.html`
3. 보고서 맨 위 "Specifications passed: 33 / 38". `[필수] R3 방 이름에 기본값을 두지 않음` 이 B105 `Room` 하나에서 실패한다(BIM→DT 문서 4장 표와 같음)

## 테스트
- `npm test` — 37 files · 587 passed(새로 넣은 것: `requirements-ids.test.ts` "옮긴 R 번호가 정본 4장의…")
- `npm run check:sample -t "ifctester"` — 1 passed(ifctester 0.8.5, 6개 파일 약 15초)
- `npx vue-tsc --noEmit` 통과

## 남은 것
- 티켓 메모의 "명세 36" 은 지금 38이다. 성수를 확인한 뒤 금지 명세 둘(R3 기본 이름, R19 기본 존)을 추가했다 — PM 이 메모를 고칠지 확인 필요(`needs-pm`)
- "일부" 인 R 중 IDS 로 확인하지 못하는 부분(외곽선 표현, 배치점이 형상 위에 있는지, 연결마다 한쪽 이상 방향 등)은 IDS 로 쓸 수 없어 에디터의 요구사항 보고서가 확인한다
- 성수는 이 PC 에 없어 측정하지 못했다(BIM→DT 문서 표의 성수 칸은 ifctester 0.9.0 으로 확인한 예전 값)
