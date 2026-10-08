OE-BIM-17 요구사항 보고서 — 줄마다 고객사에 할 요청

Closes #102
Branch: feature/OE-BIM-17-asks
Ticket: docs/prd/features/E05-BIM/OE-BIM-17.md
Review: docs/reviews/oe-bim-17.md
PRD: prd-review — 요구사항이 바뀌면 다시 본다

## 구현한 것
요구사항 보고서(R0~R24 × 표준 자리 / 다른 자리 / 없음·일부 / 해당 없음·잴 수 없음)는 이미 있었다(`src/lib/requirements.ts`, 검토 화면의 "요구사항" 칸). 수용 기준 **"다른 위치는 '설정을 바꿔 달라' 문구"** 에 못 미친 곳이 둘 있어 고쳤다.

1. **요청이 줄에 없었다.** 표 아래 한 문단("내보내기 설정을 바꾸면 표준 자리로 옮길 수 있습니다")뿐이었고, 줄 설명은 R 마다 문체가 달라 무엇을 바꿔 달라는지 빠진 줄(R16·R24·R23)도 있었다. → 줄마다 `ask` 를 만들고 표에 **"고객사에 할 요청"** 칸을 추가했다.
   - 다른 자리: 항상 **"내보내기 설정을 바꿔 달라 — {무엇을}"**. {무엇을} 은 `EXPORT_SETTING` 표 — R10 IFC 버전을 IFC4로 · R13 IFC GUID를 요소 매개변수에 저장해 다음 export 에도 같은 GUID로 · R14 방 분류를 분류 관계(IfcClassificationReference)로 · R16 계통을 IfcSystem으로 · R21 용량 속성을 표준 Pset 이름으로 매핑 · R23 Proxy 대신 알맞은 클래스로(IfcExportAs) · R24 종류를 PredefinedType으로(IfcExportType)
   - 일부인데 다른 자리 항목이 섞이면 위 요청 뒤에 "나머지는 값을 넣어 달라…"
   - 없음·일부: "값을 넣어 달라"(권장이면 "…또는 우리가 보완한 값을 확인해 달라"), 고칠 것이 정해진 항목은 그 내용(R7 IfcMapConversion, R11 배치점)
   - 표준·해당 없음·잴 수 없음: 요청 없음(—)
2. **설정으로 고칠 수 없는 것을 다른 자리로 집계했다.** R11(배치점이 형상에서 떨어져 형상 중심을 쓴 설비)이다 — 패밀리 삽입점을 고쳐야 하는 일이라 "설정을 바꿔 달라" 고 하면 틀린 요청이 된다. → 표준에서 빼 **일부**로 집계하고, 숫자는 설명에 남겼다(ADR-0006, PM 확인 필요). R13(GUID 가 바뀌어 다른 key 로 찾은 요소)은 다른 자리로 둔다 — BIM→DT 문서(`docs/bim-to-dt-ontology.md`) 4.1 이 "GUID 유지 설정" 으로 적었고, 같은 Revit 으로 다시 export 한 Duplex MEP 에서 GUID 가 63% 바뀐 것은 export 설정 탓이라 설정으로 고칠 수 있다. 버전 비교 화면의 R13 요청은 "내보내기 설정을 바꿔 달라 — IFC GUID를 요소 매개변수에 저장해 …" 다.

BIM→DT 문서 4장의 보고서 설명에 요청 칸과 R11·R13 을 일부로 집계하는 이유를 한 문단 추가했다(BIM→DT 문서는 개발 문서라 PRD 가 아니다).

| 요구사항·수용 기준 | 확인 테스트 | 결과 |
|---|---|---|
| 4상태 | 기존 `src/lib/requirements.test.ts` 4개 | 통과 |
| **"다른 위치" 는 "설정을 바꿔 달라" 문구** | `requirements.test.ts` "다른 자리면 요청이 늘 '내보내기 설정을 바꿔 달라' 와 무엇을 바꿀지다" — 설정 표의 R 7개를 fixture 에서 하나씩 다른 자리로 만들어 요청을 확인한다(R13 은 버전 비교 결과를 넣어서) | 7/7 |
| (거꾸로) 다른 자리가 아니면 설정 요청이 없다 | 같은 파일 "다른 자리가 아닌 상태는 설정 요청을 하지 않는다…" | 통과 |
| 실제 BIM 에서 다른 자리인 줄은 전부 설정 요청 | `scripts/check-sample.test.ts` "보유 샘플 BIM 에서 다른 자리인 줄은 모두 설정 요청이다" — 8개 파일 | 다른 자리가 나온 R = 설정 표에서 버전 비교 항목(R13)을 뺀 6개 그대로(R10 6개 파일 · R14 5 · R16 4 · R21 3 · R24 3 · R23 1) |
| 버전 비교의 R13 | `src/lib/versions.test.ts` "요구사항 R13 이 …", `e2e/versions.spec.ts` | 다른 자리 4 · 2 / 6, 요청 "…IFC GUID를 요소 매개변수에 저장…" |

