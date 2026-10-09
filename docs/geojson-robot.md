# 로봇 경로가 읽는 GeoJSON 속성 (R1)

에디터가 내보내는 층별 GeoJSON 가운데 로봇 경로에 쓰는 속성을 정리했습니다. 통과 속성(OE-EQP-17), 방-문-방 연결, 층간 연결이 어느 Feature 의 어느 키에 있는지와 값의 뜻을 적었습니다(OE-ROB-04).
값은 지금 에디터가 내보내는 그대로이고, 아래 숫자는 가진 BIM 셋에서 잰 것입니다.

## 파일과 좌표

- **층마다 파일 하나입니다.** 이름은 `floor-<층 이름>.geojson` 입니다. 층 이름에서 글자·숫자·한글·`-` 가 아닌 것은 `_` 로 바꾸고, 이름이 겹치면 뒤의 층에 `-2`, `-3` 을 붙입니다.
- **좌표는 IFC 세계 좌표이고 단위는 m 입니다.** 위경도가 아닙니다. 점은 `[x, y, z]`, 다각형은 `[x, y]` 입니다. 다각형의 높이는 속성의 `elevation`(층 바닥 높이)으로 읽습니다.
- **id 는 BIM 의 GlobalId 입니다.** 사람이 에디터에서 만든 것은 에디터가 지은 id 입니다. 같은 id 가 Brick TTL 의 주어이기도 해서, GeoJSON 과 TTL 은 이 id 하나로 이어집니다.
- **형상이 없는 것도 Feature 로 남습니다.** 이때 `geometry` 는 `null` 입니다. 빼지 않는 이유는 "TTL 에는 있는데 지도에는 없는" 객체를 읽는 쪽이 알아보게 하려는 것입니다.

## 통과 속성 `passable`

로봇이 지나갈 수 있는지를 `passable` 하나로 적습니다. 막힌 곳을 고를 때 이 키 하나만 보면 됩니다.

| `kind` | `passable` | 형상 |
|---|---|---|
| `door` | `true` | 점(문 자리). 형상을 읽지 않았으면 `null` |
| `window` | `false` | 점(창 자리). 형상을 읽지 않았으면 `null` |
| `wall` | `false` | 다각형(벽 바닥 외곽선). 조각이 여럿이면 `MultiPolygon` |

- 벽은 내벽·외벽·내력벽 모두 `false` 입니다. 외벽 여부는 `external`(`true`·`false`·`null`)과 `externalSource`(`bim`·`calc`·`null`)에, 내력 여부는 `loadBearing`(`null` 은 모름)에 따로 있습니다.
- 문·창에는 `wallId`(걸린 벽의 id), `width`·`height`(m)가 있습니다.

## 방-문-방 연결 `connects`

문 Feature 의 `connects` 는 그 문이 잇는 물리존(`kind: "space"`) id 의 목록입니다. 같은 층 파일 안의 물리존을 가리킵니다.

- 보통 둘입니다. 하나면 문 한쪽에만 물리존이 있는 것(바깥으로 나가는 문 등)이고, 비어 있으면 잇는 물리존을 찾지 못한 것입니다.
- `connectsSource` 는 근거입니다.
  - `bim`: BIM 의 공간 경계(IfcRelSpaceBoundary)가 문과 물리존을 이었습니다
  - `calc`: 공간 경계가 없어, 문 자리 양쪽에 있는 물리존을 좌표로 찾았습니다
- 문 자리는 에디터의 "읽을 것 → 문·창 자리" 를 켜고 연 파일에만 있습니다. 끄고 열면 문 Feature 는 남지만 `geometry` 가 `null` 이고, 공간 경계가 없는 파일에서는 `connects` 가 비어 있습니다.

| | 문 | `connects` 2개 · 1개 · 0개 · 3개 | 근거 |
|---|---|---|---|
| Duplex 건축 | 14 | 9 · 4 · 0 · 1 | `bim` 14 |
| 병원 건축 | 249 | 222 · 21 · 2 · 4 | `bim` 236 · `calc` 13 |
| 성수 건축 | 528 | 270 · 224 · 34 · 0 | `calc` 528 |

