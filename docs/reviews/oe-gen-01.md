OE-GEN-01 온톨로지 생성·내보내기 — export 파일을 다시 읽는 reader·뷰어

Closes #123
Branch: feature/OE-GEN-01-verify
Ticket: docs/prd/features/E08-GEN/OE-GEN-01.md
Review: docs/reviews/oe-gen-01.md
PRD: prd-review — 요구사항이 바뀌면 다시 본다

## 구현한 것
export 자체는 이미 있었다(`src/lib/export/ttl.ts`·`geojson.ts`, 도구막대 [GeoJSON]·[TTL]·[구축하기]). 수용 기준을 확인할 수단이 부족해서 보완했다. export 하는 파일은 한 글자도 바뀌지 않는다.

**1. 수신 측 규칙으로 다시 읽는 reader(export 파일을 다시 읽는 모듈) — 다른 저장소에 의존하지 않는다(ADR-0005).**
"ttl.go 읽기" 는 그동안 `check:sample`·`check:seongsu` 가 옆 저장소 `../ieum-pipeline` 의 ttl.go 를 복사해 go 로 빌드해서 확인했다. 그래서 결과가 다른 저장소의 checkout 상태에 좌우됐다 — 이 PC 의 ieum-pipeline 이 한 커밋 뒤처져 있어 "$ 든 GUID" 테스트가 90개 어긋남으로 실패했다(에디터 코드는 맞았다). ttl.go 의 읽기 규칙(`ex:X a 클래스` 블록만, predicate 4개, 역슬래시 unescape)을 `src/lib/export/read-ttl.ts` 로 옮겨 적고, 테스트가 이것으로 읽는다. 다른 저장소는 읽기만 참조했고 고치지 않았다. go 도 필요 없다.

**2. 두 파일의 연결 검사** — `src/lib/export/read-export.ts`. GeoJSON 을 RFC 7946 형식으로 읽고, TTL 과 id 로 이어지는지 다섯 가지를 집계한다: 형식 문제 · TTL 에 없는 feature · 끊긴 참조 · GeoJSON spaceId 와 TTL hasLocation 의 어긋남 · 문이 가리키는 없는 방.

**3. 3D 형상(GLB·OBJ)도 다시 읽는다** — `src/lib/export/read-3d.ts`. three.js loader 로 읽어 객체마다 id(GlobalId)·삼각형 수·범위(IFC 좌표로 변환)를 추출하고, GeoJSON 과 비교해 세 가지를 집계한다: 어디에도 없는 객체 · 3D 에 없는 형상(형상이 있는 물리존·설비·벽) · 위치 어긋남(방은 외곽선 범위와 1cm, 설비는 GeoJSON 점이 형상 범위에서 0.5m). 설비 허용치 0.5m 는 임포터의 배치점 보정 기준(`ANCHOR_MARGIN`, OE-BIM-12)과 같다 — ifc4Mep 의 얇은 덕트 플랜지·센서 39대는 BIM 배치점이 형상에서 0.3m 떨어져 있어서, 허용치를 그보다 좁게 잡으면 BIM 원본 그대로인 것까지 어긋남으로 집계한다.

**4. 뷰어** — `viewer.html`(에디터 첫 화면의 "내보낸 파일 보기" 링크). 내려받은 `ontology.ttl`·`floor-*.geojson`·`.glb`·`.obj` 를 놓으면 위 모듈로 읽어 보여 준다. 브라우저 안에서만 읽고 어디에도 저장하지 않는다.
- 요약: 수신 측이 읽는 subject 수, predicate 4개의 수, 읽지 않는 subject(`fso:` 덕트·배관 — 의도된 것), 층 파일·feature 종류별 수, 3D 파일마다 객체·삼각형 수
- 검사: TTL·GeoJSON 5줄 + 3D 파일마다 3줄. 어긋남이 있으면 빨간색, 줄의 id 를 누르면 그 요소를 선택한다
- 보기: [평면(GeoJSON)] 층별 평면, [3D · GLB]·[3D · OBJ] 파일 그대로의 3D(드래그 회전·휠 줌·클릭 선택, 평면과 같은 층만 또는 [모든 층]). GLB 는 파일에 있는 색, OBJ 는 색이 없어 GeoJSON 종류별 색으로 칠한다
- 선택한 것: TTL(클래스·위치·feeds·hasPart)·"가리키는 것"·GeoJSON properties·3D 객체(삼각형·범위)를 나란히, 맨 아래 **파일 원문**(그 subject 의 TTL 블록, 그 feature 의 GeoJSON — 긴 좌표는 앞 4개 점만)

