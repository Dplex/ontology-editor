OE-INT-08 ttl.go 호환 — 따옴표 든 실제 BIM 이름으로 확인

Closes #269
Branch: feature/OE-INT-08-verify
Ticket: docs/prd/features/E20-INT/OE-INT-08.md
Review: docs/reviews/oe-int-08.md
PRD: prd-review — 요구사항이 바뀌면 다시 본다

## 구현한 것
구현은 이미 있었다 — export(`ttl.ts`)가 ttl.go 가 읽는 형식으로 쓰고, 수신 측 규칙을 옮긴 reader(`read-ttl.ts`, ADR-0005)로 다시 읽어 확인한다.
대부분은 OE-GEN-10(DT 파서 호환) 검증 때 확인한 테스트와 같다. 빠져 있던 것 하나를 채웠다: **따옴표(`"`) 이스케이프는 직접 만든 fixture 로만 확인하고 있었다.**
병원 건축의 샤워 의자 3대는 Revit 패밀리 이름에 인치 표시(`"`)가 들어 있다(`M_ADA shower Seat:17" Depth x 18 1/2" Width:…`). 이 실제 이름이
수신 측 규칙으로 같은 문자열로 돌아오는지 확인한다.

| 요구사항 | 확인 테스트 | 결과 |
|---|---|---|
| `$` 이스케이프 | `export.test.ts` "IFC GUID 의 $ 를 이스케이프한다" · `read-export.test.ts` "$ 든 GUID 와 따옴표·역슬래시·줄바꿈 든 이름 …" · `check:sample` "우리가 짓는 id 와 GUID($ 가 든 것까지) …"(Duplex MEP) | 통과 |
| `"` 이스케이프 | 위 `read-export.test.ts` · `check:sample` "이름에 따옴표가 든 실제 설비가 받는 쪽에 같은 이름으로 읽힌다 (병원 건축)"(새로 넣음) | 3대 모두 같은 이름 |
| 블록 구조 | `read-export.test.ts` "주어 블록 밖에 따로 적은 feeds 는 읽히지 않는다 …" · `export.test.ts` "목적어 없는 hasPart 를 쓰지 않는다 …" | 통과 |
| fso 비엔티티 처리 | `read-export.test.ts` "덕트·배관(fso:)은 주어로 읽지 않고 따로 센다" · `check:sample` "기기의 소속은 다 읽고, 덕트·배관은 일부러 읽히지 않는다" · OE-BIM-08 테스트(ifc4Mep·병원 HVAC 의 도관 전부 fso, 엔티티로 읽히는 것 0) | 통과 |
| 매 빌드 check:sample 로 실제 읽기 확인 | **아니다.** 빌드마다 도는 것은 `npm test`(fixture 를 수신 측 규칙으로 읽는 단위 테스트)다. 실제 BIM 으로 다시 읽는 `check:sample` 은 사람이 돌린다 | 남은 것 |

저장 위치: TTL 의 `rdfs:label "…17\" Depth…"` — 따옴표 앞에 역슬래시가 붙는다. 수신 측은 그것을 풀어 원래 이름으로 읽는다.

## 화면
export 한 파일 뷰어에 병원 건축의 TTL·GeoJSON 을 놓고 샤워 의자를 선택한 것. 제목은 TTL 에서 읽은 이름이고 GeoJSON 이름과 같다. 원문에는 `\"` 로
이스케이프돼 있다(한글 글꼴에서는 역슬래시가 ₩ 로 보인다).
![따옴표 든 이름](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/blob/feature/OE-INT-08-verify/docs/figures/oe-int-08-quote.png?raw=true)

## 확인 방법
1. 8087 검토 서버(또는 `npm run dev`)에서 `data/NBU_MedicalClinic/NBU_MedicalClinic_Arch.ifc` 를 열고 TTL·GeoJSON 으로 export 한다
2. `viewer.html` 에 TTL 과 층 파일을 같이 놓고 First_Floor 의 TOILET 에 있는 샤워 의자(M_ADA shower Seat …:443686)를 누른다
3. 제목·GeoJSON name 이 `17" Depth x 18 1/2" Width` 를 그대로 담고, 원문 `rdfs:label` 은 따옴표마다 역슬래시가 붙어 있다

## 테스트
- `npm run check:sample -t "따옴표가 든 실제 설비"` — 1 passed(새로 넣음)
- 코드를 고치지 않아 단위·e2e 는 바뀌지 않는다

## 남은 것
- **"매 빌드 check:sample" 은 아니다.** check:sample 은 `data/`(저장소 밖)의 실제 BIM 이 있어야 하고 30분 넘게 걸린다. 빌드에 넣으려면 8087 검토 서버
  빌드(`scripts/review55.sh`)에서 수신 측 읽기 묶음만 골라 돌리는 방법이 있다(55 에는 `data/` 가 있다). 이 PC 에서 55 에 닿지 않아 넣지 않았다 — 할지 정해 달라(needs-dev)
- 성수 건축+기계(2026-10-06 성수 PC, 임시 probe): 이름에 따옴표·역슬래시가 든 설비 1대가 같은 이름으로 읽힌다. id 5,419개 중 `$` 가 든 GUID 1,018개를 포함해 전부 TTL 주어 키와 같고, 계통 1,037개도 다 있다
