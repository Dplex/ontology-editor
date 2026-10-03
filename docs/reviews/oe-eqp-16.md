OE-EQP-16 로봇 통과·연결 데이터 — 병원으로 확인, 겹친 방의 문 연결 수정

Closes #180
Branch: feature/OE-EQP-16-robot-data
Ticket: docs/prd/features/E12-EQP/OE-EQP-16.md
Review: docs/reviews/oe-eqp-16.md
PRD: prd-review — 요구사항이 바뀌면 다시 본다

## 구현한 것
구현은 이미 있었다. 통과 속성과 방-문-방은 `import.ts`·`geojson.ts`, 층 사이 연결은 `vertical.ts` 에 있다. 요구사항 줄마다 실제 BIM 으로 확인하는 테스트가
흩어져 있거나 없어서, **로봇 팀이 받는 GeoJSON 을 병원 건축으로 확인하는 테스트**를 추가했다.

확인하다가 하나를 고쳤다. **문 양쪽의 방을 좌표로 판정할 때 방이 겹친 위치면 목록의 첫 방을 골랐다.** 병원의 복도(1AC1)처럼 큰 방이 작은 방을 포함하는 곳에서
문이 복도로 연결됐다. 설비 소속(`locate`)과 같은 규칙인 "가장 작은 방" 으로 바꿨다(`element-geometry.ts` 의 `spacesBesideOpening`).
성수 건축은 공간 경계(IfcRelSpaceBoundary)가 0 이라 문-방 연결을 모두 이 좌표 판정으로 만든다.

| 요구사항·수용 기준 | 확인 테스트 | 결과 (병원 건축) |
|---|---|---|
| **계단실·승강로 7개 중 6개 연결** | `check:sample` "로봇 데이터: … (병원 건축)"(새로 넣음) | 7개 중 6개. 남은 하나는 1층 승강로 E1 이다 — BIM 의 2층에 승강로 공간이 없다 |
| 층간은 바닥 절반 겹침 | `vertical.test.ts` "층 사이 연결" | 같은 종류 + 작은 쪽 넓이의 절반 넘게 겹칠 때만 |
| 층간 `verticalConnects` 를 GeoJSON 에 | `check:sample` 위 테스트 · `vertical.test.ts` | 계단실 feature 6개에 있다 |
| 문 통과 가능 / 창·벽 불가 | `check:sample` 위 테스트 | 문 249 `passable: true` · 창 58 · 벽 1,080 `false` |
| 방-문-방 `connects` | `check:sample` 위 테스트 | 공간 경계에 있는 236개는 `bim`, 나머지 13개는 `calc` |
| 공간 경계가 없으면 문 위치로 좌표 판정 | `check:sample` "문 양쪽을 좌표로 짚은 방이 공간 경계와 맞는다"(병원 추가) | 공간 경계를 정답으로 **214/236**(전 210) · AC20 5/5 · Duplex 13/14 그대로 |
| — 겹친 방에서 가장 작은 방 | `element-geometry.test.ts` "방이 겹친 자리면 가장 작은 방을 짚는다"(새로 넣음) | 목록 순서와 무관하다 |

좌표로 판정한 13개 중 11개는 방이 하나다. 커튼월 문 3개는 바깥문이고, 화장실 칸막이 문 8개는 양쪽이 같은 화장실이다. 2개는 방을 찾지 못한다.

판정 거리(문 두께 밖 0.3m)를 0.5m 로 늘리면 214 가 220 이 된다. 하지만 엉뚱한 방이 1 에서 3 으로 늘어서 적용하지 않았다. 틀린 연결이 빠진 연결보다 나쁘기 때문이다.

저장 위치: GeoJSON 의 문-방(`connects`)·층 사이(`verticalConnects`)는 export 할 때마다 계산한다. 화면에서 방 경계를 고치면 다음 export 에 바로 반영된다.
TTL 에는 들어가지 않는다.

## 화면
뷰어(`viewer.html`)에 병원 건축 GeoJSON 을 놓고 선택한 화면. 계단실 1CS3 은 2층 계단실과 `verticalConnects` 로 이어진다.
![계단실](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/blob/feature/OE-EQP-16-robot-data/docs/figures/oe-eqp-16-stair.png?raw=true)

공간 경계가 없는 커튼월 문. `passable: true`, 문 위치로 판정한 방 하나(`connectsSource: calc`).
![커튼월 문](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/blob/feature/OE-EQP-16-robot-data/docs/figures/oe-eqp-16-door.png?raw=true)

## 확인 방법
1. 8087 검토 서버(또는 `npm run dev`)의 파일 여는 칸에서 **[문·창 자리(형상)]** 를 켠다. 기본은 꺼져 있다 — 온톨로지에는 필요 없고 로봇 경로용이다
2. `data/NBU_MedicalClinic/NBU_MedicalClinic_Arch.ifc` 를 열고 GeoJSON 으로 export 한다
3. `viewer.html` 에 층 파일 4개를 놓는다. First_Floor 에서 계단실 1CS3 을 누르면 `verticalConnects` 가 있고, 승강로 E1 에는 없다
4. 커튼월 문(M_Curtain Wall Dbl Glass)을 누르면 `passable: true` · `connects` 방 하나 · `connectsSource: calc`

## 테스트
- `npm test` — 40 files · 640 passed(새로 넣은 것: `element-geometry.test.ts` "방이 겹친 자리면 가장 작은 방을 짚는다")
- `npx vue-tsc --noEmit` 통과
- `npm run check:sample` — 60 passed. 새로 넣은 것은 "로봇 데이터: 통과 속성 · 방-문-방 · 층 사이 연결이 GeoJSON 에 있다 (병원 건축)" 이고,
  "문 양쪽을 좌표로 짚은 방이 공간 경계와 맞는다" 에 병원 214/236 을 추가했다. 실패 1개("벽마다 다섯 걸음 …")는 이 작업 전부터 실패하던 테스트다
- e2e — 화면 코드는 고치지 않았다. 문 판정이 편집(방 경계 수정 뒤 `relinkDoors`)에도 쓰여서 전체를 돌렸다: 103 passed

## 남은 것
- 성수는 이 PC 에 없어 측정하지 못했다. 공간 경계가 0 이라 문 전부가 좌표 판정이다 — 병원에서 개선된 만큼 성수도 개선될 것으로 보지만 숫자는 성수 PC 에서 측정한다
- 병원에서 한쪽 방만 찾는 문이 20개 남았다(정답 236 중). 거리를 늘리면 그중 일부는 맞지만 엉뚱한 방도 늘어서 그대로 뒀다.
  개별 원인은 확인하지 않았다
- OE-ROB-04(로봇 팀에 미리 전달)의 "로봇 팀 포맷 확인" 은 이 repo 밖의 일이다. 전달할 것은 위 GeoJSON 이다