**5. rdflib·GeoJSON 검사** — BIM→DT 문서(`docs/bim-to-dt-ontology.md`)에 "2026-09-25 통과" 한 줄만 있고 테스트가 없었다. 수신 측 파서는 필요한 줄만 골라 읽어서 문법이 틀린 줄도 그냥 넘기므로, 표준 Turtle 파서(rdflib)로도 읽는다. 파이썬에 rdflib 가 없으면 건너뛴다(shapely 가 있으면 다각형 자기교차까지 검사).

| 요구사항·수용 기준 | 확인 테스트 | 결과 |
|---|---|---|
| **rdflib 검사 통과** | `scripts/check-sample.test.ts` "rdflib·GeoJSON 검사 (OE-GEN-01)" — 6가지 모델의 TTL 을 rdflib 7.6 으로 읽는다 | 6/6 |
| **GeoJSON 검사 통과** | 같은 테스트 + "받는 쪽 규칙으로 다시 읽는가" › "보유 샘플 BIM 의 GeoJSON 과 TTL 이 id 로 빠짐없이 이어진다" — RFC 7946 형식, id 중복, shapely `is_valid` | IFC 쪽 문제 0, IDF 공조존 자기교차 8(남은 것) |
| **ttl.go 읽기** | `check-sample` "받는 쪽 규칙으로 다시 읽는가" 5개(커스텀존 · 기기→기기 흐름 · 소속 40·덕트는 의도적으로 안 읽힘 · $ 든 GUID · 두 파일 연결), `seongsu.test.ts` 같은 묶음 2개, 단위 `read-export.test.ts` 8개 | 통과 |
| predicate 4종 | rdflib 로 읽은 관계(object 가 개체) predicate 가 hasPart·hasLocation·feeds·hasPoint 밖에 없다 | 밖 0 |
| TTL 에 좌표 없음 | 값 predicate 가 정해 둔 것뿐(`rdfs:label`, `ex:elevation·roomNumber·areaM2·ifcClass·idfClass·systemKind·zoneKind`, 용량 4종) | 밖 0 |
| GeoJSON + TTL 이 같은 id | 위 "두 파일 연결" 검사 다섯 가지 | 6가지 모델 모두 0 |
| (3D 도 같은 id·같은 자리) | `check-sample` "보유 샘플 BIM 의 GLB·OBJ 가 GeoJSON 과 같은 id·같은 자리다", 단위 `read-export.test.ts` "read3D·check3D" 3개 | FZK 20 · ifc4Mep 2,175 · Duplex 건축+HVAC 574 · 병원 건축+HVAC 5,153 객체, GLB·OBJ 모두 어긋남 0 |
| 물리존·커스텀존·공조존·설비·배관·담당 관계 | 6가지 모델(아래)이 각 항목을 포함한다 | 아래 표 |

rdflib 로 집계한 triple(subject·predicate·object 한 문장) 수·subject 수·관계 수:

