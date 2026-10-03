OE-UI-12 3D 단일 층 표시 — 다른 층은 그리지도 선택하지도 않음

Closes #?? (OE-UI-12 — PRD 표 순서로는 #68 또는 #69, PR 올릴 때 확인)
Branch: feature/OE-UI-12-single-storey
Ticket: docs/prd/features/E03-UI/OE-UI-12.md
Review: docs/reviews/oe-ui-12.md
PRD: prd-review — 요구사항이 바뀌면 다시 본다

## 구현한 것
층 선택("○○만")은 이미 있었다. 테스트는 방 2개짜리 fixture 로 층 바닥판이 사라지는지만 확인했다. 병원 건축+HVAC 로 요구사항
"숨긴 층은 그리지도 고르지도 않음" 을 대상마다 확인해 보니, 연결 화살표 하나가 빠져 있었다.

| 대상 | 그리기 | 선택 | 확인 테스트(병원 건축+HVAC, 1층만) |
|---|---|---|---|
| 층 바닥판·물리존 | 숨김(기존) | 선택 안 됨(기존) | 2층 설비가 있던 화면 위치를 눌러도 2층 방은 0개 |
| 설비·덕트·배관 | 숨김(기존) | 선택 안 됨(기존) | 2층 설비 60개 위치를 눌러도 2층 설비는 0개. 모든 층으로 보면 같은 위치에서 2층 설비가 선택된다(대조군). 1층 설비 60개는 30개 넘게 선택된다 |
| 벽·문·창([벽·문·창] 켬) | 숨김(기존) | 선택 안 됨(기존) | 2층 벽 위치를 눌러 선택된 벽 중 2층 벽은 0개, 1층 벽은 30개 넘게 선택된다 |
| **연결 화살표**(편집 모드, 선택한 설비의 연결) | **다른 층으로 향하는 화살표도 그렸다** — 보이지 않는 곳을 가리켰고, 누르면 방향도 바뀌었다 | — | Duplex MEP 의 Level 2 라디에이터(배관 2개 중 하나가 Level 1): 모든 층 2개 → Level 2만 1개 → 모든 층 2개 |

화살표를 숨긴 연결은 오른쪽 패널의 연결 표에 남는다. 그 줄에 "다른 층(Level 1) — 3D에 안 보임" 을 표시하고, 방향은 [상류로]·[하류로] 로
거기서 바꾼다. 층을 넘는 연결은 적지 않다 — 병원 MEP 13608 중 3992, Duplex MEP 783 중 315, 병원 HVAC 3695 중 34. 모두 덕트·배관이 포함된
연결이다(설비끼리 층을 넘는 연결은 0).

테스트가 실제로 걸러내는지 확인했다(mutation test): 설비 선택의 숨김 조건, 물리존 선택의 층 조건, 벽 선택의 층 조건(바닥 평면 쪽), 화살표 조건을 하나씩
빼면 해당 줄이 깨진다. 벽 선택의 형상 쪽 조건은 빼도 깨지지 않는다 — raycast 가 보이는 형상만 대상으로 하고 높이로도 거르기 때문에 이중 조건이다.

저장 위치: 화면에만 있다. 선택한 층(`viewStorey`)은 저장하지 않고, 파일을 새로 열면 모든 층으로 돌아간다.

## 화면
병원 건축+HVAC 를 1층만 본 화면. 2층 바닥판·덕트가 없다.
![1층만](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/blob/feature/OE-UI-12-single-storey/docs/figures/oe-ui-12-first.png?raw=true)

모든 층.
![모든 층](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/blob/feature/OE-UI-12-single-storey/docs/figures/oe-ui-12-all.png?raw=true)

Duplex MEP, Level 2만 보며 라디에이터를 선택한 화면. 연결 2개 중 Level 1 배관 줄에 "다른 층" 이 붙고 3D 에는 화살표가 하나다.
![다른 층 연결](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/blob/feature/OE-UI-12-single-storey/docs/figures/oe-ui-12-other-floor.png?raw=true)

## 확인 방법
1. 8087 검토 서버(또는 `npm run dev`)에서 `data/NBU_MedicalClinic/NBU_MedicalClinic_Arch.ifc` 와 `…_Eng-HVAC.ifc` 를 같이 연다
2. 3D 위 층 칸에서 "First Floor만" → 2층 바닥판·덕트가 사라지고, 2층 덕트가 있던 위치를 눌러도 1층 것만 선택된다
3. `data/NBU_Duplex/NBU_Duplex-Apt_Eng-MEP.ifc` 를 열고 [편집] → 검색 칸에 `538562` 입력 → 라디에이터를 선택한다 → 화살표 2개
4. 층 칸 "Level 2만" → 화살표 1개, 오른쪽 연결 표의 둘째 줄에 "다른 층(Level 1) — 3D에 안 보임"

## 테스트
- `npm test` — 40 files · 647 passed
- `npx vue-tsc --noEmit` 통과
- e2e — 108 passed(새로 넣은 것: `single-storey.spec.ts` 2. 파일이 없으면 건너뛴다)

## 남은 것
- PRD 는 "3D는 한 층만 표시, 전체 빌딩 뷰는 미리보기 Phase 2" 인데, 지금은 처음 열 때 **모든 층**을 보이고 층 칸에 "모든 층" 이 있다.
  모든 층 보기를 없앨지(또는 처음을 한 층으로 할지) PM 에게 묻는다 — 없애면 층을 넘는 덕트·배관을 한눈에 볼 곳이 미리보기뿐이다
- 층 소속은 IFC 에 적힌 대로다. 위층 소속 배관이 아래층 천장에 매달린 BIM 이면 아래층만 볼 때 그 배관이 보이지 않는다. 병원 MEP 의
  층을 넘는 연결 3992개가 그런 경우인지(배관 높이 대 층 높이)는 확인하지 않았다
- 성수는 이 PC 에 없어 측정하지 못했다
