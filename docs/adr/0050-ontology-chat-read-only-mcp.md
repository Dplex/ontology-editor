---
id: "ADR-0050"
title: "온톨로지 질의는 반영한 TTL 을 읽기만 하는 MCP 로 55 의 gemini 에 붙이고, 답마다 쓴 질의를 보이며, 같은 질의를 받는 쪽 DT 파서가 읽는 만큼에도 돌려 질문 시험대로 잰다"
status: "제안"
date: "2026-10-11"
deciders: ["정희록"]
prd: []
tickets: ["OE-SPC-10"]
criteria: []
code: ["scripts/onto-graph.mjs", "scripts/onto-mcp.mjs", "scripts/onto-sources.mjs", "scripts/onto-questions.mjs", "scripts/onto-bench.mjs", "scripts/docs-chat.mjs", "scripts/docs-chat.js", "scripts/serve.mjs"]
tests: ["scripts/onto-graph.test.ts", "scripts/onto-chat.test.ts"]
related: ["ADR-0001", "ADR-0037", "ADR-0049"]
---

# ADR-0050 온톨로지 질의 챗봇과 질문 시험대

## 맥락

PRD 의 사용자 유형에 "AI Agent 사용자 — 변경된 레이아웃 버전과 커스텀존을 바탕으로 공간·설비를 질의한다" 가 있고, OE-SPC-10(커스텀존
Agent 질의, R1)이 있다. 우리가 내는 온톨로지로 그 질문에 답이 나오는지를 지금은 피처 단위 %(개발 정본 F1~F16 표)로만 잰다.
DT 화면이 실제로 묻는 것은 질문이다 — "AHU-1 은 어디 있어"(이상 알림), "이 공조기가 담당하는 방"(계통도), "A101호는 어느 층"(운영자 호칭).

벤치마킹한 Nomic(AEC 용 AI)은 IFC 를 표로 뽑아 두고 에이전트가 SQL 을 짜서 답하며, 답마다 그 SQL 을 보여 사람이 검증하게 한다.
우리에게는 받는 쪽이 하나 더 있다. ADR-0049 의 측정대로 받는 쪽 DT 파서는 우리 TTL 의 26~29% 만 읽는다. 우리 TTL 에 답이 있어도
DT 에서는 사라지는 질문이 있는지가 "BIM 으로 DT 온톨로지가 어디까지 되나" 의 마지막 칸이다.

제약은 ADR-0001 과 같다. 55 에는 gemini CLI(사내 계정)만 있고 npm 레지스트리에 닿지 않으며 node 는 TS 를 바로 못 돌린다.
8084 는 사내망 누구나 연다.

## 결정

- **55 의 문서 챗봇과 같은 방식으로 붙인다.** 같은 창(Alt+Shift+K)에 [온톨로지] 칸을 두고 `POST /__ask` 로 묻는다. 서버는
  `scripts/docs-chat.mjs` 의 `createChat` 을 이름(`onto`)·MCP·정책·시스템 프롬프트만 바꿔 하나 더 띄운다. 문서 챗봇(/__chat)과
  그 정책 파일은 그대로다.
- **gemini 가 쓸 수 있는 도구는 반영한 온톨로지를 읽기만 하는 MCP 서버(`scripts/onto-mcp.mjs`) 하나다.** 정책
  `scripts/onto-chat.policy.toml` 은 전역 deny + `onto` 만 허용으로, 문서 챗봇 정책과 같은 모양이다. 고치는 도구는 없다.
- **읽는 것은 반영본이다.** `data/.layouts/<열쇠>/current.json` 이 가리키는 버전의 `ontology.ttl`(ADR-0037) — "DT 에 반영된 것" 이다.
  창은 건물을 고르고, 서버가 목록에 있는 이름만 질문 앞에 붙인다. 앱 상태(열어 둔 BIM, 편집 중인 것)는 여전히 보내지 않는다.
