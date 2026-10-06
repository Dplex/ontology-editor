OE-GEN-10 DT 파서 호환 — 요구 항목마다 확인 테스트 연결

Closes #132
Branch: feature/OE-GEN-10-verify
Ticket: docs/prd/features/E08-GEN/OE-GEN-10.md
Review: docs/reviews/oe-gen-10.md
PRD: prd-review — 요구사항이 바뀌면 다시 본다. 관련된 OE-INT-08(ttl.go 호환)도 prd-review 지만 요구 내용이 이 티켓과 같아 함께 확인했다

## 구현한 것
구현은 이미 있었다 — export(`src/lib/export/ttl.ts`)가 ttl.go 의 지원 범위에 맞춰 쓰고, 수신 측 규칙을 옮긴 reader(`src/lib/export/read-ttl.ts`, OE-GEN-01·ADR-0005)로 다시 읽어 확인한다. 수용 기준과 비교해 확인 테스트를 적었다. 새 코드·테스트는 없다.

수신 측 ttl.go 는 범용 Turtle 파서가 아니다. 마침표로 끝나는 줄까지를 한 블록으로 보고, `ex:X a brick:클래스`(또는 `ex:`)로 시작하는 블록만 subject 로 읽으며, predicate(관계·값을 나타내는 이름) 는 hasPoint·feeds·hasLocation·hasPart 와 rdfs:label 만 본다. Turtle 문법으로는 맞아도 수신 측에서 사라지는 내용이 생기므로, 그 규칙대로 다시 읽어 확인한다.

| 요구사항·수용 기준 | 확인 테스트 | 결과 |
|---|---|---|
| `ex:X a 클래스` 블록 | `src/lib/export/read-export.test.ts` "주어 블록 밖에 따로 적은 feeds 는 읽히지 않는다 — 예전에 흐름이 전부 사라진 모양"(예전 출력 형식이 실제로 누락되는 것을 테스트로 고정), `export.test.ts` "목적어 없는 hasPart 를 쓰지 않는다"(블록마다 `.` 로 끝남) | 통과 |
| `$` 이스케이프 | `read-export.test.ts` "$ 든 GUID 와 따옴표·역슬래시·줄바꿈 든 이름을 우리 값 그대로 돌려준다", `export.test.ts` "IFC GUID 의 $ 를 이스케이프한다" · check:sample "우리가 짓는 id 와 GUID($ 가 든 것까지)가 GeoJSON 과 같은 문자열로 읽힌다"(Duplex MEP) | 통과 |
| `"` 이스케이프 | 같은 테스트(따옴표·역슬래시·줄바꿈·CR) · `export.test.ts` "이름의 CR 도 이스케이프한다" | 통과 |
| fso 비엔티티 → 하류 기기 직접 기술 | `read-export.test.ts` "기기에서 기기로 가는 흐름이 덕트를 건너 전부 읽힌다"·"덕트·배관(fso:)은 주어로 읽지 않고 따로 센다" · check:sample "기기에서 기기로 가는 흐름이 받는 쪽에 전부 닿는다"(ifc4Mep 방향 있는 연결 1,995개에서 나온 기기 쌍 전부)·"기기의 소속은 다 읽고, 덕트·배관은 일부러 읽히지 않는다"(Duplex 건축+HVAC: 기기 소속 40 다 읽힘, 읽지 않는 subject = 덕트·배관 수) | 통과 |
| 매 빌드 실제 읽기 검증 | 위 단위 테스트는 `npm test` 에 들어 있어 8087 검토 서버 빌드(`scripts/review55.sh`)마다 실행된다. 실제 BIM 은 `npm run check:sample` "받는 쪽 규칙으로 다시 읽는가" 6개(커스텀존 · 기기→기기 흐름 · 소속 · $ 든 GUID · 보유 샘플 BIM 6가지 모델의 두 파일 잇기 · 3D) | 통과 |
| **check:sample 통과** | `npm run check:sample` | 59 passed · 1 failed — 실패 1개는 작업 시작 시점에도 실패하던 "벽마다 다섯 걸음…"(벽 편집, 이 티켓과 무관). 위 "받는 쪽 규칙으로 다시 읽는가" 묶음은 전부 통과 |

