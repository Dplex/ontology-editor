---
id: "ADR-0073"
title: "3D 형상(GLB·OBJ·FBX)에 공조존·커스텀존을 물리존과 같은 판으로 넣고 kind(hvacZone·customZone)로 가르며, 판은 물리존 위로 띄우고 extras 에는 문자열 값만 둔다"
status: "채택"
date: "2026-10-20"
deciders: ["정희록"]
prd: ["1.7", "S2"]
tickets: ["OE-INT-03", "OE-OBJ-01", "OE-OBJ-13"]
criteria: []
code: ["src/lib/export/mesh3d.ts", "src/lib/export/read-3d.ts", "src/lib/viewer.ts"]
tests: ["src/lib/export/read-export.test.ts", "src/server/fbx.test.ts"]
related: ["ADR-0009", "ADR-0004", "ADR-0026", "ADR-0069"]
---

# ADR-0073 3D 형상에 공조존·커스텀존을 판으로 넣는다

## 맥락

공조존은 TTL(`brick:HVAC_Zone`, `hasPart` 물리존)과 GeoJSON(`kind: "hvacZone"` 다각형)에는 나가지만, Unity 로 가는 3D 형상(GLB, 그것을
바꾼 FBX)에는 물리존 판·벽·문·창·설비만 있었다. PRD 부록 C S2 는 "물리존·설비·공조존이 에디터·DT(Unity)·Agent 에서 같은 ID 로 조회"
이고, 커스텀존(운영존)은 OE-OBJ-01 이 "3D 에서 물리존과 다른 층으로 겹쳐 본다" 고 적었다. 커스텀존도 3D 형상에 없었다.

넣는 방법은 둘이었다.

1. 물리존 판과 같은 모양으로 넣고 `kind` 를 `hvacZone`·`customZone` 으로 둔다.
2. `kind: "space"` 로 넣고 종류 칸(`type: "hvac"` 같은 것)을 하나 더 둔다.

받는 쪽은 `kind == "space"` 를 방으로 읽는다. 문의 `connects` 가 가리키는 것, 이상 알림의 발생 위치(OE-WF-21)가 물리존이다. 2번이면 방과
겹치는 공조존이 방처럼 읽히고, 받는 쪽이 종류 칸을 모르면 그대로 방이 하나 더 생긴다.

## 결정

- 공조존(IDF·사람이 만든 것)과 커스텀존을 **물리존과 같은 판**(`spaceMesh`, 외곽선을 0.1m 두께로 세운 것)으로 넣고, GLB extras 의 `kind` 를
  `hvacZone`·`customZone` 으로 둔다. GeoJSON 의 `kind` 와 같은 이름이라 세 파일에서 종류가 하나로 맞는다.
- 판은 층 바닥에서 띄운다. 물리존 판(0~0.1m) 위에 공조존 판(0.15~0.25m), 그 위에 커스텀존 판(0.3~0.4m)이다. 셋이 같은 자리에 겹쳐도
  면이 맞붙어 깜빡이지 않고, 받는 쪽이 종류마다 켜고 끌 수 있다. 색은 편집기 3D 의 존 색(`ZONE_COLOR`·`CUSTOM_ZONE_COLOR`)이고 반투명이다.
- 조각이 여럿인 공조존(IDF 바닥이 떨어져 있는 것)은 벽처럼 `id#0`, `id#1` 로 나간다.
- extras 는 `kind`·`name`, 공조존은 `source`(`IDF`·`edit`)까지만 둔다. FBX 변환(Blender)은 extras 를 사용자 속성으로 옮기는데, 사용자 속성은
  문자열·숫자만 받는다. 포함 물리존 같은 목록은 TTL(`hasPart`)과 GeoJSON(`spaceIds`)에 있고, 3D 는 보여 주기용 셋째 파일이다.
- 내보낸 3D 를 다시 읽는 검사(`check3D`)가 공조존·커스텀존도 본다. 형상이 있는 존 feature 에 3D 객체가 없으면 빠진 것, 외곽선 범위와
  3D 범위가 다르면 옮겨진 것이다.

## 고려한 다른 길

- **`kind: "space"` + 종류 칸.** 위 맥락대로 받는 쪽이 존을 방으로 읽는다.
- **존 외곽선만 선으로 넣기.** 편집기 3D 는 외곽선으로 그리지만, glTF·FBX 의 선은 Unity 가 메시로 읽지 않아 눌러 고를 수 없다.
- **존 파일을 따로 내기.** 파일이 하나 늘고, 반영본(GLB 하나)과 Unity 쪽 읽는 곳이 둘이 된다.

## 결과

- 받는 쪽은 GLB·FBX 한 파일에서 물리존·공조존·커스텀존을 같은 id(GeoJSON feature id = TTL 엔티티)로 찾는다. 원치 않으면 `kind` 로 거른다.
- 실제 Blender 변환(`src/server/fbx.test.ts`)에서 존 판의 `kind`·`name`·`source` 가 FBX 사용자 속성으로 남는다.
- 되돌리려면 `mesh3d.ts` 의 "존 판" 블록과 `read-3d.ts` 의 `IN_3D`·`SLABS` 에 더한 `hvacZone`·`customZone` 을 걷어낸다.
