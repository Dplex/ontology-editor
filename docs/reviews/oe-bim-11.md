OE-BIM-11 단위 교차 확인 — 층 높이 비로 길이 단위 선언 오류를 경고(R6)

Closes #96
Branch: feature/OE-BIM-11-unit-cross-check
Ticket: docs/prd/features/E05-BIM/OE-BIM-11.md
Review: docs/reviews/oe-bim-11.md
PRD: prd-review — 요구사항이 바뀌면 다시 본다

## 구현한 것
요구사항 앞 절 "IfcUnitAssignment를 읽어 m로 환산" 과 수용 기준 "mm·ft 파일이 m로 들어옴" 은 이미 있었다(`src/lib/ifc/units.ts`, fixture 테스트 `units.test.ts`). 뒤 절 **"같은 건물 판본 간 층 높이로 교차 확인"** 이 없었다. 환산은 파일이 선언한 단위를 그대로 믿기 때문에, 선언이 틀리면 오류 없이 그 배수만큼 틀린 값이 된다 — 실제로 **Duplex COBie(Design)는 길이 단위를 밀리미터로 선언하고 층 높이를 미터 값으로 적어 Level 2 가 3.1mm 로 들어온다.** 파일 하나만 보면 R6 이 "선언 있음" 이라 표준이었다. 이 부분을 추가했다.

- `src/lib/unit-check.ts` — 두 모델의 이름이 같은 층 높이 비가 **모두** 같은 단위 배수(1000·100·3.28·304.8·39.37·12 와 그 역수, ±2%)면 어긋남. 한 층만 다르면 기준점 차이로 보고 넘어간다. 0.5m 미만 층은 비교하지 않는다. 층간 높이(위아래 층 차의 중앙값)가 2~12m 인 쪽을 맞다고 보고 다른 쪽을 틀린 쪽으로 표시한다(ADR-0007)
- **덧붙이기(합치기)**: 경고 "이름이 같은 층의 높이가 COBie-Design.ifc에서 Arch.ifc의 1/1000입니다(T/FDN -1.25m → -0.00125m, Level 2 3.1m → 0.0031m, Roof 6m → 0.006m). 층간 높이로 보면 COBie-Design.ifc의 길이 단위 선언이 실제 값과 다른 것 같습니다…". 그 층들은 "높이가 다른 층(기준점이 다를 수 있다)" 경고에서 뺀다
- **버전 비교**: 같은 경고를 요약표 위에 띄운다(이전 버전 / 지금 파일 중 어느 쪽이 틀렸는지)
- **요구사항 R6**: 합친 모델은 일부. 버전 비교는 지금 파일이 틀렸으면 일부, 이전 버전이 틀렸으면 표준으로 두고 설명에 이전 버전을 적는다. 요청 "길이 단위 선언을 좌표·높이에 실제로 쓴 단위에 맞춰 달라"
- BIM→DT 문서(`docs/bim-to-dt-ontology.md`) 4장 R6 줄: 확인 위치에 교차 확인을, 측정 결과에 COBie 의 선언 어긋남을 적었다

경고·R6 은 브라우저 안의 검토 결과다. 값을 배수로 되돌리지는 않는다 — BIM·TTL·GeoJSON 에는 틀린 값이 그대로 들어간다(고객사가 다시 export 해야 한다).

