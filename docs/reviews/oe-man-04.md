OE-MAN-04 설비 수동 배치 — 미배치 설비를 다 놓고 저장·export 까지 유지

Closes #120
Branch: feature/OE-MAN-04-verify
Ticket: docs/prd/features/E07-MAN/OE-MAN-04.md
Review: docs/reviews/oe-man-04.md
PRD: prd-review — 요구사항이 바뀌면 다시 본다

## 구현한 것
구현은 이미 있었다. 좌표가 있는 설비는 BIM 위치에 배치되고(`import.ts`, 배치점이 형상 밖이면 형상 중심 — OE-BIM-12), 좌표가 없는 설비는
`position: null` 로 두고 검토 화면의 **[미배치 설비]** 목록과 패널의 [3D에서 놓기]로 사람이 배치한다(OE-BIM-07 에서 만든 목록). 배치 높이는
같은 패밀리 설비의 높이(없으면 층 바닥)이고, 배치하면 소속을 다시 판정한다.

OE-BIM-07 은 직접 만든 fixture 1대와 e2e 1대로 확인했다. **실제 BIM 의 미배치 설비를 전부 배치하고, 그 편집이 저장·불러오기·export 뒤에도 유지되는지** 는
확인하지 않았었다. 이 흐름을 ifc4Mep 28대로 확인하는 테스트를 추가했다.

| 요구사항 | 확인 테스트 | 결과 |
|---|---|---|
| 좌표 있는 설비만 자동 | `check:sample` "미배치 28대를 사람이 전부 놓으면 …"(새로 넣음) · "설비와 계통을 기준값대로 읽는다" · `import.test.ts` "좌표 없는 설비는 원점이 아니라 null 이다" | 좌표 있는 설비는 BIM 위치에 있다. 사람이 28대를 배치하는 동안 그 위치가 하나도 바뀌지 않는다 |
| 나머지 수동 배치 | 같은 새 테스트 · `edit.test.ts` "미배치 목록은 좌표 없는 설비와 그 층이고, 놓으면 빠지고 되돌리면 돌아온다" · e2e `info.spec.ts` "미배치 목록에서 바로 3D 바닥을 눌러 놓으면 목록에서 빠진다" | 28대를 배치하면 목록 0, 배치한 좌표의 출처는 `edited` |
| — 저장·불러오기 | 같은 새 테스트 | 편집 파일로 저장해 새로 연 모델에 불러와도 28대가 같은 위치, 목록 0 |
| — export | 같은 새 테스트 · `check:sample` "28대가 층과 함께 목록에 들고, TTL 에는 층까지만·GeoJSON 에는 형상 없이 나간다" | 배치 전 GeoJSON `geometry: null`, 배치 후 `Point` |

저장 위치: 배치한 좌표는 GeoJSON 설비 점과 편집 파일에 남고, 소속이 생기면 TTL `brick:hasLocation` 이 방을 가리킨다(방이 없는 ifc4Mep 은 층).
BIM 파일에는 쓰지 않는다.

## 화면
ifc4Mep 에서 미배치 목록의 [3D에서 놓기] 를 누르고 3D 바닥을 눌러 배치한 덕트 조각. 위치 칸에 출처 "편집", "바닥 높이에 놓았습니다" 안내.
![놓은 설비](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/blob/feature/OE-MAN-04-verify/docs/figures/oe-man-04-placed.png?raw=true)

목록이 28대 → 27대.
![미배치 목록](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/blob/feature/OE-MAN-04-verify/docs/figures/oe-man-04-list.png?raw=true)

## 확인 방법
1. 8087 검토 서버(또는 `npm run dev`)에서 `data/ifc4Mep_IFC4.ifc` 를 연다 → 요약 아래 [미배치 설비 28대]
2. 아무 줄이나 [3D에서 놓기] → 3D 바닥을 누른다 → 목록이 27대, 패널 위치 칸에 "편집"
3. [편집 저장] 으로 받은 파일을 새로 연 ifc4Mep 에 [편집 불러오기] 하면 그 설비가 같은 자리에 있고 목록이 27대

## 테스트
- `npm run check:sample -t "OE-MAN-04"` — 1 passed(새로 넣음)
- 코드를 고치지 않아 단위·e2e 는 바뀌지 않는다

## 남은 것
- 좌표의 출처(BIM 배치점 / 형상 중심 / 사람이 놓음)는 화면 칩과 편집 파일에만 있고 **GeoJSON 에는 없다.** 수신 측이 사람이 배치한 설비를 구분하려면
  `positionSource` 를 export 해야 한다 — ADR-0008 은 관계(소속·문)의 출처만 정했다. export 할지는 PM 결정(needs-pm)
- 배치 높이는 화면 코드가 같은 패밀리의 중앙값으로 정한다(`App.vue` 의 `placeAt`). lib 에 없어 단위 테스트가 없다
- 성수(2026-10-06 성수 PC): 좌표 없는 설비가 0 이라 손으로 놓을 것이 없다 — 수동 배치는 ifc4Mep 으로만 잰다
