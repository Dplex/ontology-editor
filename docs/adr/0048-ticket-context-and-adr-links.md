---
id: "ADR-0048"
title: "티켓에서 ADR·시험·코드·번호 정의로 가는 길은 티켓 md 에 적지 않고 ADR 머리와 시험 태그에서 거꾸로 뽑아 ctx 한 번으로 보이며, 수용 기준은 AC 번호를 쓸 수 있게 한다"
status: "제안"
date: "2026-10-10"
deciders: ["정희록"]
prd: []
tickets: []
criteria: []
code: ["scripts/docs-index.mjs", "scripts/docs-ctx.mjs", "scripts/docs-mcp.mjs", "scripts/ac-coverage.ts", "scripts/prd-ac-label.mjs", "scripts/sync-board.mjs"]
tests: ["scripts/docs-mcp.test.ts", "src/lib/adr.test.ts", "src/lib/ac-tags.test.ts"]
related: ["ADR-0001"]
---

# ADR-0048 티켓 맥락 한 번에 보기 · ADR 머리 칸 · AC 번호

## 맥락

개발은 이슈 링크 → 티켓 md 에서 시작하는데, 티켓에서 필요한 다른 글로 가는 길이 한쪽으로만 나 있다.

- **티켓 → ADR 이 없다.** ADR 머리의 `tickets` 만 티켓을 가리킨다. 티켓 md 는 PM 몫이라(CLAUDE.md) 개발이 "관련 ADR" 을 적을 수 없다.
  티켓 250개 중 117개를 ADR 이 하나 이상 가리키는데, 티켓만 읽어서는 그걸 모른다.
- **R·K·D 번호의 정의를 찾는 비용이 크다.** 2026-10-10 에 이 repo 의 지난 Claude 세션 83개를 쟀다. 가장 많이 연 문서가
  `docs/bim-to-dt-ontology.md`(113KB)다 — grep 113번, `sed -n` 63번, 통째로 17번. 티켓 depends 의 `R11` 이 4.1절 표의 한 줄인데
  그 줄을 찾으려고 문서를 뒤졌다. 챗봇 MCP 의 `docs_read("R11")` 은 `null` 이었다(문서가 아니라 표의 줄이라서).
  `docs/adr/README.md`(16KB) 도 통째로 12번 읽었다.
- **시험은 `[OE-ML-09#4]` 태그로 기준을 가리키는데(498개), 기준 번호가 글머리표 순서다.** PM 이 기준 하나를 지우거나 사이에 끼우면
  뒤 기준 번호가 밀리고, 태그·ADR 본문의 `#4` 가 다른 기준을 가리킨다. `ac-tags.test.ts` 는 번호가 기준 수를 넘을 때만 잡는다.

## 결정

- **ctx — ID 하나로 맥락을 한 번에.** `docs-index.mjs` 에 `define`·`context` 를 두고, 터미널은 `npm run ctx -- <ID>`, 챗봇은
  `docs_ticket` 이 같은 것을 준다.
  - 티켓: 요구사항 · 수용 기준마다 그 기준을 재는 시험(태그) · depends·blocked_by 의 제목/상태(티켓) 또는 정의 줄(R·K·D…) ·
    `tickets`·`criteria` 에 이 티켓을 적은 ADR · 이 ID 를 적은 코드 파일과 횟수 · 이 티켓을 depends 로 가리키는 티켓.
  - ADR: 본문 · 티켓 제목 · `code`·`tests` · 관련 ADR. 번호(R11·K3·D10·F9·E1): 첫 칸이 그 번호인 표의 줄 + 표 머리 + 그 번호를
    머리 필드에 적은 티켓·ADR. 정의는 questions.md → PRD_011 → 개발 정본 → glossary 순으로 찾는다.
  - `docs_read` 도 문서가 없으면 정의 줄로 답한다.
