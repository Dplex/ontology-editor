OE-BIM-16 등급 칩 — 파일 목록과 연 뒤의 칩이 같은지 확인

Closes #101
Branch: feature/OE-BIM-16-verify
Ticket: docs/prd/features/E05-BIM/OE-BIM-16.md
Review: docs/reviews/oe-bim-16.md
PRD: prd-review — 요구사항이 바뀌면 다시 본다

## 구현한 것
구현은 이미 있었다(`src/lib/profile.ts` 의 `profileOf`, 칩은 `src/components/TierChips.vue` 하나를 목록·검토 화면이 같이 쓴다). 수용 기준과 비교해 확인 테스트를 추가했다. 코드는 고치지 않았다.

목록과 열람은 **같은 임포터지만 실행 경로가 둘**이라 결과가 어긋날 수 있었다. 그 차이를 테스트가 막는다.

| | 목록 | 열람 |
|---|---|---|
| 어디서 | 서버 `src/server/data-catalog.ts`(dev·55 공통) | 브라우저 워커 `import.worker.ts` → `App.vue` `load` |
| 임포트 옵션 | 기본값 | 화면의 [읽을 것](벽·문·창, 문·창 형상) |
| 열 때 추가 처리 | 없음 | postMessage structured clone, `inferFlowByRules` 한 번 더 |

| 요구사항·수용 기준 | 확인 테스트 | 결과 |
|---|---|---|
| 공간·설비·소속·연결망·방향 5칩 | `scripts/check-sample.test.ts` "목록의 칩과 파일을 연 뒤의 칩이 같다…" — 칩 key 순서 | 5칩, 이 순서 |
| **목록 숫자 = 열람 숫자** | 같은 테스트 — 서버 핸들러(`createDataCatalog`)의 `?profile` 응답과, 워커와 같은 경로(옵션 → structured clone → `inferFlowByRules` → `profileOf`)로 연 칩을 옵션 3가지(화면 기본 · 문 형상 켬 · 벽·문·창 끔)로 비교한다. 숫자·색 등급·마우스 설명(note)까지 | 샘플 8개 × 3가지 같음 |
| 파일마다 칸이 얼마나 채워지나 | 같은 describe 의 "파일마다 어느 칸이 얼마나 차는지"(기존 테스트) | 통과 |
| 실제 화면 | dev 서버(5174)에서 목록의 칩을 읽고 [열기] 뒤 "이 파일" 칩을 읽어 비교(일회성 스크립트, 삭제함) | 4개 파일 같음(아래) |

화면에서 비교한 값(목록 = 열람):

| 파일 | 칩 |
|---|---|
| AC20-FZK-Haus | 공간 7 · 설비 — · 소속 — · 연결망 — · 방향 — |
| ifc4Mep_IFC4 | 공간 — · 설비 286/308 · 소속 0/308 · 연결망 1995 · 방향 37/103 |
| Duplex Eng-HVAC | 공간 1 · 설비 40 · 소속 0/40 · 연결망 485 · 방향 0/26 |
| 병원 Eng-HVAC | 공간 260/263 · 설비 566 · 소속 563/566 · 연결망 3695 · 방향 559 |

테스트를 넣기 전에 `data/` 의 IFC 20개 전부(구문이 깨진 COBie 파일 3개 제외 17개, 병원 MEP 207MB 포함)를 같은 방법으로 한 번 측정해 모두 같은 것을 확인했다. 테스트에는 빨리 끝나는 8개만 둔다(27초).

## 화면
목록 — Duplex Eng-HVAC
![목록의 칩](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/blob/feature/OE-BIM-16-verify/docs/figures/oe-bim-16-list.png?raw=true)

같은 파일을 연 뒤의 "이 파일"
![연 뒤의 칩](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/blob/feature/OE-BIM-16-verify/docs/figures/oe-bim-16-opened.png?raw=true)

## 확인 방법
1. 8087 검토 서버(또는 `npm run dev`)의 첫 화면 파일 목록에서 `NBU_Duplex/NBU_Duplex-Apt_Eng-HVAC.ifc` 줄의 칩을 본다 → 공간 1 · 설비 40 · 소속 0/40 · 연결망 485 · 방향 0/26
2. 그 줄의 [열기] 를 누른다
3. 오른쪽 "이 파일" 의 칩이 1 과 같다. 칩에 마우스를 올린 설명도 같다
4. [읽을 것] 에서 벽·문·창을 끄거나 문·창 자리(형상)를 켜고 다시 열어도 칩은 같다(칩 5개는 벽·문·창을 세지 않는다)

## 테스트
- `npm run check:sample -t "목록의 칩과 파일을 연 뒤의 칩이 같다"` — 1 passed(27초). 연 쪽에서 연결 하나를 빼면 ifc4Mep 에서 실패하는 것을 확인했다
- `npm test` — 37 files · 586 passed
- `npx vue-tsc --noEmit` 통과

## 남은 것
- 파일을 연 뒤 편집·덧붙이기를 하면 "이 파일" 칩은 바뀐다(의도된 동작 — 덧붙인 뒤 어느 칸이 채워졌는지 비교한다). 수용 기준은 파일을 연 시점의 숫자로 해석했다
- 목록 캐시(`data/.profiles.json`)의 key 는 `src/lib` 코드의 hash 라서, web-ifc 버전을 올리면 오래된 숫자가 남을 수 있다. web-ifc 를 올릴 때 캐시를 지운다
- 성수는 이 PC 에 없어 측정하지 못했다
