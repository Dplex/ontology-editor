OE-INT-09 요구조건 S1~S8 — 조건마다 확인, 빠진 둘(소속 출처·3D 문·창) 보완

Closes #270
Branch: feature/OE-INT-09-s-requirements
Ticket: docs/prd/features/E20-INT/OE-INT-09.md
Review: docs/reviews/oe-int-09.md
PRD: prd-review — 요구사항이 바뀌면 다시 본다

## 구현한 것
수용 기준 "각 S 마다 테스트" 에 맞춰 PRD 부록 C 의 S1~S8 마다 테스트를 하나씩 두었다. 저장 방식(D-INT)이 정해지지 않아 지금 있는 것 — 파일 export(TTL·GeoJSON·GLB/OBJ)와 편집 파일 — 으로 확인한다. **화면 안의 모델이 아니라, export 한 파일을 수신 측 규칙으로 다시 읽은 것**(read-ttl·read-export·read-3d)을 확인한다. 소비 시스템이 보는 것이 그것이기 때문이다.

시나리오 하나로 확인한다(`src/lib/requirements-s.test.ts`): mep.ifc 에 IDF 공조존을 붙이고 → 방 이름을 고치고, 공조기를 옮기고, 감지기를 추가하고, 커스텀존을 그린 뒤 → export 하고 다시 읽는다. 같은 건물을 다시 export 한 mep-v2.ifc(GUID 가 바뀜)에 편집을 다시 불러온다. 실제 BIM 확인은 check:sample "요구조건 S (OE-INT-09, Duplex)" 가 맡는다.

확인하다가 빠진 두 가지를 찾아 보완했다.

- **S4 — 설비가 어느 방에 있는지의 출처가 파일에 없었다.** TTL 의 `hasLocation` 은 BIM 에 있는 소속과 좌표로 계산한 소속이 같은 형식이다(Duplex 건축+MEP: 656건 중 167건이 BIM). GeoJSON 설비 속성에 `spaceSource: 'bim' | 'calc'` 를 추가했다 — 문의 `connectsSource`·벽의 `externalSource` 와 같은 용어다. TTL 출처 predicate(관계·값을 나타내는 이름) 는 수신 측 합의(OE-INT-07) 전까지 export 하지 않는다(ADR-0008)
- **S7 — 3D 파일(GLB·OBJ)에 문·창이 없었다.** 임포터가 문·창 형상에서 위치만 읽고 버려서, `mesh3d.ts` 의 문·창 코드가 한 번도 실행되지 않았다(Duplex 문 14·창 24 → 0). 이제 export 할 때 위치·크기·벽을 뚫는 방향으로 박스를 만든다. 크기를 모르면 문 0.9×2.1m·창 1×1m 에 `placeholder` 를 붙인다. `check3D` 가 문·창도 확인한다(ADR-0009)

| S | 요구조건 | 확인 테스트 | 결과 |
|---|---|---|---|
| S1 | 재임포트 후 편집분 유지, GUID 가 바뀌면 재매칭 | `requirements-s.test.ts` S1 — mep-v2 에 불러오면 못 찾은 것 0, 이름으로 2개 재매칭, 고친 이름·옮긴 위치·추가한 감지기·커스텀존이 같은 U_ id 로 다시 들어간다 · check:sample — 같은 Revit 으로 다시 export 한 **Duplex MEP → MEP-2**: GUID 가 바뀐 설비 5대를 옮기고 방 1개 이름을 고친 편집이 Revit 요소 ID 5·이름 1 로 모두 적용된다 | 통과 |
| S2 | 물리존·설비·공조존이 같은 ID 로 조회 | S2 — 모델 id 가 TTL subject(TTL 에서 설명하는 대상 — 방·설비 하나) key(DT·Agent)와 GeoJSON id 에 그대로 들어간다(`$` 가 든 GUID 포함), id 규칙(U_ 22자·Z_·I_, BIM 과 이름이 일치하는 IDF 설비는 BIM id 하나로) · check:sample — Duplex 건축+MEP feature 1,042개 전부 22자 IfcGlobalId | 통과 |
| S3 | 물리존 ∩ 공조존 교집합 질의 | S3 — GeoJSON 만 읽어 겹친 넓이를 구하면 사무실 ∩ OFFICE 존 100%·STORE 존 0% 이고 TTL 의 hasPart 와 맞는다. TTL 에 좌표·WKT 없음 | 통과 |
| S4 | 계산·추정 관계의 출처 구별 | S4 — GeoJSON `spaceSource`(BIM 조명 bim, 토출구·옮긴 공조기·추가한 감지기 calc, 방 없는 센서 null), U_·Z_·I_·`source: IDF`, two-rooms 의 문 `connectsSource`·벽 `externalSource` · check:sample — Duplex 건축+MEP 소속 656건 중 bim 167(합칠 때 가져온 BIM 소속 167과 같다)·calc 489 | 통과 |
| S5 | 기존 SR 온톨로지와 합칠 때 ID 기준 규칙 | S5 — 에디터 id 는 하이픈 없는 문자만 써서 SR 이름(`ex:1-AHU-101`)과 겹칠 수 없고, 두 TTL 을 이어 읽어도 subject 가 합쳐지지 않는다. **매핑 규칙 자체는 D5(열림)** | 전제만 통과 |
| S6 | 잠금·임시 저장·버전 히스토리가 저장 위치와 무관 | S6 — 임시 저장(편집 파일 문자열)을 새로 연 원본에 불러오면 TTL·GeoJSON 이 편집한 모델과 문자 단위까지 같다. **잠금·버전 히스토리는 없다(서버 필요, D-INT)** | 임시 저장만 통과 |
| S7 | DT 가 물리존 판·벽·문·창·설비를 그릴 형상 | S7 — mep.ifc GLB·OBJ 에 물리존·설비가 GeoJSON 과 같은 id · `mesh3d.test.ts` "형상 없는 문·창은 자리·크기로 세운 상자로…" — 박스 범위(문 x 4.9~5.1·y 1.5~2.5·z 0~2) · check:sample — Duplex 건축+MEP 3D 객체 벽 57·물리존 21·설비 926·**창 24·문 14**, check3D 어긋남 0 | 통과 |
| S8 | 형상 파일과 TTL 이 같은 ID 로 조회 | S8 — 편집한 모델(옮긴·추가한 설비, 커스텀존, 공조존)도 crossCheck 어긋남 0, 옮긴 공조기의 GeoJSON 소속 = TTL 위치 · 기존 check:sample "보유 샘플 BIM 의 GeoJSON 과 TTL 이 id 로 빠짐없이…"·"GLB·OBJ 가 GeoJSON 과 같은 id·같은 자리" | 통과 |