문·창 자리를 켜고 연 결과입니다. 성수는 공간 경계가 없어 모두 `calc` 이고, 문 자리를 끄고 열면 두 물리존을 잇는 문이 0개입니다. 병원은 끄고 열어도 공간 경계로 222개가 두 물리존을 잇습니다.

## 층간 연결 `verticalConnects`

물리존의 `verticalConnects` 는 아래·위층에서 이어진 물리존 id 의 목록입니다. **다른 층 파일의 물리존을 가리킵니다.** 로봇 경로가 층을 옮기는 자리입니다. 근거는 두 가지이고, 출처를 `verticalConnectsSource` 에 적습니다.

- **계단이 말한 연결(`bim`)이 먼저입니다.** BIM 의 계단(IfcStair)이 시작 층에서 오르기 시작하는 자리(진입 지점)와 끝 층에 다다르는 자리(종료 지점)가 드는 두 물리존을 잇습니다. 계단실이 아닌 물리존이어도 잇습니다(거실의 나선 계단, 복도의 계단). 이렇게 이은 물리존은 아래의 겹침 추정에서 빠집니다.
- **계단이 없는 계단실·승강로는 바닥 겹침으로 추정합니다(`calc`).** 물리존 종류가 같아야 하고(계단실끼리, 승강로끼리), 층을 높이로 줄 세웠을 때 바로 위층에서 바닥 외곽선이 작은 쪽 넓이의 절반 넘게 겹쳐야 합니다. 정확히 절반은 후보가 아닙니다.
- **겹침 추정은 양쪽이 서로를 가장 많이 겹친 후보로 고를 때만 잇습니다.** 가장 많이 겹친 후보가 둘 이상(동률)이거나, 위층 물리존 하나를 아래층 물리존 둘이 고르면 잇지 않습니다. 틀린 층간 연결은 빠진 연결보다 경로를 더 크게 망치기 때문입니다.
- 종류를 모르는 물리존은 겹침으로 잇지 않습니다. 자리만 겹친다고 이으면 위층 복도가 아래층 로비와 이어지기 때문입니다.
- 이어진 것이 없으면 두 키 모두 없습니다.
- `verticalConnects` 는 구조로 이어졌다는 뜻이고, 로봇이 지나갈 수 있다는 뜻은 아닙니다. 계단실은 이어져 있어도 로봇이 지나가지 못합니다.

| | 물리존 | `verticalConnects` 가 있는 물리존 | 출처 |
|---|---|---|---|
| Duplex 건축 | 21 | 0 | 계단 2개의 종료 지점이 2층 물리존에 들지 않습니다(2층 복도에 외곽선이 없습니다) |
| 병원 건축 | 269 | 6 | 모두 `bim` |
| 성수 건축 | 508 | 28 | 모두 `bim` |

## 수직 관통 오브젝트 `kind: "vertical"`

계단은 물리존과 따로 수직 관통 오브젝트로 내보냅니다. **오브젝트 하나가 지나는 층마다 feature 하나**이고, id 는 `<오브젝트 id>@<층 id>` 입니다. 오브젝트 id 는 BIM 계단의 GlobalId 입니다.

| 속성 | 뜻 |
|---|---|
| `verticalKind` | 종류. 지금은 `stair` 뿐입니다 |
| `parentId` | 오브젝트 id. 같은 값의 feature 들이 오브젝트 하나입니다 |
| `source` | `bim`(BIM 계단에서 만듦) |
| `entry` | 오르기 시작하는 자리 `[x, y, z]`. 시작 층 feature 에만 있고, 나머지는 `null` 입니다 |
| `exit` | 다다르는 자리 `[x, y, z]`. 끝 층 feature 에만 있고, 나머지는 `null` 입니다 |
| `spaceIds` | `entry`·`exit` 가 드는 같은 층 물리존 id. 지점이 없는 사이 층은 빈 목록입니다 |
| `passable` | 늘 `false` 입니다. 계단은 로봇이 지나가지 못합니다 |
| `verticalConnects` | 같은 오브젝트의 바로 아래·위층 feature id. 출처는 `verticalConnectsSource` 입니다 |

