OE-BIM-05 문·창 생성 — 호스트 벽 없는 문·창을 R4 일부로 집계하는지 확인

Closes #90
Branch: feature/OE-BIM-05-verify
Ticket: docs/prd/features/E05-BIM/OE-BIM-05.md
Review: docs/reviews/oe-bim-05.md
PRD: prd-review — 요구사항이 바뀌면 다시 본다

## 구현한 것
구현은 이미 있었다(`import.ts` IfcDoor·IfcWindow + IfcRelVoidsElement·IfcRelFillsElement 로 호스트 벽, `requirements.ts` R4). 수용 기준의 확인 테스트가 "문·창이 없는 설비 파일" 하나뿐이어서, **호스트 벽을 모르는 문·창을 확인하는 테스트를 직접 만든 fixture 와 실제 BIM 에 추가했다.**

| 요구사항·수용 기준 | 확인 테스트 | 결과 |
|---|---|---|
| **호스트 벽 없는 문·창은 R4 일부로 집계** | `requirements.test.ts` "호스트 벽을 모르는 문·창은 R4 를 \"일부\" 로 만든다"(새로 넣음) | 모수에 남고 표준 수에서만 빠진다 |
| — 실제 BIM | `check:sample` "호스트 벽을 모르는 문·창은 R4 일부로 센다"(새로 넣음) | 병원 건축 302/307 일부 · AC20 16/16 · Duplex 38/38 |
| 문·창 위치 + 개구부 관계(어느 벽) | `check:sample` "벽의 평면 외곽선과 문·창의 자리를 형상에서 읽는다" | 통과 |

## 화면
병원 건축의 요구사항 보고서 — R4 문·창의 개구부 관계 "일부 302 / 307"
![병원 건축 R4](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/blob/feature/OE-BIM-05-verify/docs/figures/oe-bim-05-r4-hostless.png?raw=true)

## 확인 방법
1. 8087 검토 서버(또는 `npm run dev`)에서 `data/NBU_MedicalClinic/NBU_MedicalClinic_Arch.ifc` 를 연다
2. 3D 아래 [요구사항] 을 펼친다 → R4 "문·창의 개구부 관계" 가 **일부 302 / 307**
3. `data/NBU_Duplex/NBU_Duplex-Apt_Arch.ifc` 는 38 / 38 표준

## 테스트
- `npm test` — 37 files · 584 passed(새로 넣은 것: `requirements.test.ts` 1)
- `npm run check:sample -t "R4 일부로"` — 1 passed(새로 넣음)
- 화면 코드를 고치지 않아 e2e 는 바뀌지 않는다

## 남은 것
- 병원에서 호스트 벽을 모르는 5개가 어떤 문·창인지는 확인하지 않았다
- 성수는 이 PC 에 없어 측정하지 못했다
