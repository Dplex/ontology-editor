# 다음 할 일 (2026-10-12 저녁, 다른 PC 로 넘기며)

쌓아 둔 PR 스택(#431~#510)은 다 main 에 들어갔다. 맨 위는 `13d3509 Merge pull request #510`. 여기서는 남은 결정과 일을 적는다.
일을 마치면 이 파일에서 그 줄을 지운다.

## 지금 상태

- #452~#510: 전부 main 에 있다. GHE 화면도 #456 하나만 빼고 Merged 다.
- #456(OE-ML-07·09 통째 이동·지우기): **Closed 로 남았다.** 코드는 main 에 있다(merge 커밋 `8a0a57f`).
  GHE 동기화가 밀린 동안 닫았다 다시 열려 했는데, "These commits are already merged" 로 다시 열기를 받지 않았다. PR 에 까닭을 코멘트로 달았다.
- 넣으면서 고친 것
  - #471 등급 판정을 PM 이 10-10 에 바꾼 D1 제안안(D안: 게이트 누적 등급 0~3·계통 60%, 목표선 등급 4)에 맞췄다. 분모 0 인 등급은 "평가 불가" 로 보이고 구축은 막지 않는다(사용자 결정). ADR-0040.
  - #487 이 DVM 실내기 8대를 완전성 검사에서 빼서 성수 기준선을 옮겼다: 연결망 2935/3384, 원천→말단 156/260(`92704e6`).
  - #504 ADR 정리 때 공조존 꼭짓점 손잡이(#434)를 ADR-0026 에, D안을 ADR-0040 에 넣었다. ADR-0027 은 없어졌다.
  - #507 `scripts/onto-bench.mjs` 첫 줄 `#!` 를 뺐다. Windows(CRLF 로 꺼냄)에서 vitest 가 그 줄을 못 걸러 SyntaxError 가 났다.

## 정할 것 (희록님)

1. **#114 OE-REQ-04 닫기** — #471·#482·#483 이 `Refs` 라 열려 있다. PM 이 10-12 에 수용 기준을 지워 기준이 비었고, 요구사항(게이트 0~3 은 BIM+계산만, 목표 4 는 확정 방향만)대로 만들었다.
   - 1) 지금 닫는다(추천). D1 이 다르게 정해지면 `modified` → 후속 이슈로 돌아오고, `src/lib/grade.ts` 의 `DEFAULT_LINES` 만 바꾼다
   - 2) D1·D12 확정 뒤 닫는다

## 할 일

1. **#190 OE-PIP-09 — BIM 계통 이름을 읽기 전용으로 되돌린다.** 수용 기준 1번("BIM 원본 계통 이름은 읽기 전용, 수동 계통만 편집")을 어겼다. 지금은 BIM 계통 이름도 고칠 수 있고 원래 이름을 "BIM 이름 …" 으로 남긴다(`e2e/edit-system.spec.ts:119`).
   작은 PR 로 고치고, #190 의 `needs-pm` 을 뗀다(편하다는 것 말고는 바꿀 까닭이 없어 PM 질문이 아니다).
2. **수용 기준을 다 재는 티켓 닫기.** #485~#494 등은 `Refs` 라 이슈가 열려 있다. `npm run ac:coverage` 를 돌려 기준이 모두 "다 잼" 인 티켓만 골라, 재는 시험을 코멘트로 달고 닫는다(카드 Done).
   나머지는 남은 것을 코멘트로 단다. 단 `prd-review` 인 BIM·REQ·INT 티켓(#494)은 닫기 전에 목록을 희록님께 보인다.
3. **흔들리는 e2e** — `e2e/shortcuts.spec.ts:69`(방향키 10cm)는 main 에서 worker 1 로 돌려도 3번 중 2번 실패한다(`moved` 가 0). 원인을 찾는다.
4. **PM 확인 거리**(물을 때 `docs/dev/writing-style.md` 대로 예시 장면 · 짧은 선택지)
   - #489 OE-MAP-01#9 동점 규칙: 넣으면 Duplex MEP 일치 122 → 121, 미소속 270 → 278 로 나빠져 넣지 않았다. 향을 읽을 데이터가 없으면 소속 없음으로 할지
   - #106 / #483 층 이름: PRD 1.8 은 BIM 재제출 거리인데 에디터에서 넣게 했다
   - OE-ML-01#3 "별도 라이저 도구 버튼 없음" vs OE-UI-04#7 [라이저]: 설비 모드의 [라이저] 는 다중층 뷰를 여는 진입 버튼으로 읽었다(#492·#493)
   - #181 EL 정차 층, #53 Flow Type 색: 값이 없어 막힌 것
   - #501 PRD 형식 제안(`docs/dev/prd-format-proposal.md`), #502 PRD 1.7 과 다른 곳(`docs/ontology.md`) — 2026-10-13 Unity 확인 뒤
5. 그 밖
   - #118 PDF 배경 받기(새 PR). DWG 는 서버가 필요해 `blocked`
   - #451 병원 check:sample 은 병원 BIM 이 있는 55 에서 돌린다
   - 닫힌 이슈의 `needs-pm` 떼기: #190(위 1 뒤)·#158·#123·#102·#43
   - GHE 관리자에게 push → PR 동기화 지연 알리기(증거: 확인용 PR #521 — 만들 때 head `ff8c7b4` 는 잡았으나 뒤 push `b8ab7e5` 가 안 붙음, #456 이 50분 넘게 옛 head)

## 이 PC 에서 알게 된 것 (다른 PC 에서도 같으면)

- **GHE 동기화 지연**: 이미 있는 PR 에 push 해도 PR 이 옛 head 를 들고 13~50분 Open·충돌로 보일 때가 있다. 브랜치 API(`gh api repos/IoT-Solution/bim-to-dt-ontology/branches/<브랜치>`)는 새 sha 를 안다.
  그동안은 `git merge --no-ff` 로 main 에 넣고 기다리면 Merged 로 바뀐다. **PR 을 닫았다 다시 열지 않는다**(#456 처럼 Closed 로 남는다). `Closes` 가 있으면 이슈 닫기·카드 Done 은 손으로 한다.
- **쌓인 PR**: 아래 PR 을 merge 하기 전에 위 PR 의 대상을 main 으로 바꾼다(대상 브랜치를 지우면 GHE 가 위 PR 을 닫는다).
- **edit.ts CRLF**: 몇 브랜치가 `src/lib/edit.ts` 를 CRLF 로 커밋해 파일 전체가 바뀐 것으로 보였다. 합치기 전에 LF 로 되돌리면 충돌이 실제 줄만 남는다.
- **check:sample**: 규칙·임포터(`src/lib/mapping|checks|flow-rules|exterior|topology|grade|kinds`, `src/lib/ifc/`)를 고친 PR 은 넣기 **전에** 돈다. 다른 PC 에서 만든 PR 은 성수 없이 잰 것이 많다(#487).
  그 PC 에 샘플(FZK·ifc4Mep·Duplex COBie/HVAC·병원)이 없으면 "가진 BIM 이 2개 이상" 을 보는 시험 7개가 늘 실패한다. 새로 실패하는 것만 본다.
- **e2e 부하**: 전체를 기본 병렬로 돌리면 30초 시간 초과가 난다. 관련 파일만 `--workers=2` 로, 리플레이는 `npm run e2e:serial`.
- **worktree 의 data**: worktree 에서 e2e·check:sample 을 돌리려면 main 의 `data/` 로 junction 을 건다. 지울 때 `rmdir`(링크만) — `Remove-Item -Recurse` 나 `git worktree remove --force` 는 링크 너머를 지운다.
