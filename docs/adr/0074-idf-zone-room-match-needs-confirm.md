---
id: "ADR-0074"
title: "IDF 공조존의 든 방은 겹친 넓이로 계산한 초안이라 (존, 방) 짝마다 사람이 확인해야 TTL·GeoJSON 에 나가고, 설비↔존 담당은 확인 없이 나간다"
status: "제안"
date: "2026-10-20"
deciders: []
prd: ["D13"]
tickets: ["OE-IDF-05", "OE-ZON-07"]
criteria: ["OE-IDF-05#1", "OE-IDF-05#2"]
code: ["src/lib/idf/confirm.ts", "src/lib/idf/attach.ts", "src/lib/export/ttl.ts", "src/lib/export/geojson.ts", "src/editor/idf-zones.ts", "src/components/editor/IdfZonesFold.vue"]
tests: ["src/lib/idf/idf.test.ts", "src/lib/requirements-s.test.ts"]
related: ["ADR-0069"]
---

# ADR-0074 IDF 존↔물리존 매칭은 사람이 확인해야 나간다

## 맥락

IDF 공조존이 방 바닥의 절반 넘게를 덮으면 그 방을 존의 일부(`spaceIds`)로 둔다(ADR-0069). 이 값은 겹친 넓이로 **계산한 초안**인데,
확인 장치가 없어 TTL 의 `brick:hasPart` 와 GeoJSON 의 `spaceIds` 로 그대로 나갔다. 받는 쪽은 초안과 확정을 구별할 수 없다.

[D13](../prd/questions.md#L19)(2026-10-07 결정)은 존↔물리존 매칭(계산)은 사용자가 확인해야 반영하고, IDF 에 적힌 설비↔존 담당(명시)은
확인 없이 반영한다고 정했다. OE-IDF-05 수용 기준 1·2 가 이를 시험하도록 요구한다.

## 결정

- 확인은 (존, 방) 짝 단위로 `hvac.confirmed` 에 `존id|방id` 문자열로 둔다. 존 id 는 IDF 존 이름에서 만들어지므로(`Z_<이름>`) IDF 를 다시
  얹어도 같다. 다시 얹을 때 `options.confirmed` 로 넘기고, 그때 존과 방이 아직 있는 짝만 남긴다. 방이나 존이 사라지면 확인도 사라진다.
- 확인한 짝만 TTL `brick:hasPart` 와 GeoJSON `spaceIds` 에 나간다. 겹친 방(`overlaps`)은 이미 `overlapsSource: 'calc'` 로 계산이라고 밝혀 나가는
  값이라 그대로 둔다.
- 설비↔존 담당(`brick:feeds`)은 IDF 가 말한 값이라 확인을 거치지 않는다.
- 사람이 만든 공조존(`source: 'edit'`)은 담당 물리존을 사람이 골랐으니 확인할 것이 없다.
- 화면은 공조존 표(IDF)의 존마다 "확인 n/m" 버튼과 모두 확인·풀기 버튼을 둔다. 한 번에 한 쌍씩이 아니라 존 단위로 확인하는 까닭은 수백 개
  존이 있는 사이트에서 쌍마다 누르는 것이 검토 시간을 낭비하기 때문이다(OE-ZON-07 user story).

## 결과

- 확인 전의 IDF 공조존은 TTL 에 `brick:hasPart` 없이 나간다. 기존에 IDF 를 열어 내보내던 사용자는 확인 단추를 눌러야 이전과 같은 TTL 이 된다.
- `hvac.confirmed` 는 메모리 모델에만 있다. 브라우저를 닫거나 IDF 를 새로 열면 사라진다. 편집 파일(`edit-file.ts`)은 IDF 상태를 담지 않으므로
  같은 한계다.
- 되돌리려면 `exportedSpaceIds`(`confirm.ts`)가 IDF 존에도 `spaceIds` 전부를 돌려주게 고치면 이전 동작이다.
