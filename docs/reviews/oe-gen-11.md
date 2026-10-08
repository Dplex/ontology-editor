OE-GEN-11 층 단위 생성 — 층마다 TTL·GeoJSON, 합치면 건물 전체와 같음

Closes #133
Branch: feature/OE-GEN-11-per-storey
Ticket: docs/prd/features/E08-GEN/OE-GEN-11.md
Review: docs/reviews/oe-gen-11.md
PRD: prd-review — 요구사항이 바뀌면 다시 본다
ADR: docs/adr/0011-per-storey-ontology-files.md

## 구현한 것
요구사항은 "층마다 생성·등록 가능" 한 줄이다. 이번에는 층마다 파일로 export 하는 것까지 했다(서버 등록은 D-INT 가 정해진 뒤).
다른 층 요소를 가리키는 줄은 id 로 남긴다.

| 무엇 | 구현 | 확인 테스트 |
|---|---|---|
| 층마다 생성 | 파일 요약의 **층별 요약** 표에 줄마다 [구축] 버튼이 있다. 누르면 `floor-{층}.ttl` · `floor-{층}.geojson` 두 파일을 export 한다(`storey-export.ts`). 파일명이 같아 짝을 바로 알 수 있다 | e2e `export.spec.ts` "층별 요약의 [구축] 은 …" |
| GeoJSON | 건물 전체로 export 할 때의 해당 층 파일과 같다(파일명·내용) | `ttl-storey.test.ts` "GeoJSON 은 건물 전체로 낼 때의 …" |
| TTL — 해당 층 내용 | 층·방·커스텀존·설비 블록은 해당 층 파일에만 들어간다. 건물 블록은 해당 층만 `hasPart` 로 가진다. 여러 층에 걸친 계통은 층 파일마다 그 층 구성원만 `hasPart` 로 적는다. 공조존(IDF)은 해당 층 파일에 통째로 들어간다 | `ttl-storey.test.ts` 4개 |
| 다른 층을 가리키는 줄 | **id 로 남긴다**. 층 파일을 모두 합치면 건물 전체 TTL 과 triple(subject·관계·대상으로 된 TTL 한 줄) 단위로 같다 | 아래 측정 |
| 어느 층에도 속하지 않는 것 | 구성원 없는 계통, 층을 모르는 IDF 설비는 맨 아래 층 파일에 넣는다 | `ttl-storey.test.ts` "어느 층에도 안 걸리는 것 …" |
| 건물 전체 TTL | 층을 선택하지 않으면 이 기능 전과 바이트 단위로 같다 | 기존 단위 테스트·`check:sample` 의 TTL 비교가 모두 그대로 통과 |
| 수신 측처럼 쌓아 읽기 | 뷰어(`viewer.html`)에 층 TTL(`floor-*.ttl`) 여러 개를 놓으면 subject 별로 합쳐 읽는다(`read-ttl.ts` 의 `mergeReadings`). 전에는 TTL 을 하나만 들고 있어서 층 파일을 놓으면 마지막 층만 남았다. 건물 전체 TTL 을 놓으면 층 파일 대신 그 파일을 쓴다 | `ttl-storey.test.ts` "층 파일을 다 합쳐 읽으면 …" · e2e `viewer.spec.ts` "층별로 구축한 TTL 을 여럿 놓으면 …" |

측정(`check:sample` "층 단위 생성 (OE-GEN-11)") — 보유 샘플 BIM 6개 모두:
- 층 파일을 합친 triple = 건물 전체 TTL 의 triple(빠진 것 0, 늘어난 것 0)
- 층마다 GeoJSON feature 가 모두 그 층 TTL 의 subject 로 있고(`notInTtl` 0), 설비 소속·문이 잇는 방도 일치한다
- 층 파일 하나만 보면 대상이 그 파일에 없는 줄이 있는데, 모두 다른 층 파일의 subject 다. 층 파일을 모두 쌓아 읽으면(`mergeReadings`) 끊긴 참조가 0 이다. 그런 줄 수:

