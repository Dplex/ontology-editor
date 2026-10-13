---
id: "ADR-0052"
title: "FBX 는 화면이 만든 GLB 를 서버의 Blender 가 바꿔 낸다. glTF 임포터 대신 GLB 를 직접 읽고, 건물 노드 없이 층을 맨 위에 둔다"
status: "채택"
date: "2026-10-12"
deciders: ["정희록"]
prd: ["D11"]
tickets: ["OE-INT-03"]
criteria: []
code: ["scripts/glb2fbx.py", "src/server/fbx.ts", "src/server/data-catalog.ts", "scripts/serve.mjs", "src/App.vue", "src/lib/export/fbx-props.ts", "src/lib/export/read-3d.ts", "src/viewer/ExportViewer.vue"]
tests: ["src/server/fbx.test.ts", "src/lib/export/fbx-props.test.ts", "scripts/check-sample.test.ts", "e2e/export.spec.ts", "e2e/viewer.spec.ts"]
related: ["ADR-0009"]
---

# ADR-0052 FBX 내보내기 — 서버의 Blender 로 GLB 를 바꾼다

## 맥락

DT(Unity)가 3D 형상을 FBX 로 받을 수 있게 FBX 내보내기를 더한다(D11 의 FBX 갈래). GLB·OBJ 는 브라우저 워커가 three 로 만들지만
(`mesh3d.ts`) three 에는 FBX 내보내기가 없다. FBX 는 Autodesk 형식이고 공개된 형식 문서가 없다.

길은 셋이었다.

1. 서버에 Blender 를 두고 GLB 를 FBX 로 바꾼다
2. Autodesk FBX SDK 를 서버에 둔다
3. 브라우저에서 FBX 바이너리를 직접 쓴다

## 결정

1 을 골랐다(2026-10-12, 정희록). 화면은 지금처럼 워커에서 GLB 를 만들어 `POST /__data/__fbx` 로 보내고, 서버(`src/server/fbx.ts`)가
`blender -b --python scripts/glb2fbx.py` 로 바꿔 FBX 를 돌려준다. 파일은 OS 임시 폴더에 두고 답한 뒤 지운다. 변환은 한 번에 하나씩 한다.
Blender 는 4.5 LTS 이고 경로는 `BLENDER` 환경변수, 없으면 PATH 의 `blender` 를 쓴다. 서버에 Blender 가 없으면 `GET /__data/__fbx` 가
`enabled:false` 와 까닭을 주고, 화면은 FBX 단추를 막고 그 까닭을 title 로 보인다.

변환 스크립트에서 정한 것이 둘 있다.

- **GLB 를 Blender 의 glTF 임포터로 읽지 않고 numpy 로 직접 읽는다.** 임포터는 메시마다 임시 객체를 만들었다 지우는데 지우는 비용이
  객체 수에 비례한다. 성수(메시 22,285개)는 읽기만 226초, 전체 4분 7초가 걸렸다. 우리 GLB 는 모양이 정해져 있다(노드마다 메시 하나,
  프리미티브 하나, 삼각형, 재질은 색 하나). 직접 읽으면 성수 전체가 46초(읽기 20초, 쓰기 25초), 메모리 4.3GB 다. BIM 법선을 그대로
  넣는 데 12초가 든다. 빼면 둥근 덕트·배관이 각져 보여서 넣는다.
- **FBX 에 건물 노드를 두지 않고 층을 맨 위에 둔다.** Blender FBX 내보내기의 축 굽기(`bake_space_transform`)는 건물 → 층 → 메시처럼
  두 단 아래 자식에서 보정 행렬을 상쇄하지 못해, 메시마다 회전 90°와 크기 0.01 이 붙었다(`io_scene_fbx/fbx_utils.py` 의
  `fbx_object_matrix`). 층 → 메시 한 단이면 노드 변환이 모두 단위 행렬이다. 건물의 id·이름·스키마는 층마다 `buildingId`·`buildingName`·
  `schema` 속성으로 내린다. Unity 는 FBX 파일 하나를 프리팹 하나로 읽으므로 파일 자체가 건물 자리를 맡는다.

