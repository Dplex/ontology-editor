OE-MAN-06 층 단위 진행 — 층마다 완료 표시, 고치면 자동 해제

Closes #122
Branch: feature/OE-MAN-06-storey-progress
Ticket: docs/prd/features/E07-MAN/OE-MAN-06.md
Review: docs/reviews/oe-man-06.md
PRD: prd-review — 요구사항이 바뀌면 다시 본다
ADR: docs/adr/0011-per-storey-ontology-files.md
의존: OE-GEN-11(층마다 생성) — 같은 표의 [구축]

## 구현한 것
요구사항은 "층 단위로 진행, 층마다 온톨로지 생성(#8)" 한 줄이다. 층마다 생성은 OE-GEN-11 에서 했다. 진행 방식은 다음과 같다:
층마다 완료 표시 + 진행률, 표시는 편집 파일에 저장, 완료한 층을 고치면 자동으로 해제.

| 무엇 | 구현 | 확인 테스트 |
|---|---|---|
| 층마다 완료 | 층별 요약 표에 **진행** 칸 — [완료 표시] / "완료 ✓ [지우기]" / "완료 뒤 고침 [다시 완료]". 표 위에 "완료 2/4층 · 완료 뒤 고침 First Floor · 남은 층 Roof - Main", 칸 제목에 "완료 2/4" | e2e `storey-progress.spec.ts` 2 |
| 고치면 자동 해제 | 완료를 누를 때 그 층의 **지문(fingerprint)** 을 저장하고, 현재 지문과 비교해 상태를 정한다(`storey-progress.ts`). 지문 대상은 그 층 파일(OE-GEN-11)에 들어갈 내용 — 방·벽·문·창·설비·커스텀존, 그 층 설비의 연결, 그 층 설비가 속한 계통. 해제되면 알림을 띄운다 | 단위 `storey-progress.test.ts` 6 |
| 되돌리면 다시 완료 | 상태를 저장된 flag 가 아니라 현재 모델로 계산하기 때문에, Ctrl+Z 로 그 층이 완료 시점과 같아지면 다시 완료가 된다. 지문은 배열·객체 key 순서를 무시한다(되돌리기가 같은 값을 다른 순서로 돌려놓아도 같다) | e2e: 공조기를 옮기면 해제 → Ctrl+Z → 완료 ✓ |
| 손으로 원래 자리에 옮기면? | "완료 뒤 고침" 그대로다. 좌표 출처가 "사람이 옮김" 으로 남아 export 할 GeoJSON 이 다르기 때문이다 | 단위 |
| 다른 층 편집 | 영향 없음 | 단위 · 병원 측정 |
| 편집 파일에 남는다 | `storeysDone: [{ id, at, changed? }]`. 층 id 는 다른 id 처럼 지문(versions.ts)으로 다시 찾는다. 불러올 때 편집을 모두 적용한 뒤 지문을 새로 계산한다. `changed` 는 저장할 때 이미 고친 상태였다는 뜻이라 불러와도 "완료 뒤 고침" 이다. 완료한 층이 없으면 이 항목이 없다(예전 파일과 같은 형식) | 단위 · e2e(저장 → 다시 열기 → 불러오기 → 완료 2/2) |
| 완료만 눌러도 저장 대상 | 편집 없이 완료만 눌러도 [편집 저장]·자동 저장·종료 시 확인이 이를 저장 대상으로 본다(완료 표시는 되돌리기 이력에 없어서 따로 집계한다) | e2e "편집 없이 완료만 눌러도 …" |

측정(`check:sample` "층 단위 진행 (OE-MAN-06)", 병원 건축+HVAC):
- 네 층을 모두 완료 → First Floor 설비 하나를 옮기면 First Floor 만 "완료 뒤 고침", 나머지 3개 층은 완료
- 층·설비 GUID 를 전부 바꾼 버전에 편집 파일을 불러와도 완료한 층을 모두 찾는다(못 찾은 층 0), 상태도 같다
- 지문 계산은 네 층에 45ms. 편집(방향키)마다 바로 계산하면 편집이 그만큼 느려져서 **편집이 멈춘 뒤 200ms 에 한 번** 확인한다. 완료를 누를 때는 바로 확인한다

저장 위치: 편집 파일(`*.edits.json` 의 `storeysDone`)과 자동 저장. TTL·GeoJSON 에는 들어가지 않는다 — 진행 표시는 에디터의 작업 상태다.
완료와 [구축] 은 별개다 — 완료를 눌러도 파일을 export 하지 않고, 구축해도 완료로 보지 않는다.

## 화면
병원 건축+HVAC. 세 층을 완료한 뒤 First Floor 의 VAV 하나를 옮겼다. First Floor 가 "완료 뒤 고침" 으로 해제되고 [다시 완료] 가 뜬다.
![층 단위 진행](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/blob/feature/OE-MAN-06-storey-progress/docs/figures/oe-man-06-progress.png?raw=true)

## 확인 방법
1. 8087 검토 서버(또는 `npm run dev`)에서 `data/NBU_MedicalClinic/NBU_MedicalClinic_Arch.ifc` 와 `…_Eng-HVAC.ifc` 를 같이 연다
2. 파일 요약 → 층별 요약 → First Floor 의 [완료 표시] → "완료 ✓", 칸 제목 "완료 1/4"
3. [편집] → First Floor 설비 하나를 방향키로 옮긴다 → 잠시 뒤 "완료 뒤 고침" 과 알림. Ctrl+Z → 다시 "완료 ✓"
4. Ctrl+S 로 편집 저장 → 같은 파일을 다시 열고 [편집 불러오기] → First Floor 가 완료다

## 테스트
- `npm test` — 43 files · 665 passed(새로 넣은 것: `storey-progress.test.ts` 6)
- `npx vue-tsc --noEmit` 통과
- e2e — 114 passed(새로 넣은 것: `storey-progress.spec.ts` 2)
- `npm run check:sample` — 73 passed · 0 failed(새로 넣은 것: "층 단위 진행 (OE-MAN-06)")
- mutation test — 이 커밋이 넣은 규칙을 하나씩 꺼 보고 테스트가 깨지는지 확인했다. 16곳 중 8곳을 잡았고, 나머지를 잡으려고 추가한 것: `storey-progress.test.ts` 2개(연결 방향·커스텀존·벽만 고쳐도 해제, 못 찾은 완료 층 집계), e2e `storey-progress.spec.ts` "완료만 눌러도 편집을 끝낼 때 묻고 자동 저장에 남으며 …"(종료 시 확인·자동 저장·해제 알림·다른 파일을 열면 집계 0)

## 남은 것
- 완료는 누가 했는지 적지 않는다(사용자 개념이 없는 PoC). 층 단위 편집 잠금(OE-COM-05, R2)이 들어오면 같이 본다
- 완료를 막는 조건(그 층의 생성 게이트·완전성 검사 통과)은 걸지 않았다. OE-GEN-02·03 이 정해지면 층 단위로 걸지 본다
- 성수 건축+기계(19층, 2026-10-06 성수 PC, 임시 probe): 19층을 다 완료한 뒤 진행 계산 218ms(병원 네 층 45ms), 설비 하나를 옮기면 그 층(B5F)만 풀리고 다시 계산 225ms. 편집마다 도는 값이라 300ms 기준 안이지만 여유가 적다
