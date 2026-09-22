# ontology-editor

BIM(IFC4)을 읽어 공간 온톨로지 초안을 만드는 PoC 입니다.
[DT2.0] PRD_011 의 R1.5 "초기 구축 모드"(#5~#8)에 해당합니다.

지금 되는 것은 임포트와 내보내기까지입니다. IFC 를 열면 층·물리존·벽·문·창을 뽑아
검토 화면과 3D 로 보여 주고, 결과를 두 파일로 내보냅니다. 편집은 아직 없습니다.

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
| `src/lib/export/` | GeoJSON(기하) · Brick TTL(의미) |
| `src/lib/viewer.ts` | three.js 3D. 표로는 안 잡히는 좌표 오류를 눈으로 잡습니다 |

## 다음에 할 일

- 편집. PRD #9·#10 의 물리존 생성·분할·병합과 벽·문·창 편집입니다.
- IDF 임포트. 공조존과 담당 설비가 거기서 옵니다(PRD #5·#11). BIM 에는 공조존이 없습니다.
- 설비. 샘플 BIM 에 MEP 가 없어서 아직 확인하지 못했습니다. MEP 가 든 IFC 를 구해야 합니다.
- 기존 온톨로지와 합치기. `ieum-pipeline/data/ontology` 의 설비·관제점과 이 결과를 잇는
  일인데, 어느 쪽 id 를 기준으로 삼을지 정해야 합니다.