- 형상은 그 층 높이 구간에 든 계단판·참의 평면 볼록 껍질(Polygon)입니다. 끝 층은 다다르는 자리뿐이라 `exit` 를 점(Point)으로 냅니다.
- 다른 층에 닿지 않는 계단(한 층 안의 몇 계단)은 내보내지 않습니다. 성수 건축은 계단 35개 중 32개가 오브젝트가 됩니다. 그중 2개는 사이 층(B5'F)을 지나 B4F 에 닿아, 사이 층 feature 에는 형상만 있습니다.
- TTL 에는 들어가지 않습니다.

## 아직 없는 것

- **엘리베이터·에스컬레이터·샤프트의 수직 관통 오브젝트**(OE-OBJ-14·OE-ML-02)는 아직 나가지 않습니다. 지금 엘리베이터·에스컬레이터는 설비 Feature(`kind: "equipment"`)일 뿐 `passable` 이 없습니다. 엘리베이터의 층별 통과 속성은 정차 층(OE-EQP-17)이 정해지면 냅니다.
- **층별 통과 상태와 사유**도 같은 이유로 아직 없습니다.

## 예시

병원 건축의 문 하나, 계단실 하나, 그 계단실에서 오르는 계단의 1층·2층 feature 입니다(좌표는 줄이고 숫자는 반올림했습니다).

```json
{"type": "Feature", "id": "1byTDaqS91rBnWJlv$nn_r", "geometry": {"type": "Point", "coordinates": [-49.01, …]},
 "properties": {"kind": "door", "name": "M_Single-Flush:0915 x 2134mm:0915 x 2134mm:221919",
  "storeyId": "3eM8WbY_59RR5TDWs3wwJP", "width": 0.915, "height": 2.134, "wallId": "3LbNSBzHHBSuzhUUvuwALs",
  "passable": true, "connects": ["0ztdC3L1HAzhbhMHypqc04", "0ztdC3L1HAzhbhMHypqc03"], "connectsSource": "bim"}}

{"type": "Feature", "id": "0ztdC3L1HAzhbhMHypqc0q", "geometry": {"type": "Polygon", "coordinates": [[…]]},
 "properties": {"kind": "space", "name": "1CS3", "longName": "STAIR", "storeyId": "3eM8WbY_59RR5TDWs3wwJP",
  "elevation": 0, "areaM2": 12.7547, "verticalConnects": ["0ClPCUC7jCQRnj1dhupMQK"], "verticalConnectsSource": "bim"}}

{"type": "Feature", "id": "0mxk1RW8H5mvX1dNnpRqIz@3eM8WbY_59RR5TDWs3wwJP", "geometry": {"type": "Polygon", "coordinates": [[…]]},
 "properties": {"kind": "vertical", "verticalKind": "stair", "parentId": "0mxk1RW8H5mvX1dNnpRqIz",
  "name": "Stair:Concrete Pan - 180mm Max Riser 280mm Tread:250693", "storeyId": "3eM8WbY_59RR5TDWs3wwJP", "elevation": 0,
  "source": "bim", "entry": [-36.334, 51.874, 0.111], "exit": null, "spaceIds": ["0ztdC3L1HAzhbhMHypqc0q"], "passable": false,
  "verticalConnects": ["0mxk1RW8H5mvX1dNnpRqIz@3eM8WbY_59RR5TDWs3wwJN"], "verticalConnectsSource": "bim"}}

{"type": "Feature", "id": "0mxk1RW8H5mvX1dNnpRqIz@3eM8WbY_59RR5TDWs3wwJN", "geometry": {"type": "Point", "coordinates": [-37.566, 51.299, 4.389]},
 "properties": {"kind": "vertical", "verticalKind": "stair", "parentId": "0mxk1RW8H5mvX1dNnpRqIz", …, "storeyId": "3eM8WbY_59RR5TDWs3wwJN",
  "elevation": 4.57, "source": "bim", "entry": null, "exit": [-37.566, 51.299, 4.389], "spaceIds": ["0ClPCUC7jCQRnj1dhupMQK"], "passable": false,
  "verticalConnects": ["0mxk1RW8H5mvX1dNnpRqIz@3eM8WbY_59RR5TDWs3wwJP"], "verticalConnectsSource": "bim"}}
```