ifc4Mep 을 수신 측 규칙으로 읽은 결과(뷰어 요약과 같다): 수신 측이 읽는 subject 351(hasPart 1,743 · hasLocation 308 · feeds 106), 읽지 않는 subject 1,895(fso:Segment 1,075 · fso:Fitting 820 — 일부러 Brick 밖에 둔 덕트·배관), `$` 가 든 GUID subject 79개가 GeoJSON id 와 같은 문자열로 읽힌다. 두 파일 연결 검사 다섯 줄 모두 0.

TTL 이 바뀌지 않으므로 BIM·GeoJSON·화면도 그대로다.

## 화면
ifc4Mep 의 TTL·GeoJSON 을 export 한 파일 뷰어로 연 화면 — 수신 측이 읽는 subject·predicate 수, 읽지 않는 subject(fso), 검사 다섯 줄 0
![뷰어](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/blob/feature/OE-GEN-10-verify/docs/figures/oe-gen-10-viewer.png?raw=true)

`$` 가 든 GUID 의 Manifold(`1h$HMC2J94RvlMKbh7lkX1`) — 수신 측 key 가 GeoJSON id 와 같고, feeds 에 덕트를 건너뛴 하류 기기(Heating/Cooling Device)가 직접 적혀 있다(덕트 구간을 가리키는 줄도 같이 보인다 — 남은 것 참고)
![feeds](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/blob/feature/OE-GEN-10-verify/docs/figures/oe-gen-10-feeds.png?raw=true)

## 확인 방법
1. 8087 검토 서버(또는 `npm run dev`)에서 `data/ifc4Mep_IFC4.ifc` 를 열고 [TTL]·[GeoJSON] 으로 내려받는다
2. 첫 화면의 "내보낸 파일 보기"(`viewer.html`)에 내려받은 파일 6개를 놓는다
3. 요약: subject 351 · feeds 106 · 읽지 않는 subject fso:Segment 1,075 · fso:Fitting 820, 검사 다섯 줄 모두 0
4. 층 [01_verdieping] 에서 Manifold 를 누르면 id `1h$HMC2J94RvlMKbh7lkX1`, feeds 22 중 9개가 수신 측이 읽는 기기다(Heating/Cooling Device 등, 덕트를 건너뛰어 직접 적은 것 포함). 맨 아래 원문에는 `ex:1h\$HMC2…` 로 이스케이프돼 있다

## 테스트
- `npm test` — 40 files · 633 passed(이 티켓으로 바뀐 것 없음)
- `npx vue-tsc --noEmit` 통과
- `npm run check:sample` — 59 passed · 1 failed(위 표)

## 남은 것
- **기기 블록의 feeds 가 덕트·배관(fso)도 가리킨다.** ifc4Mep: 수신 측이 읽는 feeds 106개 중 76개가 fso subject 를 가리킨다(Manifold 22개 중 13). 수신 측은 fso 블록을 읽지 않으므로 그 대상은 이름 없는 노드가 된다. 기기 → 기기 흐름은 따로 직접 적혀 있어(30개, 쌍 전부) 잃는 정보는 없다. 덕트를 가리키는 feeds 를 뺄지(Brick 으로는 맞는 문장이고 rdflib 쪽 소비자는 쓴다)는 수신 측(ieum-pipeline)과 정할 일 — OE-INT-08
- read-ttl.ts 는 ttl.go(`39d1dca` 기준)의 규칙을 옮겨 적은 것이다. 수신 측 규칙이 바뀌면 직접 따라 고쳐야 하고, 변경을 알려 주는 테스트는 없다(다른 저장소에 의존하지 않기로 함, ADR-0005)
- 실제 BIM 으로 확인하는 check:sample 은 빌드마다 돌지 않는다(data/ 가 저장소 밖이고 30분 넘게 걸린다). 매 빌드에는 fixture 단위 테스트만 실행된다
