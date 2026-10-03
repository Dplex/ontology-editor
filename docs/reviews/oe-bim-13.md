OE-BIM-13 Proxy 리포트 — 파일의 Proxy 전체와 읽지 않은 것까지 집계

Closes #98
Branch: feature/OE-BIM-13-proxy-report
Ticket: docs/prd/features/E05-BIM/OE-BIM-13.md
Review: docs/reviews/oe-bim-13.md
PRD: prd-review — 요구사항이 바뀌면 다시 본다

## 구현한 것
설비로 읽는 규칙은 이미 있었다(`src/lib/ifc/import.ts`) — IfcBuildingElementProxy 는 **포트가 있거나 이름이 사전에 있는 것만** 설비로 읽는다. 수용 기준 **"Proxy 수 리포트"** 는 임포트 경고 한 줄과 요구사항 R23 이었는데, **설비로 읽은 수만** 집계했다. 파일에 Proxy 가 몇 개였고 몇 개를 버렸는지는 어디에도 없어서, 이 규칙이 설비를 빠뜨렸는지 사람이 확인할 방법이 없었다. 이 부분을 보완했다.

- 임포터가 파일의 Proxy 를 전부 세어 `Model.facts.proxies = { total, ported, named, skipped }` 에 둔다. `skipped` 는 읽지 않은 것의 이름 예시(패밀리:유형, 요소 ID 를 빼고 앞 5가지). 브라우저 안의 모델에만 있고 TTL·GeoJSON 에는 들어가지 않는다
- 경고: "Proxy(IfcBuildingElementProxy) **49개 중 1개**를 설비로 읽었습니다(포트 1, 이름 0). … **나머지 48개는 포트도 없고 이름도 사전에 없어 건축 부재로 보고 읽지 않았습니다(예: (이름 없음), SolarMountingSystems)**"
- 요구사항 R23 설명에 같은 내용("파일의 Proxy 49개 중 48개는 …")
- 건축+설비를 합치면 두 파일의 수를 합산한다(`merge.ts`)

| 요구사항·수용 기준 | 확인 테스트 | 결과 |
|---|---|---|
| 포트가 있거나 이름이 사전에 있는 Proxy 만 설비로 | 기존 `src/lib/ifc/import.test.ts` "Proxy 로 들어온 설비" 4개 | 통과 |
| **Proxy 수 리포트** — 전체·읽은 것·읽지 않은 것 | `import.test.ts` "파일의 Proxy 를 전부 세고, 읽지 않은 것을 이름과 함께 경고·요구사항 R23 에 적는다" — `proxy.ifc` 3개 중 2개(포트 1·이름 1), 휠스톱 1개 읽지 않음, 합치면 6개 | 통과 |
| 보유 샘플 BIM 에서 | `scripts/check-sample.test.ts` "Proxy 리포트 (OE-BIM-13)" | 아래 표 |
| (성수 기계) | `check-sample` "성수 기계" 에 `facts.proxies` 포트 1,578 · 이름 74 를 추가(soft) | 이 PC 에 성수가 없어 실행하지 못함 |

보유 샘플 BIM 의 Proxy:

| 파일 | 전체 | 설비로 읽음(포트·이름) | 읽지 않음 | 읽지 않은 것 |
|---|---|---|---|---|
| ifc4Mep | 49 | 1(1·0) | 48 | 태양광 거치대 40(`SolarMountingSystems`, 설명 "Mounting rack") · 이름·형상 없는 8 |
| 병원 전기(Eng-ELE) | 29 | 28(0·28) | 1 | 유압 엘리베이터(`M_Elevator-Hydraulic`) |
| AC20 · Duplex 건축·HVAC · 병원 건축·HVAC | 0 | — | — | — |

읽지 않은 것이 실제로 건축 부재인지는 ifcopenshell 로 열어 이름·설명·포트를 확인했다(태양광 거치대는 포트 없음, 8개는 이름·형상이 없음).

요구사항의 "건축 루버 오인 방지 예외(OE-EXT-05)" 는 티켓 메모대로 아직 없다(남은 것).

## 화면
ifc4Mep 을 연 화면의 경고 — Proxy 49개 중 1개를 읽고 48개를 읽지 않음(예: (이름 없음), SolarMountingSystems)
![Proxy 경고](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/blob/feature/OE-BIM-13-proxy-report/docs/figures/oe-bim-13-proxy-warning.png?raw=true)

요구사항 R23 줄
![R23](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/blob/feature/OE-BIM-13-proxy-report/docs/figures/oe-bim-13-r23.png?raw=true)

## 확인 방법
1. 8087 검토 서버(또는 `npm run dev`)에서 `data/ifc4Mep_IFC4.ifc` 를 연다
2. 3D 아래 경고 목록에 "Proxy(IfcBuildingElementProxy) 49개 중 1개를 설비로 읽었습니다 … 나머지 48개는 … 읽지 않았습니다(예: (이름 없음), SolarMountingSystems)"
3. "요구사항" 을 펼쳐 R23 → 다른 자리 307 · 1 / 308, 설명 끝에 "파일의 Proxy 49개 중 48개는 …", 요청 "내보내기 설정을 바꿔 달라 — 설비를 Proxy 대신 알맞은 IFC 클래스로(IfcExportAs)"
4. `data/NBU_MedicalClinic/NBU_MedicalClinic_Eng-ELE.ifc` 를 열면 "29개 중 28개 … 나머지 1개 …(예: M_Elevator-Hydraulic:2000 lbs:2000 lbs)"

## 테스트
- `npm test` — 38 files · 604 passed(새로 넣은 것: `import.test.ts` 1개, 고친 것: 같은 파일의 경고 문구)
- `npx vue-tsc --noEmit` 통과
- `npm run check:sample` — 56 passed · 1 failed(알려진 실패 "벽마다 다섯 걸음 나갔다 돌아오면…", 작업 시작 시점에도 실패). 새로 넣은 "Proxy 리포트 (OE-BIM-13)" 통과

## 남은 것
- **OE-EXT-05 건축 Proxy 루버 오인 방지**(성수 건축 Proxy 339 중 240 이 루버)는 하지 않았다. 설비로 읽는 규칙을 바꾸는 일이라 성수로 회귀 테스트를 해야 하는데 이 PC 에 성수가 없다. 별도 티켓이다
- **유압 엘리베이터를 설비로 받을지** — 병원 전기의 엘리베이터 1대가 사전에 없어 건축 부재로 빠진다. 로봇 경로(층 이동)·DT 설비 목록에 필요하면 이름 사전에 "엘리베이터" 를 더해야 한다 — `needs-pm`
- 성수 기계의 읽지 않은 Proxy 수는 확인하지 못했다(soft 기댓값에 포트 1,578·이름 74 만 넣었다)
