OE-BIM-02 층 생성 — 층고를 BIM 값과 Elevation 차이로 구분, 없으면 "모름"

Closes #87
Branch: feature/OE-BIM-02-storey-height
Ticket: docs/prd/features/E05-BIM/OE-BIM-02.md
Review: docs/reviews/oe-bim-02.md
PRD: prd-review — 요구사항이 바뀌면 다시 본다

## 구현한 것
층(IfcBuildingStorey → 이름·바닥 높이)은 이미 있었다. 빠진 것은 층고였다. 요구사항은 "층고는 Elevation 의 차로 계산하고, 층 높이
속성(GrossHeight·NetHeight, COBie Storey Height)이 있으면 함께 읽는다. 값이 없으면 지어내지 않는다" 이고, 용어집(`docs/prd/glossary.md`
"층고")의 방향은 "BIM 에 있으면 그 값을 따르고 출처를 표시한다" 다.

| 요구사항 | 구현 | 확인 테스트 |
|---|---|---|
| 층 높이 속성을 읽는다 | 임포터가 층마다 BaseQuantities 의 `GrossHeight`·`NetHeight`(IfcElementQuantity)와 COBie `Storey Height` 속성(설명이 "Floor Height" 라 gross)을 읽어 `Storey.declaredHeight` 에 둔다. **0 이하는 값이 없는 것으로 본다** | `check:sample` "층고 (OE-BIM-02)" — AC20 두 층 BIM 값, Duplex COBie 네 층 0.0 → 읽지 않음 |
| Elevation 의 차로 계산 | `storey-height.ts`. 윗층 = 바닥 높이가 이 층보다 높은 층 중 가장 낮은 층(같은 높이 층이 둘이면 건너뛴다). 계산 값은 모델에 저장하지 않고 필요할 때 계산한다 | `storey-height.test.ts` 6개 |
| 함께 — 어느 값을 쓰나 | BIM 값이 있으면 그 값(출처 BIM), 없으면 계산 값(출처 계산). 둘 다 있고 1cm 넘게 다르면 계산 값을 옆에 경고색으로 표시한다 | 같은 테스트 |
| 지어내지 않는다 | 맨 위층이고 BIM 에 값이 없으면 "모름" | 보유 샘플 BIM 4개의 맨 위층(Roof·Dak) 모두 모름, AC20 다락만 BIM 2.0m |
| 합치기 | 기준 파일 값을 쓰고, 기준 파일에 없을 때만 덧붙인 파일 값을 가져온다(`merge.ts`) | 병원 건축+HVAC 합쳐도 같다 · ifc4Mep+AC20 에서 AC20 값이 들어온다 |

표시 위치: 파일 요약의 **층별 요약** 표에 "층고" 칸. 값에 마우스를 올리면 읽은 속성(`BaseQuantities.GrossHeight`)·계산 값·순 높이가 뜬다.

보유 샘플 BIM 측정:

| 파일 | 층고 |
|---|---|
| AC20 | Erdgeschoss 2.7 BIM(순 2.7, 계산 2.7 과 같다) · Dachgeschoss 2.0 BIM(순 2.0, 윗층이 없어 계산 못 함) |
| Duplex 건축 | T/FDN 1.25 · Level 1 3.1 · Level 2 2.9 계산 · Roof 모름 |
| Duplex COBie(Design·Programming) | Storey Height 0.0 → 읽지 않음. 계산 0.0013·0.0031·0.0029m — 길이 단위를 mm 로 잘못 선언한 파일이다(ADR-0007). 0.00 으로 반올림하지 않고 유효 숫자로 표시한다 |
| 병원 건축(합쳐도 같다) | TOF Footing 1.0 · First 4.57 · Second 4.68 계산 · Roof - Main 모름 |
| ifc4Mep | 0.8 · 3.5 · 3.5 · 3.5 계산 · 03. Dak 모름 |