- **도구는 그래프를 묻는 다섯 가지다**: 한눈에(`onto_overview`), 이름으로 찾기(`onto_find`), 한 대상의 관계(`onto_describe`),
  술어를 따라 걷기(`onto_walk`), triple 패턴 질의(`onto_query`, SPARQL 의 기본 그래프 패턴). 답에는 쓴 질의를 그대로 붙이게 한다
  (`scripts/onto-chat.md`) — Nomic 의 "SQL 을 보여 준다" 를 패턴으로 한다.
- **같은 질의를 두 보기에 돌린다.** full 은 우리 TTL 전부, receiver 는 받는 쪽 파서가 읽는 만큼(`read-ttl.ts` 의 규칙을
  `onto-graph.mjs` 에 옮겨 적고, 시험이 두 결과가 같은지 본다). `onto_query` 는 receiver 의 결과 수를 같이 돌려주고, 다르면
  "DT 쪽 파서는 이 정보를 읽지 않는다" 고 답하게 한다.
- **질문 시험대(`npm run onto:bench`)로 잰다.** DT 화면별 질문 12개(`onto-questions.mjs`)를 건물마다 구체적인 대상으로 바꿔
  정해진 패턴으로 답을 내고 full·receiver 를 견준다. `--ask` 면 같은 질문을 gemini 에 말로 물어 답에 기대한 이름·수가 들었는지 채점한다.

## 고려한 다른 길

- **SPARQL 엔진(Comunica·Oxigraph)을 붙인다** — 55 에서 npm 으로 받을 수 없고, 우리 TTL 은 writer 가 정해진 모양이라 의존성 없는
  읽기로 충분하다. 패턴 질의는 조인·필터·세기까지다. OPTIONAL·경로식이 필요해지면 그때 다시 본다.
- **편집 화면(src)에 패널을 넣고 열어 둔 모델에 묻는다** — 편집 중인 상태는 DT 에 반영된 것이 아니다. AI Agent 사용자가 묻는
  대상은 반영본이고, ADR-0001 과 같은 이유로 앱이 서버를 아는 길을 만들지 않는다.
- **TTL 원문을 통째로 프롬프트에 넣는다** — 성수 TTL 이 5.5MB 다. 넣을 수 있어도 세기·조인을 모델이 눈으로 하게 되어 틀린다.
- **문서 챗봇의 MCP 서버(docs)에 도구를 더한다** — 정책을 넓히지 않고 되지만, 문서와 온톨로지는 묻는 사람도 답하는 법도 다르다.
  프롬프트를 섞으면 둘 다 나빠진다.

## 결과

- 정문을 거치지 않는 API 가 하나 더 생긴다(`/__ask`). 지키는 것은 "반영본 읽기만" 이라는 도구 제한이고, 비용은 55 계정의 gemini
  사용량이다. 동시 실행 수·질문 길이·시간 제한은 문서 챗봇과 같은 값을 쓴다.
- 2026-10-11 샘플로 잰 시험대(정해진 패턴, gemini 없이): 질문할 대상이 있는 질문 중 받는 쪽도 답하는 것 — mep 8/10, Duplex 5/8,
  병원 8/11, 합성 성수 8/11. **면적(Q9)·방번호(Q10)는 네 건물 모두 우리 TTL 에만 있다** — 받는 쪽 파서가 `ex:` 속성을 버려서
  "A101호는 어디" 같은 운영자 질문이 DT 쪽에서는 답이 없다. 로봇 통과(Q12)는 TTL 밖(GeoJSON)이다. Duplex 는 흐름 방향이 없어
  상류·담당 공간(Q7·Q8)을 물을 대상이 없다.
- gemini 채점은 gemini 가 되는 곳(55)에서 `npm run onto:bench -- --ask` 로 잰다. 이 PC 의 개인 계정 gemini 는 막혀 있다.
- 되돌리려면 `serve.mjs` 의 `/__ask` 와 창의 [온톨로지] 칸을 빼면 된다. 앱 코드(src)는 건드리지 않았다.
