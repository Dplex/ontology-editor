# 우리 온톨로지 — 무엇이고 어디까지인가

이 문서는 **"이 repo 가 만드는 온톨로지가 정확히 무엇인가"** 하나에 답한다. 왜 그렇게 냈는지는 `intent.md`, BIM 이 그중 어디까지
주는지는 `docs/bim-to-dt-ontology.md`, 기능 요구는 `docs/prd/` 에 있다. 여기는 그 셋이 공통으로 가리키는 대상의 정의다.

받는 쪽(Unity 클라이언트)이 실제로 무엇을 읽는지는 아직 확인하지 않았다 — 맨 아래 "아직 모르는 것" 에 질문으로 둔다.
그 칸이 채워지기 전까지 이 문서의 "받는 쪽" 은 ieum-pipeline 의 TTL 파서(`ttl.go`)를 옮긴 `read-ttl.ts` 를 기준으로 한다.

## 정의

> **한 건물의 공간·설비·계통을 Brick 어휘로 적은 인스턴스 그래프(TTL)와, 그 노드들의 평면 형상(GeoJSON)을,
> BIM 의 GlobalId 하나로 이은 한 쌍.** 층마다 한 쌍씩 만들 수 있고, 모으면 건물 하나다.

| 부분 | 답하는 질문 | 파일 |
|---|---|---|
| 의미 | 무엇이 무엇에 속하고(`hasPart`·`hasLocation`), 무엇이 무엇을 공급하나(`feeds`) | `floor-<층>.ttl` · 반영본은 `ontology.ttl` |
| 형상 | 어디에 어떤 모양으로 있나(외곽선·점·선, 건물 로컬 m) | `floor-<층>.geojson` |
| 이음 | 둘이 같은 것이다 | id — GlobalId, 사람이 만든 것 `U_…`, IDF 출신 `Z_…`·`I_…` |

정의에 들지 않는 것: **GLB·OBJ** 는 보여 주기용 셋째 파일이다(같은 id 를 객체 이름으로 쓰지만 의미·형상의 정본이 아니다).
**편집 파일(`edits.json`)** 은 BIM 위에 얹는 사람의 보정이고, 온톨로지는 BIM + 보정을 다시 계산한 결과다.

## "온톨로지" 라는 말 — 스키마가 아니라 데이터다

엄밀한 뜻의 온톨로지는 클래스와 관계의 정의(스키마)다. 우리는 스키마를 새로 설계하지 않는다.

| | 무엇 | 누가 정하나 |
|---|---|---|
| 스키마(시맨틱 웹 말로 TBox) | Brick(공간·설비·계통 클래스, `hasPart`·`hasLocation`·`feeds`) · FSO(덕트·배관 `Segment`·`Fitting`) · Brick 에 없는 것을 적는 `ex:` | 외부 표준 + 받는 쪽과의 합의 |
| **우리가 만드는 것**(ABox, 흔히 "지식 그래프") | 그 스키마로 **이 건물**을 적은 데이터 — "1층 회의실 101 은 1층의 일부이고, FCU-3 은 회의실 101 에 있다" | 에디터(BIM + 계산 + 사전 + 사람) |

비유하면 Brick 은 주소 체계(시·구·동)이고, 우리 온톨로지는 그 체계로 쓴 이 건물의 주소록이다.
PRD·화면·이 repo 에서 "온톨로지" 는 이 데이터를 가리킨다.

이 구분이 실무에서 갈리는 곳은 **"온톨로지를 고친다" 가 두 가지 일**이라는 점이다.

| 고치는 것 | 예 | 어떻게 |
|---|---|---|
| 데이터 | 설비 소속을 바꾼다, 방 이름을 고친다, 배관을 그린다 | 에디터의 편집(E1~E11). 받는 쪽은 그대로 읽는다 |
| 어휘 | 출처 술어를 새로 쓴다, 새 클래스를 쓴다 | 받는 쪽과 합의(OE-INT-07, D5). 받는 쪽 파서가 모르는 어휘는 **에러 없이 버려진다** |

## 왜 있나

DT 화면이 묻는 질문에 답하는 데이터다. 이상 알림("이 설비는 어디에"), 탐색기 트리("건물 구조"), 3D Map("이 공간의 모양"),
계통도("이 공조기가 담당하는 곳"), AI Agent("회의실 온도"), 로봇 관제("지나갈 수 있나"). 질문별로 필요한 관계는
`docs/bim-to-dt-ontology.md` 2장의 피처 F1~F16 이다. **핵심은 F11(설비가 어느 방에 있나)** — BIM 에 없고 우리가 계산한다.

## 무엇이 들어 있나 — 지금 실제로 내는 것

### TTL 클래스