COBie ProductSelect·ProductInstall·Handover 파일은 STEP 구문 오류로 열리지 않아 확인하지 못했다(기존 `UnreadableIfcError`).

저장 위치: 화면에만 있다. **export 하지 않는다** — TTL 은 층의 `ex:elevation` 만, GeoJSON 은 feature 마다 `elevation` 만 그대로다.
계산 값은 수신 측이 바닥 높이로 똑같이 계산할 수 있고, BIM 값을 export 할지·어느 predicate(관계·값을 나타내는 이름) 로 할지는 수신 측과 정할 일이라 이번에 넣지 않았다(남은 것).
`check:sample` 의 TTL·GeoJSON 비교가 전부 그대로 통과한다.

## 화면
AC20. 두 층 모두 BIM 에 있는 층고다. 다락은 윗층이 없어 계산할 수 없지만 BIM 값이 있다.
![AC20](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/blob/feature/OE-BIM-02-storey-height/docs/figures/oe-bim-02-ac20.png?raw=true)

Duplex COBie(Design). Storey Height 0.0 은 읽지 않으므로 계산 값이고, 단위 선언이 틀려 mm 단위 값으로 보인다. 맨 위 Roof 는 모름.
![COBie](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/blob/feature/OE-BIM-02-storey-height/docs/figures/oe-bim-02-cobie.png?raw=true)

## 확인 방법
1. 8087 검토 서버(또는 `npm run dev`)에서 `data/AC20-FZK-Haus.ifc` 를 연다 → 층별 요약의 층고가 2.70 m BIM · 2.00 m BIM
2. 2.70 에 마우스를 올린다 → "BIM BaseQuantities.GrossHeight / 계산(윗층 바닥과의 차) 2.70 m / 순 높이(BIM, …) 2.70 m"
3. `data/NBU_MedicalClinic/NBU_MedicalClinic_Arch.ifc` → 1.00 · 4.57 · 4.68 계산, Roof - Main 은 모름

## 테스트
- `npm test` — 41 files · 653 passed(새로 넣은 것: `storey-height.test.ts` 6)
- `npx vue-tsc --noEmit` 통과
- e2e — 109 passed(새로 넣은 것: `info.spec.ts` "층별 요약에 층고를 …". AC20 이 없으면 fixture 만 확인한다)
- `npm run check:sample` — 71 passed · 0 failed(새로 넣은 것: "층고 (OE-BIM-02)")
- mutation test — 이 커밋이 넣은 규칙을 하나씩 꺼 보고 테스트가 깨지는지 확인했다. 10곳 중 5곳을 잡았고, 나머지를 잡으려고 추가한 것: `storey-height-read.test.ts` 3개(밀리미터 파일의 단위 환산, COBie Storey Height, 합칠 때 기준 파일 우선 — 보유 샘플 BIM 에 값이 없어 millimetre.ifc 에 넣어 확인한다), e2e `info.spec.ts` 층고 테스트에 두 단계(새 fixture `storey-height.ifc` 로 BIM 3.2m·계산 3.0m 어긋남 표시, Duplex COBie 의 0.0031 m)

## 남은 것
- 층고를 TTL·GeoJSON 에 export 할지 PM·수신 측에 확인 필요. export 한다면 BIM 값만인지 계산 값도인지, predicate 이름(`ex:storeyHeight`?)과 출처 표시를 정해야 한다. export 하면 `read-export.ts` 의 `NUMERIC_OK` 에 추가해야 한다(OE-INT-02)
- 층고를 사람이 입력하는 칸은 없다. 용어집은 층고·천장고·방 높이를 "BIM 에 없으면 사용자가 설정한다" 고 정했지만, 이 티켓 요구사항에는
  입력이 없고 설정 단위(사이트·층·물리존)가 Q7 로 열려 있어 넣지 않았다. 지금 사람 입력이 필요한 곳은 맨 위층(모름)뿐이다
- 성수는 이 PC 에 없어 측정하지 못했다
