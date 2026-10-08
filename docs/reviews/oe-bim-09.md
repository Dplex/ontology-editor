OE-BIM-09 계통·포트 읽기 — 두 스키마 모두 연결 수 > 0 확인

Closes #94
Branch: feature/OE-BIM-09-verify
Ticket: docs/prd/features/E05-BIM/OE-BIM-09.md
Review: docs/reviews/oe-bim-09.md
PRD: prd-review — 요구사항이 바뀌면 다시 본다

## 구현한 것
구현은 이미 있었다(`src/lib/ifc/import.ts`). 수용 기준과 비교해 확인 테스트와 결과를 아래 표에 적었다(티켓 md 는 PM 담당이라 고치지 않는다). 새로 구현한 곳은 없다.

| 요구사항·수용 기준 | 확인 테스트(`scripts/check-sample.test.ts`) | 결과 |
|---|---|---|
| **두 스키마 모두 연결 수 > 0** — IFC4 IfcRelNests | "포트 연결 (ifc4Mep, IFC4)" | 1,995(방향 1,995) |
| — IFC2x3 IfcRelConnectsPortToElement + IfcRelConnectsPorts | "포트 연결 (Duplex HVAC, IFC2x3)" | 485(방향 190) |
| FlowDirection 읽기 | 같은 두 테스트 — SOURCE→SINK 는 방향, SOURCEANDSINK 는 방향 없는 연결 | 통과 |
| IfcSystem → 계통 | "실제 MEP BIM (ifc4Mep, IFC4)" › "설비와 계통을 기준값대로 읽는다" | 37 |
| IfcSystem 이 없으면 Revit System Name → 계통 | "Duplex MEP 판본 (포트 없음)" › "계통을 속성으로 세우고…" | IfcSystem 0 → 20 |

## 화면
IFC4(ifc4Mep) — 계통 37 · 연결 1,995 · 흐름 방향 1,995
![ifc4Mep 요약](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/blob/feature/OE-BIM-09-verify/docs/figures/oe-bim-09-ports-ifc4.png?raw=true)

IFC2x3(Duplex HVAC) — 계통 34 · 연결 485 · 흐름 방향 190
![Duplex HVAC 요약](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/blob/feature/OE-BIM-09-verify/docs/figures/oe-bim-09-ports-ifc2x3.png?raw=true)

## 확인 방법
1. 8087 검토 서버(또는 `npm run dev`)에서 `data/ifc4Mep_IFC4.ifc` 를 연다 → 3D 아래 요약에 계통 37 · 연결 1,995 · 흐름 방향 1,995(BIM)
2. `data/NBU_Duplex/NBU_Duplex-Apt_Eng-HVAC.ifc` 를 연다 → 계통 34 · 연결 485 · 흐름 방향 190(BIM)

## 테스트
- `npm run check:sample -t "포트 연결|설비와 계통을 기준값대로|Duplex MEP"` — 4 passed
- 코드를 고치지 않아 `npm test`·e2e 는 바뀌지 않는다

## 남은 것
- Duplex HVAC 연결 485 중 295 는 Revit 이 피팅·덕트 포트를 SOURCEANDSINK 로 export 해서 방향이 없다. 규칙으로 추정한 방향은 따로 표시한다(F16)
- 성수 기계(IFC2x3, 2026-10-06 성수 PC): 연결 19,515(방향 8,702) · 계통 1,037 — 두 스키마 모두 연결 수 > 0 은 성수에서도 맞다(`check:seongsu` "성수 기계" 기준값)