| 묶음 | 클래스 | 출처 |
|---|---|---|
| 공간 계층 | `brick:Building` → `brick:Floor` → 방(`brick:Room` 또는 종류별 하위 클래스 `brick:Office`·`brick:Hallway`·`brick:Restroom` 등, `kinds.ts` 의 방 종류) | BIM · 사전 |
| 설비(기기) | Brick 설비 클래스(`kinds.ts`). 종류를 모르면 `ex:<IFC 클래스>`(`ex:FlowTerminal`·`ex:BuildingElementProxy` 등) | BIM · 사전 |
| 덕트·배관 | `fso:Segment`(구간) · `fso:Fitting`(이음쇠) | BIM · 편집 |
| 계통 | Brick `*_System`(`brick:Air_System`·`brick:Hot_Water_System` 등). 종류를 모르면 `ex:Distribution_System` | BIM · 사전 |
| 존 | `brick:HVAC_Zone`(공조존 — IDF 또는 사람) · `brick:Zone`(커스텀존 — 사람) | IDF · 편집 |

루트는 건물이다. `brick:Site` 는 내지 않는다(F1 의 "사이트" 칸은 비어 있다). Brick 에 건축 부재 클래스가 없어서 벽·문·창은 TTL 에 없다.

### TTL 술어

받는 쪽 열은 `read-ttl.ts`(ieum-pipeline `ttl.go` 2026-09-29 `39d1dca` 를 옮긴 것) 기준이다.

| 술어 | 뜻 | 받는 쪽 |
|---|---|---|
| `rdfs:label` | 이름 | 읽음 |
| `brick:hasPart` | 건물→층→방, 계통→구성원, 존→방 | 읽음 |
| `brick:hasLocation` | 설비→방. 방을 못 찾으면 층 | 읽음 |
| `brick:feeds` | 상류→하류. BIM 포트·사람이 정한 방향·사람이 확정한 규칙만(K14) | 읽음 |
| `brick:hasPoint` | 설비→관제점 | 읽지만 **우리는 내지 않는다**(관제점은 BAS 몫, F13) |
| `ex:roomNumber` | 방 번호 | 버림 |
| `ex:areaM2` | 면적(㎡) — 방·공조존 | 버림 |
| `ex:elevation` | 층 바닥 높이(m) | 버림 |
| `ex:ifcClass` | 원래 IFC 클래스 | 버림 |
| `ex:systemKind` | 계통 종류(사전) | 버림 |
| `ex:nominalAirFlowRate` · `ex:nominalWaterFlowRate` · `ex:nominalCapacity` · `ex:nominalFlowRate` | 용량(풍량·수량·능력·유량) | 버림 |
| `ex:alias` | 커스텀존 별명(ADR-0004) | 버림 |
| `ex:zoneKind` | 커스텀존 표시 `"custom"` | 버림 |
| `ex:idfClass` | IDF 설비의 원래 클래스 | 버림 |

### GeoJSON feature

층 하나가 FeatureCollection 하나다. 모든 feature 에 `kind`·`name`·`storeyId` 가 있고, id 는 TTL 주어와 같다.
형상이 없어도 feature 는 남고 `geometry` 가 `null` 이다. 키 하나하나의 뜻은 `docs/geojson-robot.md`(로봇 경로가 읽는 것)와 `geojson.ts`.

| `kind` | 형상 | 주요 속성 | TTL 에도 있나 |
|---|---|---|---|
| `space` | Polygon(외곽선이 없으면 null) | `longName`·`areaM2`·`elevation`·`verticalConnects` | 있음(방) |
| `wall` | Polygon · MultiPolygon | `thickness`·`height`·`loadBearing`·`external`(+`externalSource`)·`passable` | 없음 |
| `door` · `window` | Point — **기본 설정에서는 null**(문·창 자리를 읽을 때만) | `wallId`·`width`·`height`·`passable`, 문은 `connects`(+`connectsSource`) | 없음 |
| `equipment` | Point(기기) · LineString(덕트·배관 구간) | `ifcClass`·`spaceId`(+`spaceSource`)·`systemId`·`capacity` | 있음 |
| `vertical` | Polygon · Point | `verticalKind`·`parentId`·`spaceIds`·`entry`·`exit` | 계단실·승강로 방만 |
| `hvacZone` · `customZone` | Polygon | `spaceIds`(든 방), 공조존은 `source`(`IDF`·`edit`), 커스텀존은 `equipmentIds` | 있음(존) |
| `room` · `spaceObject` | Polygon | `spaceId`, 오브젝트는 `height`·`size`·`item` | 없음(ADR-0023) |

### 얼마나 읽히나 — 2026-10-10 측정

샘플 BIM 네 쌍을 건축+설비로 합쳐 내보내고, 받는 쪽 규칙(`read-ttl.ts`)으로 다시 읽었다.