- **티켓 → ADR·코드·시험 링크는 PRD 에 적지 않고 거꾸로 뽑는다.** 정본은 ADR 머리(`tickets`·`criteria`)와 시험 제목의 태그다.
- **ADR 머리에 `criteria`·`code`·`tests`·`related` 를 더한다.** 47개는 본문에 적힌 파일·`OE-…#n`·`ADR-nnnn` 에서 뽑아 채웠다.
  `adr.test.ts` 가 없는 파일, `tickets` 에 없는 티켓의 기준, 없는 기준 번호, 대체 관계와 겹치는 `related` 를 잡는다.
- **수용 기준 앞에 `AC3` 을 적으면 그 번호로 센다**(`- **AC3** …`). 적지 않은 티켓은 지금처럼 순서다. 한 티켓 안에서 섞으면
  `ac-tags.test.ts` 가 막는다. PM 이 쓸지는 [제안서](../dev/prd-format-proposal.md)로 묻는다 — 파서만 먼저 받는다.
  지금 순서대로 붙이는 `scripts/prd-ac-label.mjs` 를 PM 몫으로 둔다(개발은 `--write` 를 돌리지 않는다). 250개 티켓 전부에서 붙인 뒤의
  기준 번호·문장이 지금과 같다는 것을 `ac-tags.test.ts` 가 본다. `sync-board.mjs` 는 AC 번호만 붙은 수용 기준을 요구사항 변경으로 치지
  않는다(`modified` 를 붙이지 않고 수정 이력에 "AC 번호 붙임" 한 줄).

## 고려한 다른 길

- **티켓 md 에 "관련 ADR" 절.** 개발이 PRD 를 고치지 않는 규칙에 걸리고, ADR 머리와 두 벌이 되어 어긋난다.
- **sync-board 가 이슈 본문에 ADR·시험 블록을 붙이기.** 이슈가 개발의 첫 화면이라 효과는 크다. 하지만 블록이 바뀔 때마다 이슈 본문의
  수정 이력이 늘고, 반영이 회사 PC 의 수동 `--apply` 뿐이라 늦다. ctx 가 쓰이는지 본 뒤에 다시 본다.
- **`bim-to-dt-ontology.md` 를 장마다 파일로 쪼개기.** 정의 줄 하나에 드는 글은 ctx 가 이미 1KB 로 줄인다. 쪼개면 문서 사이 링크·
  pm-brief 의 절 번호가 다 바뀐다.
- **임베딩 검색.** ADR-0001 대로 55 는 npm 에 닿지 않는다. 필요한 것은 비슷한 글이 아니라 번호가 가리키는 정확한 줄이다.

## 결과

- `npm run ctx -- R11` 1.3KB(표 머리 + 4.1절의 R11 줄 + 쓰는 티켓 4개), `OE-ML-09` 6.0KB(기준 5개마다 시험, ADR-0034·0047, 코드 8개),
  `OE-BIM-12` 2.5KB(K5·R11·Q8 의 정의 줄). 티켓 250개의 depends·blocked_by 162개 번호가 모두 정의 줄로 풀린다.
- 챗봇(`docs_ticket`)이 코드 파일 이름·시험 제목·줄 번호를 내보낸다. 코드 본문은 내지 않는다 — `docs-chat.policy.toml` 은 그대로다.
- ADR 의 `code` 는 "이 결정을 바꾸려면 열어 볼 파일" 이라 본문에서 이름만 든 파일도 들어 있다(예: ADR-0004 의 `vertical.ts`).
  더 줄이는 것은 사람이 ADR 을 다시 볼 때 한다.
- 되돌리려면: `docs-index.mjs` 의 "정의·맥락" 절과 `docs-ctx.mjs`, `docs-mcp.mjs` 의 `docs_ticket`·`docs_read` 를 앞 판으로,
  ADR 머리의 네 칸과 `adr.test.ts` 의 5번 묶음, `parseCriteria` 의 `AC_LABEL`, `sync-board.mjs` 의 `noAc` 를 걷어낸다.
