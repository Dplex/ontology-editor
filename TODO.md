# 다음에 할 일

이어서 작업할 때 이 파일부터 읽는다. 피처 번호(F11, E5 같은 것)는
[`docs/bim-to-dt-ontology.md`](docs/bim-to-dt-ontology.md) 를 가리킨다.

기준일: 2026-09-22 · 이 시점의 상태는 `git log` 로 확인한다

---

## 먼저 환경부터 되살린다

`data/` 와 `public/web-ifc.wasm` 은 저장소에 없으므로 받아야 한다.

```bash
npm install
npm run fetch:sample          # 실측 샘플 BIM 셋을 data/ 로 받는다 (합계 약 45MB)
unzip -o data/NBU_Duplex_ifc.zip -d data/   # Duplex 는 압축이라 풀어야 한다
npx playwright install chromium

npm test                      # 58개 통과가 정상이다
npm run e2e                   # 4개 통과가 정상이다
npm run check:sample          # 실제 BIM 기준값 대조
npm run dev                   # http://localhost:5174
```

`npm run check:sample` 이 건너뛰었다고 나오면 `fetch:sample` 을 안 받은 것이다. 실패가 아니다.

---

## 지금까지 된 것

| 구분 | 상태 |
|---|---|
| F1 F2 F3 공간 계층·기하·이름 | 임포트된다. 실제 BIM 으로 확인했다 |
| F7 내력벽 | 읽는다. 값이 없는 경우를 `null` 로 구분한다 |
| F8 F9 F10 설비·위치·계통 | 읽는다. 실제 IFC4 MEP 모델(설비 2,202 · 계통 37)로 확인했다 |
| F11 설비 소속 물리존 | 좌표로 판정한다 |
| 내보내기 | 기하는 GeoJSON, 의미는 Brick TTL 로 나간다 |
| E1 E5 E6 편집 | 물리존 이름 수정, 설비 이동, 미배치 설비 배치 |
| 3D 뷰 | 층별 물리존과 설비 위치를 보여 준다 |
| 문서 | 피처 정의, BIM 범위 실측, 최소 요구사항, 편집 기능 정의 |

---

## 할 일 (우선순위 순)

### 1. F4·F5·F6 을 읽는다

**왜 먼저인가.** 파일에 이미 들어 있는데 안 읽는 것들이다. 규격 문제가 아니라 구현만 남았고,
막힌 것이 없어서 바로 할 수 있다. 벽 편집(E4)과 로봇 통과 여부(F15)가 전부 여기에 걸린다.

실측 샘플(`AC20-FZK-Haus.ifc`)에 들어 있는 값은 다음과 같다.

| 읽을 것 | IFC 위치 | 샘플에 들어 있는 값 |
|---|---|---|
| 벽 두께 | `IfcRelAssociatesMaterial` → `IfcMaterialLayerSetUsage` | 0.24m, 관계 21건 |
| 개구부 치수 | `IfcDoor.OverallHeight`, `OverallWidth` | 문 2.01 x 0.885m |
| 개구부 소속 | `IfcRelVoidsElement` + `IfcRelFillsElement` | 17건, 16건 |
| 공간 경계 | `IfcRelSpaceBoundary` | 81건 |

**어디부터.** `src/lib/ifc/import.ts` 의 `Reader` 클래스에 읽기 함수를 더한다. 벽에 `thickness`,
문·창에 `width`·`height`, 물리존에 `boundedBy`(부재 id 목록)를 붙인다.

**무엇이 통과면 끝인가.** `src/lib/ifc/fixtures/two-rooms.ifc` 에 재료층과 개구부 관계를 추가하고
그 값을 테스트로 고정한다. `npm run check:sample` 의 기준값에 실제 샘플 수치(두께 0.24m, 공간
경계 81건)를 박는다.

`IfcRelSpaceBoundary` 가 특히 값어치가 있다. 물리존을 둘러싼 벽이 무엇인지를 BIM 이 직접 주므로,
기하 연산으로 유추하지 않아도 된다.

### 2. E2 물리존 경계 수정

