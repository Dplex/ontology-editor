// 그림: 에디터 모델의 한 객체가 GeoJSON(기하 형상)과 Brick TTL(의미·관계) 두 파일로 나뉘어 나가고, 같은 ID 핀 하나로 이어지는 커플러 모형이다.
export const ITEMS = [
  {
    id: "Space_B202",
    name: "1 · 침실 2 (물리존)",
    y: 24,
    kind: "brick:Room · Polygon",
    geo: '{ "type": "Feature", "id": "Space_B202",\n  "properties": { "kind": "space", "name": "침실 2" },\n  "geometry": { "type": "Polygon", "coordinates": [[[4.2,1.8], ...]] } }',
    ttl: 'ex:Space_B202 a brick:Room ;\n  rdfs:label "침실 2" ;\n  brick:isPartOf ex:Storey_Level_2 .',
    note: "공간명 '침실 2'는 TTL의 rdfs:label 과 GeoJSON properties에 적히고, 바닥 외곽선 좌표는 GeoJSON Polygon에만 적힙니다. 두 줄을 잇는 것은 공유 ID 'Space_B202' 하나입니다.",
  },
  {
    id: "Boiler_557516",
    name: "2 · 보일러 #557516 (설비)",
    y: 56,
    kind: "brick:Boiler · Point",
    geo: '{ "type": "Feature", "id": "Boiler_557516",\n  "properties": { "kind": "equipment", "spaceId": "Space_Utility" },\n  "geometry": { "type": "Point", "coordinates": [2.45, 3.80, 3.10] } }',
    ttl: 'ex:Boiler_557516 a brick:Boiler ;\n  brick:hasLocation ex:Space_Utility ;\n  brick:isPartOf ex:System_HotWater .',
    note: "설비의 배치 좌표 [x, y, z]는 층별 GeoJSON의 Point가 되고, 설비 종류(brick:Boiler)·소속(hasLocation)·계통 관계는 TTL에 적힙니다.",
  },
  {
    id: "Door_104",
    name: "3 · 문 D-104 (연결 개구부)",
    y: 88,
    kind: "连接 공간 · LineString",
    geo: '{ "type": "Feature", "id": "Door_104",\n  "properties": { "kind": "door", "connects": ["Space_B202", "Space_Hall"] },\n  "geometry": { "type": "LineString", "coordinates": [[4.2,3.1],[4.2,4.0]] } }',
    ttl: 'ex:Space_B202 brick:isConnectedTo ex:Space_Hall .\n# 문이 잇는 두 물리존의 인접 관계로 변환',
    note: "문과 창은 GeoJSON에서 폭과 위치를 가진 선분(LineString)이 되고, 맞닿은 두 물리존을 연결하는 공간 위상 근거가 됩니다.",
  },
];

export function readoutOf(it) {
  return `공유 ID [${it.id}] · ${it.kind} · GeoJSON ⇄ TTL 1:1 정합`;
}
