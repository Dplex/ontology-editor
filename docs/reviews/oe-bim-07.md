OE-BIM-07 설비 생성 — 좌표 없는 설비를 미배치 목록에 모아 바로 배치

Closes #92
Branch: feature/OE-BIM-07-unplaced-list
Ticket: docs/prd/features/E05-BIM/OE-BIM-07.md
Review: docs/reviews/oe-bim-07.md
PRD: prd-review — 요구사항이 바뀌면 다시 본다

## 구현한 것
설비 읽기(종류·x·y·z·용량)와 좌표 없는 설비를 `position: null` 로 두는 것은 이미 있었다. 수용 기준 **"좌표 없는 설비는 미배치 목록"** 의 목록이 화면에 없었다 — 임포트 경고 "설비 n대에 좌표가 없습니다" 의 수만 있고, 어느 설비인지는 설비 표 수천 행의 빈 좌표 칸에 섞여 있었다. 완전성 검사 "기기마다 소속 방" 은 방이 없는 설비 파일에서 건너뛰므로 ifc4Mep 의 28대는 어디에도 이름이 나오지 않았다.

- **요약 칸의 경고 아래에 [미배치 설비 n대]** — 줄마다 이름 · 층 · 종류, [3D에서 놓기]. 보기 모드에서 눌러도 편집 모드로 전환해 그 설비를 선택하고 바닥 클릭을 기다린다(배치 방식은 E6 의 [3D에서 놓기] 그대로 — 높이는 같은 패밀리, 소속 재판정, Ctrl+Z). 배치하면 목록에서 빠지고, 되돌리면 돌아온다. 좌표 없이 추가한 설비도 같은 목록에 들어간다
- 30대가 넘으면 접힌 상태로 열리고, 200대까지만 표시한다(나머지는 "외 n대")
- 임포트 경고 줄은 그대로 둔다 — 경고는 파일을 열 때 BIM 에서 읽은 기록이고, 목록은 현재 상태다
- 저장 위치: 미배치 설비도 온톨로지에서 빠지지 않는다. **TTL 은 `brick:hasLocation` 이 층**(방은 모름), **GeoJSON 은 `geometry: null`** 에 `storeyId` 만. 위치를 임의로 만들지 않는다. 사람이 배치하면 그때 좌표·소속이 생긴다(편집)
- 사전: IFC 클래스 한글 이름에 `ProtectiveDevice` → "보호기(차단기·퓨즈)" 를 추가했다(ifc4Mep 의 F1~F13 이 영문 클래스명으로 표시됐다)

| 요구사항·수용 기준 | 확인 테스트 | 결과 |
|---|---|---|
| **좌표 없는 설비는 미배치 목록** | `edit.test.ts` "미배치 목록은 좌표 없는 설비와 그 층이고, 놓으면 빠지고 되돌리면 돌아온다"(새로 넣음) | mep.ifc `TEMP-101-01@1F` 1대, 배치하면 0, 되돌리면 1 |
| — 실제 BIM | `check:sample` "좌표 없는 설비는 미배치 목록 (ifc4Mep)"(새로 넣음) | ifc4Mep 28대 = 보호기 22 + 배관 조각 6, 층 2개 |
| — export | `edit.test.ts` "미배치 설비는 TTL 에 층까지만, GeoJSON 에 형상 없이 나간다"(새로 넣음), 같은 확인을 ifc4Mep 28대 전부에 적용 | 통과 |
| — 화면 | `e2e/info.spec.ts` "미배치 목록에서 바로 3D 바닥을 눌러 놓으면 목록에서 빠진다"(새로 넣음) | 통과 |
| 설비(종류·위치·용량) | `check:sample` "설비와 계통을 기준값대로 읽는다", `import.test.ts` "좌표 없는 설비는 원점이 아니라 null 이다" | 통과 |

## 화면
ifc4Mep — 요약 아래 [미배치 설비 28대], F1 의 [3D에서 놓기] 를 눌러 바닥 클릭을 기다리는 중
![ifc4Mep 미배치 목록](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/blob/feature/OE-BIM-07-unplaced-list/docs/figures/oe-bim-07-unplaced-list.png?raw=true)

분전반 부품(추가 작업) — ifc4Mep 에서 `F1` 을 검색한 화면. 00층 퓨즈는 그 층에 하나뿐인 분전반 위치에 배치되어 좌표 출처가 [계산], 01층 퓨즈는 분전반이 두 개라 좌표가 없다.
![분전반 부품](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/blob/feature/OE-BIM-07-unplaced-list/docs/figures/oe-bim-07-panel-parts.png?raw=true)

