OE-BIM-08 토출구·배관 초안 — IFC4·Revit IFC2x3 실제 BIM 으로 확인

Closes #93
Branch: feature/OE-BIM-08-verify
Ticket: docs/prd/features/E05-BIM/OE-BIM-08.md
Review: docs/reviews/oe-bim-08.md
PRD: prd-review — 요구사항이 바뀌면 다시 본다

## 구현한 것
구현은 이미 있었다(`import.ts` 가 IfcDistributionElement 를 설비·배관으로, `kinds.ts` 가 종류를, `ttl.ts` 가 배관을 `fso:` 로). 실제 BIM 으로 확인하는
테스트는 "Duplex HVAC 의 배관이 엔티티로 읽히지 않는다" 하나였다. 요구사항 줄마다, **IFC 가 토출구·배관을 표현하는 두 방식**(IFC4 의 구체 클래스,
Revit IFC2x3 의 IfcFlowTerminal + 타입 객체)으로 확인 테스트를 추가했다.

| 요구사항 | 확인 테스트 | ifc4Mep (IFC4) | 병원 HVAC (Revit IFC2x3) |
|---|---|---|---|
| Air Terminal → 토출구 | `check:sample` "토출구·배관 초안 (OE-BIM-08)"(새로 넣음) | 43 → 디퓨저 30 · 그릴 13 | AirTerminal 타입 555 → 디퓨저 234 · 그릴 206 · **VAV 115** |
| Duct·Pipe → 배관 초안(구간·이음쇠) | 같은 테스트 | IFC 의 구간 1,075 · 이음쇠 820 이 하나도 빠지지 않는다 | 구간 1,548 · 이음쇠 1,590 |
| 세그먼트 형상 | 같은 테스트 | 1,895 중 1,868 (아래) | 3,138 전부 |
| 기기와 도관 구분, 도관은 `fso:` | 같은 테스트 · `export.test.ts` · `read-export.test.ts` | `fso:Segment` 1,075 · `fso:Fitting` 820, 수신 측이 엔티티로 읽는 도관 0 | 1,548 · 1,590, 0 |

VAV 115 는 Revit 이 AirTerminal 타입으로 export 했지만 이름 사전(`kinds.ts`)이 VAV(역할 조절)로 분류한다. 토출구가 아니라 토출구에 바람을 나눠 주는 기기이기 때문이다.

형상이 없는 ifc4Mep 배관 27개: 10개는 IFC 에 형상이 없고(`Representation` 이 `$`), 17개는 `IfcSweptDiskSolidPolygonal`(IFC4 Add2 의 관 형상)이라
web-ifc 0.0.78 이 메시를 만들지 못한다(읽을 때 `unexpected mesh type` 로그). 좌표가 있는 것은 3D 에 점으로 표시되고, 모델·TTL·GeoJSON 에는 그대로 있다.

저장 위치: 토출구는 TTL 에 `brick:Air_Diffuser` 등 기기 블록으로, 배관은 `fso:Segment`·`fso:Fitting` 블록으로 들어간다. 배관 형상은 3D(GLB·OBJ)에만 있다 —
TTL 에는 좌표가 없고, GeoJSON 에는 점(배치점)이다.

## 화면
병원 HVAC 를 연 3D. 덕트·배관이 계통 색으로 그려진다.
![병원 HVAC 3D](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/blob/feature/OE-BIM-08-verify/docs/figures/oe-bim-08-3d.png?raw=true)

요약 칸 — 기기 566 · 덕트·배관 3,138.
![요약](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/blob/feature/OE-BIM-08-verify/docs/figures/oe-bim-08-tiles.png?raw=true)

## 확인 방법
1. 8087 검토 서버(또는 `npm run dev`)에서 `data/NBU_MedicalClinic/NBU_MedicalClinic_Eng-HVAC.ifc` 를 연다
2. 요약 칸이 기기 566 · 덕트·배관 3,138. 3D 에 덕트가 형상 그대로 그려진다
3. TTL 로 export 해서 `viewer.html` 에 놓으면 요약의 "읽지 않는 클래스" 에 `fso:Segment`·`fso:Fitting` 이 따로 집계된다

## 테스트
- `npm run check:sample -t "OE-BIM-08"` — 2 passed(새로 넣음)
- 코드를 고치지 않아 단위·e2e 는 바뀌지 않는다

## 남은 것
- ifc4Mep 의 관 17개(`IfcSweptDiskSolidPolygonal`)는 web-ifc 가 그리지 못한다. 중심선 + 반지름 정보라 에디터가 원기둥으로 그릴 수는 있다 — 필요하면 별도로 한다
- 성수 기계(IFC2x3, 2026-10-06 성수 PC, 임시 probe): AirTerminal 1,689 → 디퓨저 1,226 · 그릴 404 · 외기 루버 59 · VAV 0. IFC 구간 7,874 · 이음쇠 7,990 이 하나도 빠지지 않고, 형상 15,864 전부, TTL `fso:Segment` 7,874 · `fso:Fitting` 7,990, 받는 쪽이 엔티티로 읽는 도관 0