| 파일 | 다른 층을 가리키는 줄 |
|---|---|
| AC20 | 0 |
| ifc4Mep | 20 |
| Duplex 건축+HVAC · Duplex MEP | 0 · 0 |
| 병원 건축+HVAC | 311 |
| IDF(Samsung) | 225 |

저장 위치: export 한 파일뿐이다. 건물 전체 [구축하기] 와 달리 **저장으로 치지 않는다** — 다른 층의 편집은 아직 export 하지 않았으니 편집을 끝낼 때 저장할지 묻는다.
층별 진행(완료 표시)은 OE-MAN-06 이 이 기능 위에 만든다.

## 화면
병원 건축+HVAC 의 층별 요약. 줄마다 [구축] 버튼이 있고, First Floor 를 구축하면 버튼에 ✓ 가 잠깐 뜬다.
![층별 구축](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/blob/feature/OE-GEN-11-per-storey/docs/figures/oe-gen-11-storeys.png?raw=true)

## 확인 방법
1. 8087 검토 서버(또는 `npm run dev`)에서 `data/NBU_MedicalClinic/NBU_MedicalClinic_Arch.ifc` 와 `…_Eng-HVAC.ifc` 를 같이 연다
2. 파일 요약 → 층별 요약 → First Floor 줄의 [구축] → `floor-First_Floor.ttl` · `floor-First_Floor.geojson` 두 파일이 export 된다
3. 두 파일을 `viewer.html` 에 놓는다 → GeoJSON 의 방·설비가 모두 TTL subject 와 이어진다. 다른 층 덕트를 가리키는 줄은 "끊긴 참조" 로 표시된다
4. 나머지 층도 구축해서 더 놓는다 → TTL 제목이 "층 파일 4개 합침" 이 되고 끊긴 참조가 0 이 된다

## 테스트
- `npm test` — 42 files · 659 passed(새로 넣은 것: `ttl-storey.test.ts` 6)
- `npx vue-tsc --noEmit` 통과
- e2e — 112 passed(새로 넣은 것: `export.spec.ts` 1 · `viewer.spec.ts` 1. 층별 요약 끝 칸이 [구축] 으로 바뀌어서 `edit-3d.spec.ts` 가 설비 칸을 클래스로 찾도록 고쳤다)
- `npm run check:sample` — 72 passed · 0 failed(새로 넣은 것: "층 단위 생성 (OE-GEN-11)")
- mutation test — 이 커밋이 넣은 규칙을 하나씩 끄고 테스트가 깨지는지 확인했다. 8곳 중 5곳을 잡았고, 나머지를 잡으려고 추가한 것: `ttl-storey.test.ts` 2개(공조존은 해당 층 파일에만, 같은 파일을 두 번 놓아도 관계가 중복되지 않음), e2e `viewer.spec.ts` 한 단계(건물 전체 TTL 위에 층 파일을 놓으면 전체를 빼고 쌓는다)

## 남은 것
- "등록" 은 지금은 다운로드다. DT 서버에 층 단위로 올리는 기능은 D-INT 가 정해진 뒤에 한다
- 수신 측이 층 파일을 쌓아 읽는지 확인해야 한다. 파일 하나만 읽으면 다른 층을 가리키는 줄의 대상이 비어 있다(ADR-0011)
- 생성 게이트(OE-GEN-02)·생성 전 검증(OE-GEN-03)을 층 단위로 걸지는 그 티켓이 정해질 때 본다. 지금은 건물 전체 [구축하기] 처럼 막지 않는다
- 성수 건축+기계(19층, 2026-10-06 성수 PC, 임시 probe): 층 파일을 모으면 건물 전체와 트리플 120,421 개가 같고, 층마다 GeoJSON 과 TTL 이 이어지며, 다른 층을 가리키는 줄 12개는 전부 다른 층 파일의 주어다. 재다가 찾은 계통 포트 끊긴 참조(39,302)는 OE-INT-02 에서 고쳤다
