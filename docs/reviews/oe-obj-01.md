OE-OBJ-01 커스텀존 — 그리기·나누기·합치기·지우기, TTL 에 brick:Zone

Closes #43
Branch: feature/OE-OBJ-01-custom-zone
Ticket: docs/prd/features/E02-OBJ/OE-OBJ-01.md
Review: docs/reviews/oe-obj-01.md
PRD: prd-done (의존하는 OE-SPC-06~10 은 prd-review — 요구사항이 바뀌면 다시 본다)

**ADR-0004 PM 확인 필요** — 커스텀존을 온톨로지에 어떤 형태로 export 할지는 PRD 에 없어서 개발이 정했다(상태 `제안`).

## 구현한 것
- **커스텀존(F14)** — 운영자가 물리존 위에 다각형으로 정하는 운영 단위(임원석·식당·사무석). 층마다 둔다(`Storey.customZones`, `src/lib/custom-zone.ts`).
  - 만들기: 왼쪽 팔레트 [공간 그리기 › 커스텀존] → 바닥에 꼭짓점을 찍고 Enter. 엇갈린 다각형·아주 작은 다각형은 이유를 알리고 만들지 않는다.
  - 이름(별명) 고치기, 나누기(선의 두 점 — 넓은 쪽이 이름을 이어받고 좁은 쪽이 `이름 2`), 합치기(같은 층 다른 존 선택), 지우기.
  - **서로 겹쳐도 되고 물리존 경계와 달라도 된다**(OE-OBJ-01).
  - 되돌리기(Ctrl+Z)·다시 하기·편집 파일·리포트("커스텀존 ○○를 만들었습니다")에 모두 반영된다.
- **온톨로지 반영**(ADR-0004)
  - TTL: `ex:{id} a brick:Zone ; brick:hasPart <방들> ; rdfs:label "별명" ; ex:zoneKind "custom"`. 층이 `brick:hasPart` 로 포함한다.
  - **포함하는 방**: 바닥의 절반 넘게 덮이는 방(공조존 → 방과 같은 기준).
  - **안의 기기**: 좌표가 다각형 안인 기기(덕트·배관 제외)가 `brick:hasLocation` 을 하나 더 갖는다(`brick:hasLocation ex:방, ex:존`). 넓은 사무실 한쪽 구석만 덮는 "임원석" 같은 존에서도 Agent 가 그 안의 설비·관제점을 찾을 수 있게 하기 위해서다. 수신 측(`ttl.go`)은 hasLocation 을 목록으로 읽어 줄마다 저장한다(`ontology_store.go` 확인).
  - **공조존과의 매핑**은 같은 방을 포함하는 것(공조존 hasPart 방)으로 연결된다. predicate(관계·값을 나타내는 이름) 를 새로 만들지 않았다.
  - GeoJSON: `kind: 'customZone'` feature — 다각형, `spaceIds`(포함하는 방), `equipmentIds`(포함된 기기). TTL 에는 좌표가 없다.
  - 매핑은 **저장하지 않고 export 할 때 계산한다**. 물리존을 나누거나 설비를 옮기면 다음 export 에 바로 반영된다(OE-SPC-09 "수정 시 매핑 갱신").
- **화면** — 3D 에 점선(선택한 존은 파란 선과 옅은 면), 오른쪽 패널에 넓이·포함하는 방(방 번호 포함)·포함된 기기·이름·나누기·합치기·지우기. 아무것도 선택하지 않았을 때 패널에 커스텀존 목록. F 로 선택한 존의 기기에 시점을 맞춘다.
- 팔레트가 길어지면 작은 파일에서 3D 왼쪽 아래의 건물을 가려서(기존 e2e 2개가 그 위치를 클릭했다), [공간 그리기] 아래 두 버튼(물리존·커스텀존)을 한 줄에 뒀다. 접근성 이름은 "물리존 그리기"·"커스텀존 그리기" 그대로다.
- BIM→DT 문서(`docs/bim-to-dt-ontology.md`) 편집 표에 E10 행을 추가하고 "남은 일" 에서 커스텀존을 뺐다.

## 화면
Duplex 건축+HVAC Level 1 — 주방·욕실을 덮는 커스텀존. 포함하는 방 3, 포함된 기기 13
![Duplex Level 1 커스텀존](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/blob/feature/OE-OBJ-01-custom-zone/docs/figures/oe-obj-01-custom-zone.png?raw=true)

별명 여러 개(추가 작업) — 쉼표(반각·전각)로 구분한 별명 3개가 "다른 별명" 줄에 나온다.
![커스텀존 별명](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/blob/feature/OE-OBJ-01-custom-zone/docs/figures/oe-obj-01-aliases.png?raw=true)

Duplex MEP 에서 커스텀존에 별명 "경영진석" 을 달고 검색 칸에 그 별명을 입력한 화면 — 존 안의 설비 3개가 나온다.
![별명으로 찾기](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/blob/feature/OE-OBJ-01-custom-zone/docs/figures/oe-obj-01-alias-search.png?raw=true)

