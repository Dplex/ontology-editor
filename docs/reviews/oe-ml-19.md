OE-ML-19 층간 연결 계산 — 편집이 다음 export 에 반영되는지 확인

Closes #255
Branch: feature/OE-ML-19-vertical-verify
Ticket: docs/prd/features/E18-ML/OE-ML-19.md
Review: docs/reviews/oe-ml-19.md
PRD: prd-review — 요구사항이 바뀌면 다시 본다

## 구현한 것
구현은 이미 있었다(`vertical.ts` 의 `verticalLinks`, `geojson.ts` 가 export 할 때 부른다). 수용 기준이 비어 있어 요구사항 줄마다 확인 테스트를 연결했고,
테스트가 없던 두 가지(모델에 저장하지 않는다 · 바로 위층만)를 추가했다. 병원 측정은 OE-EQP-16 과 같은 테스트다.

| 요구사항 | 확인 테스트 | 결과 |
|---|---|---|
| 계단실·승강로를 바로 위층의 **같은 종류** 방과 연결한다 | `vertical.test.ts` "바로 위층에서 절반 넘게 겹치는 같은 종류의 방과 잇는다" | 종류를 모르는 방(로비)은 자리가 겹쳐도 연결하지 않는다 |
| 바닥이 **절반 넘게** 겹치면 | 같은 테스트(3F 의 반만 걸친 계단실) · 아래 새 테스트(경계를 옮겨 절반 아래로) | 끊긴다 |
| **바로 위층**만 | `vertical.test.ts` "바로 위층만 본다 …"(새로 넣음) | 중간 층에 같은 통로가 없으면 두 층 위와 연결하지 않는다 |
| `verticalConnects` 를 GeoJSON 에 | `vertical.test.ts` "GeoJSON 의 계단실·승강로 feature 에 …" | 연결된 방에만 들어가고, 다른 방에는 이 key 가 없다 |
| **모델에 저장하지 않고 GeoJSON 출력 시 계산** | `vertical.test.ts` "모델에 저장하지 않고 내보낼 때 잰다 …"(새로 넣음) | 방 이름을 "계단실" 로 고치면(`renameSpace` → 사전이 종류를 정함) 다음 export 에서 연결되고, 경계를 옮기면(`replaceSpaceFootprint`) 끊긴다. 모델 JSON 에 `verticalConnects` 가 없다 |
| — 실제 BIM | `check:sample` "로봇 데이터: … (병원 건축)" · "병원 건축 + HVAC" | 계단실·승강로 7개 중 6개(계단 3쌍). 남은 1층 승강로 E1 은 BIM 의 2층에 승강로 공간이 없다 |

저장 위치: GeoJSON 의 계단실·승강로 feature `properties.verticalConnects`(위·아래층 방 id). TTL 에는 들어가지 않는다.
모델에도 저장하지 않으므로 편집 파일·되돌리기가 다룰 값이 없다 — 방 종류·경계가 바뀌면 다음 export 때 새로 계산한다.

## 화면
export 한 파일 뷰어에 병원 건축 GeoJSON 을 놓고 2층 계단실 2CS3 을 선택한 것. `verticalConnects` 가 1층 계단실 id 다.
![2층 계단실](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/blob/feature/OE-ML-19-vertical-verify/docs/figures/oe-ml-19-stair.png?raw=true)

## 확인 방법
1. 8087 검토 서버(또는 `npm run dev`)에서 `data/NBU_MedicalClinic/NBU_MedicalClinic_Arch.ifc` 를 열고 GeoJSON 으로 export 한다
2. `viewer.html` 에 층 파일 4개를 놓고 Second_Floor 의 2CS3 을 누른다 → `verticalConnects` 가 1층 계단실 1CS3 의 id
3. First_Floor 의 1CS3 을 누르면 반대로 2CS3 의 id. 승강로 E1 에는 `verticalConnects` 가 없다

## 테스트
- `npm test` — 40 files · 645 passed(새로 넣은 것: `vertical.test.ts` 2)
- `npx vue-tsc --noEmit` 통과
- 화면·임포터 코드를 고치지 않아 e2e·check:sample 은 바뀌지 않는다(병원 측정은 OE-EQP-16 커밋의 check:sample 테스트)

## 남은 것
- 성수 건축+기계(2026-10-06 성수 PC, 임시 probe): 계단실·승강로로 읽힌 방 32개(외곽선 있는 것 27) 중 **26개**가 위·아래층과 이어진다. 외곽선이 없는 5개는 겹침을 잴 수 없어 빠진다
- 층이 셋 이상 이어지는 수직 통로는 층마다 위·아래 한 쌍씩 잇는다(1F↔2F, 2F↔3F). 1F 에서 3F 를 바로 가리키지는 않는다 — 읽는 쪽이 차례로 따라가야 한다
