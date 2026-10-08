# TODO: Actions 러너와 review 브랜치 워크플로

2026-10-02 정리. 칸반의 In Review 를 55 서버 한 곳에서 확인하려고 GitHub Actions 와 `review` 브랜치를 붙이는 일이다.

## 목표 흐름

| 칸반 | git | 자동으로 따라오는 것 |
|---|---|---|
| In Progress | `feature/{티켓}-{이름}` 에서 작업한다. PR 은 draft 로 연다 | 없음 |
| In Review | PR 을 Ready for review 로 바꾼다 | `review` 를 main + (draft 가 아닌 열린 PR 전부)로 다시 만든다. 테스트 → 강제 push → 55 배포 → PR 에 확인 주소 코멘트 → 카드 In Review |
| 반려 | PR 을 draft 로 되돌린다 | `review` 를 다시 만들면 그 PR 이 빠진다. 카드는 In Progress 로 간다 |
| Done | 사람이 PR 의 Merge 버튼을 누른다 | `Closes #n` 으로 이슈가 닫힌다. 프로젝트 내장 워크플로("PR merged → Done")가 카드를 옮긴다. `review` 를 다시 만든다 |

- `review` 는 버리는 브랜치다. 커밋을 main 으로 옮기지 않는다. main 에 들어가는 단위는 티켓 브랜치(PR)다.
- 다시 만들다가 충돌이 나면 두 PR 이 main 에서도 부딪힌다는 뜻이다. 실패로 끝내고 어느 PR 끼리인지 코멘트를 단다.
- 칸반 카드 이동은 Actions 를 깨우지 못한다(Projects 이벤트는 워크플로 트리거가 아니다). 그래서 git(PR)이 움직이고 칸반이 따라오게 한다.

## 끝난 것

- [x] 55 에 조직 러너 `dt-dev` 를 등록했다. 러너 그룹은 `iot-solution-runner`, 라벨은 `self-hosted, Linux, X64, dt-dev`, 위치는 `/home/dt/actions-runner`
- [x] 러너를 systemd 서비스로 띄웠다(`actions.runner._services.dt-dev.service`)
- [x] 러너 그룹 저장소 접근에 `bim-to-dt-ontology` 를 넣고 저장했다
- [x] 러너 그룹 "Allow public repositories" 를 켰다(이 저장소가 GHE 에서 Public 이다)
- [x] 러너의 `.env` 에 프록시와 `NODE_EXTRA_CA_CERTS=/home/dt/proxy.crt` 를 넣었다. 원래 파일은 `.env.bak` 이다
  - 프록시는 `/etc/environment` 에 있어서 로그인 셸에만 걸리고 systemd 서비스에는 안 걸린다. 그래서 `actions/setup-node` 가 Node 를 내려받다 `ECONNRESET` 으로 끊겼다
  - `no_proxy` 에는 `10.0.0.0/8, .samsung.net, .sec.samsung.net, sec.samsung.net, github.sec.samsung.net` 이 있다
- [x] 확인: `runs-on: [self-hosted, dt-dev]` 시험 워크플로 성공. 기획 쪽 `PRD check` 3건(prd_edit 2, main 1) 성공

## 남은 것

### 보안 (먼저)
- [ ] 저장소 Settings → Actions → General 에서 포크 PR 워크플로를 "승인 후 실행" 으로 둔다
  - public 저장소라 사내 누구나 포크해서 PR 을 열 수 있고, 그 워크플로가 55 에서 `dt` 권한으로 돈다. 55 에는 DB·키·다른 서비스가 있다
  - API 로는 이 설정을 확인하지 못했다. 웹에서 본다
- [ ] 기획 쪽 `PRD check`(`prd_edit` 브랜치의 `.github/workflows/prd-check.yml`)가 `runs-on: self-hosted` 다
  - 전사 공용 `code-linux` 러너 692대가 모든 저장소에 열려 있어서 그쪽으로도 갈 수 있다
  - `runs-on: [self-hosted, dt-dev]` 로 바꾸자고 기획에 말한다

### 55 운영 기록
- [ ] `~/git/dt/CLAUDE.md` 에 "55 는 systemd 를 안 쓴다" 의 예외로 러너를 적는다. 서비스 이름, `.env` 에 프록시를 넣은 이유, 재시작 명령(`sudo systemctl restart actions.runner._services.dt-dev.service`)을 같이 적는다
- [ ] `/home/dt/README.md` 의 기동·정지 절차에 러너를 적는다(버전 관리가 안 되는 파일이다)