| 요구사항·수용 기준 | 확인 테스트 | 결과 |
|---|---|---|
| mm·ft 파일이 m로 들어옴 (fixture) | 기존 `src/lib/ifc/units.test.ts` — millimetre·foot fixture 가 two-rooms 와 같은 층 높이·넓이·좌표 | 통과 |
| mm·ft 파일이 m로 들어옴 (실제 파일) | `scripts/check-sample.test.ts` "단위 교차 확인 (OE-BIM-11, Duplex)" — 선언 배수 HVAC 0.001·MEP-1 0.3048·나머지 1, 다섯 파일 모두 Level 1 0 · Level 2 3.1 · Roof 6 으로 건축과 같다 | 통과 |
| 버전 간 층 높이로 교차 확인 — 배수 판정 | `src/lib/unit-check.test.ts` — 배수·역수, 피트·인치·센티미터, 한 층만 다르면 null, 3% 벗어나면 null, 0 근처·한쪽 0·이름 없음, 지하층, 틀린 쪽 판정 | 9 passed |
| 교차 확인 — 합치기·버전 비교·R6 | `src/lib/requirements.test.ts` "단위 선언 교차 확인 (OE-BIM-11)" — millimetre.ifc 의 `.MILLI.` 를 `$` 로 바꾼 바이트(2F 3000m)와 two-rooms 를 합치면 경고 하나·`unitScale` 1000·R6 일부, 기준·덧붙이기를 바꿔도 일부, 정상 millimetre·foot 는 경고 없음, 버전 비교는 지금 파일이 틀리면 일부·이전 버전이 틀리면 표준 | 5 passed |
| 교차 확인 — 실제 사례 | `check-sample` 같은 테스트 — 건축 ↔ COBie(Design) 1/1000(T/FDN·Level 2·Roof), COBie 를 틀린 쪽으로 판정, 합치기 경고 문구, R6 일부, 반대로(건축이 지금 파일) R6 표준 | 통과 |
| 화면 | `e2e/versions.spec.ts` "이전 판본과 층 높이가 단위 배수로 다르면 경고하고 R6 을 일부로 내린다" | 통과 |

mutation test: `merge.ts` 의 교차 확인을 빼면 `requirements.test.ts` 2개가 실패한다.

## 화면
Duplex 건축을 열고 COBie(Design)를 이전 버전으로 비교한 화면 — 층 높이 1/1000 경고, 틀린 쪽은 이전 버전
![버전 비교 경고](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/blob/feature/OE-BIM-11-unit-cross-check/docs/figures/oe-bim-11-version-warning.png?raw=true)

반대로 COBie 를 열고 건축을 이전 버전으로 비교한 화면 — 요구사항 R6 일부와 요청
![R6](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/blob/feature/OE-BIM-11-unit-cross-check/docs/figures/oe-bim-11-r6.png?raw=true)

## 확인 방법
1. 8087 검토 서버(또는 `npm run dev`)에서 `data/NBU_Duplex/NBU_Duplex-Apt-COBie_Arch-Design.ifc` 를 연다
2. "요구사항" 의 R6 → 표준 자리 "길이 단위가 선언되어 있습니다." (파일 하나로는 알 수 없다)
3. "버전 비교" 를 펼치고 [이전 버전 열기] 로 `data/NBU_Duplex/NBU_Duplex-Apt_Arch.ifc` 를 선택한다
4. 요약표 위 경고 "이름이 같은 층의 높이가 이전 버전의 1/1000입니다(T/FDN -1.25m → -0.00125m, Level 2 3.1m → 0.0031m, Roof 6m → 0.006m). 층간 높이로 보면 지금 파일의 길이 단위 선언이…"
5. "요구사항" 의 R6 → 일부, 요청 "길이 단위 선언을 좌표·높이에 실제로 쓴 단위에 맞춰 달라"
6. (덧붙이기) 건축을 열고 [덧붙이기] 로 COBie 를 선택하면 경고 칸에 같은 1/1000 경고, R6 일부

## 테스트
- `npm test` — 39 files · 621 passed(새로 넣은 것: `unit-check.test.ts` 9개, `requirements.test.ts` 5개)
- `npx vue-tsc --noEmit` 통과
- `npm run check:sample` — 57 passed · 1 failed(새로 넣은 "단위 교차 확인" 통과. 실패 1개는 작업 시작 시점에도 실패하던 "벽마다 다섯 걸음…")
- e2e — `npx playwright test` 103 passed(`e2e/versions.spec.ts` 에 1개 추가함)

## 남은 것
- 비교할 층이 하나뿐이면(층이 둘인 건물) 우연히 12배·100배가 ±2% 안에 들 수 있다. 드물다고 보고 비교 쌍 수의 하한을 두지 않았다(ADR-0007)
- 피트 ↔ 미터 어긋남은 3m ↔ 9.8m 라 둘 다 층간 높이로 그럴듯해서 어느 쪽이 틀렸는지 판정하지 않는다("한쪽" 으로 표시)
- 층 이름이 분야별 파일끼리 다르면(R1 위반) 비교할 쌍이 없어 교차 확인도 할 수 없다
- ADR-0007 PM 확인 필요 — 교차 확인 기준(모든 짝·±2%·0.5m)과 틀린 쪽 판정(층간 높이 2~12m), 버전 비교에서 이전 버전만 틀리면 R6 을 표준으로 두는 것
