OE-EXT-01 외벽 판정 — IsExternal 없는 벽을 건물 바깥에 닿는지로 판정

Closes #232
Branch: feature/OE-EXT-01-external-wall
Ticket: docs/prd/features/E17-EXT/OE-EXT-01.md
Review: docs/reviews/oe-ext-01.md
PRD: prd-review — 요구사항이 바뀌면 다시 본다

**ADR-0002 PM 확인 필요** — 외곽선 접촉을 어떻게 판정할지(격자 채움, 임계값 30%·0.3m)는 PRD 에 없어서 개발이 정했다(상태 `제안`).

## 구현한 것
- 외벽 여부가 BIM 에 있으면(`Pset_WallCommon.IsExternal`, #300 이 읽는다) 그대로 쓰고, 없으면 **건물 바깥에 닿는지로 계산**한다(`src/lib/exterior.ts`).
  - 층 평면을 0.1m 격자로 칠하고(벽 바닥 외곽선의 convex hull + 방 바닥), 테두리에서 flood fill 로 채운 칸을 바깥으로 본다. 벽 **옆면** 길이의 30% 넘게 바깥에 닿으면 외벽이다.
  - ray casting 을 쓰지 않는 이유: ㄷ자 건물의 안쪽 외벽은 바깥으로 쏜 광선이 맞은편 날개에 막혀 내벽으로 판정된다. flood fill 은 돌아 들어간다.
  - 벽 끝이 닿은 것은 세지 않는다 — 양 끝이 외벽에 붙은 내벽은 끝부분이 외벽 너머 바깥에 닿기 때문이다(직접 그린 테스트로 발견).
  - 벽 바닥 외곽선의 문 자리는 convex hull 이 메우고, 방과 벽 사이 몇 cm 틈은 한 칸 팽창(dilate)시켜 보완한다.
  - 바닥 외곽선이 없는 벽은 계산하지 못해 "모름" 으로 둔다(값을 지어내지 않는다).
- **모델에 저장하지 않고 쓸 때 계산한다**(`vertical.ts` 와 같은 방식). 벽을 옮기거나 그리고 지우면 다음 판정에 바로 반영되어 오래된 값이 남지 않고, 편집 파일·되돌리기와도 엮이지 않는다.
- 저장 위치
  - 화면: 3D 에서 벽·문·창을 선택하면 패널에 `외벽`/`내벽` 과 출처 칩(BIM·계산). 문·창의 "외벽에 뚫림" 도 같은 판정을 쓴다.
  - GeoJSON: 벽 feature 의 `external` 에 계산 값까지 채워지고, `externalSource`(`bim`·`calc`·null)가 새로 추가된다.
  - TTL: 바뀌지 않는다(벽은 GeoJSON 에만 있다).
- 수용 기준 "외벽 표시" — 패널과 GeoJSON 에 표시한다. IsExternal 이 없는 ArchiCAD 파일(AC20)에서도 외벽으로 표시된다.

## 화면
![AC20 1층 외벽을 선택하면 외벽 · 계산](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/blob/feature/OE-EXT-01-external-wall/docs/figures/oe-ext-01-external-calc.png?raw=true)

## 확인 방법
1. `npm run dev` 에서 `data/AC20-FZK-Haus.ifc` 를 연다(`npm run fetch:sample`). ArchiCAD 파일이라 벽 13장 모두 IsExternal 이 없다
2. [편집] → 왼쪽 팔레트 [벽·문·창] → 3D 위 층 선택에서 `Erdgeschoss만`
3. 바깥 둘레 벽(`Wand-Ext-ERDG-2` 등)을 누르면 패널에 `외벽 [계산]`, 안쪽 벽(`Wand-Int-ERDG-1` 등)은 `내벽 [계산]`
4. Revit 파일(`data/NBU_Duplex/NBU_Duplex-Apt_Arch.ifc`)에서 같은 것을 하면 `외벽 [BIM]` — BIM 값이 우선한다
5. [벽 긋기] 로 건물 밖에 벽을 그리면 `외벽 [계산]`. [GeoJSON] 을 export 하면 그 벽에 `"external": true, "externalSource": "calc"`

## 테스트
- `npm test` — 35 files · 562 passed. 새로 넣은 것: `src/lib/exterior.test.ts` 6개
  - ㄷ자 안쪽 외벽 / 문 자리 옆·양 끝이 외벽에 붙은 내벽 / 방 없이 벽만 / BIM 값 우선 / 외곽선 없는 벽은 모름 / 편집으로 추가한 벽
  - `export.test.ts` 의 벽 feature 기댓값을 `external: true, externalSource: 'calc'` 로 고쳤다(IsExternal 없는 직접 그린 벽)
- `npx vue-tsc --noEmit` 통과
- `npm run check:sample` — 44 passed · 2 failed · 25 skipped(성수 등 없는 파일). 실패 2개는 **이 변경을 빼도 그대로 실패한다**(기존 PR 들을 합친 상태에서 이미 실패):
  "ttl.go 가 GUID 를 GeoJSON 과 같은 문자열로 읽는다"(90개 어긋남), "벽마다 다섯 걸음 나갔다 돌아오면…"(`moveWallWithSpaces` 가 null). 이 이슈 범위가 아니라 따로 본다
- `npm run check:sample` 의 새 검사 "외벽 판정을 BIM 의 IsExternal 에 대 본다": IsExternal 을 가리고 계산만으로 판정한 결과
  - AC20 13/13(이름이 정답) · Duplex 건축 50/57 · 병원 건축 1,020/1,080(94.1%)
  - 틀린 것: Duplex 는 세대 경계벽 4·기초벽 3 을 Revit 이 외벽으로 적었다. 병원은 에디터가 커튼월을 벽으로 읽지 않아 안쪽 칸막이가 바깥에 노출되고, 지붕층·2층에 건물 밖으로 그려진 공간이 바깥을 막는다
  - 끝에서 제외하는 길이는 0.2~0.7m 모두 1,070±1 장으로 같아 중간값(0.3m)을 골랐다. 벽만으로 바깥을 먼저 찾고 밖의 방을 빼는 2단계 방식도 시도했지만, 커튼월 빈자리 때문에 방까지 빠져 1,055 로 떨어져서 넣지 않았다
- e2e — `npx playwright test e2e/exterior.spec.ts` 1 passed(새로 그린 벽: 방 사이 내벽, 건물 밖 외벽, 출처 계산). `edit-elements`·`export`·`edit-structure` 12 passed
- mutation test — 이 커밋이 넣은 규칙을 하나씩 꺼 보고 테스트가 깨지는지 확인했다. 10곳 중 8곳을 잡았고, 외벽 기준(옆면이 바깥에 닿은 비율 30%)을 5%·70% 로 바꿔도 통과했다 — 보유 샘플 BIM 은 그 범위에서 결과가 같다. `exterior.test.ts` "벽 옆면이 바깥에 닿은 몫이 30% 를 넘어야 외벽이다"(별채가 반쯤·거의 다 가린 벽)를 추가했다

## 남은 것
- 커튼월(IfcCurtainWall)을 벽으로 읽지 않는다 — 병원 오판의 대부분. 외벽 자체인데 3D·GeoJSON 에도 없다. 읽을지는 따로 정한다
- 사방이 막힌 중정은 바깥과 이어지지 않아 그 둘레 벽이 내벽으로 판정된다(보유 파일에는 이런 경우가 없다)
- 3D 에서 외벽을 색으로 구분하지는 않았다. 벽 색은 지금 내력 여부(내력·모름·비내력)를 나타낸다
- 성수는 이 PC 에 없어 측정하지 못했다
