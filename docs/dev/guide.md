# 사용 가이드 다시 만들기: `public/guide/`

에디터 화면이 바뀌어 가이드 그림이 어긋났을 때, 원리 그림의 문구·숫자를 고칠 때 연다.

## 요점

- 가이드는 `public/guide/index.html` 한 장이다. 빌드를 거치지 않고 `dist/guide/` 로 그대로 나가며, 에디터 첫 화면과 `?` 안내창이 `./guide/index.html` 로 연다.
- 화면 그림(`screens/`)은 손으로 찍지 않는다. `scripts/guide/capture.mjs` 가 실제 에디터를 조작하며 찍고, 번호 핀 자리와 핀마다의 확대 컷도 그때 잰다. 그래서 UI 가 바뀌면 스크립트만 다시 돌린다.
- 원리 그림(`fig/`)은 `scripts/guide/figures/<이름>/build.mjs` 가 만든다. 판정 로직은 에디터 코드를 옮긴 `model.mjs` 에 있고, 그 코드가 바뀌면 같이 고친다.

| 그림 | 옮긴 코드 | 숫자의 출처 |
|---|---|---|
| Fig 0 등급(`grade`) | — | `docs/bim-to-dt-ontology.md` 3.5, 가이드 3단계 패널의 실측값 |
| Fig 1 소속 판정(`assign`) | `src/lib/mapping.ts` 의 `locateHow` | `SNAP`(0.05 m), `ASSIGN_SNAP_RANGE`(0~1 m) |
| Fig 2 흐름 방향(`flow`) | `src/lib/topology.ts` 의 추적 | `docs/bim-to-dt-ontology.md` 3.4 |

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
node scripts/guide/figures/assign/build.mjs
node scripts/guide/figures/flow/build.mjs --audit
```

- 그림 kit 은 [anatomy](https://github.com/wheresryan22/anatomy) 의 파일을 `scripts/guide/anatomy/` 에 원본 그대로 두었다(그 README).
- 그림을 고치면 anatomy 저장소를 받아 그쪽 `scripts/lines.mjs` 로 선 끝 검사를 돌려 `line ends: 0` 을 확인한다. 흐름 그림은 `--audit` 이 `audit passed` 로 끝나야 한다.
- 가이드 페이지는 라이트 테마다. 그림의 라이트판(`*.html`)이 iframe 안에서 투명 바탕으로 보이도록 `html[data-embed]` 와 `color-scheme: light` 를 둔다. 빠지면 Chrome 이 캡션 뒤에 검은 바탕을 깐다.
