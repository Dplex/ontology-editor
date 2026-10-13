---
id: "ADR-0058"
title: "API 만 부르는 Activity·Kanban 워크플로는 사내 공용 러너 code-linux 에서 돌리고, 55 러너에는 55 를 만지는 Review 만 남긴다"
status: "채택"
date: "2026-10-13"
deciders: ["정희록"]
prd: []
tickets: []
criteria: []
code: [".github/workflows/activity.yml", ".github/workflows/kanban.yml", ".github/workflows/review.yml"]
tests: []
related: []
---

# ADR-0058 API 만 부르는 Activity·Kanban 워크플로는 사내 공용 러너 code-linux 에서 돌리고, 55 러너에는 55 를 만지는 Review 만 남긴다

## 맥락
이 repo 의 워크플로 다섯 개가 55 의 러너 하나(`dt-dev`, v2.324.0)에서 줄을 섰다. 2026-10-13 에 #537 의 Kanban·Review 가 02:56 UTC
에 줄을 서서 1시간 반 넘게 queued 였다.

- 55 서버는 CPU 98% 유휴였다. 서버 부하가 아니다.
- 잡 하나는 3~8초면 끝나는데, 러너가 잡을 마칠 때마다 메시지 long poll 이 끊긴 것을 오류로 보고 15~30초 쉰 뒤 다음 잡을 받는다
  (`_diag/Runner_*.log` 의 "Sleeping for 22.186 seconds before retrying", 그 로그 한 파일에 2,007번). 오늘 잡 354개가 평균 42초,
  시간당 80~90개가 한계였다.
- 그날 생긴 run 100개 중 94개가 이슈 라벨·댓글·본문 수정으로 깨어난 Activity 다. 보드 동기화처럼 이슈를 한꺼번에 건드리면 PR 의
  Review 가 그 뒤에 선다.
- GHE Server 에는 github.com 의 GitHub-hosted 러너가 없다. org 에 `code-linux` 라벨의 공용 self-hosted 러너가 기본으로 열려 있다.
  시험 워크플로로 잡 5개를 한 번에 던지니 5~7초 만에 서로 다른 머신 5대(`code-runner-108-*`, 4코어, root)에서 동시에 시작해
  9초씩 걸렸고, `actions/github-script@v7` 로 GHE API 를 불렀다.

## 결정
Activity·Kanban 은 `actions/github-script` 로 GHE API 만 부르고 55 의 파일·서비스를 만지지 않으니 `runs-on: code-linux` 로 돌린다.
Review 는 55 의 검토 트리를 받아 8087 을 다시 띄우므로 `dt-dev` 에 남긴다. 그러면 55 러너에는 Review(와 55 에서 도는 board-check·prd-check)만
줄을 서고, 이슈 활동이 몰려도 PR 검토가 밀리지 않는다.

## 고려한 다른 길
- 55 러너를 새 버전으로 올린다 — GHE 3.18.14 가 주는 러너가 2.324.0 이라 더 올리면 GHE 와 맞는지 보장이 없고, 새 버전에서 이 15~30초
  쉼이 고쳐졌는지 근거를 못 찾았다.
- 55 에 `dt-dev` 러너를 하나 더 붙인다 — 처리량은 두 배지만 Review 두 개가 8087 검토 트리를 같이 만질 수 있고, 등록 토큰이 org 관리자에게 있다.
- Activity 를 schedule 로 몰아서 적는다 — 잡 수는 줄지만 "🔔 최근 변화" 가 늦게 바뀌고, 2분 안의 변화를 잇는 규칙을 다시 짜야 한다.

## 결과
- `PROJECT_TOKEN`(Projects·repo 쓰기 토큰)이 공용 러너 머신에서 쓰인다. 잡은 root 로 돌고, 잡이 끝난 뒤 머신을 지우는지는 확인하지 않았다.
  토큰 권한이 그보다 넓어지면 다시 본다.
- 공용 러너가 붐비면 Activity·Kanban 이 그쪽에서 기다린다. 2026-10-13 시험에서는 5~7초였다.
- 되돌리려면 `activity.yml`·`kanban.yml` 의 `runs-on` 을 `[self-hosted, dt-dev]` 로 바꾸고 `docs/dev/board.md` 의 러너 이름을 고친다.
