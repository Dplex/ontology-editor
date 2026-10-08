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

## 지금 상태 (2026-10-08 22:40)

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
| [#396](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/396) [#397](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/397) [#398](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/398) [#399](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/399) | 민주님 PRD | 손대지 않는다. merge 되면 티켓 문구가 바뀌어 `modified`·후속 이슈가 생길 수 있다 |

### PM 답 대기 (`needs-pm`)

| 이슈 | 무엇 |
|---|---|
| [#181](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/181) [OE-EQP-17](docs/prd/features/E12-EQP/OE-EQP-17.md) | EL 정차 층 판단 기준(승강장 문 = 정차 층?) — [#375](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/375) 가 기다린다. [#394](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/394) 로 문구가 바뀌어 `modified` 도 붙었다 |
| [#165](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/165) [OE-EQP-01](docs/prd/features/E12-EQP/OE-EQP-01.md) | 설비 마스터에서 배치 — 미배치 팔레트([#371](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/371))로 되는 범위와 안 되는 범위를 여쭘 |
| [#173](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/173) [OE-EQP-09](docs/prd/features/E12-EQP/OE-EQP-09.md) | AHU·PAC — "이동 후 담당 공조존이 비면 Z-04 경고" 가 공조존 티켓에 걸림 |
| [#340](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/340) [OE-BIM-16](docs/prd/features/E05-BIM/OE-BIM-16.md) 후속 | 등급 설명표 요구사항 작성 중(민주님) |

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

### 1. 배관 편집 (E13 · R1 P1)

[OE-PIP-10](docs/prd/features/E13-PIP/OE-PIP-10.md) 형상 수정([#191](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/191)) → [OE-PIP-11](docs/prd/features/E13-PIP/OE-PIP-11.md) 수동 그리기([#192](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/192)) → [OE-PIP-12](docs/prd/features/E13-PIP/OE-PIP-12.md) 끝점 추종([#193](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/193)) → [OE-PIP-13](docs/prd/features/E13-PIP/OE-PIP-13.md) 좌표 조건([#194](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/194)).
그다음 [OE-OBJ-12](docs/prd/features/E02-OBJ/OE-OBJ-12.md) 배관 오브젝트([#53](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/53), P2) · [OE-EQP-08](docs/prd/features/E12-EQP/OE-EQP-08.md) 실내기([#172](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/172)) · [OE-PIP-14](docs/prd/features/E13-PIP/OE-PIP-14.md) BIM 배관 가져오기([#195](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/195), P2).

### 2. 수동 공조존 (E10·E11 · R1 P1)

[OE-ZON-01](docs/prd/features/E10-ZON/OE-ZON-01.md) 수동 생성([#151](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/151)) → [OE-ZON-02](docs/prd/features/E10-ZON/OE-ZON-02.md) 경계 그리기([#152](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/152)) → [OE-ZON-04](docs/prd/features/E10-ZON/OE-ZON-04.md) 편집 E9([#154](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/154)) → [OE-ZON-05](docs/prd/features/E10-ZON/OE-ZON-05.md) 검증 Z-01~06([#155](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/155)) · [OE-ZON-06](docs/prd/features/E10-ZON/OE-ZON-06.md) 용량 입력값([#156](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/156), P2).
같이 [OE-MAN-05](docs/prd/features/E07-MAN/OE-MAN-05.md) 공조존 수동([#121](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/121)) · [OE-OBJ-13](docs/prd/features/E02-OBJ/OE-OBJ-13.md) 공조존 오브젝트([#54](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/54), P2), 그 위에 매핑 [OE-MAP-02](docs/prd/features/E11-MAP/OE-MAP-02.md)([#159](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/159)) · [OE-MAP-03](docs/prd/features/E11-MAP/OE-MAP-03.md)([#160](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/160)) · [OE-MAP-04](docs/prd/features/E11-MAP/OE-MAP-04.md)([#161](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/161)) · [OE-MAP-05](docs/prd/features/E11-MAP/OE-MAP-05.md)([#162](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/162)) · [OE-MAP-06](docs/prd/features/E11-MAP/OE-MAP-06.md)([#163](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/163)).

### 3. 다중층·수직 관통 (R1)

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