| 샘플 | TTL 트리플 | 받는 쪽이 읽는 트리플 | 주어 | 받는 쪽이 읽는 주어 | 덕트·배관(`fso:`) 주어 |
|---|---|---|---|---|---|
| Duplex 건축 + MEP | 5,082 | 1,402 (28%) | 972 | 187 | 785 |
| Duplex 건축 + HVAC | 3,083 | 803 (26%) | 558 | 100 | 458 |
| 병원 건축 + HVAC | 26,733 | 7,662 (29%) | 4,098 | 960 | 3,138 |
| 합성 성수 건축 + 기계 | 125,279 | 33,312 (27%) | 20,447 | 4,757 | 15,690 |

**받는 쪽 그래프는 우리가 쓴 TTL 의 약 1/4 이다.** 버려지는 것은 두 가지다. 덕트·배관 주어(전체 주어의 77~82%, 받는 쪽이 `fso:` 클래스를
읽지 않음)와 `ex:` 속성 전부(받는 쪽이 클래스·이름·관계 넷만 읽음). 기기끼리의 `feeds` 는 덕트를 건너뛰어 적기 때문에(3.4) 흐름 연결은 살아남는다.
같은 측정에서 문·창 1,918개의 GeoJSON 형상은 전부 null 이었다(기본 설정).

### 질문으로 재면 — 2026-10-11

DT 화면이 묻는 질문 12개(`scripts/onto-questions.mjs`)를 건물마다 구체적인 대상으로 바꿔, 정해진 질의로 우리 TTL 과 받는 쪽이 읽는 만큼에
각각 물었다(`npm run onto:bench`, ADR-0050). 공간 계층·설비가 놓인 방·계통·흐름(상류·담당 공간)은 받는 쪽도 답한다.
**면적과 방번호는 네 건물 모두 우리 TTL 에만 있다** — "A101호는 어느 층" 같은 운영자 질문이 받는 쪽 DT 에서는 답이 없다.
로봇 통과(방-문-방)는 TTL 밖(GeoJSON)이고, Duplex 는 흐름 방향이 없어 상류·담당 공간을 물을 대상이 없다.

| 샘플 | 대상이 있는 질문 | 우리 TTL 이 답함 | 받는 쪽도 답함 |
|---|---|---|---|
| Duplex 건축 + MEP | 8 | 7 | 5 |
| 병원 건축 + HVAC | 11 | 10 | 8 |
| 합성 성수 건축 + 기계 | 11 | 10 | 8 |

## 받는 쪽과의 약속

- **id.** BIM 에서 온 것은 IfcGlobalId, 사람이 만든 것은 `U_`, IDF 출신은 `Z_`(존)·`I_`(설비). GlobalId 의 `$` 는 TTL 에서 `\$` 로 적는다.
  같은 Revit 에서 다시 내보내면 GUID 의 63% 가 바뀌어서, 버전을 잇는 곳은 `versions.ts` 가 Revit 요소 ID·이름·위치로 짝짓는다(intent.md).
  기존 SR 온톨로지의 id(`ex:1-AHU-101`)와의 매핑은 D5 에서 정한다.
- **네임스페이스.** `ex:` 는 `http://example.org/building#` — 자리표시 주소다. 건물·고객을 주소로 가를 수 없다. 기존 SR 온톨로지도
  `ex:` 를 쓰고 받는 쪽 파서가 `brick:` 과 `ex:` 를 같게 취급해서 그대로 두었다. 정식 IRI 는 정하지 않았다.
- **좌표.** GeoJSON 은 IFC 세계 좌표(m)이고 위경도가 아니다. 점은 `[x, y, z]`, 다각형은 `[x, y]` 에 `elevation` 이다.
  **TTL 에는 형상(다각형·점)을 넣지 않는다**(`export.test.ts`) — 넣으면 WKT 문자열이 되어 겹침을 물을 수 없다. 면적·높이 같은 수치 속성은 형상이 아니라 TTL 에 있다.
- **층.** 층마다 TTL·GeoJSON 한 쌍이고, 층 TTL 을 다 모으면 건물 전체 TTL 과 같은 트리플이다(ADR-0011). 다른 층을 가리키는 목적어는 id 로 남는다.
  반영본(서버 버전 폴더, src/server/layouts.ts)은 건물 전체 `ontology.ttl` 하나 + 층별 `geojson/*.geojson` + `model.glb` 다.
- **확정된 것만.** 흐름 방향(`feeds`)은 확정된 것만 낸다. 추정만 된 것은 내지 않는다(K14, ADR-0021).
- **출처.** TTL 관계에는 출처가 없다. 계산·편집이 섞이는 관계는 GeoJSON 의 `*Source`(`bim`·`calc`·`edit`)에 적는다(ADR-0008, OE-INT-07).
- **파서 부분 문법.** 받는 쪽은 범용 Turtle 파서가 아니다. `ex:X a 클래스` 로 시작하는 블록만 읽는다(`read-ttl.ts`, bim-to-dt-ontology 부록 C).