**왜.** 편집 피처 중 온톨로지가 가장 크게 흔들리는 편집이다. 경계가 바뀌면 F11 설비 소속과 면적이
같이 바뀐다.

**어디부터.** 재판정과 리포트는 이미 있다. `src/lib/edit.ts` 의 `moveEquipment` 가 본이 된다.
꼭짓점 하나를 옮기는 함수를 더하고, 그 안에서 `assignEquipmentToSpaces` 를 다시 돌린 뒤 `Change`
목록을 돌려주면 된다. 면적은 `polygonArea` 로 다시 계산한다.

**무엇이 통과면 끝인가.** 경계를 옮겨 설비가 다른 물리존으로 넘어가는 경우와, 어느 물리존에도
속하지 않게 되는 경우를 테스트로 만든다. 뒤쪽이 PRD 의 Z-01 경고에 해당한다.

**주의.** 다각형이 자기 자신과 교차하는 모양이 되면 `polygonArea` 와 `pointInPolygon` 이 둘 다
뜻 없는 값을 준다. 막을지 경고만 할지를 정해야 한다.

### 3. E3 물리존 생성·삭제·분할·병합

**왜.** E2 다음으로 자연스럽고, 재판정이 같은 자리에 얹힌다.

**주의할 규칙 둘.** 한 층에 물리존이 최소 하나는 남아야 한다. 물리존을 지워도 층에 구멍이 생기는
것이 아니라 주변 물리존으로 그 공간이 귀속된다(PRD #9).

### 4. 길이 단위를 읽는다 (새로 올라온 1순위)

**왜.** 실제 MEP 모델을 구해서 돌려 보니 여기서 걸렸다. `IfcUnitAssignment` 을 안 읽어서
미터가 아닌 모델의 좌표가 통째로 틀린다. 확인한 네 파일 중 둘이 그랬다.

| 모델 | 선언된 길이 단위 | 지금 읽히는 값 |
|---|---|---|
| AC20-FZK-Haus | METRE | 맞다 |
| ifc4Mep | METRE | 맞다 |
| NBU_Duplex-Apt_Eng-HVAC | MILLIMETRE | 1,000배로 들어온다 |
| NBU_Duplex-Apt_Eng-MEP-1 | FOOT | 3.28배로 들어온다 |

**오류가 나지 않고 숫자가 그럴듯해서 눈으로 보기 전에는 모른다.** 소속 물리존 판정과 넓이가
전부 여기에 딸려 있으므로 다른 것보다 먼저 고친다.

**어디부터.** `IfcProject.UnitsInContext` 에서 `LENGTHUNIT` 을 찾는다. `IfcSIUnit` 이면
`Prefix`(MILLI, CENTI 등)로 배수를 정하고, `IfcConversionBasedUnit` 이면 `ConversionFactor` 를
읽는다. 읽은 배수를 `Reader` 에 들고 다니며 좌표와 길이에 곱한다.

**무엇이 통과면 끝인가.** 픽스처를 밀리미터로 선언한 판본을 하나 만들어 같은 결과가 나오는지
본다. `check-sample.test.ts` 에 Duplex HVAC 의 설비 좌표 기준값을 미터로 박는다.

### 5. 실제 MEP BIM 으로 확인한다 (구해 놓았다)

`npm run fetch:sample` 이 셋을 받는다. 이미 `check:sample` 이 둘을 대조하고 있다.

| 파일 | 무엇을 증명하나 |
|---|---|
| `AC20-FZK-Haus.ifc` | 건축만 있는 IFC4. 공간 골격의 범위 |
| `ifc4Mep_IFC4.ifc` | 설비만 있는 IFC4. 설비 2,202 · 계통 37 · 포트 4,232 |
| `NBU_Duplex_ifc.zip` | 건축과 설비가 갈린 실제 프로젝트. COBie 판본에 계통 10 |

**여기서 나온 남은 일 셋.**

1. **설비가 `IfcSpace` 에 담긴 경우를 못 읽는다.** Duplex COBie 판본은 설비 133대가 있는데
   우리는 0 으로 읽었다. 지금은 층의 `IfcRelContainedInSpatialStructure` 만 보기 때문이다.
   공간에 담긴 것도 같이 읽어야 한다.
2. **건축 모델과 설비 모델을 합치지 못한다.** 한 번에 파일 하나만 연다. 설비 모델에는 물리존이
   없어서(`ifc4Mep` 의 물리존 0) 소속 판정이 전부 실패한다. 여러 파일을 겹쳐 읽는 기능이
   필요하고, 겹칠 때 좌표계가 같은지 확인하는 절차도 같이 필요하다.
3. **용량 파라미터 이름이 도구마다 다르다.** `ifc4Mep`(DDS-CAD)은 2,202대 전부 용량이 안
   읽혔다. 지금 찾는 이름 넷으로는 부족하다. 실제 파일에 무슨 이름이 쓰이는지 세어 보고 늘린다.

---

## 정해져야 진행되는 것

### 저장 위치 (PRD 1.7, 가장 먼저 필요하다)

에디터와 DT 가 데이터를 어떻게 주고받을지가 셋으로 열려 있다.

1. 에디터가 파일로 내보내고 DT 가 가져간다
2. 공유 온톨로지 서버에 API 로 직접 쓴다
3. 공유 DB 를 쓴다

**지금 이 저장소는 1번을 전제로 만들어져 있다.** 백엔드가 없고 전부 브라우저 안에서 돈다.

이것이 정해지지 않으면 다음을 만들 수 없다. 임시 저장(#15), 반영하기(#17), 버전 히스토리와
되돌리기(#19), 층 단위 편집 잠금(#2) 이 전부 저장 위치에 딸려 있기 때문이다. 2번이나 3번으로
정해지면 서버가 필요하고, 그때 상위 `CLAUDE.md` 의 "새 서비스를 붙일 때" 다섯 단계가 전부 걸린다.

### 기존 온톨로지와 합칠 때 어느 ID 를 기준으로 삼나

`ieum-pipeline/data/ontology/SR_Building_ontology_260723.ttl` 에는 설비와 관제점이 있고 기하가
없다. 이 저장소가 만드는 것은 그 빠진 절반이다. 둘을 합치려면 같은 설비를 같은 것으로 알아보는
기준이 있어야 하는데, 기존 쪽은 `ex:1-AHU-101` 같은 이름을 쓰고 이쪽은 IfcGlobalId 를 쓴다.

### F12 공조존과 F13 관제점을 이 과제 범위에 넣나

둘 다 BIM 에서 나오지 않는다. 공조존은 IDF 나 gbXML 에서 오고 관제점은 BAS 에서 온다.
"BIM 으로 어디까지" 라는 물음의 답으로는 "안 된다" 로 적어 두었는데, 에디터가 이 둘을 고치는
기능까지 제공할지는 정해지지 않았다.

---

## 손대기 전에 알아 둘 것

상세한 것은 `CLAUDE.md` 에 있고, 여기에는 잊기 쉬운 것만 적는다.

- **TTL 에 좌표를 넣지 않는다.** 기하는 GeoJSON 이 갖는다. `export.test.ts` 가 막고 있다.
- **`null` 은 "모름" 이지 "아니오" 가 아니다.** 내력벽, 설비 좌표, 소속 물리존이 전부 그렇다.
  `0` 이나 `false` 로 채우면 조용히 틀린다.
- **편집 함수 안에서 재판정을 돌린다.** 호출부에 맡기면 좌표와 소속이 어긋난 채로 남는다.
- **설비 판정은 `IfcDistributionElement` 상속 조회에 맡긴다.** 제외 목록으로 바꾸지 말 것.
  한때 `IfcAnnotation` 14개를 설비로 셌다.
- **`data/` 와 `public/web-ifc.wasm` 은 커밋하지 않는다.** 각각 `fetch:sample` 과 `sync-wasm.mjs`
  가 만든다.
- **타입을 정확히 일치시켜 고르지 말고 상속으로 고른다.** 설비는 `IfcDistributionElement`,
  계통은 `IfcSystem` 을 `includeInherited` 로 조회한다. 계통을 정확히 일치로 골랐다가 실측
  모델에서 `IfcDistributionCircuit` 22개를 놓쳤다.