## 확인 방법
1. 8087 검토 서버(또는 `npm run dev`)에서 `data/ifc4Mep_IFC4.ifc` 를 연다
2. 요약의 경고 아래 **[미배치 설비 28대 — 좌표가 없어 3D에 없습니다]** — (이름 없음) 덕트·배관 6, F1~F13 보호기 22, 층은 `00. Begane grond`·`01. verdieping`
3. 아무 줄이나 [3D에서 놓기] → 편집 모드로 바뀌고 "…을 놓을 바닥을 3D에서 클릭하세요" → 3D 바닥을 누르면 배치되고 목록이 27대로 줄어든다. Ctrl+Z 면 28대
4. 직접 만든 fixture `src/lib/ifc/fixtures/mep.ifc` 는 `TEMP-101-01` 1대 — 사무실 바닥에 배치하면 소속이 "사무실" 이 되고 목록이 사라진다

## 테스트
- `npm test` — 37 files · 586 passed(새로 넣은 것: `edit.test.ts` 2, `kinds.test.ts` 1줄)
- `npx vue-tsc --noEmit` 통과
- `npm run check:sample` — 48 passed · 2 failed(작업 시작 시점에도 실패하던 것: ttl.go id 90개 어긋남, `moveWallWithSpaces` null). 새로 넣은 "미배치 목록 (ifc4Mep)" 통과
- e2e — `npx playwright test e2e/info.spec.ts e2e/smoke.spec.ts` 27 passed(새로 넣은 것 1)
- mutation test(처음 커밋(미배치 목록) 기준) — 이 커밋이 넣은 규칙을 하나씩 꺼 보고 테스트가 깨지는지 확인했다. 3곳 중 2곳을 잡았고, 나머지를 잡으려고 추가한 것: e2e `unplaced.spec.ts`(ifc4Mep) — 01층 설비를 선택한 채 00층만 보다가 [3D에서 놓기] 를 누르면 01층으로 바뀐다. (선택한 설비를 따라 층을 바꾸는 코드가 따로 있어서, 이미 선택된 설비일 때만 이 코드가 동작한다)
- mutation test — 이 커밋이 넣은 규칙을 하나씩 꺼 보고 테스트가 깨지는지 확인했다. 7곳 중 3곳을 잡았고, 나머지를 잡으려고 추가한 것: `panel-parts.test.ts` 3개(좌표 없는 분전반은 세지 않기·이름으로 분전반인 것·두 개면 배치하지 않기 — 테스트하려고 `placeInPanels` 를 export 했다), `coverage.test.ts`(피처 채움 F9 에서 계산), `check:sample` R11 의 수, e2e `panel-parts.spec.ts`(좌표 출처 칩이 계산)

## 남은 것
- (해결) **분전반 안 부품은 같은 층에 하나뿐인 분전반 위치를 따른다.** ifc4Mep 의 퓨즈 22대는 IFC 어디에도 어느
  분전반에 속하는지 정보가 없었다(포트 연결 0 · 묶음·중첩 없음 · 분전반이 회로에 없음). 그래서 근거는 IFC 연결이 아니라 "같은 층에 좌표 있는 분전반이
  하나뿐" 이다(`import.ts` 의 `placeInPanels`, 대상 클래스 IfcProtectiveDevice·TrippingUnit). 00층은 MB01 하나라 11대를 그 위치에 배치하고 출처를
  `panel`(화면·R11·커버리지에서 계산)로 둔다. 01층은 분전반이 두 개(Data board 1·SB 02)라 추정하지 않고 미배치로 남긴다. 미배치 28 → 17,
  경고에 "분전반 안 부품(보호기) 11대를 … 층으로 짐작한 것" 을 적고, R11 은 이 11대를 표준에서 뺀다. `check:sample` "좌표 없는 설비는 미배치
  목록 (ifc4Mep)" 이 확인한다
- 분전반 위치에 배치한 부품은 분전반을 옮겨도 따라가지 않는다(부착 관계를 저장하지 않았다)
- 설비 표를 "좌표 없음" 으로 필터링하는 기능은 하지 않았다 — 같은 부분을 draft #303(설치면 필터)이 고친다
- 성수는 이 PC 에 없어 측정하지 못했다