## 아닌 것

- 새 스키마가 아니다 — Brick·FSO 를 쓰고, 없는 것만 `ex:` 로 적는다.
- IMDF·IDF 가 아니다 — 변환기를 만드는 과제가 아니다(intent.md).
- BIM 의 사본이 아니다 — 벽은 평면 외곽선, 문·창은 점(기본 null)이고 3D 형상은 GLB 에만 있다.
- 관제점·실시간 값이 아니다 — `hasPoint` 와 센서 값은 BAS 에서 온다.

## 아직 모르는 것 — 2026-10-13(월) 회사에서 확인

Unity 클라이언트가 실제로 무엇을 읽는지가 이 정의의 마지막 칸이다. 답에 따라 "버림" 열과 내보내기 범위가 바뀐다.

| # | 질문 | 지금 가정 | 답에 따라 바뀌는 것 |
|---|---|---|---|
| 1 | Unity 는 어느 파일을 읽나 — TTL · GeoJSON · GLB? 직접 읽나, ieum-pipeline 이 DB·API 로 바꿔 주나? | TTL 은 `ttl.go` 를 거친다 | "받는 쪽" 열의 기준(`read-ttl.ts` 가 맞는 기준인가) |
| 2 | TTL 에서 클래스·이름·관계 넷 밖(`ex:` 속성, `fso:` 덕트·배관)을 쓰나? | 안 쓴다(파서가 버림) | 안 쓰면 TTL 의 약 3/4 는 받는 쪽에 닿지 않는다 — 낼지, 파서를 넓힐지 |
| 3 | 3D 를 무엇으로 그리나 — GeoJSON 외곽선을 세우나, GLB·FBX 를 쓰나(D11)? 문·창 자리를 쓰나? | GeoJSON 으로 그린다(PRD 1.7) | 문·창 형상 기본값(지금 null), GLB 를 정의에 넣을지 |
| 4 | Unity 의 오브젝트와 무엇으로 잇나 — GlobalId? SR 의 `ex:1-AHU-101`? | GlobalId | D5, 재내보내기에서 GUID 가 바뀔 때의 처리 |
| 5 | 좌표 — 원점·축(y-up 변환)·단위가 같은가? | 같은 원점·축·m(PRD 1.7) | OE-INT-04 |
| 6 | 층 파일로 받나, 건물 하나로 받나? | 반영본은 건물 TTL 하나 + 층 GeoJSON | 파일 나누기 |
| 7 | `ex:` 네임스페이스를 그대로 쓰나, 정식 IRI 가 있나? | 그대로 | 여러 건물을 한 그래프에 둘 때 |
| 8 | 갱신을 어떻게 받나 — 파일을 다시 읽나, API 인가(D-INT ①②③)? | 파일 export → import | 반영(OE-WF-10)·버전의 소재지 |
| 9 | 운영 중인 SR 온톨로지(`brick:Zone` 4,016 등)와 우리 것은 합치나, 대체하나? | 새 건물의 초기 구축이라 별도 | D5, 초기 구축 / 운영 편집 모드 경계 |

확인하면 이 표의 "지금 가정" 을 답으로 바꾸고, 정해진 것은 ADR 로 남긴다.

## PRD 문구와 지금 구현이 다른 곳

PRD 는 PM 이 고친다. 아래는 이슈에 `needs-pm` 으로 올릴 거리다(월요일 확인 뒤에 함께).

- PRD 1.7 "술어 4종(`hasPart`·`hasLocation`·`feeds`·`hasPoint`)" — `hasPoint` 는 내지 않고, `ex:` 속성 12종을 더 낸다(받는 쪽은 버림).
- PRD 1.7·OE-INT-02 "GeoJSON: … 벽·문·창 … 좌표" — 문·창 좌표는 기본 설정에서 null 이다.
- PRD 1.7 "DT 파서(`ttl.go`)가 읽는 것 확인" — 파일이 깨지지 않고 읽히는 것은 맞지만, 읽히는 내용은 트리플의 약 27% 다.
- PRD glossary 에 "온톨로지" 항목이 없다. 위 "정의" 의 한 문장을 넣어 주시도록 요청할 거리다.

## 이 문서를 고치는 법

- 내보내기 코드(`ttl.ts`·`capacity.ts`·`geojson.ts`)에서 접두사·`ex:` 술어·feature `kind` 가 바뀌면 같은 PR 에서 이 문서의 표를 고친다.
  `src/lib/ontology-doc.test.ts` 가 어긋나면 실패한다.
- 측정 표는 날짜와 함께 바꾼다. 다시 재는 방법은 위 표의 샘플 네 쌍을 합쳐 `modelToTTL` → `readOntologyTTL` 로 읽는 것이다.