mutation test: GeoJSON 의 `spaceSource` 를 빼면 S4 가, `openingBox` 분기를 막으면 `mesh3d.test.ts` 문·창 테스트가 실패한다.

`spaceSource` 와 문·창 박스는 export 하는 파일에 남는다(GeoJSON 설비 속성, GLB·OBJ 객체). BIM 에는 쓰지 않는다.

## 화면
뷰어 — Duplex 건축+MEP 의 3D(GLB)에 문·창이 벽에 끼워져 있고(선택한 문은 빨강), 3D 검사 세 줄이 0
![문·창 3D](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/blob/feature/OE-INT-09-s-requirements/docs/figures/oe-int-09-door-3d.png?raw=true)

같은 파일에서 라디에이터를 선택하면 GeoJSON 의 `spaceSource: bim` — TTL 에는 `hasLocation Living Room` 만 있다
![spaceSource](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/blob/feature/OE-INT-09-s-requirements/docs/figures/oe-int-09-space-source.png?raw=true)

## 확인 방법
1. 8087 검토 서버(또는 `npm run dev`)에서 [읽을 것] 의 "문·창 자리" 를 켜고 `data/NBU_Duplex/NBU_Duplex-Apt_Arch.ifc` 를 연 뒤 [덧붙이기] 로 `NBU_Duplex-Apt_Eng-MEP-Optimized.ifc`
2. TTL·GeoJSON·GLB 를 export 한다
3. `viewer.html`(첫 화면의 "내보낸 파일 보기" 링크)에 세 파일을 놓는다 → 검사 8줄 모두 0, 요약 "벽 57 · 물리존 21 · 설비 926 · 창 24 · 문 14", 3D 객체 1,042
4. Level_1 평면에서 라디에이터(`M_Radiator - Hosted…557520`)를 누르면 GeoJSON 칸에 `spaceSource bim`, 토출구처럼 계산한 소속은 `calc`
5. 문(`M_Single-Flush:1250mm…146596`)을 누르고 [3D · GLB] → 벽에 끼운 문 박스가 빨강, 범위 z 0~2.01

## 테스트
- `npm test` — 40 files · 633 passed(새로 넣은 것: `requirements-s.test.ts` 11개, `mesh3d.test.ts` 1개)
- `npx vue-tsc --noEmit` 통과
- `npm run check:sample` — 59 passed · 1 failed(새로 넣은 "요구조건 S" 2개 통과. 실패 1은 작업 시작 시점에도 실패하던 "벽마다 다섯 걸음…")
- e2e — `npx playwright test` 103 passed(뷰어 3D 검사 0 그대로)
- mutation test — 이 커밋이 넣은 규칙을 하나씩 꺼 보고 테스트가 깨지는지 확인했다. 5곳 중 4곳을 잡았고, 나머지를 잡으려고 추가한 것: `read-export.test.ts` "문·창도 3D 객체가 있어야 한다 — 형상 없는 문이 빠지면 잡는다"

## 남은 것
- **S5 매핑 규칙** — 에디터 GUID 와 SR 이름(`ex:1-AHU-101`) 중 어느 쪽을 기준으로 할지는 D5(열림). 지금은 둘이 섞여도 서로 덮어쓰지 않는다는 전제만 확인한다. 같은 공조기가 두 subject 로 남는다
- **S6 잠금·버전 히스토리** — 서버(또는 공유 DB)가 있어야 한다(D-INT). 지금은 탭 안의 되돌리기와 브라우저 임시 저장뿐이다
- **S4 의 남은 칸** — 설비끼리 `feeds` 는 BIM 포트·사람이 정한 방향·확정한 규칙이 섞여 들어가는데 셋을 구분하는 표시가 없다. TTL 만 읽는 Agent 는 소속 출처도 모른다. 새 predicate 합의는 OE-INT-07
- **S7 은 문·창 읽기를 켜야** 문·창이 3D 에 들어간다(끄면 위치 정보가 없다, 기본은 끔). 문틀 모양이 아닌 박스다 — DT 가 BIM 모양이 필요하면 ADR-0009 의 1번 방안
- ADR-0008·0009 PM 확인 필요