## 확인 방법
1. 8087 검토 서버(또는 `npm run dev`)에서 `data/NBU_Duplex/NBU_Duplex-Apt_Arch.ifc` 와 `NBU_Duplex-Apt_Eng-HVAC.ifc` 를 같이 선택한다(합쳐 열린다)
2. [편집] → 3D 위 층 선택 `Level 1만`
3. 팔레트 [공간 그리기 › 커스텀존] → 주방·욕실 쪽 바닥에 꼭짓점 4개를 찍고 Enter → 오른쪽 패널에 "커스텀존 1", 포함하는 방·포함된 기기
4. 이름 칸에 `1층 주방·욕실` → Enter. F 를 누르면 그 존의 기기에 시점이 맞는다
5. [나누기] → 선의 두 점을 찍으면 2개로 나뉜다 → 합칠 커스텀존 선택으로 다시 합친다 → [커스텀존 지우기] → Ctrl+Z 로 하나씩 되돌아간다
6. 다른 커스텀존을 겹쳐 그려도 된다. 아무것도 선택하지 않으면 패널 아래에 커스텀존 목록이 뜬다
7. [TTL] 을 export 하면 `a brick:Zone` 블록과, 존 안 기기의 `brick:hasLocation ex:방, ex:존` 이 있다. [GeoJSON] 에는 `"kind": "customZone"` feature

## 테스트
- `npm test` — 37 files · 583 passed
  - 새로 넣은 것: `src/lib/custom-zone.test.ts` 8개 — 방 일부만 덮는 존의 기기와 TTL hasLocation·층 hasPart, 방을 포함하는 기준(절반 넘게)과 겹침, 엇갈린·작은 다각형 거절과 빈 이름, 나누기·합치기, 일부만 겹친 두 존 합치기 거절, 설비를 옮기거나 방 경계를 바꾸면 매핑이 갱신됨, 되돌리기·다시 하기, 리포트·편집 파일 왕복(TTL·GeoJSON 이 같음)·TTL 에 좌표 없음
  - 편집 fuzz 테스트(`edit-fuzz.ts`)에 `customZone`(만들기·이름·지우기·나누기·합치기)을 추가했다. 커스텀존·물리존·설비 편집만 골라 seed 1,500 × 40스텝(커스텀존 편집 4,463번)을 따로 돌려 실패 0
  - `edit.test.ts` 의 "파일을 열 때와 비교" 기댓값에 `customZones: []` 를 추가했다
- `npx vue-tsc --noEmit` 통과
- `npm run check:sample` — 45 passed · 2 failed · 25 skipped. 실제 BIM fuzz 테스트(커스텀존 포함)은 통과
  - 새로 넣은 것: "커스텀존을 그려도 ttl.go 가 기기의 위치에 존을 같이 읽는다" — **실제 `ttl.go`** 로 읽어 보면 존이 `BrickClass: Zone` 엔티티로 하나 늘고(방·층처럼 타입 없는 논리 엔티티), 존 안 기기의 Locations 가 `[층, 존]` 이다
  - 실패 2개는 #232·#46 과 같은 것으로 이 변경 전부터 실패한다("ttl.go 가 GUID 를…", "벽마다 다섯 걸음…")
- e2e — `npx playwright test` 98 passed. 새로 넣은 것: `e2e/custom-zone.spec.ts`(그리기 → 이름 → 나누기 → 합치기 → 지우기 → Ctrl+Z → 목록에서 다시 선택)
- mutation test(처음 커밋(커스텀존) 기준) — 이 커밋이 넣은 규칙을 하나씩 꺼 보고 테스트가 깨지는지 확인했다. 14곳 중 11곳을 잡았고, 나머지를 잡으려고 추가한 것: `custom-zone.test.ts` 3개 — 덕트·배관은 존 안 설비로 세지 않기, 다른 층 존끼리 합치기 막기, 편집 파일의 층을 못 찾으면 못 찾은 것으로 집계
- mutation test — 이 커밋이 넣은 규칙을 하나씩 꺼 보고 테스트가 깨지는지 확인했다. 11곳 중 8곳을 잡았고, 나머지를 잡으려고 추가한 것: `custom-zone.test.ts` "별명이 있는 존을 고친 뒤 되돌려도 별명이 남는다", e2e `custom-zone.spec.ts` 전각 쉼표(，)로 구분하기와 "Duplex MEP: 커스텀존의 별명으로 검색하면 그 존 안의 설비가 나온다"(검색 칸은 큰 파일에만 있다)

## 남은 것
- (해결 — ADR-0012) **별명은 여러 개다.** 첫 이름이 TTL `rdfs:label`, 더 붙인 별명은 `ex:alias`, GeoJSON
  `aliases`, 편집 파일 `customZones[].zones[].aliases`. 패널(편집 모드)에 "다른 별명" 칸(쉼표로 여러 개), 보기에 "다른 별명" 줄. 합치면 없어지는
  존의 이름·별명이 합친 존의 별명으로 남는다. 설비 검색은 설비가 속한 존의 이름·별명으로도 찾는다. 테스트: `custom-zone.test.ts` "별명 여러 개" 4 ·
  "설비 검색 …" 1, e2e `custom-zone.spec.ts` "커스텀존에 별명을 여럿 달면 …". ADR-0004 의 "별명은 하나" 한 줄을 ADR-0012 가 대체했다
- **겹침 정책** — OE-SPC-07 은 Q4 결정을 기다리는데 OE-OBJ-01 은 "겹쳐서 설정할 수 있다" 로 정했다. OE-OBJ-01 을 따랐다 → Q4 가 결정됐는지 `needs-pm`
- Agent 질의(OE-SPC-10)는 온톨로지 쪽(brick:Zone·hasLocation)까지만 했다. Agent 연동은 그 티켓 담당
- 3D 에서 커스텀존을 클릭해 선택할 수는 없다(점선이라 물리존 바닥과 겹친다). 패널 목록·그린 직후·나눈 뒤에 선택된다
- 커스텀존의 꼭짓점 끌기는 없다 — 다시 그리거나 나누고 합친다
- 성수는 이 PC 에 없어 측정하지 못했다
