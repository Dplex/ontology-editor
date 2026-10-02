# ontology-editor

**▶ [에디터 열기 (55 서버, 사내망)](http://10.251.35.55:8084/)** · [칸반](https://github.sec.samsung.net/orgs/IoT-Solution/projects/1)

BIM(IFC4)으로 DT 용 온톨로지를 어디까지 만들 수 있는지를 확인하는 PoC 입니다.
[DT2.0] PRD_011 의 R1.5 "초기 구축 모드"(#5~#8)에 해당합니다.

**이 과제의 산출물은 도구가 아니라 답입니다.** DT 온톨로지에 무엇이 있어야 하는지를 정하고,
그중 BIM 이 줄 수 있는 범위를 재고, 고객사 BIM 에 최소한 무엇이 필요한지를 적는 일입니다.
답은 [`docs/bim-to-dt-ontology.md`](docs/bim-to-dt-ontology.md) 에 있습니다. 이 저장소의
코드는 그 답을 실측으로 뒷받침하는 도구입니다.

이어서 작업할 때는 [`TODO.md`](TODO.md) 부터 읽습니다. 환경을 되살리는 방법과 다음에 할 일이
우선순위 순으로 있습니다.

IFC 를 열면 층·물리존·벽·문·창과 설비·계통을 뽑아 검토 화면과 3D 로 보여 주고, 결과를 두
파일로 내보냅니다. 편집은 설비 이동과 배치, 물리존 이름 수정까지 됩니다.

## 온톨로지를 두 파일로 나눕니다

기하와 의미를 한 파일에 담지 않습니다. 둘은 같은 id 로 이어집니다.

```
floor-1F.geojson   기하    { id: "3l2Nh...", geometry: Polygon, properties: { kind: "space" } }
ontology.ttl       의미    ex:3l2Nh... a brick:Room ; rdfs:label "회의실" .
```

id 는 IfcGlobalId 를 그대로 씁니다. 저작 도구가 재내보내기를 해도 GUID 를 유지하도록
설정할 수 있어서(PRD #6 의 내보내기 요구사항), 재임포트 때 같은 공간을 같은 것으로
알아볼 수 있습니다.

합치지 않는 이유는 한쪽이 상대 포맷의 문자열 주머니가 되기 때문입니다. Brick 에는 다각형을
담을 자리가 없어서 넣으려면 WKT 문자열이 되는데, 그러면 "이 물리존이 저 공조존과 겹치는가"
를 물을 수 없습니다. 그 교집합 연산이 PRD #12(설비-물리존 재매핑)의 본체입니다. 반대로
IMDF 에는 설비 계통(`feeds`, `hasPoint`)을 담을 자리가 없습니다.

## 설비가 들어 있어야 쓸 만해집니다

공간만 있는 온톨로지는 DT 에서 할 일이 적습니다. 설비가 함께 들어와야 "이 회의실을 담당하는
공조기가 무엇인가" 를 물을 수 있습니다. IFC4 는 설비를 담을 수 있고, 이 임포터가 읽는 것은
넷입니다.

| 읽는 것 | 어디서 | 없으면 |
|---|---|---|
| 설비 종류 | `IfcDistributionElement` 하위 클래스 | 설비가 아예 안 들어옵니다 |
| 위치 x·y·z | `ObjectPlacement` | 미배치 목록으로 빠져서 사람이 3D 에서 놓아야 합니다 |
| 용량 | `Pset_*` 의 `NominalAirFlowRate` 등 | 공조존 용량 검증(Z-03)을 돌릴 수 없습니다 |
| 계통 | `IfcSystem` + `IfcRelAssignsToGroup` | 어느 공조기가 어느 토출구를 담당하는지 모릅니다 |

소속 물리존은 BIM 이 주지 않습니다. 설비 좌표가 어느 물리존 외곽선 안에 드는지를 계산해서
만듭니다(`src/lib/mapping.ts`, PRD #12).

**다만 실제 BIM 에 설비가 들어 있느냐는 별개 문제입니다.** MEP 모델은 건축 모델과 따로
만들어지는 일이 많아서, "BIM 있어요" 가 "설비도 있어요" 는 아닙니다. 공개 샘플 넷을 확인한
결과가 그렇습니다.

| 모델 | 설비 | 계통 | 실제로 들어 있던 것 |
|---|---|---|---|
| AC20-FZK-Haus | 0 | 0 | 건축만 |
| C20-Institute-Var-2 | 0 | 0 | 건축만 |
| Office_A | 31 | 0 | 휴지걸이·거울·안전손잡이 |
| dental_clinic | 102 | 0 | 타월디스펜서·거울·소화기함 |

뒤 둘은 `IfcFlowTerminal` 로 분류되어 설비로 읽히지만 욕실 액세서리입니다. 넷 다 계통이
없습니다. 그래서 `src/lib/ifc/fixtures/mep.ifc` 를 직접 썼습니다. 그 파일이 곧 고객사에
요구할 최소 사양이고, 테스트가 그 사양을 지킵니다.

## 편집은 3D 가 아니라 관계를 고칩니다

설비를 옮기면 좌표만 바뀌는 것이 아니라 소속 물리존을 다시 판정하고, `brick:hasLocation` 이
바뀝니다. 그 한 줄이 이상 알림의 발생 위치입니다. 그래서 편집 함수는 좌표를 고치고 끝내지 않고
무엇이 바뀌었는지를 돌려줍니다.

```
설비 AHU-1 의 x 를 50 으로  →  AHU-1: 사무실 → (소속 없음)
좌표 없던 센서에 (5, 4)     →  TEMP-101-01: (소속 없음) → 사무실
```

3D 에서 끌어 옮기는 조작은 아직 없습니다. PoC 에서 확인할 것은 조작감이 아니라 한 번의 편집이
온톨로지의 어느 관계를 바꾸는가이기 때문입니다.

## 돌리는 법

```bash
npm install
npm run dev        # http://localhost:5174
```

백엔드가 없습니다. IFC 파싱은 브라우저 안에서 WASM(web-ifc)으로 돌아갑니다.

## 확인하는 법

```bash
npm test           # vitest: 임포트·변환·내보내기. 입력은 저장소 안의 픽스처 IFC
npm run e2e        # playwright: 브라우저가 실제로 WASM 을 받아 파일을 여는 것까지
npm run build      # vue-tsc 타입 검사 + vite 빌드

npm run fetch:sample   # 실제 BIM 샘플(2.5MB)을 data/ 로 받는다
npm run check:sample   # 그 샘플로 기준값과 맞춰 본다. 파일이 없으면 이유를 찍고 건너뛴다
```

`npm run e2e` 는 처음 한 번 브라우저를 받아야 합니다: `npx playwright install chromium`.

## 구조

| 자리 | 내용 |
|---|---|
| `src/lib/model.ts` | 중간 모델. 임포트와 내보내기가 여기서 만납니다 |
| `src/lib/ifc/import.ts` | IFC → 중간 모델. PRD #6 매핑표를 따릅니다 |
| `src/lib/ifc/placement.ts` | IfcLocalPlacement 사슬을 평면 변환으로 접습니다 |
| `src/lib/ifc/fixtures/` | 손으로 쓴 최소 IFC4. 무엇이 들어가면 무엇이 나오는지 보입니다 |
| `src/lib/mapping.ts` | 설비 좌표로 소속 물리존을 판정합니다(PRD #12) |
| `src/lib/edit.ts` | 편집과 재판정. 무엇이 바뀌었는지를 함께 돌려줍니다 |
| `src/lib/export/` | GeoJSON(기하) · Brick TTL(의미) |
| `src/lib/viewer.ts` | three.js 3D. 표로는 안 잡히는 좌표 오류를 눈으로 잡습니다 |

## 다음에 할 일

피처 번호는 [`docs/bim-to-dt-ontology.md`](docs/bim-to-dt-ontology.md) 의 것입니다.

- **F4·F5·F6 을 읽습니다.** 벽 두께, 개구부 치수, 공간 경계가 파일에 이미 들어 있는데 아직
  안 읽습니다. 규격 문제가 아니라 구현이 남은 부분이고, 로봇 통과 여부(F15)가 여기에 걸립니다.
- **MEP 가 든 실제 BIM 으로 확인합니다.** 설비 임포트는 손으로 쓴 픽스처로만 확인했습니다.
- **편집을 넓힙니다.** 지금은 E1·E5·E6 만 됩니다. 물리존 경계 수정(E2)과 생성·분할·병합(E3)이
  다음이고, 둘 다 설비 소속 재판정이 이미 있어서 거기에 얹힙니다.
- **기존 온톨로지와 합칩니다.** `ieum-pipeline/data/ontology` 의 설비·관제점과 이 결과를 잇는
  일인데, 어느 쪽 id 를 기준으로 삼을지 정해야 합니다.