| 모델 | 포함하는 것 | triple | subject | hasPart · hasLocation · feeds |
|---|---|---|---|---|
| AC20-FZK-Haus | 물리존 | 45 | 10 | 9 · 0 · 0 |
| ifc4Mep + 커스텀존 1개 | 설비·배관(fso)·커스텀존 | 12,766 | 2,247 | 1,744 · 2,209 · 2,025 |
| Duplex 건축+HVAC, 방 이름을 `회의실 "A"\B` + 줄바꿈으로 고침 | 합치기·편집·담당(공기 원천 → 방) | 3,083 | 558 | 549 · 498 · 190 |
| Duplex MEP | `$` 든 GUID | 5,083 | 972 | 888 · 926 · 0 |
| 병원 건축+HVAC | 큰 파일 | 26,733 | 4,098 | 3,985 · 3,806 · 4,453 |
| 삼성 IDF | 공조존·IDF 담당 사슬 | 2,205 | 483 | 16 · 247 · 494 |

테스트가 잡는지 일부러 틀리게 바꿔 확인했다(mutation test): TTL 에 `ex:a ex:x 1.5 .` 를 붙이면 숫자 predicate 검사에서, 이스케이프하지 않은 줄바꿈 라벨을 붙이면 rdflib `BadSyntax` 로, 기기 블록·방 블록을 지우면 "TTL 에 없는 feature"·"끊긴 참조" 로, GeoJSON 소속을 바꾸면 "소속 어긋남" 으로 실패한다(단위 테스트에 남김).

앱에서도 같다: dev 서버에서 Duplex 건축을 열고 HVAC 를 덧붙여 [TTL]·[GeoJSON]·[GLB]·[OBJ] 로 내려받은 파일 7개 — rdflib 로 읽으면 triple 3,083 · subject 558, 뷰어로 열면 수신 측 subject 100 · 읽지 않는 subject 458(fso:Fitting 227 · fso:Segment 231) · feature 614 · 3D 객체 574(GLB·OBJ 같은 수), 검사 11줄 모두 0.

## 화면
Duplex 건축+HVAC 를 export 한 파일 7개(TTL·GeoJSON 4·GLB·OBJ)를 뷰어로 연 화면 — 요약·검사 11줄
![뷰어](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/blob/feature/OE-GEN-01-verify/docs/figures/oe-gen-01-viewer.png?raw=true)

[3D · GLB] Level_1 — 3D 에서 클릭한 벽이 빨갛고, 오른쪽에 같은 id 의 GeoJSON 벽과 3D 객체(범위)가 나온다
![3D GLB](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/blob/feature/OE-GEN-01-verify/docs/figures/oe-gen-01-viewer-3d.png?raw=true)

[3D · OBJ] 같은 위치 — OBJ 는 색이 없어 GeoJSON 종류별 색으로 칠했다
![3D OBJ](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/blob/feature/OE-GEN-01-verify/docs/figures/oe-gen-01-viewer-obj.png?raw=true)

평면에서 변기를 선택한 오른쪽 칸 — TTL·가리키는 것·GeoJSON·3D 를 나란히 보여 주고, 맨 아래에 파일 원문(TTL 블록 · GeoJSON feature)
![원문](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/blob/feature/OE-GEN-01-verify/docs/figures/oe-gen-01-viewer-source.png?raw=true)

평면에서 밸브를 선택한 화면
![선택한 것](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/blob/feature/OE-GEN-01-verify/docs/figures/oe-gen-01-viewer-selected.png?raw=true)

에디터의 export 버튼 위치(도구막대 [GeoJSON]·[TTL])
![export](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/blob/feature/OE-GEN-01-verify/docs/figures/oe-gen-01-export.png?raw=true)

