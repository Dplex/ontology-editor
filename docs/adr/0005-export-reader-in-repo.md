---
id: "ADR-0005"
title: "export 한 TTL 은 다른 저장소의 ttl.go 를 빌드하지 않고, 그 규칙을 옮긴 이 repo 의 reader 와 뷰어로 다시 읽는다"
status: "채택"
date: "2026-10-03"
prd: []
tickets: ["OE-GEN-01"]
supersedes: []
superseded_by: ""
---

# ADR-0005 export 한 TTL 은 다른 저장소의 ttl.go 를 빌드하지 않고, 그 규칙을 옮긴 이 repo 의 reader 와 뷰어로 다시 읽는다

## 맥락

OE-GEN-01 의 수용 기준은 "ttl.go 읽기" 다. 수신 측 DT 파서(`ieum-pipeline/internal/ontology/ttl.go`)는 범용 Turtle 파서가 아니라,
`ex:X a 클래스` 로 시작하는 블록만 subject(TTL 에서 설명하는 대상 — 방·설비 하나) 로 읽고 predicate(관계·값을 나타내는 이름) 4개(hasPart·hasLocation·feeds·hasPoint)와 라벨만 본다. Turtle 문법으로는 맞아도
수신 측에서 사라지는 내용이 생긴다 — 블록 밖에 따로 적은 feeds 때문에 ifc4Mep 흐름 1,995개가 0 이 된 적이 있다.

그래서 `check:sample`·`check:seongsu` 가 **다른 저장소의 ttl.go 를 복사해 go 로 빌드**한 뒤 에디터 출력을 읽혔다. 문제가 두 가지였다.

- **결과가 다른 저장소의 checkout 상태에 좌우됐다.** 이 PC 의 `../ieum-pipeline` 이 origin 보다 한 커밋 뒤처져(`\$` unescape
  수정 전) "GUID($ 든 것)가 GeoJSON 과 같은 문자열로 읽힌다" 가 90개 어긋남으로 실패했다. 에디터 코드는 맞았다.
  맞추려면 다른 저장소를 pull 해야 했는데, 다른 모듈은 건드리지 않는 것이 원칙이다.
- go 와 다른 저장소가 없으면(55·고객사 PC) 테스트 묶음 전체를 건너뛰어, 수신 측 계약을 아무도 확인하지 않았다.

또 export 한 두 파일(GeoJSON·TTL)을 사람이 **파일 그대로** 열어 볼 도구가 없었다. 에디터 화면은 모델을 그리므로, export 에서 빠지거나
두 파일 사이에서 어긋난 것은 보이지 않는다.

## 결정

- `src/lib/export/read-ttl.ts` 에 ttl.go 의 읽기 규칙(블록 나누기, subject 정규식, predicate 4개, 역슬래시 unescape)을 **옮겨 적는다.** 다른 저장소는
  읽기만 참조하고 빌드·수정하지 않는다. 수신 측이 읽지 않는 subject 블록(`fso:` 덕트·배관)은 `unread` 로 따로 집계한다.
- `src/lib/export/read-export.ts` 가 GeoJSON 을 RFC 7946 형식으로 읽고, 두 파일이 id 로 이어지는지 확인한다(TTL 에 없는 feature,
  끊긴 참조, GeoJSON spaceId 와 TTL hasLocation 의 어긋남, 문이 가리키는 없는 방).
- `src/lib/export/read-3d.ts` 가 3D 형상(GLB·OBJ)을 three.js loader 로 다시 읽어 GeoJSON 과 같은 id·같은 위치인지 확인한다.
- `viewer.html`(export 한 파일 보기)이 같은 모듈로 내려받은 파일을 연다 — 층별 평면과 파일 그대로의 3D, 수신 측이 읽은 subject·관계,
  검사(TTL·GeoJSON 5줄 + 3D 파일마다 3줄), 선택한 요소의 TTL·GeoJSON·3D 와 파일 원문을 나란히 보여 준다. 에디터의 3D 화면(모델을 그린다)이
  아니라 파일을 그린다. 에디터와 별도 페이지다(vite multi-page).
- `check:sample`·`check:seongsu` 의 "ttl.go 가 읽는가" 묶음을 이 reader(export 파일을 다시 읽는 모듈) 로 바꿨다. 같은 assertion(기기→기기 흐름이 모두 연결됨, 소속 40,
  덕트는 의도적으로 안 읽힘, $ 든 GUID)이 go 없이 실행된다. 표준 문법은 rdflib 로 따로 확인한다(OE-GEN-01, 파이썬이 있을 때).

측정: Duplex 건축+HVAC 를 앱에서 export 한 5개 파일을 뷰어로 열면 수신 측 subject 100 · 읽지 않는 subject 458(fso) · GeoJSON 614 feature,
검사 5줄 모두 0. `check:sample` 의 같은 검사가 보유 샘플 BIM 6가지(합친 모델·IDF 포함)에서 0.

## 결과

- 수신 측 계약을 이 repo 만으로 확인한다. 다른 저장소의 상태와 go 설치 여부에 결과가 좌우되지 않는다.
- 대가: **ttl.go 가 바뀌면 read-ttl.ts 를 직접 따라 고쳐야 한다.** 옮겨 적은 기준은 ieum-pipeline `39d1dca` 다. 수신 측이
  predicate 를 늘리거나 블록 규칙을 바꾸면 에디터 테스트는 옛 규칙으로 통과해 버린다. ieum-pipeline 과 맞출 때(TODO.md "받는 쪽과 맞출 것")
  이 파일을 같이 확인한다.
- 되돌리려면: `scripts/check-sample.test.ts`·`scripts/seongsu.test.ts` 의 "받는 쪽 규칙으로 다시 읽는가" 묶음에서 `readOntologyTTL`
  대신 ttl.go 를 빌드해 호출하면 된다(이 ADR 이전 커밋의 `TTL_GO` 묶음). 뷰어는 그대로 둬도 된다.