- **색은 sRGB 로 적는다.** glTF 색은 linear 이고 Blender 는 넣은 값을 그대로 FBX `DiffuseColor` 에 쓴다. FBX 를 읽는 쪽(Unity,
  three 의 FBXLoader)은 그 값을 sRGB 로 읽어서, linear 로 두면 성수 벽이 회색에서 짙은 회색으로 어둡게 나왔다. 변환할 때 RGB 를
  sRGB 로 바꿔 넣는다(알파는 그대로).

FBX 의 모양은 다음과 같다.

- y 가 위, 미터(`UnitScaleFactor` 100)이고 노드 변환은 모두 단위 행렬이다. 꼭짓점은 GLB 와 같은 값이다
- 객체 이름은 GlobalId 다. GLB extras(`kind`·`name`·`systemId` 등)는 FBX 사용자 속성으로 남는다
- FBX 사용자 속성에는 bool 이 없어서 `placeholder: true` 가 `1` 로 읽힌다

## 고려한 다른 길

- 2 FBX SDK: Unity 의 FBX 임포터가 이 SDK 위에 있어 호환은 가장 확실하다. 대신 Autodesk 독점 라이선스라 사내 서버에 두려면 조건을
  먼저 확인해야 한다. Python 바인딩은 SDK 버전마다 맞는 Python 버전이 정해져 있어 55 에 올리는 일도 크다. 형상은 메시·이름·색·사용자
  속성뿐이라 SDK 에만 있는 기능(애니메이션·스킨)은 쓸 일이 없다
- 3 브라우저에서 직접 쓰기: 서버가 필요 없다. 그러나 형식 문서가 없어 Blender 가 쓰는 머리·꼬리 상수를 따라 써야 하고, Unity 로
  넣어 보기 전에는 맞는지 알 수 없다
- Blender 의 glTF 임포터를 그대로 쓰기: 위 측정대로 성수에서 4분이 넘는다

## 결과

- FBX 는 서버가 있어야 나온다. 8084(55)와 dev 서버(5174)는 `/__data` 를 붙여서 되고, 서버 없이 연 화면에서는 단추가 막힌다
- 성수를 화면에서 받기까지 54~102초가 걸렸다(이 PC 에서 두 번 쟀다. 서버 변환 46초에 GLB 만들기·올리기·받기가 더해진다). 55 는 Blender 를 깔아야 한다
  (`docs/dev/deploy55.md`)
- 내보낸 파일 뷰어(viewer.html)가 FBX 도 읽는다. 형상·재질은 FBXLoader 가 읽고, FBXLoader 가 버리는 사용자 속성은
  `src/lib/export/fbx-props.ts` 가 바이너리에서 Model 마다 따로 읽어 GLB extras 처럼 붙인다. 그래서 FBX 도 GLB 처럼 종류(kind)를
  갖고, 뷰어가 3D 의 kind 와 GeoJSON 의 kind 를 견주는 "종류 어긋남" 검사를 GLB·FBX 에 한다. 성수 FBX(225MB)를 뷰어에서 읽는 데 26초였다
  (GLB 3초). ASCII FBX 는 형상만 읽고 속성은 읽지 않는다
- Unity 로 넣어 본 적은 아직 없다. `src/server/fbx.test.ts` 는 three 의 FBXLoader 와 Blender 로 다시 읽어 이름·삼각형 수·자리·사용자
  속성이 GLB 와 같은지 잰다
- 되돌리려면: `src/App.vue` 의 FBX 단추와 `glbToFBX`, `data-catalog.ts` 의 `__fbx` 줄, `serve.mjs` 의 `/__data/__fbx` 허용을 지우고
  `src/server/fbx.ts`·`scripts/glb2fbx.py` 를 지운다. 뷰어는 `read-3d.ts` 의 FBX 갈래와 `fbx-props.ts` 를 지운다. GLB·OBJ 는 그대로다
