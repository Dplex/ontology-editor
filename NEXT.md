# 다음 작업 — `next-10-09`

ecode(`eco`)에만 올리는 작업 브랜치다. 2026-10-08 밤 sec `main`(39ea19c, [#407](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/407) 까지)에서 시작했다.
이 파일은 **어디까지 했고 다음에 무엇을 하는지**와 **작업 방법**만 적는다. 숫자는 2026-10-08 22:40 의 보드·이슈에서 뽑았다.

> **PRD(`docs/prd/`)는 고치지 않는다** — 티켓 md 의 "검증 (이 repo)" 절도. 요구사항과 다르게 가야 하면 PR md 의 "남은 것" 에
> `needs-pm` 질문으로 적고, sec 으로 옮길 때 이슈에 코멘트·라벨을 단다. 커밋마다 `git show --stat HEAD` 에 `docs/prd` 가 없는지 본다.

## 작업 방법 — 커밋 하나 = sec PR 하나

지난 `weekend/2026-10-03` 와 같다. 다른 점은 PR md·스샷을 `next/` 에 두는 것뿐이다(sec 으로는 가져가지 않는다).

- **커밋 하나에 들어가는 것**: 코드 + 그 기능을 재는 테스트 + PR md(`next/pr/<티켓 소문자>.md`) + 스샷(`next/figures/<티켓 소문자>-무엇.png`).
  설계 결정이 있으면 ADR(`docs/adr/`)도 같은 커밋에. 다른 PR 몫은 넣지 않는다.
- **PR md 가 곧 커밋 메시지다.** 틀은 [`next/pr-template.md`](next/pr-template.md). `git commit -F next/pr/oe-xxx-nn.md` 로 커밋한다
  (편집기로 쓰면 `## 구현한 것` 같은 줄이 주석으로 지워진다). 문체는 [`docs/dev/writing-style.md`](docs/dev/writing-style.md) — 전부 존댓말,
  본문 모양은 [`docs/dev/board.md`](docs/dev/board.md) "검토 코멘트(PR 본문)의 모양": 구현한 것 · 화면 · 확인 방법 · 테스트 · 남은 것.
- **스샷**은 Playwright 로 실제 BIM(`data/`)을 열어 찍는다. PR md 에서는 상대 경로(`../figures/…png`)로 걸어 ecode 에서 보이게 하고,
  sec PR 을 열 때 GitHub 첨부로 올려 주소를 바꾼다(브랜치 경로 링크는 merge 뒤 깨진다, [#340](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/340)).
- **커밋 전에**: `npm test` · `npx vue-tsc --noEmit` · 바꾼 화면의 e2e. 임포터·규칙 숫자를 건드렸으면 `npm run check:sample`.
  숫자는 PR md 의 "테스트" 에 적는다.
- **고칠 때**: 방금 커밋이면 `git commit --amend -F next/pr/….md`. 앞 커밋이면 `git commit --fixup=<커밋>` 뒤
  `GIT_SEQUENCE_EDITOR=: git rebase -i --autosquash f26b4f3`.
- 끝날 때마다 `git push eco next-10-09`.
- **코드 변경 없이 닫을 이슈**는 "구현 확인 결과" 코멘트를 `next/comment/<티켓 소문자>.md` 에 둔다. sec 에 닿는 PC 에서 그 이슈에 코멘트로 달고 닫는다(#343~#350 과 같은 모양).

### sec 으로 옮기기 (sec 에 닿는 PC 에서, 사람이 확인하며)

```bash
git log --reverse --format='%h %s' --grep='^OE-\|^docs:\|^test:' f26b4f3..eco/next-10-09   # PR 거리 커밋 목록
c=<커밋>; br=$(git log -1 --format=%B $c | sed -n 's/^Branch: //p')
git switch -c "$br" origin/main && git cherry-pick -n $c
git rm -rq --cached next && rm -rf next          # PR md·스샷은 sec 으로 가져가지 않는다
git commit -C $c && npm test && git push -u origin "$br"
GH_HOST=github.sec.samsung.net gh pr create --base main --head "$br" --title "<제목>" --body-file <(git show -s --format=%b $c)
```

PR 을 연 뒤 스샷을 첨부로 올려 본문 주소를 바꾸고, `needs-pm` 질문은 이슈에 코멘트·라벨로 단다.

## 이 브랜치에서 한 것

옮길 때 이 순서대로 PR 을 연다(뒤의 것이 앞의 것과 같은 줄을 고친다).

| 커밋 | PR 거리(PR md) | 이슈 | `needs-pm` |
|---|---|---|---|
| 6655ba5 | [ADR 목록 0017~0022](next/pr/docs-adr-index.md) | 없음 | — |
| 0c463b3 | [OE-EQP-11 스프링클러 소화 배관 검사](next/pr/oe-eqp-11.md) | [#409](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/409) | — |
| 51bd6b5 | [OE-SPC-12 사이트 기본 내벽 두께 0.15m](next/pr/oe-spc-12.md) | [#408](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/408) | 외벽 300mm 칸을 둘지 |
| 665d97c | [OE-OBJ-03·09 룸·오브젝트 GeoJSON 내보내기](next/pr/oe-obj-03-09-export.md) | 새 이슈(옮길 때 생성) | TTL 에 넣을지 · 모델 파일을 넘길지. ADR 목록 줄이 첫 PR 뒤에 붙는다 |
| e45fcab | [OE-PIP-12 분기 이음쇠·추종 불가 사유·미리보기](next/pr/oe-pip-12.md) | [#193](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/193) | — |
| 99af8d3 | [OE-EXT-05 포트 없는 건축 루버 Proxy 받지 않기](next/pr/oe-ext-05.md) | [#236](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/236) | OE-EQP-15·PRD 1.8 의 성수 루버 숫자 갱신 요청 |
| ee01c80 | [성수 화면 시험을 10-08 merge 뒤 동작에 맞춤](next/pr/test-seongsu-e2e.md) | 없음 | — |
| 2256682 | [OE-SPC-17 같은 공간명 방 종류 일괄 수정·사전 보강](next/pr/oe-spc-17.md) | [#150](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/150) | 약어 방 이름(S.T·P.S 등)의 뜻·방 종류 목록 |
| f297e7d | [OE-MAN-03 외곽선 없는 물리존 목록·BIM 면적·그린 뒤 경고](next/pr/oe-man-03.md) | [#119](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/119) | ±20% 경고 기준 |
| 07f02c3 | [OE-WF-06 닫았다 다시 열어도 내보내기가 같다는 시험](next/pr/oe-wf-06.md) | [#205](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/205) | 파일 없이 이어서 하기(서버 보관)가 필요한지. OE-SPC-17 다음 |
| b61c2df | [OE-ZON-01·02 수동 공조존(골라 만들기·그려 나누기·담당 설비)](next/pr/oe-zon-01-02.md) | [#151](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/151) [#152](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/152) [#121](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/121) | 서비스 영역을 설비→공조존→물리존으로 내는지 |
| 93e0169 | [OE-ZON-05 공조존 검증·담당 물리존 고치기·분할 따라가기](next/pr/oe-zon-05.md) | [#155](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/155) | — (ZON-01·02 다음) |
| 9a2e745 | [OE-ZON-04 공조존 경계 다시 그리기](next/pr/oe-zon-04.md) | [#154](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/154) | — (ZON-05 다음) · `needs-pm` |
| f7520a4 | [OE-MAP-02 흐름 기준 후보와 연결 경고](next/pr/oe-map-02.md) | [#159](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/159) | — (ZON-04 다음) |
| 3a5c554 | [OE-ZON-01 설비 패널의 담당 공조존](next/pr/oe-zon-01-panel.md) | Refs [#151](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/151) | — (MAP-02 다음) |
| 8ed03b8 | [OE-PIP-10 꺾임 이음쇠(꼭짓점) 옮기기](next/pr/oe-pip-10-vertex.md) | Refs [#191](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/191) | — (ADR 목록 줄은 MAP-02 다음) · `needs-pm` |
| 77f59aa | [OE-PIP-13 구간 경로 LineString · 미반영 목록](next/pr/oe-pip-13.md) | [#194](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/194) | PIP-10 다음 · `needs-pm` |
| 1225b23 | [OE-EQP-07 EL·ES 층 편집 잠금 · 에스컬레이터 사전](next/pr/oe-eqp-07.md) | [#171](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/171) | — (check-sample 성수 줄은 PIP-13 다음) |
| 18183f8 | [OE-PIP-11 수동 배관 그리기](next/pr/oe-pip-11.md) | Refs [#192](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/192) | PIP-13 다음 · `needs-pm` |
| 6b67ca6 | [OE-PIP-10 구간 삭제 영향](next/pr/oe-pip-10-impact.md) | Refs [#191](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/191) | PIP-10 꼭짓점 다음 |
| 8f04fd0 | [OE-PIP-10 구간 끝 연결 대상 바꾸기](next/pr/oe-pip-10-retarget.md) | Refs [#191](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/191) | 구간 삭제 영향 다음 |
| 8c6bde3 | [docs: 로봇 경로가 읽는 GeoJSON 속성](next/pr/docs-geojson-robot.md) | Refs [#231](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/231) | — · `needs-pm` |
| 96b9a32 | [OE-MAN-02 평면도 배경 이미지](next/pr/oe-man-02.md) | [#118](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/118) | — · `needs-pm` |
| b17f8b7 | [OE-EQP-08 실내기 Z-06](next/pr/oe-eqp-08.md) | [#172](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/172) | ZON-01 패널 다음 |
| 978c118 | [test: BIM 배관 다시 열기(OE-PIP-14)](next/pr/test-pip-14.md) | Refs [#195](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/195) | PIP-10·13 다음 |
| 3731493 | [OE-PIP-08 연결 후보 [연결하기] 용어](next/pr/pip-08-wording.md) | Refs [#411](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/411) | — |
| 533c433 | [OE-EQP-15 외벽 설비 소속 판정 제외](next/pr/eqp-15-exterior-space.md) | Refs [#179](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/179) · [#399](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/399) | — |
| b63f3e6 | [OE-MAP-03·05·06 N:M 표시·서비스 영역·재계산 시험](next/pr/oe-map-03-05-06.md) | [#160](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/160) [#162](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/162) [#163](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/163) | 공조존 PR 들 다음 |
| 9f137ad | [OE-MAP-04 리포트의 Z-01](next/pr/oe-map-04.md) | [#161](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/161) | ZON-05 다음 |
| a74525a | [OE-ML-19 겹침 후보 상호 일치·출처·병원 기준선 + ADR-0032](next/pr/oe-ml-19.md) | 새 이슈(옮길 때 "[후속 #350]" 로 생성) | 로봇 GeoJSON 문서·PIP-11 다음 · `needs-pm`(#237 세션 확정) |
| 4893c23 | [OE-ML-02 BIM 계단 → 수직 관통 오브젝트(층별 조각) · 계단이 이은 물리존 우선 + ADR-0033](next/pr/oe-ml-02.md) | Refs [#238](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/238) | ML-19 다음 |
| ce487d2 | [OE-ML-05 층 편집 화면의 계단 조각(형상·진입/종료 지점) · 읽기 전용 패널](next/pr/oe-ml-05.md) | OE-ML-05 이슈(번호는 옮길 때 확인 — `Refs #…` 를 채운다) | ML-02 다음 |
| f188ef4 | [test: 편집 도구 상자가 Windows 글꼴에서 꺾여 바닥을 가리던 것](next/pr/test-palette-width.md) | 없음 | — (e2e `edit-3d`·`edit-structure` 두 개가 이 PC 에서 실패하던 것) |
| a33f97f | [OE-ML-01 다중층 뷰(보기) — 층 범위 · 오브젝트 전체 칠하기 · 진입→종료 점선 · 진입 경로 ①②](next/pr/oe-ml-01-view.md) | Refs [#237](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/237) | ML-05 다음 |
| f6a7dde | [OE-ML-07·09 다중층 뷰에서 계단 전체 이동·삭제 · V-03 · 편집 파일 + ADR-0034](next/pr/oe-ml-07-09.md) | OE-ML-07·09 이슈(번호는 옮길 때) | ML-01 보기 다음 |
| bb94f4a | [OE-ML-07 층별 형상·진입/종료 지점 고치기 · 편집 파일 `parts`](next/pr/oe-ml-07-parts.md) | OE-ML-07 이슈(번호는 옮길 때) | ML-07·09 다음 |
| e15bc58 | [docs: ADR 대체 관계·목록·제목 바로잡기 + `adr.test.ts`](next/pr/docs-adr-check.md) | 없음 | ML-07 층별 고치기 다음 |
| d730c0d | [test: 수용 기준 태그(`[OE-ML-07#1]`) · `ac-tags.test.ts` · `npm run ac:coverage`](next/pr/test-ac-tags.md) | 없음 | ADR 점검 다음 |

## 지금 상태 (2026-10-09 09:40 확인)

### 10-08 에 merge 된 것

- 희록님 PR 18개(이슈 32개 닫힘): [#365](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/365) [#367](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/367) [#369](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/369) [#370](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/370) [#371](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/371) [#372](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/372) [#378](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/378) [#379](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/379) · [#384](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/384) [#385](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/385) [#386](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/386) [#388](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/388) [#389](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/389) [#390](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/390) · [#381](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/381) [#382](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/382) [#374](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/374) [#373](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/373).
  main + 18개를 합쳐 `npm test` 818 · e2e 164 · `check:sample` 97 통과(4 건너뜀)를 확인하고 merge 했다.
  `check:sample` 의 무작위 편집 시험이 잡은 [#381](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/381) 버그(합친 물리존의 BIM 소속이 다시 열면 풀림)를 고쳐 넣었다(a9eeeb9).
- 민주님 PRD PR: [#394](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/394) [#402](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/402) [#403](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/403) [#404](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/404) [#405](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/405) [#406](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/406) [#407](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/407), 보고 자료 [#400](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/400).

### 열린 PR

| PR | 상태 | 할 일 |
|---|---|---|
| [#375](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/375) 로봇 통과 속성 | 보류 | [#181](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/181) 의 EL 정차 층 질문에 PM 답 대기. 수용 기준의 ES·샤프트 `passable=false` 는 이름 사전에 방 종류가 없어 아직 안 됨 |
| [#393](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/393) 플랫폼 프로토타입 | 민주님 draft | 손대지 않는다. ADR `0015` 번호가 [#365](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/365) 의 `0015-ceiling-height-per-storey.md` 와 겹친다 — 민주님께 알릴 것 |
| [#396](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/396) [#397](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/397) [#398](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/398) | 민주님 PRD | 손대지 않는다. merge 되면 티켓 문구가 바뀌어 `modified`·후속 이슈가 생길 수 있다([#399](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/399) 는 10-09 에 merge, 아래) |
| [#410](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/410) 티켓 242개에 User story 보완 · [#412](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/412) 보드 동기화가 User story 줄 변경을 요구 변경으로 치지 않게 | 민주님 | 손대지 않는다. [#410](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/410) 이 merge 되면 티켓 md 242개가 바뀌므로 sec 로 옮길 PR 들과 `docs/prd` 충돌은 없지만(우리는 PRD 를 안 고친다) 보드의 `modified` 표시는 [#412](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/412) 가 먼저 들어가야 생기지 않는다 |

### 보드 정리 거리 (웹 UI 에서)

- In Review 칸의 [#343](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/343)~[#350](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/350) 여덟 개는 10-07 에 이미 닫혔다(구현 확인 코멘트). Status 만 남아 있다 — Status 는 웹 UI 에서만 고친다(`docs/dev/board.md`).
- [#230](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/230) OE-ROB-03 은 열린 PR [#375](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/375) 에 걸려 In Review 다.

### PM 답 대기 (`needs-pm`)

| 이슈 | 무엇 |
|---|---|
| [#181](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/181) [OE-EQP-17](docs/prd/features/E12-EQP/OE-EQP-17.md) | EL 정차 층 판단 기준(승강장 문 = 정차 층?) — [#375](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/375) 가 기다린다. [#394](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/394) 로 문구가 바뀌어 `modified` 도 붙었다 |
| [#165](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/165) [OE-EQP-01](docs/prd/features/E12-EQP/OE-EQP-01.md) | 설비 마스터에서 배치 — 미배치 팔레트([#371](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/371))로 되는 범위와 안 되는 범위를 여쭘 |
| [#173](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/173) [OE-EQP-09](docs/prd/features/E12-EQP/OE-EQP-09.md) | AHU·PAC — "이동 후 담당 공조존이 비면 Z-04 경고" 가 공조존 티켓에 걸림 |
| [#340](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/340) [OE-BIM-16](docs/prd/features/E05-BIM/OE-BIM-16.md) 후속 | 등급 설명표 요구사항 작성 중(민주님) |

### 10-09 PRD 변경이 바꾼 것 (sec main 622c80a, eco/main 에도 반영)

- **[#411](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/411) 연결 도구 용어가 "잇기·끊기" 에서 "연결하기·연결 끊기" 로 바뀌었다**(OE-PIP-01·06·08, UI-04, glossary). 화면에 옛 말이 둘 남았다 — 연결 누락 후보의 [잇기] 버튼(OE-PIP-08 은 "[연결 후보 확인 후 연결하기]"), 수동 배관의 [곧게 잇기](18183f8). 코드 주석의 "잇기" 는 그대로 둬도 된다.
- **[#399](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/399) Codex 검토가 E04 IDF-12~15·E12 EQP-14·15·BIM-18 문구를 고쳤다.** OE-EQP-15 에 "외벽 설비는 소속 판정 1단계에서 빠져, 허용 거리 안에 물리존이 있어도 붙지 않는다" 가 더해졌다 — 지금 동작과 맞는지 확인할 것. 이름 사전(glossary)이 별칭·적용 범위·확인 상태·버전을 관리하는 것으로 정의가 넓어졌다.

### 10-08 PRD 변경이 바꾼 것

- **IDF 기반 자동 구축은 R2 다([#404](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/404)).** [OE-IDF-01](docs/prd/features/E04-IDF/OE-IDF-01.md)~09·11~13 과 [OE-ZON-03](docs/prd/features/E10-ZON/OE-ZON-03.md)·[OE-ZON-07](docs/prd/features/E10-ZON/OE-ZON-07.md) 이 R2 로 갔다. 공조존은 R1 에서 공조존 도구로 수동으로 만든다.
- **다중층(E18, [OE-ML-01](docs/prd/features/E18-ML/OE-ML-01.md)~19)이 전부 `prd-done` 이다([#394](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/394)·[#406](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/406)).** 계단·ES 층별 형상, EL 정차 미확인, 층간 연결과 통과 여부 분리가 새 요구다.
- **스프링클러 헤드의 소화(FP) 배관 연결이 필수 검사가 됐다([#405](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/405)).** 후속 이슈 [#409](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/409).
- **벽 사이트 기본 두께가 "내벽 150 / 외벽 300mm" 로 정해졌다.** 후속 이슈 [#408](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/408). 지금([#380](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/380))은 사람이 넣는 칸이라 차이를 확인한다.
- [#407](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/407) 은 티켓 197개에 "관련 티켓" 절과 depends 를 더했다(릴리스·우선순위는 그대로).

## 할 일 — 순서

R1 Todo 는 34장, 후속 이슈 3장([#340](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/340) [#408](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/408) [#409](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/409)), R2 4장이다. [D10](docs/prd/questions.md)(2026-10-06, R1 편집 범위의 개발 주체)으로 R1 편집 범위(공조존 E9 · 배관 14-B · 다중층)는
희록님이 단독으로 개발하니 더 기다릴 것이 없다.

### 0. 작은 후속 — 먼저

1. ~~ADR 목록 줄~~ — 6655ba5
2. ~~#409 스프링클러 헤드의 소화 배관 연결 필수~~ — 0c463b3
3. ~~#408 벽 사이트 기본 두께~~ — 51bd6b5(외벽 300mm 는 `needs-pm`)
4. ~~룸·추가 공간 오브젝트 내보내기~~ — 665d97c(TTL·모델 파일은 `needs-pm`)
5. ~~`e2e:seongsu` 가 E 에서 멈춤~~ — ee01c80(12 통과)
6. **[#184](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/184) 계통 종류** — PM 답이 사실상 1번이다. PM 확인을 받고 닫는다. "Flow Type · 계통도 17종 · 흐름 방향" 세 필드 정의는 후속 이슈 후보다.

7. ~~[#258](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/258) OE-HIST-03 편집 파일 저장·불러오기(P1, 보드 Todo)~~ — 수용 기준 넷 모두 시험이 있다. [`next/comment/oe-hist-03.md`](next/comment/oe-hist-03.md) 를 코멘트로 달고 닫는다. 원래 메모: 코드는 거의 다 있다(편집 파일·GUID 재짝짓기 S1 시험·사람 지정 소속 ADR-0018). 닫는 PR 이 없어 Todo 로 남았다. 수용 기준 넷을 시험에 대 보고 빈 곳만 메워 닫는다(R2 IDF 재임포트는 제외).
8. ~~[#411](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/411) 용어 맞추기~~ — 3731493([잇기]→[연결하기]) · 수동 배관 [곧게 연결하기] 는 PIP-11 커밋에 넣음. 화면의 [잇기] → [연결하기], [곧게 잇기] → [곧게 연결하기] 류. 위 "10-09 PRD 변경" 참고.
9. ~~[#399](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/399) OE-EQP-15 외벽 설비 소속~~ — 533c433 (성수 루버 26대가 방에 붙던 것 → 0. 사람이 외벽에 붙인 다른 종류는 남음)
10. **[#54](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/54) OE-OBJ-13 · [#53](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/53) OE-OBJ-12** — 수용 기준이 공조존·배관 PR 들로 채워진다. 그 PR 들이 merge 되면 [`next/comment/oe-obj-13.md`](next/comment/oe-obj-13.md)·[`next/comment/oe-obj-12.md`](next/comment/oe-obj-12.md) 를 달고 닫는다. #53 은 Flow Type 색 값이 glossary 에 없어 `needs-pm` 을 같이 단다.

### 1. 배관 편집 (E13 · R1 P1) — 1단계 8ed03b8 (꼭짓점 = 이음쇠, 꺾임점 옮기기, ADR-0029). 2단계 77f59aa (구간 경로 LineString·미반영 목록, ADR-0030). 3단계 18183f8 (수동 배관 그리기, ADR-0031). 4단계 6b67ca6 (구간 삭제 영향). 5단계 8f04fd0 (끝 연결 대상 바꾸기). 열린 끝 검증은 이미 있음(conduit-ends 진단, 해제 보정 사유 포함). 다음: 꼭짓점 추가·삭제는 PM 과 의미부터

[OE-PIP-10](docs/prd/features/E13-PIP/OE-PIP-10.md) 형상 수정([#191](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/191)) → [OE-PIP-11](docs/prd/features/E13-PIP/OE-PIP-11.md) 수동 그리기([#192](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/192)) → [OE-PIP-12](docs/prd/features/E13-PIP/OE-PIP-12.md) 끝점 추종([#193](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/193)) → [OE-PIP-13](docs/prd/features/E13-PIP/OE-PIP-13.md) 좌표 조건([#194](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/194)).
그다음 [OE-OBJ-12](docs/prd/features/E02-OBJ/OE-OBJ-12.md) 배관 오브젝트([#53](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/53), P2) · [OE-EQP-08](docs/prd/features/E12-EQP/OE-EQP-08.md) 실내기([#172](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/172)) · [OE-PIP-14](docs/prd/features/E13-PIP/OE-PIP-14.md) BIM 배관 가져오기([#195](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/195), P2).

### 2. 수동 공조존 (E10·E11 · R1 P1) — 1단계 b61c2df (만들기·그리기·담당 설비·지우기). 2단계 93e0169 (검증 5규칙·담당 물리존 고치기·분할 따라가기). 3단계 9a2e745 (경계 다시 그리기, ADR-0027). 4단계 f7520a4 (흐름 기준 후보·연결 경고, ADR-0028). 5단계 3a5c554 (설비 패널의 담당 공조존). 다음: ZON-06·Z-03 용량(P2) — 막힌 것 둘: 가진 BIM 어디에도 물리존 설계 풍량(Pset_SpaceThermalDesign)이 없고(병원·Duplex·성수·Office 실측 0), 설비 용량의 CMH 환산(K9)이 없다(capacity 는 IFC 단위 그대로). 환산부터

[OE-ZON-01](docs/prd/features/E10-ZON/OE-ZON-01.md) 수동 생성([#151](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/151)) → [OE-ZON-02](docs/prd/features/E10-ZON/OE-ZON-02.md) 경계 그리기([#152](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/152)) → [OE-ZON-04](docs/prd/features/E10-ZON/OE-ZON-04.md) 편집 E9([#154](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/154)) → [OE-ZON-05](docs/prd/features/E10-ZON/OE-ZON-05.md) 검증 Z-01~06([#155](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/155)) · [OE-ZON-06](docs/prd/features/E10-ZON/OE-ZON-06.md) 용량 입력값([#156](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/156), P2).
같이 [OE-MAN-05](docs/prd/features/E07-MAN/OE-MAN-05.md) 공조존 수동([#121](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/121)) · [OE-OBJ-13](docs/prd/features/E02-OBJ/OE-OBJ-13.md) 공조존 오브젝트([#54](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/54), P2), 그 위에 매핑 [OE-MAP-02](docs/prd/features/E11-MAP/OE-MAP-02.md)([#159](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/159)) · [OE-MAP-03](docs/prd/features/E11-MAP/OE-MAP-03.md)([#160](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/160)) · [OE-MAP-04](docs/prd/features/E11-MAP/OE-MAP-04.md)([#161](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/161)) · [OE-MAP-05](docs/prd/features/E11-MAP/OE-MAP-05.md)([#162](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/162)) · [OE-MAP-06](docs/prd/features/E11-MAP/OE-MAP-06.md)([#163](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/163)).

### 3. 다중층·수직 관통 (R1) — EQP-07 1225b23 (EL·ES 잠금). **2026-10-09 사용자: 다중층 뷰는 지금 할 수 있는 것부터, 막힌 것은 후속으로**

PRD 는 충분히 자세하다(E18 티켓 19개 `prd-done`, 수용 기준 100여 개, 열린 질문 없음). 진행 순서(한 조각 = PR 하나):

1. ~~**ADR-0032 E18 을 이 repo 에서 어디까지 하나** + **ML-19 겹침 후보 규칙**~~ — a74525a(숫자 그대로: 병원 6/7 · 성수 26/32 · Office_A 4/5 · dental 6/7, 모호 0. 세션 확정 대체는 #237 `needs-pm`) — `src/lib/vertical.ts` 를 티켓대로 고친다: 이웃 층·같은 종류·유효 면적, 겹친 면적 ÷ 작은 면적 **> 50%**(정확히 50% 는 아님), **양쪽이 서로를 최고 후보로 고를 때만** 연결, 동률·다대일은 "모호 후보" 로 두고 출력하지 않음, GeoJSON 에 추정 출처(`verticalConnectsSource` 류), 병원 고정 기준선(대상 ID·기대 연결·출처, OE-EQP-16 "7개 중 6개 이상").
   - 실측(상호 일치 규칙을 얹어 본 값): 병원 건축 수직 공간 7 · 지금 연결 6 · 아래층 쪽 후보 짝 3 · 상호 일치 3 · 동률 0 → **6 그대로**. 성수 건축 32 · 26 · 24 · 24 · 0. Office_A 5 · 4 · 2 · 2 · 0. 즉 지금 샘플에서는 숫자가 안 바뀌고, 규칙·출처·모호 처리와 기준선이 새로 생긴다.
2. ~~**ML-02 수직 관통 오브젝트 데이터 모델**~~ — 4893c23 은 계단만(IfcStair → 층별 조각, 성수 35 중 32, 계단이 이은 짝이 겹침만의 짝을 모두 품음). **남은 2b: ES**(이름 사전 설비 + 형상 높이로 시작·끝 층), **2c: EL**(정차 층 #181 대기 — 형상만). **2b 는 성수 PC 에서** — 에스컬레이터는 성수 원본(`data/성수`)에만 있다(6대, `Escalator_(AUS)`). 집 PC 의 병원·Duplex·FZK·합성 성수에는 0 이라 시작·끝 층 규칙을 잴 수 없다. 원래 메모: — 부모 ID·종류·출처·관통 층·층별 형상·진입/종료 지점·연관 물리존 ID. 계단은 IfcStair 로 읽는다(샘플 7개 파일 모두 있음: Duplex 2 · 병원 3 · 성수 35 · Office_A 2 · FZK 1 · Institute 4 · dental 3). EL·ES 는 IfcTransportElement 가 샘플에 0 이라 이름 사전 설비에서 만든다. 물리존(계단실·승강로)은 그대로 두고 ID 로 잇는다.
3. ~~**ML-05 층 편집 화면 읽기 전용**~~ — ce487d2(계단: 3D·평면도에 형상·진입/종료 지점, 고르면 읽기 전용 패널, Delete·방향키 막음, 다시 누르면 아래 계단실). 배관 분기 예외는 PIP-15 와 같이.
4. ~~**다중층 뷰 화면(ML-01 의 보기 부분)**~~ — a33f97f(범위 시작~끝·전체, ①②, 오브젝트 전체 칠하기, 진입→종료 점선. 편집이 없어 보기만 — 3D 끌기·편집 키·도구 상자를 끈다). ③ 은 PIP-15 와 같이. ML-19 모호 후보 표시는 아직.
5. **ML-06~09 생성·이동·구간 변경·삭제** — f6a7dde 는 전체 이동(ML-07 앞 절반)·삭제(ML-09), V-03 은 연 때 형상과 견줌(ADR-0034). ML-07 후반(층별 형상·지점)은 bb94f4a(편집 파일 `parts`). **다음: ML-08 구간 바꾸기 → ML-06 만들기**(만들기는 층마다 형상을 그려야 해서 마지막). ML-12~14 라이저·층별 분기·층간 오프셋, ML-18 좌표 조건은 그 뒤.

**후속(지금 막힘)**: ML-01 의 세션·확정(진입 전 층 편집 확정·작업 ID — OE-WF-03 이 `prd-review`, PoC 에 서버 확정 없음. ADR-0032 에서 로컬 편집 이력으로 대신하는 안을 적고 `needs-pm`) · ML-15 색(glossary 에 색 값 없음, #53 과 같은 질문) · ML-10 EL 정차 층([#181](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/181) PM 답 대기) · ML-03 개구부 면적(슬래브 형상 데이터부터 확인) · R2 잠금(OE-COM-05).

[OE-OBJ-14](docs/prd/features/E02-OBJ/OE-OBJ-14.md) 수직 관통 오브젝트([#55](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/55)) · [OE-EQP-07](docs/prd/features/E12-EQP/OE-EQP-07.md) EL·ES 위임([#171](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/171)) · [OE-PIP-15](docs/prd/features/E13-PIP/OE-PIP-15.md) 층간 배관([#196](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/196)). E18 요구가 10-08 에 크게 바뀌었으니 티켓부터 다시 읽는다.

### 4. 공간·화면 나머지 (R1)

[OE-MAN-03](docs/prd/features/E07-MAN/OE-MAN-03.md) 외곽선 없는 방 그리기([#119](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/119)) · [OE-WF-06](docs/prd/features/E14-WF/OE-WF-06.md) 임포트 결과 = 임시 저장본([#205](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/205)) · [OE-SPC-05](docs/prd/features/E09-SPC/OE-SPC-05.md) 공간명 연동([#138](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/138), 뷰어마스터 쪽 [OE-SYNC-03](docs/prd/features/E15-SYNC/OE-SYNC-03.md)) ·
[OE-SPC-17](docs/prd/features/E09-SPC/OE-SPC-17.md) 방 종류 사전·일괄 수정([#150](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/150), P2) · [OE-MAN-02](docs/prd/features/E07-MAN/OE-MAN-02.md) 평면도 배경 이미지([#118](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/118), P2).

### 5. 외벽·로봇 (R1 P2)

[OE-EXT-03](docs/prd/features/E17-EXT/OE-EXT-03.md) 외벽 에디터([#234](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/234) — [#374](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/374) 이후 외벽 형상은 외벽 여부를 풀어야만 고친다) · [OE-EXT-05](docs/prd/features/E17-EXT/OE-EXT-05.md) Proxy 루버 오인 방지([#236](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/236)) · [OE-ROB-04](docs/prd/features/E16-ROB/OE-ROB-04.md) 데이터 선행 제공([#231](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/231)).

### R2 (지금 안 한다)

[OE-IDF-01](docs/prd/features/E04-IDF/OE-IDF-01.md)~15 · [OE-ZON-03](docs/prd/features/E10-ZON/OE-ZON-03.md) · [OE-ZON-07](docs/prd/features/E10-ZON/OE-ZON-07.md) · [OE-MAN-01](docs/prd/features/E07-MAN/OE-MAN-01.md)([#117](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/117)) · [OE-PIP-16](docs/prd/features/E13-PIP/OE-PIP-16.md)([#197](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/197)) · [OE-PIP-17](docs/prd/features/E13-PIP/OE-PIP-17.md)([#198](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/198)) · [OE-ROB-01](docs/prd/features/E16-ROB/OE-ROB-01.md)([#228](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/228)) · [OE-ROB-02](docs/prd/features/E16-ROB/OE-ROB-02.md)([#229](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/229), [Q3](docs/prd/questions.md) 로봇 팀 대기).

## 다른 PC 에서 시작

```bash
git fetch eco && git switch -C next-10-09 eco/next-10-09
```

sec 에 닿지 않는 PC 에서는 코드만 이어 하고 이 브랜치에 커밋·push 한다. PR·merge·이슈 코멘트는 sec 에 닿는 PC 에서 한다.