## 화면
Duplex MEP(Optimized)를 열고 "요구사항" 을 펼친 화면 — 오른쪽 "고객사에 할 요청" 칸. 다른 자리 항목이 있는 줄(R14·R10·R24·R16·R21)은 굵게 "내보내기 설정을 바꿔 달라 — …"
![요구사항 보고서의 요청](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/blob/feature/OE-BIM-17-asks/docs/figures/oe-bim-17-requests.png?raw=true)

## 확인 방법
1. 8087 검토 서버(또는 `npm run dev`)에서 `data/NBU_Duplex/NBU_Duplex-Apt_Eng-MEP-Optimized.ifc` 를 연다
2. 아래쪽 "요구사항" 칸을 펼친다 → 제목 옆 "권장 14개: 표준 1 · 다른 자리 2 · 없음·일부 6"
3. R14 방 분류: 다른 자리 0 · 22 / 22, 요청 "내보내기 설정을 바꿔 달라 — 방 분류를 분류 관계(IfcClassificationReference)로 — 지금은 Category Code 속성에만 있다"
4. R16 계통: 일부 0 · 811 / 926, 요청 "내보내기 설정을 바꿔 달라 — 계통을 IfcSystem으로 … 나머지는 값을 넣어 달라, 또는 우리가 보완한 값을 확인해 달라"
5. R11 설비 위치: 표준 141 / 141, 요청 없음(—)
6. 버전 비교에서 `src/lib/ifc/fixtures/mep.ifc` 를 연 뒤 `mep-v2.ifc` 를 비교하면 R13 이 "다른 자리 4 · 2 / 6", 요청 "내보내기 설정을 바꿔 달라 — IFC GUID를 요소 매개변수에 저장해 다음 내보내기에도 같은 GUID로"

## 테스트
- `npm test` — 38 files · 603 passed(새로 넣은 것: `requirements.test.ts` 2개, 고친 것: `versions.test.ts` "요구사항 R13 이…" 에 요청 확인)
- `npx vue-tsc --noEmit` 통과
- `npm run check:sample -t "다른 자리인 줄은"` — 1 passed
- e2e — `npx playwright test e2e/smoke.spec.ts e2e/versions.spec.ts` 19 passed(`versions.spec.ts` 에 R13 요청 확인을 추가함)
- mutation test — 이 커밋이 넣은 규칙을 하나씩 꺼 보고 테스트가 깨지는지 확인했다. 4곳 중 2곳을 잡았고, 나머지를 잡으려고 추가한 것: `requirements-ask.test.ts` 2개 — 일부는 다른 자리·일부는 없는 줄의 "나머지는 …", 형상 중심으로 옮긴 좌표를 다른 자리로 세지 않기(보유 fixture 에는 이런 줄이 없어 직접 만든다)

## 남은 것
- (확인 2026-10-06 성수 PC) 형상 중심으로 옮긴 277대는 기계가 아니라 **건축** 모델이다. 건축 R11 일부 1,162/1,439, 기계 R11 표준 3,472/3,472. 다른 자리인 줄(R10·R23, R24 의 일부)은 두 모델 모두 설정 요청이다
- 설정 이름(IfcExportAs·IfcExportType, IFC GUID 저장, 속성 매핑 파일)은 Revit 기준이다. 다른 저작 도구(ArchiCAD 등)로 export 하는 고객사에는 같은 기능의 다른 메뉴를 알려 줘야 한다 — 요청 문구를 도구별로 나눌지 `needs-pm`
- 화면의 숫자는 칸이 화면에 들어올 때 0 부터 올라가는 애니메이션(Roll)이 있다. 스샷은 "동작 줄이기" 설정으로 찍었다
