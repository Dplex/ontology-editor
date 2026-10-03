OE-EQP-10 VAV·토출구 디테일 — 계통 없는 것 경고, 담당 공조기 표시

Closes #174
Branch: feature/OE-EQP-10-vav-system
Ticket: docs/prd/features/E12-EQP/OE-EQP-10.md
Review: docs/reviews/oe-eqp-10.md
PRD: prd-review — 요구사항이 바뀌면 다시 본다

## 구현한 것
VAV 와 실내 말단(디퓨저·그릴)은 계통이 있어야 한다. 계통이 없으면 TTL 에서 어느 계통의 구성원(`brick:hasPart`)으로도 들어가지 않아,
DT 가 "이 급기 계통의 토출구" 를 조회할 때 빠진다. 외부 루버는 방이 아니라 바깥과 통하는 설비라 제외했다.

| 요구사항·수용 기준 | 구현 | 확인 테스트 |
|---|---|---|
| **계통 없는 VAV 경고** | 선택한 설비 패널에 경고를 띄운다(보기·편집 모드 모두). 검토 화면에 "계통 없는 VAV·토출구" 목록을 두고, 누르면 그 설비로 이동한다 | e2e `edit-system.spec.ts` "계통 없는 토출구는 패널과 검토 화면에 경고하고 …"(새로 넣음) |
| 소속 계통 필수 | 계통이 있어야 하는 설비 = VAV + 실내 말단(`served.ts` 의 `needsSystem`) | `served.test.ts` "VAV 와 실내 말단만 계통이 있어야 한다 …"(새로 넣음) |
| 담당 판정 근거 | 패널에 **담당** 줄을 추가했다. 흐름을 거슬러 올라가 닿는 공조기(급기 ←)와 흐름을 따라 닿는 공조기(환기 →)를 보여 준다. VAV 면 하류로 공기를 나눠 주는 말단 수와 방 수도 보여 준다(`airBasis`). 공조기 쪽에서 보던 "담당 공간" 을 말단 쪽에서 본 것이라 같은 흐름 방향을 쓴다 | `served.test.ts` "담당 근거: …"(새로 넣음) |
| — 실제 BIM | | `check:sample` 병원 건축+HVAC: VAV 115·말단 440 중 계통 없음 0, 말단 439/440·VAV 115/115 가 공조기와 연결되고 VAV 115 모두 하류 말단을 찾는다 · ifc4Mep: 계통 없는 그릴 5개(새로 넣음) |

저장 위치: 경고와 담당 줄은 화면에만 있다. 계통을 고치면 TTL 의 계통 블록 `brick:hasPart` 가 바뀐다(OE-PIP-02 와 같은 방식). 담당 근거는
추정(흐름 방향)이라 export 하지 않는다 — 확정된 방향으로 연결된 급기 말단의 방만 공조기의 `brick:feeds` 로 들어간다(기존 동작).

BIM 을 연 상태로는 경고가 거의 뜨지 않는다. 병원은 Revit 의 System Name 에 VAV·말단의 계통이 모두 있다. 경고가 실제로 뜨는 것은 편집 뒤다 —
VAV 를 새로 추가하거나, 계통을 지우거나, 계통을 "없음" 으로 바꿀 때.

## 화면
병원 건축+HVAC 의 VAV. 계통이 있고, 담당은 공조기에서 오는 급기이며 말단 4개·방 4곳에 공기를 나눠 준다.
![담당 근거](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/blob/feature/OE-EQP-10-vav-system/docs/figures/oe-eqp-10-basis.png?raw=true)

편집 모드에서 계통을 "없음" 으로 바꾸면 경고가 뜬다.
![경고](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/blob/feature/OE-EQP-10-vav-system/docs/figures/oe-eqp-10-warning.png?raw=true)

검토 화면의 목록.
![목록](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/blob/feature/OE-EQP-10-vav-system/docs/figures/oe-eqp-10-list.png?raw=true)

## 확인 방법
1. 8087 검토 서버(또는 `npm run dev`)에서 `data/NBU_MedicalClinic/NBU_MedicalClinic_Arch.ifc` 와 `…_Eng-HVAC.ifc` 를 같이 연다
2. 검색 칸에 `VAV` 를 입력하고 첫 VAV 를 선택한다 → 패널의 **담당** 줄이 "급기 ← M_Air Handling Unit … · 말단 4개 · 방 4곳" 이다
3. [편집] → 계통 칸을 "(계통 없음)" 으로 → 패널에 "VAV에 계통이 없습니다 …" 경고, 리포트 위에 "계통 없는 VAV·토출구 1대"
4. Ctrl+Z → 경고와 목록이 사라진다
5. `data/ifc4Mep_IFC4.ifc` 를 열면 편집 없이도 "계통 없는 VAV·토출구 5대"(그릴)

## 테스트
- `npm test` — 40 files · 643 passed(새로 넣은 것: `served.test.ts` 3)
- `npx vue-tsc --noEmit` 통과
- e2e — 104 passed(새로 넣은 것: `edit-system.spec.ts` 1)
- `npm run check:sample` — 61 passed · 1 failed(새로 넣은 것: ifc4Mep "계통 없는 VAV·토출구를 고른다", 병원 건축+HVAC 에 VAV·말단 숫자). 실패 1개("벽마다 다섯 걸음 …")는 이 작업 전부터 실패하던 테스트다

## 남은 것
- 경고만 한다. 계통 없는 VAV 를 export 에서 막지는 않는다 — 막을지는 생성 전 검증(OE-GEN-03)에서 정한다
- 담당 근거는 흐름 방향만 본다. 말단의 계통과 흐름으로 연결된 공조기의 계통이 다른 경우(계통 정보와 연결이 어긋난 BIM)는 따로 알리지 않는다
- 성수는 이 PC 에 없어 측정하지 못했다
