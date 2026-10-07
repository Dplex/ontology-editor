# 이슈·칸반·검토 판 운영

CLAUDE.md 에서 옮겼다. 이슈를 만들거나, PR 을 열거나, 라벨·카드를 만질 때 연다.

이 repo 의 이슈와 칸반은 **사내 GitHub 하나로 관리한다.** "Jira", "칸반", "이슈 등록" 이라고 하면 Atlassian Jira 가 아니라
여기를 말한다.

- 이슈: `github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology` (`gh issue …`, 라벨 `prd-011`·`phase-1`, 제목 끝에 티켓 `(OE-XXX-nn)`)
- 칸반: <https://github.sec.samsung.net/orgs/IoT-Solution/projects/1> (Projects v2, `gh project … --owner IoT-Solution`)
- `gh api` 는 기본 호스트가 github.com 이다. **`GH_HOST=github.sec.samsung.net`** 을 붙인다(안 붙이면 404·rate limit 이 난다).

## 카드가 움직이는 규칙

**상태는 Todo → In Progress → In Review → Done 이고, In Progress 다음은 PR 이 옮긴다.** 손대기 시작하면 카드를
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

Status 선택지는 **웹 UI 에서만 고친다.** API(`updateProjectV2Field`)는 선택지를 통째로 갈아끼워 모든 카드의 상태 값을
지운다(2026-10-02 임시 프로젝트로 실측).

최근에 무엇이 바뀌었나는 [🔔 최근 변화](https://github.sec.samsung.net/orgs/IoT-Solution/projects/1/views/7) 뷰에서 본다.
`.github/workflows/activity.yml` 이 라벨 붙임·뗌·댓글·제목/본문 수정·생성을 카드의 `🔔 최근 변화` 텍스트 칸에
`2026-10-02 14:03 +needs-pm (누구)` 로 적고, 뷰가 그 칸을 내림차순으로 정렬한다(Projects 에는 수정 시각 필드가 없다).
카드 상태 이동은 안 잡힌다. 이 칸도 손으로 고치지 않는다.

## 8087 검토 판

**In Review 인 PR 은 55 의 8087 검토 판에서 본다**(<http://10.251.35.55:8087/>, 8084 는 main 판 그대로).
`.github/workflows/review.yml` 이 PR·main 이 움직일 때마다 `review` 브랜치를 main + (draft 아니고 앱 파일을 고친 열린 PR)로
다시 만들고, `scripts/review55.sh` 가 `/home/dt/review/ontology-editor` 에서 테스트·빌드해 띄운다.

- 앱 파일은 `src/`·`public/`·`index.html`·`package*.json`·`vite.config.ts`·`tsconfig` 다. 문서만 고친 PR(기획 PRD 수정)은 안 들어간다.
- 주소·충돌·실패 코멘트는 희록님(`REVIEW_AUTHOR`)이 연 PR 에만 단다. 다른 PR 과 충돌하는 PR 은 빼고 나머지로 띄운다.
- 무엇이 들어갔는지는 8087 화면에서 **Alt+Shift+R**(PR·브랜치·이슈·커밋). 앱 코드가 아니라 배포 때 `dist/` 에 끼워 넣는
  `scripts/review-info.js` 라서 main 판에는 없다.
- `review` 는 버리는 브랜치다. 손으로 커밋하거나 main 으로 옮기지 않는다. 55 를 재부팅하면 8087 은 손으로 다시 띄운다
  (`gh workflow run Review -R IoT-Solution/bim-to-dt-ontology`).

## 검토 코멘트(PR 본문)의 모양

#32 의 모양을 따른다(PR 본문이나 이슈에): 구현한 것 · 화면(스샷) · **확인 방법**(어느 파일을 열고 무엇을 누르면 무엇이 보이나,
번호 매긴 단계) · 테스트(파일과 `npm test`·`check:sample`·e2e 결과 숫자) · 남은 것. 스샷은 Playwright 로 실제 BIM 을 열어
찍고 `docs/figures/` 에 커밋해 브랜치 경로 `?raw=true` 로 링크한다. 3D 의 벽·설비 자리는 e2e 모드(`vite --mode e2e`)의
`window.__viewer`(`element`·`part`·`point`)로 짚는다.

## 티켓 md 와 이슈 본문 맞추기

티켓 md(`docs/prd/features`)를 고치면 이슈 본문이 어긋난다 — `npm run board`(점검), `-- --apply`(반영). 반영은 사람이 로컬 `gh` 로 수동 실행하고
Status 는 건드리지 않는다. 점검은 Actions `Board check` 가 PR·main push 때 돌려 실행 요약에 남긴다(반영은 안 한다 — 문구만 바뀌어도
`modified` 가 붙어 카드가 돌아가니 보고 나서 돌린다). 자세히는 `docs/prd/README.md` "보드 동기화".

## 라벨

**라벨은 왜 멈췄나·무엇이 바뀌었나만 말한다**(상태를 라벨로 다시 적지 않는다). 정책은 위키 [라벨 정책](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/wiki/라벨-정책),
걸러 보는 화면은 프로젝트의 [🏷️ 라벨 보드](https://github.sec.samsung.net/orgs/IoT-Solution/projects/1/views/5)다. 열은 `🏷️ 라벨` 칸인데 라벨의
사본이라 손으로 고치지 않는다. 라벨을 바꾼 뒤 `npm run board -- --apply` 를 돌리면 따라온다.

- `needs-pm`: PM 결정 대기. 질문을 이슈 코멘트에 번호 선택지로 적고 붙인다. PRD(`docs/prd/`) 수정이 필요할 때도 개발이 고치지 않고 이 라벨로 PM 에게 넘긴다. 답이 오면 뗀다
- `needs-dev`: 일부만 구현. 남은 것을 코멘트·티켓 메모에 적고 붙인다
- `rejected`: 검토 반려. In Review → In Progress 로 돌릴 때 이유와 함께. 다시 In Review 로 올릴 때 뗀다
- `blocked`: 기획 밖(개발 주체 D10·서버/저장 위치 PRD 1.7·다른 팀)을 기다린다. 무엇을 누가 풀지 코멘트에. 기획이 풀면 `needs-pm` 이다
- `modified`: 개발이 손댄 이슈의 요구사항이 바뀌었다. `npm run board -- --apply` 가 붙인다. 구현을 다시 보고 뗀다.
  Done 이슈에 붙은 것은 손으로 떼지 않는다 — 후속 이슈가 생기고, 그 PR 이 merge 될 때 kanban.yml 이 뗀다.
  후속 이슈는 템플릿(원 이슈 수정 이력의 이전 문구 + 지금 요구사항·수용 기준)이고 제목 끝에 `(OE-XXX-nn)` 를 붙이지 않는다
  (sync-board 가 제목 끝 ID 로 짝지어서 둘이 되면 엉뚱한 이슈를 고친다). 그래서 `npm run board` 의 "제목 끝에 티켓 ID 가 없는 항목" 에 뜬다
