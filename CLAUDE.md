# ontology-editor

BIM(IFC4)으로 공간 온톨로지를 만들고 고치는 PoC. 부모 `~/git/dt/CLAUDE.md` 가 말투와 플랫폼
공통 규칙을 정하니 여기엔 이 repo 안에서만 참인 것만 적는다.

**의도와 스펙(왜 이렇게 만드나, 바꾸면 안 되는 결정)은 `intent.md` 에 있다.** 설계를 바꾸거나 온톨로지에 무엇을 낼지 정할 때는
그 파일을 먼저 연다. 이 파일은 작업 규칙만 둔다.

## 이 repo 는 PRD_011 의 R1.5 다

**PRD 의 정본은 이 repo 의 `docs/prd/` 다**(2026-10-01 에 Confluence 에서 옮겼다. Confluence 페이지는 그날의 스냅숏이고 더
고치지 않는다). `PRD_011.md` 가 제품 전체, `features/E##-XXX/OE-XXX-nn.md` 가 티켓 하나씩(250개, Jira 1:1), `questions.md` 가
열린 결정이다. 규칙은 `docs/prd/README.md`. 이 repo 가 맡은 것은 "초기 구축 모드"(#5~#8) + 편집 E1~E8 이다(D10) — BIM·IDF 임포트,
수동 구축, 온톨로지 생성. 운영 편집(#9~#21)의 주체는 D10 이 열려 있다. 번호(#6 같은 것)는 PRD 기능 번호, `OE-BIM-12` 는 티켓이다.

기억으로 답하지 말고 그 파일을 연다. 티켓의 "검증 (이 repo)" 절이 그 기능을 재는 테스트를 가리키니, 기능을 고치면 거기도 고친다.

## 이슈·칸반은 사내 GitHub 안에서 한다

이 repo 의 이슈와 칸반은 **사내 GitHub 하나로 관리한다.** "Jira", "칸반", "이슈 등록" 이라고 하면 Atlassian Jira 가 아니라
여기를 말한다(PRD 티켓 파일의 `jira:` 칸도 이 이슈 번호다).

- 이슈: `github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology` (`gh issue …`, 라벨 `prd-011`·`phase-1`, 제목 끝에 티켓 `(OE-XXX-nn)`)
- 칸반: <https://github.sec.samsung.net/orgs/IoT-Solution/projects/1> (Projects v2, `gh project … --owner IoT-Solution`)
- `gh api` 는 기본 호스트가 github.com 이다. **`GH_HOST=github.sec.samsung.net`** 을 붙인다(안 붙이면 404·rate limit 이 난다).
- **상태는 Todo → In Progress → In Review → Done 이고, In Progress 다음은 PR 이 옮긴다.** 손대기 시작하면 카드를
  In Progress 로 손으로 옮긴다(이것만 사람 몫). 티켓마다 main 에서 브랜치(`feature/OE-OBJ-06-bearing-lock` 처럼)를 갈라 작업하고,
  PR 본문에 `Closes #n` 을 넣어 연다. 그다음은 `.github/workflows/kanban.yml` 이 카드를 따라 옮긴다(55 러너 `dt-dev`):

  | 일 | 카드 |
  |---|---|
  | PR 열림(draft 아님)·Reopen·Ready for review | In Review, `rejected` 뗌 |
  | PR merge | Done(이슈는 `Closes #n` 으로 닫힌다) |
  | PR 을 merge 없이 Close | 이슈에 `rejected` 붙이고 In Progress |
  | 누가 이슈에 `rejected` 를 붙임 | In Progress |
  | 이슈에 `modified` 가 붙음 | In Review 면 In Progress 로 돌리고 코멘트. **Done 이면 그대로 두고 후속 이슈 `[후속 #n] …` 를 Todo 로 만든다** |
  | 후속 이슈를 Closes 하는 PR 이 merge | 원 이슈의 `modified` 를 뗀다 |

  카드는 PR 본문의 `Closes`·`Fixes`·`Resolves #n` 으로만 찾는다 — 빠뜨리면 카드가 안 움직인다. 아직 검토받을 게 아니면 draft 로 연다.
  **merge 는 사람이 확인한 뒤에만 한다**(그게 곧 Done 이다). 토큰은 저장소 시크릿 `PROJECT_TOKEN`(희록님 gh 토큰 사본)이라
  `gh auth refresh` 로 바뀌면 `gh auth token | gh secret set PROJECT_TOKEN -R IoT-Solution/bim-to-dt-ontology` 로 다시 넣는다.
- **In Review 인 PR 은 55 의 8087 검토 판에서 본다**(<http://10.251.35.55:8087/>, 8084 는 main 판 그대로).
  `.github/workflows/review.yml` 이 PR·main 이 움직일 때마다 `review` 브랜치를 main + (draft 아니고 앱 파일을 고친 열린 PR)로
  다시 만들고, `scripts/review55.sh` 가 `/home/dt/review/ontology-editor` 에서 테스트·빌드해 띄운다.
  - 앱 파일은 `src/`·`public/`·`index.html`·`package*.json`·`vite.config.ts`·`tsconfig` 다. 문서만 고친 PR(기획 PRD 수정)은 안 들어간다.
  - 주소·충돌·실패 코멘트는 희록님(`REVIEW_AUTHOR`)이 연 PR 에만 단다. 다른 PR 과 충돌하는 PR 은 빼고 나머지로 띄운다.
  - 무엇이 들어갔는지는 8087 화면에서 **Alt+Shift+R**(PR·브랜치·이슈·커밋). 앱 코드가 아니라 배포 때 `dist/` 에 끼워 넣는
    `scripts/review-info.js` 라서 main 판에는 없다.
  - `review` 는 버리는 브랜치다. 손으로 커밋하거나 main 으로 옮기지 않는다. 55 를 재부팅하면 8087 은 손으로 다시 띄운다
    (`gh workflow run Review -R IoT-Solution/bim-to-dt-ontology`).
- 검토 코멘트는 #32 의 모양을 따른다(PR 본문이나 이슈에): 구현한 것 · 화면(스샷) · **확인 방법**(어느 파일을 열고 무엇을 누르면 무엇이 보이나,
  번호 매긴 단계) · 테스트(파일과 `npm test`·`check:sample`·e2e 결과 숫자) · 남은 것. 스샷은 Playwright 로 실제 BIM 을 열어
  찍고 `docs/figures/` 에 커밋해 브랜치 경로 `?raw=true` 로 링크한다. 3D 의 벽·설비 자리는 e2e 모드(`vite --mode e2e`)의
  `window.__viewer`(`element`·`part`·`point`)로 짚는다.
- Status 선택지는 **웹 UI 에서만 고친다.** API(`updateProjectV2Field`)는 선택지를 통째로 갈아끼워 모든 카드의 상태 값을
  지운다(2026-10-02 임시 프로젝트로 실측).
- 티켓 md(`docs/prd/features`)를 고치면 이슈 본문이 어긋난다 — `npm run board`(점검), `-- --apply`(반영). 사람이 로컬 `gh` 로 수동 실행하고
  Status 는 건드리지 않는다. 자세히는 `docs/prd/README.md` "보드 동기화".
- **라벨은 왜 멈췄나·무엇이 바뀌었나만 말한다**(상태를 라벨로 다시 적지 않는다). 정책은 위키 [라벨 정책](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/wiki/라벨-정책),
  걸러 보는 화면은 프로젝트의 [🏷️ 라벨 보드](https://github.sec.samsung.net/orgs/IoT-Solution/projects/1/views/5)다. 열은 `🏷️ 라벨` 칸인데 라벨의
  사본이라 손으로 고치지 않는다. 라벨을 바꾼 뒤 `npm run board -- --apply` 를 돌리면 따라온다.
  - `needs-pm`: PM 결정 대기. 질문을 이슈 코멘트에 번호 선택지로 적고 붙인다. 답이 오면 뗀다
  - `needs-dev`: 일부만 구현. 남은 것을 코멘트·티켓 메모에 적고 붙인다
  - `rejected`: 검토 반려. In Review → In Progress 로 돌릴 때 이유와 함께. 다시 In Review 로 올릴 때 뗀다
  - `blocked`: 기획 밖(개발 주체 D10·서버/저장 위치 PRD 1.7·다른 팀)을 기다린다. 무엇을 누가 풀지 코멘트에. 기획이 풀면 `needs-pm` 이다
  - `modified`: 개발이 손댄 이슈의 요구사항이 바뀌었다. `npm run board -- --apply` 가 붙인다. 구현을 다시 보고 뗀다.
    Done 이슈에 붙은 것은 손으로 떼지 않는다 — 후속 이슈가 생기고, 그 PR 이 merge 될 때 kanban.yml 이 뗀다.
    후속 이슈는 템플릿(원 이슈 수정 이력의 이전 문구 + 지금 요구사항·수용 기준)이고 제목 끝에 `(OE-XXX-nn)` 를 붙이지 않는다
    (sync-board 가 제목 끝 ID 로 짝지어서 둘이 되면 엉뚱한 이슈를 고친다). 그래서 `npm run board` 의 "제목 끝에 티켓 ID 가 없는 항목" 에 뜬다
- **최근에 무엇이 바뀌었나는 [🔔 최근 변화](https://github.sec.samsung.net/orgs/IoT-Solution/projects/1/views/7) 뷰에서 본다.**
  `.github/workflows/activity.yml` 이 라벨 붙임·뗌·댓글·제목/본문 수정·생성을 카드의 `🔔 최근 변화` 텍스트 칸에
  `2026-10-02 14:03 +needs-pm (누구)` 로 적고, 뷰가 그 칸을 내림차순으로 정렬한다(Projects 에는 수정 시각 필드가 없다).
  카드 상태 이동은 안 잡힌다. 이 칸도 손으로 고치지 않는다.

## 이 repo 에서 일하는 방식 (지난 세션에서 본 것)

말투는 부모 `CLAUDE.md`(ELI30)를 따른다. 여기엔 이 repo 에서 되풀이된 것만 적는다.

- **화면을 보다가 바로 말한다** — "스크롤이 너무 길어", "마우스가 설비 위인지 모르겠어", "전체 화면 버튼". 고치면 e2e 로
  재고, 눈으로 봐야 하는 것(색·속도)은 안 봤다고 말한다. 스샷이 필요하면 Playwright 로 실제 BIM(Duplex·성수)을 열어 찍는다.
- **"이게 어떻게 되는 거야?" 는 대개 "어디에 남느냐" 를 묻는 것이다** — 확정·편집이 BIM 에 쓰이는지, 브라우저에만 있는지,
  TTL·GeoJSON 의 어느 줄이 되는지. 출처(BIM·계산·사전·편집)를 같이 답한다.
- **테스트는 해피 케이스로 끝내지 않는다.** "유저 기반으로 꼼꼼히", "버그 헌팅" 을 여러 번 청했다. 성수·병원처럼 큰 파일과
  편집 둘이 만나는 곳을 먼저 본다.
- **기능을 끝내면 이슈 + PR 이다**(칸반은 PR 이 옮긴다). 본문에 PRD 티켓 경로, 스샷(`docs/figures/` 에 올려 `?raw=true` 로 링크), 확인 경로를
  둔다(#32 가 본). 작은 손질은 이슈 없이 main 으로 push 해 달라고 한 적이 있으니, 애매하면 어느 쪽인지 묻는다.
- **목적을 자주 되짚는다** — 도구를 늘리는 게 아니라 "BIM 필수 요구 + 그걸로 DT 온톨로지가 어디까지 되나" 다. 기능 제안이
  그 답에 보탬이 안 되면 그렇게 말한다.

## 무엇이 설비인가는 IFC 계층에 맡긴다

`IfcDistributionElement` 를 **상속 포함**으로 조회한다(`GetLineIDsWithType(..., true)`).
그 아래에 공조·배관·전기·계측이 전부 들어간다.

처음에는 "건축 부재가 아니면 설비" 로 뒀다가 AC20-FZK-Haus 에서 `IfcAnnotation` 14개
(치수선·라벨)를 설비로 셌다. 제외 목록을 늘리는 방식은 새 클래스가 나올 때마다 또 틀린다.
`check-sample.test.ts` 가 그 모델의 설비 수를 0 으로 박아 두고 있으니, 이 값이 0 이 아니게
되면 기준이 다시 넓어진 것이다.

## IFC 에서 조용히 틀리는 곳 셋

1. **배치 사슬(IfcLocalPlacement)을 안 타면 방이 전부 원점에 겹친다.** 개수도 넓이도 그대로라
   숫자만 봐서는 멀쩡해 보인다. 3D 뷰가 이걸 잡으라고 있는 것이고, 테스트도 "두 방의 첫 점이
   다르다" 를 따로 본다.
2. **층과 공간은 분해 관계(IfcRelAggregates), 벽·문·창은 포함 관계
   (IfcRelContainedInSpatialStructure)로 묶인다.** 같은 "층에 속한다" 인데 IFC 가 관계를 나눠
   놔서, 한쪽만 읽으면 절반이 빈다.
3. **`loadBearing: null` 은 "모름" 이지 "아니오" 가 아니다.** 실제 BIM 에 Structural 속성이
   없는 일이 흔하다(샘플 AC20-FZK-Haus 는 13장 전부 없다. Pset_WallCommon 은 있는데 그 안에
   ThermalTransmittance 만 들어 있다). false 와 섞으면 편집 제한이 엉뚱하게 걸린다.

설비에도 같은 함정이 있다. **좌표가 없는 설비를 `0,0,0` 으로 채우면 안 된다** — "모르는 것"
이 "원점에 있는 것" 으로 바뀌어서, 원점 근처 물리존에 자동으로 소속돼 버린다. `position` 과
`spaceId` 가 `null` 을 그대로 들고 다니는 이유다.

공간 외곽선이 **어느 표현에 들어 있는지가 저작 도구마다 다르다.** ArchiCAD 는 `FootPrint` 를
따로 내보내지만 **Revit 은 만들지 않고 `Body/SweptSolid` 만 낸다.** FootPrint 만 읽던 시절
Duplex 세 판본(Revit)의 공간 85개가 전부 외곽선 0 이었고, 3D 에 방이 한 칸도 안 그려졌다.
지금은 FootPrint 를 먼저 보고 없으면 `IfcExtrudedAreaSolid` 의 `SweptArea` 를 쓴다 — 그게 곧
바닥 단면이라 Brep 과 달리 메시를 자를 필요가 없다. Brep·SurfaceModel 과 형상 표현이 아예
없는 공간(COBie 판본)은 여전히 빈 고리를 주고 경고로 남긴다.

**배치점을 좌표로 믿지 말 것.** Revit IFC2x3 의 덕트 구간은 `ObjectPlacement` 가 층 원점이고
형상만 제자리다(Duplex HVAC 231개 전부). 그대로 판정하면 원점이 든 방에 덕트가 전부 몰린다.
배치점이 자기 형상에서 0.5m 넘게 떨어지면 형상 중심을 쓴다(`anchorToGeometry`). 형상을 안 읽는
`importIfc` 에서는 이 보정이 안 돈다 — 소속을 재는 검사는 `importIfcWithMeshes` 를 쓴다.

**설비 판본에는 같은 방이 두 번 있다.** Revit 이 건축 Room 사본과 "MEP Space" 를 같이 낸다(Duplex MEP 42개 중 20쌍,
병원 MEP 257쌍). 열 때 외곽선이 같고(1cm) 이름이나 방 번호가 같은 방을 말하는 쌍만 걷는다(`dropDuplicateSpaces`) —
외곽선만 보면 병원 지붕 `R-Roof`·`R-AT1 Roof`(다른 공간)를 먹고, 안쪽 점만 보면 대기실이 접수대를 먹는다.
**건축 파일에도 사본이 있다** — 성수 건축은 이름 붙은 방마다 같은 외곽선의 기본 이름 "공간"(번호도 따로)을 하나씩 더 둬서
933개로 읽혔다(실제 508). 한쪽 이름이 Revit 기본 이름이면 외곽선만으로 같은 방으로 보고 이름 있는 쪽을 남긴다(`PLACEHOLDER_NAMES`).

**층은 GUID 로 맞출 수 없다.** 같은 건물의 건축·설비 판본이 층 GlobalId 를 따로 만든다. 합치기는
이름으로 맞추고, 좌표계가 같은지는 따로 잰다 — 다른 건물을 합쳐도 오류 없이 층 짝이 지어진다.

**F11 의 정답지는 BIM 이 말한 소속이다.** `scoreAgainstDeclared` 가 좌표 판정을 거기에 대 본다.
**같은 층 물리존끼리도 겹친다** — 병원 건축 52쌍(큰 대기실이 접수대를 품는다), Duplex 건축 7쌍. Revit 이 적은 넓이와
우리가 읽은 넓이가 같으니 읽기가 틀린 것이 아니라 원본이 그렇다. 그래서 "옆 방과 겹치면 경고" 는 두지 않는다(원래 있던 것과
사람이 만든 것을 가르지 못한다). 겹친 자리의 설비는 **가장 작은 방**에 둔다 — 목록의 첫 방보다 BIM 이 말한 소속에 맞는
수가 가진 파일 전부에서 늘었다. `scoreAgainstDeclared` 는 걸린 방 중 하나만 맞아도 맞힌 것으로 세서 이 차이를 못 잰다.
벽면 여유 `SNAP`(5cm)을 바꾸면 이 채점표가 움직이니 `check:sample` 을 같이 본다.

**web-ifc 가 스키마에 따라 숫자를 다르게 준다.** IFC4 는 `DirectionRatios` 를 `IfcReal` 객체로
감싸는데 IFC2x3 은 맨 숫자 배열로 준다. 한쪽만 가정하면 **오류 없이 회전만 조용히 사라진다** —
넓이도 개수도 그대로라 눈으로 보기 전에는 모른다. 숫자를 읽는 자리는 `numbers()` 를 쓴다.

## 테스트 입력이 두 갈래다

- `npm test` — 입력이 `src/lib/ifc/fixtures/two-rooms.ifc` 다. 손으로 쓴 최소 IFC4 라서
  무엇이 들어가면 무엇이 나오는지 파일 하나로 보인다. 회전이 있는 방, FootPrint 가 없는 방,
  내력벽 참/거짓/모름이 일부러 다 들어 있다.
- `npm run check:sample` — 입력이 실제 BIM(`data/AC20-FZK-Haus.ifc`)이고 gitignore 다.
  없으면 실패가 아니라 이유를 찍고 건너뛴다(`npm run fetch:sample` 로 받는다).
  손으로 쓴 픽스처가 통과해도 진짜 저작 도구 출력에서 깨질 수 있어서 따로 둔다.

**사전·규칙·임포터의 숫자(SNAP, 배치점 보정, 형상 추정 거리)를 고치면 가진 BIM 전부에 같이 대 본다.**
BIM 마다 저작 습관이 달라서 한 파일을 올리려고 고치면 다른 파일이 내려간다. `check:sample` 이 AC20·ifc4Mep·
Duplex·병원(NBU_MedicalClinic)·성수를 한 번에 재고, 정확도는 지금 값 아래로 떨어지면 실패다. 하나가 오르고
다른 하나가 내려가는 변경은 과적합으로 보고 넣지 않는다. 성수 검사는 성수 파일이 있는 PC 와 55 에서만 돈다 —
기준값을 정본에서 옮겨 넣은 PC 에는 성수가 없었으니, 처음 돌려서 어긋나면 코드와 문서 중 맞는 쪽으로 둘 다 고친다.
성수만 돌리려면 `npm run check:seongsu` — 기준값에 더해 `scripts/seongsu.test.ts` 가 불변식(편집 왕복·되돌리기·ttl.go)을
보고 정본의 빈칸을 재서 `data/성수/측정-결과.md` 에 쓴다. 화면 테스트까지 포함한 목록은 `docs/seongsu-test.md` 다.

## 큰 파일의 속도는 GPU 로 잰다

Playwright 헤드리스 크롬의 WebGL 은 기본이 CPU(SwiftShader)라서, 병원 MEP(207MB) 3D 한 프레임이 3초씩 걸려 방향키
편집이 3.4초로 재졌다. `--use-angle=d3d11 --ignore-gpu-blocklist` 로 GPU 를 쓰면 0.24초다. 느리다는 숫자가 나오면
렌더러부터 확인한다. 열기는 워커에서 돌아 화면이 멈추지 않지만 기다리는 시간이다 — 병원 MEP 가 43초에서 18초가 됐다.
줄인 곳은 둘이다. 형상 연결 추정(`topology.ts`)은 문자열 격자를 정수 해시 격자로 바꿨다(34초 → 6초).
속성(`import.ts`)은 네 번 훑던 것을 한 번으로 줄였다. 둘 다 출력이 바이트 단위로 같은지 해시로 확인하고 바꿨다.
이런 곳을 고칠 때도 그렇게 한다.
3D 는 설비 형상을 정점 25만 개 덩어리로 나눠 프레임마다 하나씩 GPU 에 올린다 — 한 벌로 합쳐 올리면 성수(403MB)를 열 때
화면이 멈췄고, 옮기기·칠하기도 그 덩어리만 다시 올린다. 성수 화면 항목은 `npm run e2e:seongsu`(GPU, 4분)가 돌고 기준을
넘으면 실패한다(`docs/seongsu-test.md`).

## WASM 은 커밋하지 않는다

`public/web-ifc.wasm` 은 `scripts/sync-wasm.mjs` 가 node_modules 에서 복사한다. 릴리스 바이트
그대로여야 버전 올리기가 재배치가 아니라 설치 한 번으로 끝난다. `predev`·`prebuild`·`pree2e`
에 걸려 있어서 따로 부를 일은 없다.

## dev 포트는 5174 다

5173 은 `ieum-pipeline/web`(운영 콘솔)이 쓴다. 바꾸려면 `vite.config.ts` 를 고친다.

e2e 는 따로 5175 에 `--mode e2e` 로 띄운다(`playwright.config.ts`). 그 모드는 `data/` 목록을 붙이지
않는다. 등급 측정이 dev 서버와 같은 스레드에서 돌아서, 임포터를 고친 직후 성수 기계 파일을 재는 1분 가까이
서버가 멈추고 e2e 가 전부 시간 초과로 떨어졌다. 55 의 정적 서버도 같은 이유로 배포 직후 등급을 다시 잴
때 잠깐 멈춘다.
목록에서 시작하는 흐름(짝 링크, 골라 합쳐 열기, 아래쪽에서 열기, 열 수 없는 파일)은 `e2e/data-list.spec.ts` 가
`page.route('**/__data/**')` 로 목록·등급·파일을 흉내 내서 본다. 서버 측정을 거치지 않아 멈추지 않고, `data/` 가 없는 PC 에서도 돈다.

## 55 에서는 정적 서버로 8084 에 뜬다

빌드한 번들을 `scripts/serve.mjs`(의존성 없는 node 정적 서버)가 `0.0.0.0:8084` 로 내준다.
주소는 `http://10.251.35.55:8084/`. 기동은 다른 repo 와 같은 인터페이스인 `scripts/run.sh`,
배포는 `scripts/deploy55.sh` 이고, **밤 자동 배포(`ieum-apm/scripts/autodeploy55.sh`)에는 넣지 않는다.**
PoC 라 원할 때 손으로 배포한다: `ssh 55 'cd /home/dt/git/dt/ontology-editor && scripts/deploy55.sh'`.
API 가 없어 재시작해도 다른 서비스가 끊기지 않으니 창(23:35)을 기다릴 이유가 없다.

**정문(8000)을 거치지 않는다.** 이 앱은 브라우저 안에서만 돌고 API 가 없어서, 정문의 유일한
일인 토큰 검증이 지킬 것이 없다. 포털 `:80` 은 한 장짜리 `.html` 만 내주므로 여러 파일로 된
번들을 올릴 자리가 아니었다.

**`data/` 샘플 목록과 등급 칩은 dev 서버와 55 가 같은 코드로 낸다.** `src/server/data-catalog.ts`
하나를 vite 플러그인이 쓰고, `npm run build:server` 로 묶은 판을 `serve.mjs` 가 `/__data` 에 붙인다.
둘이 따로 구현하면 같은 파일에 다른 칩이 뜬다. 55 의 `data/` 는 gitignore 라 pull 로 오지 않는다.
**55 에서 `npm run fetch:sample` 은 안 된다** — 2026-09-23 실측으로 GitHub·tib.eu·npm 레지스트리에 전부
닿지 않았다. 개발 PC 의 `data/` 에서 IFC 만 복사한다:
`rsync -a --prune-empty-dirs --include='*/' --include='*.ifc' --exclude='*' data/ 55:/home/dt/git/dt/ontology-editor/data/`.
등급은 첫 요청 때 재서 `data/.profiles.json` 에 캐시하고(17개 18초), 임포터 코드가 바뀌면 다시 잰다.

PRD 1.7 은 DT 와의 데이터 교환 방식을 셋으로 열어 두고 개발 확인이 필요하다고 적었다
(① 파일 export→import ② 온톨로지 서버에 API 로 직접 쓰기 ③ 공유 DB). 지금 이 repo 는
①을 전제로 만들어져 있다. ②·③ 으로 정해지면 서버가 생기고, 그때 부모 CLAUDE.md 의
"새 서비스를 붙일 때" 다섯 단계가 전부 걸린다.
