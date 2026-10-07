OE-REQ-01 R0~R24 표 — PRD 부록 A 와 BIM→DT 문서 4장 일치 확인

Closes #111
Branch: feature/OE-REQ-01-verify
Ticket: docs/prd/features/E06-REQ/OE-REQ-01.md
Review: docs/reviews/oe-req-01.md
PRD: prd-review — 요구사항이 바뀌면 다시 본다

## 구현한 것
표는 이미 있었다 — BIM→DT 문서(`docs/bim-to-dt-ontology.md` — 테스트 이름·PRD 의 '정본') 4장(4.1 필수 · 4.2 권장)이 R0~R24 를 담고, PRD_011.md 부록 A 는 R0~R24 를 복사하지 않고 BIM→DT 문서를 링크하며 **BIM→DT 문서에 아직 없는 제안**(R25 BAS 관제점 매핑 키)만 표로 둔다(부록 A 머리말). 수용 기준 **"부록 A 와 정본 4장 일치(테스트)"** 를 확인하는 테스트가 없었다. 기존 테스트는 BIM→DT 문서 ↔ IDS ↔ 보고서의 등급만 확인했다(`requirements-ids.test.ts`). 그래서 테스트를 추가했다. PRD 는 읽기만 한다.

| 요구사항·수용 기준 | 확인 테스트(`src/lib/prd.test.ts` "부록 A 와 정본 4장 (OE-REQ-01)") | 결과 |
|---|---|---|
| R0~R24, 필수 11 · 권장 14 | "정본 4장이 R0~R24 를 필수 11 · 권장 14 로 한 번씩 담는다 — 제목·용어집의 개수와 같다" — 4.1·4.2 표의 R 개수를 세고, 합치면 R0~R24 가 한 번씩, 제목 "(11개)·(14개)", `glossary.md` 의 "필수 11 · 권장 14" | 11 · 14, 빠짐·겹침 없음 |
| **부록 A 와 BIM→DT 문서 4장 일치** | "부록 A 는 정본을 가리키고, 표에는 정본에 없는 제안만 둔다" — 링크(`../bim-to-dt-ontology.md`·`../requirements.ids`)가 실제 파일이고, 표의 R 이 BIM→DT 문서에 없으며 R24 뒤 번호다 | 링크 2 있음, 제안 R25 1개 |
| BIM→DT 문서 ↔ IDS ↔ 요구사항 보고서 | 기존 `requirements-ids.test.ts` "정본 4장의 R 번호를 같은 등급으로 옮긴다"·"…requirements.ts…도 정본과 같은 R 번호·등급이다" | 통과 |

BIM→DT 문서를 일부러 틀리게 고쳐 테스트가 잡는지 확인했다(BIM→DT 문서는 개발 문서다. PRD 는 잠시도 고치지 않았다):

| 바꾼 것 | 실패한 테스트 |
|---|---|
| 4.1 필수 표에서 R9 줄 빼기 | 필수 11 · 권장 14 테스트, (티켓의 `depends: R9` 가 가리킬 곳이 없어) 기존 "depends · blocked_by 가 가리키는 것이 존재한다" |
| 4.2 권장 표에 R22 줄 한 번 더 | 필수 11 · 권장 14 테스트 |

## 화면
BIM→DT 문서 4.1·4.2 와 PRD 부록 A 의 표 — 테스트가 비교하는 대상
![부록 A 와 BIM→DT 문서 4장](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/blob/feature/OE-REQ-01-verify/docs/figures/oe-req-01-appendix-a.png?raw=true)

## 확인 방법
1. `npx vitest run src/lib/prd.test.ts` → 12 passed, 그중 "부록 A 와 정본 4장 (OE-REQ-01)" 2개
2. `docs/bim-to-dt-ontology.md` 4.2 권장 표에서 한 줄(예: R22)을 지우고 다시 돌린다 → "정본 4장이 R0~R24 를 필수 11 · 권장 14 로…" 가 R22 빠짐으로 실패한다

## 테스트
- `npm test` — 38 files · 607 passed(새로 넣은 것: `prd.test.ts` 2개)
- `npx vue-tsc --noEmit` 통과

## 남은 것
- 부록 A 의 제안(R25)을 채택하면 BIM→DT 문서·IDS·보고서로 옮기고 부록 A 표에서 빼야 한다. 그때 이 테스트가 "표의 R 이 정본에 없다" 로 누락을 잡는다
- 요구사항 설명의 "PRD #6 의 ①~⑦ 을 R0~R24 로 교체" — PRD_011.md 에 요구사항을 ①~⑦ 로 적은 곳은 남아 있지 않다(①② 는 운영 편집 흐름·데이터 교환 선택지 번호뿐). 그 문장은 테스트로 확인하지 않았다
