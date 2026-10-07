OE-PIP-09 계통 이름 규칙 — 편집 뒤에도 BIM 계통 이름 유지, 이름으로 합치기

Closes #190
Branch: feature/OE-PIP-09-system-names
Ticket: docs/prd/features/E13-PIP/OE-PIP-09.md
Review: docs/reviews/oe-pip-09.md
PRD: prd-review — 요구사항이 바뀌면 다시 본다

## 구현한 것
구현은 이미 있었다. 에디터에는 **계통 이름을 고치는 기능이 없었다** — 계통 편집은 설비의 계통 바꾸기·종류·유체·만들기·지우기뿐이다(OE-PIP-02).
Revit `System Name` 으로 만든 계통은 이름이 곧 id 라서, 합치기(`merge.ts`)가 같은 이름의 두 조각을 한 계통으로 합친다. 사람이 만든 계통은
만들 때 이름을 자유롭게 정하고, id 는 새로 만들어 BIM 계통과 섞이지 않는다.

"고치는 기능이 없다" 는 당시 코드에서만 참이다. 나중에 이름 고치기가 들어와도 문제가 생기면 바로 드러나도록, invariant 로 확인하는 테스트를 추가했다.

| 요구사항 | 확인 테스트 | 결과 |
|---|---|---|
| **BIM 계통 이름은 고치지 않음** | `edit-fuzz.test.ts` "어떤 편집을 섞어도 BIM 계통 이름은 그대로이고 …"(새로 넣음) — 편집 37종을 무작위로 25번씩, seed 200개. 편집한 모델과 편집 파일로 다시 불러온 모델 모두 | BIM 계통 이름이 한 번도 바뀌지 않는다 |
| 분야별 파일 합칠 때 이름으로 맞춤 | `merge.test.ts` "같은 이름에서 세운 계통은 두 조각을 하나로 합친다" · `check:sample` "Duplex HVAC + MEP — 같은 이름 15개가 한 계통이 되고 …"(새로 넣음) | 계통 34 + 20 → 39, 같은 이름 15개가 하나씩, 이름이 겹치는 계통 0 |
| 사람이 만든 계통만 이름 자유 | 위 fuzz 테스트 — 만든 계통은 BIM 계통 id 와 겹치지 않고 사람이 정한 이름이다 | 만든 계통이 섞인 경우 20번 넘게 확인 |

병원 HVAC + MEP 도 확인했다(테스트에는 넣지 않음 — MEP 가 207MB 라 느리다): 계통 15 + 16 → 23, 같은 이름 8개가 합쳐지고 이름 중복 0.
예: Mechanical Supply Air 1 은 996 + 1,707 → 2,703 구성원.

저장 위치: 계통 이름은 TTL 계통 블록의 `rdfs:label`, GeoJSON 설비의 `systemId`(이름에서 만든 id)다. BIM 이름이 바뀌지 않으므로 다음 버전을
덧붙여도 같은 계통으로 이어진다.

## 화면
Duplex HVAC 와 MEP 를 같이 연 계통 범례. 두 파일에 같은 이름으로 있던 계통이 한 줄로 합쳐져 있다(39개, 이름은 BIM 그대로).
![계통 범례](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/blob/feature/OE-PIP-09-system-names/docs/figures/oe-pip-09-legend.png?raw=true)

## 확인 방법
1. 8087 검토 서버(또는 `npm run dev`)에서 `data/NBU_Duplex/NBU_Duplex-Apt_Eng-HVAC.ifc` 와 `…_Eng-MEP-Optimized.ifc` 를 같이 연다
2. 계통 범례가 39개이고 같은 이름이 두 번 나오지 않는다
3. [편집] 에서 범례의 계통을 골라도 이름 칸은 없다(종류·유체만). 새 계통은 설비 패널의 [새 계통…] 에서 이름을 주고 만든다

## 테스트
- `npm test` — 40 files · 647 passed(새로 넣은 것: `edit-fuzz.test.ts` 1. fuzz 결과로 편집한 모델·다시 불러온 모델을 돌려주도록 `edit-fuzz.ts` 를 고쳤다 — 테스트 전용 파일)
- `npx vue-tsc --noEmit` 통과
- `npm run check:sample -t "OE-PIP-09"` — 1 passed(새로 넣음)

## 남은 것
- 사람이 만든 계통의 이름을 만든 뒤에 고치는 길은 없다. "이름 자유" 가 만든 뒤 고치기까지 뜻하면 따로 만든다(needs-pm)
- 사람이 BIM 계통과 같은 이름으로 계통을 만들 수 있다. 이름이 같아도 id 가 달라 합치기에서 섞이지 않지만, 범례에 같은 이름이 두 개 보인다
