# 사용 가이드 다시 만들기: `public/guide/`

에디터 화면이 바뀌어 가이드 그림이 어긋났을 때, 원리 그림의 문구·숫자를 고칠 때 연다.

## 요점

- 가이드는 `public/guide/index.html` 한 장이다. 빌드를 거치지 않고 `dist/guide/` 로 그대로 나가며, 에디터 첫 화면과 `?` 안내창이 `./guide/index.html` 로 연다.
- 화면 그림(`screens/`)은 손으로 찍지 않는다. `scripts/guide/capture.mjs` 가 실제 에디터를 조작하며 찍고, 번호 핀 자리와 핀마다의 확대 컷도 그때 잰다. 그래서 UI 가 바뀌면 스크립트만 다시 돌린다.
- 원리 그림(`fig/`)은 `scripts/guide/figures/<이름>/build.mjs` 가 만든다. 판정 로직은 에디터 코드를 옮긴 `model.mjs` 에 있고, 그 코드가 바뀌면 같이 고친다.

| 그림 | 들어가는 단계 | 옮긴 코드 · 원리 | 숫자의 출처 |
|---|---|---|---|
| `grade` (등급 사다리) | 0단계 (`#s0`) | — | `docs/bim-to-dt-ontology.md` 3.5, 가이드 3단계 패널의 실측값 |
| `merge` (건축·설비 정합 지그) | 1단계 (`#s1`) | 층 표고(`Elevation`) · 원점 오프셋 정합 | Duplex 건축(19개 공간) + HVAC(40대 설비) |
| `footprint` (바닥 외곽선 검수대) | 4단계 (`#s4`) | 외곽선 유무에 따른 3D·소속 판정과 경고 분류(`A·B·C·X`) | `R2` 요구사항, 외곽선 없는 물리존 2개 |
| `viewport` (3D ↔ 2D 단면 슬라이서) | 5단계 (`#s5`) | 층 선택 및 `Shift+V` 수평 단면 직교 투영 | Duplex `Level 1`(0.0 m) · `Level 2`(+3.1 m) |
| `provenance` (4채널 출처 계전기) | 6단계 (`#s6`) | `사람 > BIM > 계산·사전` 속성 채택 우선순위 | 보일러(`#557516`)의 종류·계통·소속 출처 |
| `assign` (설비 소속 판정) | 7단계 (`#s7`) | `src/lib/mapping.ts` 의 `locateHow` | `SNAP`(0.05 m), `ASSIGN_SNAP_RANGE`(0~1 m) |
| `dual-export` (TTL·GeoJSON 커플러) | 9단계 (`#s9`) | 기하(GeoJSON)와 의미(Brick TTL)의 단일 ID 결합 | `src/lib/export/ttl.ts`, `geojson.ts` |
| `flow` (흐름 방향 추적) | 10단계 (`#s10`) | `src/lib/topology.ts` 의 추적 (`trace`, `deviceFlows`) | `docs/bim-to-dt-ontology.md` 3.4 |
| `validator` (5종 정합성 게이트) | 15단계 (`#s15`) | `viewer.html` 의 5가지 교차 정합성 검사 규칙 | Duplex 엔티티 100개 · Feature 679개 · 위반 0건 |
| `versioning` (4단계 저장·버전 스태커) | 저장 비교 (`#saves`) | 자동 저장 · 층별 임시 저장(`__drafts`) · 구축(`v1`) · 반영(`v2`) | `src/server/floor-state.ts`, `layouts.ts` |
| `space-hierarchy` (공간·공조 4계층 분해) | 용어 사전 (`#terms`) | 물리존(`IfcSpace`) · 룸(분할) · 공조존(`IDF`) · 계통·포트 | `docs/ontology.md` |

## 화면 그림 다시 찍기

프로젝트와 업로드가 서버의 data 폴더에 남기 때문에, 빈 폴더를 붙인 e2e 모드 서버로 찍는다. 로컬 `data/` 의 프로젝트 목록이 더러워지지 않는다.

```bash
OE_DATA_ROOT=$(mktemp -d) npx vite --mode e2e --port 5179
node scripts/guide/capture.mjs
```

- `data/NBU_Duplex/` 와 `data/ifc4Mep_IFC4.ifc` 가 있어야 한다(`npm run fetch:sample`).
- 같은 폴더로 두 번 돌리면 프로젝트가 둘이 되어 첫 그림이 달라진다. 돌릴 때마다 빈 폴더를 쓴다.
- 핀을 놓을 요소가 안 보이거나 그림 밖이면 스크립트가 멈춘다. 엉뚱한 곳을 가리키는 핀을 남기지 않으려는 것이다. 멈춘 자리의 선택자를 지금 UI 에 맞게 고친다.
- 다 찍은 뒤 `pins.js` 의 핀 수와 가이드의 `ol.pins` 항목 수가 장면마다 같은지 본다. 다르면 번호와 설명이 어긋난다.

## 원리 그림 다시 만들기

```bash
node scripts/guide/figures/grade/build.mjs
node scripts/guide/figures/merge/build.mjs
node scripts/guide/figures/footprint/build.mjs
node scripts/guide/figures/viewport/build.mjs
node scripts/guide/figures/provenance/build.mjs
node scripts/guide/figures/assign/build.mjs
node scripts/guide/figures/dual-export/build.mjs
node scripts/guide/figures/flow/build.mjs --audit
node scripts/guide/figures/validator/build.mjs
node scripts/guide/figures/versioning/build.mjs
node scripts/guide/figures/space-hierarchy/build.mjs
```

- 그림 kit 은 [anatomy](https://github.com/wheresryan22/anatomy) 의 파일을 `scripts/guide/anatomy/` 에 원본 그대로 두었다(그 README).
- 그림을 고치면 anatomy 저장소를 받아 그쪽 `scripts/lines.mjs` 로 선 끝 검사를 돌려 `line ends: 0` 을 확인한다. 흐름 그림은 `--audit` 이 `audit passed` 로 끝나야 한다.
- 가이드 페이지는 라이트·다크 둘 다다. 에디터와 같은 열쇠(`localStorage` 의 `oe-theme`)를 따르고, 고른 적이 없으면 시스템 설정을 따른다. 위 막대의 ☾/☀ 로 바꾸면 에디터 테마도 같이 바뀐다.
- 그림은 판이 둘(`*.html`·`*-dark.html`)이라 테마에 맞춰 iframe 주소를 갈아 끼운다. 바꾸면 그림이 다시 그려져 고른 단계가 처음으로 돌아간다.
- 그림이 iframe 안에서 투명 바탕으로 보이도록 `html[data-embed]` 와 `color-scheme: light` 를 둔다. 빠지면 Chrome 이 캡션 뒤에 검은 바탕을 깐다. 다크판은 `html:has(body[data-theme="dark"])` 가 바탕을 칠해서, 투명 규칙을 `html[data-embed]:has(body)` 로 같은 우선순위에 한 번 더 둔다.
- 다크 팔레트는 무채색이다. anatomy 판(`.iso-plate`)이 다크에서 `#131313` 이라 표면을 같은 색으로 두어야 그림이 상자로 떠 보이지 않는다.
- 화면 그림(`screens/`)은 라이트로 찍은 것 한 벌이라 다크에서도 밝게 보인다.