### review 워크플로 (코드)
- [ ] `scripts/deploy55.sh` 가 배포할 브랜치를 인자로 받게 한다. 기본은 지금처럼 main 이다
- [ ] 화면 구석에 지금 떠 있는 브랜치·커밋을 빌드 때 찍어 보인다(8084 에 무엇이 떠 있는지 알게)
- [ ] `.github/workflows/review.yml`
  - 트리거: `pull_request`(opened · ready_for_review · converted_to_draft · synchronize · reopened · closed), `workflow_dispatch`
  - `runs-on: [self-hosted, dt-dev]`, `concurrency: review`(한 번에 하나만 돈다)
  - `review` 를 `origin/main` 에서 새로 만들고, draft 가 아닌 열린 PR 의 head 를 차례로 합친다 → `npm ci` → `npm test` → `git push --force-with-lease origin review`
  - 55 의 `/home/dt/git/dt/ontology-editor` 에서 `scripts/deploy55.sh review` 를 실행한다(러너가 55 에 있어서 SSH 가 필요 없다)
  - PR 마다 확인 주소(`http://10.251.35.55:8084/`)와 `review` 커밋을 코멘트로 단다
  - 카드 상태를 맞춘다: Ready → In Review, draft → In Progress
- [ ] Projects 를 고칠 토큰: 기본 `GITHUB_TOKEN` 은 조직 프로젝트를 못 고친다. `project` 범위의 PAT 를 저장소 시크릿(예: `PROJECT_TOKEN`)으로 넣는다
- [ ] 프로젝트 설정(웹 UI)에서 내장 워크플로 "Pull request merged → Done" 을 켠다
  - Status 선택지 자체는 웹 UI 에서만 고친다. API(`updateProjectV2Field`)는 선택지를 통째로 갈아끼워서 모든 카드의 상태를 지운다

### 이미 있는 브랜치 옮기기
- [ ] **먼저 main(ea083fd 이후)에 다시 올린다.** 기획이 #283 으로 티켓 상태 값을 `prd-done`·`prd-review` 둘로 바꿨다. 내 브랜치들은
  티켓 머리 필드에 `poc-partial` 같은 옛 값을 적어서 그대로 합치면 `prd.test.ts` 가 깨진다. 티켓 파일에서는 검증·메모 절만 남기고 머리 필드는 main 값으로 둔다
- [ ] #42(OE-COM-08)는 구현 뒤 요구사항이 바뀌었다(`modified`). 임시 저장 목록에서 불러오기, 저장 시 웹에서 바로 확인하기가 더해졌다
- [ ] 지금 In Review 인 브랜치를 `feature/…` 로 옮기고 PR 을 연다. 본문에 `Closes #n` 을 넣는다

  | 지금 브랜치 | 새 이름 | 이슈 | 기준 |
  |---|---|---|---|
  | `obj-06-bearing-lock` | `feature/OE-OBJ-06-bearing-lock` | #48 | main |
  | `obj-05-inner-wall` | `feature/OE-OBJ-05-inner-wall` | #47 | #48 위에 쌓임 |
  | `obj-07-openings` | `feature/OE-OBJ-07-openings` | #49 | #47 위에 쌓임 |
  | `com-08-unsaved-confirm` | `feature/OE-COM-08-unsaved-confirm` | #42 | main |
  | `obj-16-no-overlap` | `feature/OE-OBJ-16-no-overlap` | #52 · #57 | main |
  | `obj-08-mount-surface` | `feature/OE-OBJ-08-mount-surface` | #50(1단계, In Progress) | main |

  - 쌓인 셋(#48 → #47 → #49)은 PR 의 base 를 앞 브랜치로 두거나, main 기준으로 다시 정리한다. 앞으로는 main 에서 바로 가른다
- [ ] 첫 `review` 를 만들고 55 에 배포한다. **55 배포 전에 허락을 받는다**
- [ ] `CLAUDE.md`(이 저장소)의 칸반 절차를 위 흐름으로 고친다. 지금은 "브랜치 push + 이슈 코멘트 → In Review" 로 적혀 있다

## 정할 것

- 8084 를 `review` 로 띄우면 55 의 에디터는 main 이 아니라 검토 중인 판이 된다. PoC 라 괜찮다고 봤다. main 과 나란히 보려면 55 에 트리가 둘이 돼서 "55 배포는 `/home/dt/git/dt` 하나에서만" 규칙을 바꿔야 한다
- 저장소를 Internal 로 바꾸면 "Allow public repositories" 를 다시 끌 수 있다. 지금은 켜 두기로 했다
