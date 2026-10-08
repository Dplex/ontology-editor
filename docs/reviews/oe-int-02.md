OE-INT-02 산출물 형식 — TTL 에 좌표가 숫자로 새는 것 차단

Closes #263
Branch: feature/OE-INT-02-outputs
Ticket: docs/prd/features/E20-INT/OE-INT-02.md
Review: docs/reviews/oe-int-02.md
PRD: prd-review — 요구사항이 바뀌면 다시 본다

## 구현한 것
구현은 이미 있었다(`geojson.ts` 기하, `ttl.ts` 의미, 같은 IfcGlobalId). 요구사항 셋 중 "TTL 에 좌표 없음(테스트로 차단)" 의 테스트가
특정 단어(`POLYGON`·`coordinates`·`wkt`)만 막고 있었다. `ex:x 12.3` 처럼 **숫자 predicate(관계·값을 나타내는 이름) 로 들어가는 좌표는 잡지 못했다.** 숫자 값을 갖는 predicate 를
허용 목록으로 검사하도록 바꿨다(`read-export.ts` 의 `numericPredicates`·`NUMERIC_OK`).

| 요구사항 | 확인 테스트 | 결과 |
|---|---|---|
| GeoJSON(기하) + Brick TTL(의미) | `export.test.ts` · `check:sample` "보유 샘플 BIM 의 GeoJSON 과 TTL 이 id 로 빠짐없이 이어진다" | 6세트(AC20 · ifc4Mep · Duplex 건축+HVAC · Duplex MEP · 병원 건축+HVAC · IDF) |
| **같은 IfcGlobalId** | 같은 `check:sample` 테스트(뷰어와 같은 `crossCheck`) | TTL 에 없는 feature 0 · 끊긴 참조 0 · 소속 어긋남 0 · 문이 잇는 방 0 |
| **TTL 에 좌표 없음(테스트로 차단)** | `export.test.ts` "숫자를 담는 술어는 넓이·바닥 높이·용량뿐이다 …"(새로 넣음) · 위 `check:sample` 에 같은 검사(새로 넣음) | 숫자 값을 갖는 predicate 는 `ex:areaM2`(넓이) · `ex:elevation`(층 바닥 높이) · 용량 4종뿐이다. 좌표 줄을 넣으면 검사에 걸린다 |

허용 목록: 방·존 넓이, 층 바닥 높이(층 블록의 값, 점의 좌표가 아니다), 설비 용량(`capacity.ts` 의 `ex:nominalAirFlowRate` 등 4종).
이름 같은 문자열 값 안의 숫자("01.0001.00")는 세지 않는다. 새 숫자 predicate 를 TTL 에 넣으려면 이 목록을 고쳐야 하므로, 좌표가 몰래 들어갈 수 없다.

## 화면
export 한 파일 뷰어에 병원 건축+HVAC 의 TTL 과 GeoJSON 4개를 같이 놓은 것. 다섯 검사가 다 0 이다.
![교차 검사](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/blob/feature/OE-INT-02-outputs/docs/figures/oe-int-02-crosscheck.png?raw=true)

## 확인 방법
1. 8087 검토 서버(또는 `npm run dev`)에서 `data/NBU_MedicalClinic/NBU_MedicalClinic_Arch.ifc` 와 `…_Eng-HVAC.ifc` 를 같이 열고 TTL·GeoJSON 으로 export 한다
2. `viewer.html` 에 `ontology.ttl` 과 층 파일 4개를 같이 놓는다 → 검사 다섯 줄이 모두 ✓ 0
3. 평면에서 아무 방·설비를 누르면 오른쪽에 같은 id 의 TTL 블록과 GeoJSON 속성이 같이 뜬다

## 테스트
- `npm test` — 40 files · 646 passed(새로 넣은 것: `export.test.ts` 1)
- `npx vue-tsc --noEmit` 통과
- `npm run check:sample -t "GeoJSON 과 TTL 이 id 로 빠짐없이"` — 1 passed(6세트, 숫자 predicate 검사 추가)
- e2e `export.spec.ts` — 4 passed(뷰어가 같은 `read-export.ts` 를 쓴다)

## 남은 것
- `ex:elevation`(층 바닥 높이)을 좌표로 볼지는 정하지 않았다. 점의 좌표가 아니라 층의 값이라 허용 목록에 두었다 — 아니라면 needs-pm
- 성수는 이 PC 에 없어 측정하지 못했다