## 확인 방법
1. 8087 검토 서버(또는 `npm run dev`)에서 `data/NBU_Duplex/NBU_Duplex-Apt_Arch.ifc` 를 열고 `NBU_Duplex-Apt_Eng-HVAC.ifc` 를 덧붙인다
2. 도구막대의 [TTL] → `ontology.ttl`, [GeoJSON] → `floor-T_FDN·Level_1·Level_2·Roof.geojson`, [GLB]·[OBJ] → `…+….glb`·`.obj`
3. 첫 화면의 "내보낸 파일 보기"(또는 URL 끝에 `viewer.html`)를 열고 내려받은 파일 7개를 드래그해 놓는다
4. 요약에 subject 100 · hasPart 549 · hasLocation 40 · feeds 14, 읽지 않는 subject fso 458, feature 614, 3D 객체 574 (GLB·OBJ 각각). 검사 11줄이 모두 ✓ 0
5. [Level_1] 평면에서 초록 점(기기)을 누르면 오른쪽에 TTL 의 hasLocation 과 GeoJSON 의 spaceId 가 같은 방으로 보이고, 맨 아래 "원문" 에 그 subject 의 TTL 블록과 GeoJSON feature 가 파일 그대로 나온다
6. [3D · GLB] 를 누르면 같은 층이 3D 로 나오고 선택한 기기가 빨갛다. 3D 에서 벽을 누르면 오른쪽 칸이 그 벽으로 바뀐다. [3D · OBJ] 도 같은 위치
7. 다른 파일의 TTL 을 하나 더 놓으면(짝이 아닌 TTL) "TTL 에 없는 feature" 가 빨갛게 늘어나고, id 를 누르면 그 feature 로 이동한다

## 테스트
- `npm test` — 38 files · 598 passed(새로 넣은 것: `read-export.test.ts` 11개)
- `npx vue-tsc --noEmit` 통과, `npx vite build` — `dist/index.html`·`dist/viewer.html`
- `npm run check:sample -t "받는 쪽 규칙|rdflib"` — 7 passed(수신 측 규칙 6 — 3D 포함 · rdflib 1). go·다른 저장소 없이 실행된다
- e2e — `npx playwright test e2e/viewer.spec.ts` 3 passed(에디터에서 내려받아 뷰어로 열기 · 짝이 아닌 파일의 어긋남 · GLB·OBJ 3D·원문), `e2e/export.spec.ts` 4 passed
- mutation test — 이 커밋이 넣은 규칙을 하나씩 꺼 보고 테스트가 깨지는지 확인했다. 6곳 중 5곳을 잡았고, 나머지를 잡으려고 추가한 것: `read-export.test.ts` "문이 잇는 방이 TTL 에 없으면 잡는다"

## 남은 것
- **IDF 공조존 8개가 OGC 단순 도형이 아니다.** DesignBuilder 바닥 조각을 완전히 합치지 못해 MultiPolygon 조각끼리 변이 T자로 맞닿는다. 겹친 넓이는 존마다 0.0013㎡ 이하라 넓이·소속에는 영향이 없지만 PostGIS·shapely 는 거부할 수 있다. IDF 임포트는 R2(#5)라 고치지 않았고, 8개를 넘으면 실패하도록 테스트를 넣었다
- **"술어 4종" 은 관계 predicate 로 읽었다.** TTL 에는 값 predicate(`rdfs:label`, `ex:*` 7종, 용량 4종)도 있다. BIM→DT 문서 1.6 은 용량만 예외로 적었다. "4종 외 술어 없음" 이 원래 의도라면 맞춰야 한다 — `needs-pm`
- **read-ttl.ts 는 ttl.go(ieum-pipeline `39d1dca` 기준)를 옮겨 적은 것이다.** 수신 측 규칙이 바뀌면 직접 따라 고쳐야 한다(ADR-0005). ADR-0005 PM 확인 필요
- `brick:hasPoint` 는 한 번도 들어가지 않는다. BIM 에 관제점이 없기 때문이다
- 요구사항의 "등록"(DT 에 올리기)은 이 repo 에 없다 — 파일 다운로드까지다(OE-INT-02 에 의존)
- rdflib·ifctester 검사는 파이썬 도구가 있을 때만 실행된다(없으면 건너뜀). 이 PC 는 rdflib 7.6·shapely 2.0
