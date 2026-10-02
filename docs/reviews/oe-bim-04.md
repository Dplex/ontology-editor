OE-BIM-04 벽 생성 — 벽 위치·두께 GeoJSON 을 건축 BIM 전체로 확인

Closes #89
Branch: feature/OE-BIM-04-verify
Ticket: docs/prd/features/E05-BIM/OE-BIM-04.md
Review: docs/reviews/oe-bim-04.md
PRD: prd-review — 요구사항이 바뀌면 다시 본다

## 구현한 것
구현은 이미 있었다(`import.ts` IfcWall·재료층 두께, `element-geometry.ts` 형상 바닥면 → 평면 외곽선, `export/geojson.ts` 벽 feature). 수용 기준을 손으로 그린 벽으로만 확인하고 있어서, **보유한 실제 건축 BIM 전체로 확인 테스트를 추가했다**(`scripts/check-sample.test.ts` "벽이 위치·두께를 가진 GeoJSON 으로 나간다").

| 요구사항·수용 기준 | 확인 테스트 | 결과 |
|---|---|---|
| **벽 위치·두께 GeoJSON 출력** | `check:sample` "벽이 위치·두께를 가진 GeoJSON 으로 나간다"(새로 넣음) | AC20 13/13 · Duplex 57/57 · 병원 1,080/1,080 |
| IfcWall → 평면 외곽선(두께 포함) | `check:sample` "벽의 평면 외곽선과 문·창의 자리를 형상에서 읽는다" · `export.test.ts` 벽 feature | 통과 |
| 슬래브는 읽지 않음, 3D Map 은 물리존 바닥판 + 벽 | 임포터에는 IfcSlab 을 읽는 코드가 없다. GeoJSON 의 feature 종류는 space·equipment·wall·door·window(·공조존·커스텀존) | 해당 |

## 화면
Duplex 건축 Level 1 평면도 — 벽이 두께대로, 문 자리는 비워진 외곽선으로 그려진다
![Duplex 1층 평면도의 벽](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/blob/feature/OE-BIM-04-verify/docs/figures/oe-bim-04-walls-plan.png?raw=true)

## 확인 방법
1. 8087 검토 서버(또는 `npm run dev`)에서 `data/NBU_Duplex/NBU_Duplex-Apt_Arch.ifc` 를 연다
2. 층 `Level 1만` → [평면도] — 벽이 두께대로 그려진다
3. [GeoJSON] 을 export 하면 층마다 `"kind": "wall"` feature 가 Polygon(또는 MultiPolygon)과 `"thickness"` 를 갖는다(Level 1 은 21장)

## 테스트
- `npm run check:sample -t "벽이 위치·두께를 가진"` — 1 passed(새로 넣음)
- 코드를 고치지 않아 `npm test`·e2e 는 바뀌지 않는다

## 남은 것
- 벽 높이는 OE-OBJ-04(#46)가 GeoJSON `height` 로 추가한다
- 성수는 이 PC 에 없어 측정하지 못했다
