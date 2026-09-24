# 3D 편집 다음 회차: 좌표 규칙 위반 수정 · Ctrl+Z 되돌리기 · 문서

브랜치 `feature/3d-map-edit`(551646d 위). main 에는 커밋하지 않는다 — 병합은 사람이 한다.
출처는 ouroboros Seed `seed_fab3c94fbb5d`(A등급)의 AC 와 제약이다. 인터뷰가 답하지 못하고 넘어간 결정(되돌리기
범위, 스택 깊이 등)은 이 문서에서 정했다. 아래 "정한 것" 이 그것이다.

## 범위와 순서

커밋 하나에 한 가지씩, 이 순서로 쌓는다. 커밋마다 `npm test` · `npm run e2e` · `npx vue-tsc --noEmit` 이 전부
0 으로 끝나야 쌓는다. 하나라도 실패하면 그 커밋은 쌓지 않고 실패 출력을 그대로 남긴다.

1. **좌표 규칙 위반 수정** — 좌표 없는 설비를 표에서 한 축만 넣으면 나머지를 0 으로 채우던 것
2. **Ctrl+Z 되돌리기** — E2 · E5 · E6 · 연결 방향 편집을 한 단계씩
3. **문서 한 줄씩** — CLAUDE.md "지금 어디까지 왔나", `docs/bim-to-dt-ontology.md` 6장

이번 회차에 넣지 않는 것: 편집 막대(sticky)가 3D 위쪽을 가리는 것, 손잡이·사람 방향 화살표의 대비, 성수 대용량
성능 측정, 다시하기(Ctrl+Shift+Z). 비목표는 전과 같다(새 라우트, 서버·인증·배포, 방·벽 그리기, 설비 추가·삭제,
IDF/IMDF 변환).

---

## 1. 좌표 규칙 위반 수정

### 무엇이 틀렸나

`src/App.vue` 의 `applyMove` 는 좌표가 없는 설비(`position: null`)에 한 축만 들어와도 나머지를 0 으로 채워
`moveEquipment` 를 부른다.

```ts
const base: [number, number, number] = current ? [current[0], current[1], current[2]] : [0, 0, 0]
```

CLAUDE.md 는 "좌표가 없는 설비를 `0,0,0` 으로 채우면 안 된다 — 모르는 것이 원점에 있는 것으로 바뀌어 원점 근처
물리존에 자동으로 소속된다" 고 한다. x 하나만 넣은 순간 y=0, z=0 인 자리로 판정되어 엉뚱한 방에 소속될 수 있다.

**기존 e2e 가 이 동작을 굳혀 두고 있다.** `e2e/smoke.spec.ts` 의 "설비를 옮기면 소속 물리존이 다시 판정된다" 는
TEMP-101-01 에 x=5, y=4 만 넣고 사무실 소속을 기대한다(z 는 0 으로 채워진 채 통과). 이 테스트도 같이 고친다.

### 정한 것

- 좌표가 없는 설비는 **x·y·z 셋이 다 들어와야** 옮긴다. 그 전에는 `moveEquipment` 를 부르지 않고 `Change` 도
  만들지 않는다. `position`·`spaceId` 는 `null` 그대로다.
- 들어온 축은 버리지 않고 설비별 초안으로 들고 있다가 셋이 차면 한 번에 옮긴다. 초안은 새 파일을 열거나 덧붙이면
  비운다.
- 초안이 있는 동안 그 줄에 안내를 띄운다: **"x·y·z 셋 다 넣어야 옮깁니다"**. 빈 칸은 `placeholder="—"` 그대로다.
- 좌표가 이미 있는 설비는 지금처럼 한 축씩 고친다(나머지 두 축은 아는 값이다).

### 바꿀 곳

- `src/lib/edit.ts` — 순수 함수 하나를 더한다. 화면 없이 테스트하려고 판단을 여기에 둔다.
  ```ts
  /** 좌표 없는 설비의 축 초안. 셋이 다 차야 좌표가 된다. 모르는 축을 0 으로 채우지 않는다. */
  export function completePosition(draft: readonly (number | null)[]): Vec3 | null
  ```
- `src/App.vue`
  - `const positionDrafts = ref(new Map<string, (number | null)[]>())`
  - `applyMove`: `current` 가 있으면 지금처럼 `relocate`. 없으면 초안에 축을 넣고, `completePosition` 이 값을
    주면 `relocate` 한 뒤 초안을 지운다.
  - 설비 표에서 초안이 있는 줄의 입력칸이 초안 값을 보이게 한다(`:value`). 안내 문구는 소속 칸 자리에 띄운다.
  - `load`·`append` 에서 초안을 비운다.
- `src/styles.css` — 안내 문구는 기존 `.muted` 나 경고 톤을 쓴다. 새 색은 넣지 않는다.

### 테스트

- 단위(`src/lib/edit.test.ts`): `completePosition([5, null, null])` → `null`, `([5, 4, 2.5])` → `[5, 4, 2.5]`,
  `([0, 0, 0])` → `[0, 0, 0]`. 0 은 "모름" 이 아니라 값이다.
- e2e(`e2e/smoke.spec.ts` 고침): TEMP-101-01 에 x=5 만 넣으면 `(소속 없음)` 그대로이고, 안내가 뜨고, 편집 막대가
  "바뀐 것 0건" 이다. y=4 를 넣어도 그대로다. z=2.5 까지 넣으면 사무실이 된다.

---

## 2. Ctrl+Z 되돌리기

### 정한 것

- **범위**: 3D 와 표에서 한 편집을 **한 줄 스택**에 같이 쌓는다. 어디서 고쳤든 사람에게는 같은 편집이다.
  - E5 설비 끌기(3D) · 좌표 입력(표)
  - E2 꼭짓점 끌기(3D) · 꼭짓점 입력(표)
  - E6 층 옮기기(패널)
  - 연결 하나의 방향(3D 화살표 · 표의 상류로/하류로/되돌리기)
  - E1 물리존 이름(표) — 라벨만이라 되돌리기가 싸다. 같이 넣는다.
  - 계통 방향 확정(`confirmSystemFlow`)은 **넣는다**. `brick:feeds` 로 나가는 편집이라 잘못 눌렀을 때 되돌릴
    길이 있어야 한다. 되돌리면 그때 확정한 연결의 `inferred.confirmed` 만 false 로 돌린다.
- **포트 방향(`directed`)은 편집 대상이 아니므로 스택에 들어갈 일이 없다.** `setFlowDirection` 이 이미 막는다.
- **한 단계 = 한 번의 조작.** 끌기는 누르고 놓기까지가 한 단계다(끄는 중의 중간 자리는 쌓지 않는다). 거부된
  것(자기교차 꼭짓점, 세 축이 안 찬 좌표 초안)은 쌓지 않는다.
- **깊이 100.** 넘으면 가장 오래된 것부터 버린다. 편집은 브라우저 탭 안에만 있어서 무제한이면 성수에서 메모리를
  쌓는다(E2 스냅숏에 그 층 설비 소속이 통째로 들어간다).
- **비우는 때**: 새 파일을 열거나 덧붙일 때만. 편집 모드를 껐다 켜도 남는다(편집 결과도 남으므로).
- **Ctrl+Z 는 편집 모드에서만** 먹는다. 보기 모드에서는 고치는 손잡이가 없으므로 되돌릴 것도 보이지 않는다.
  macOS 는 Cmd+Z 도 받는다. Shift 가 같이 눌리면 받지 않는다(다시하기는 비목표).
- **입력칸에 초점이 있으면 받지 않는다** — `input`·`textarea`·`select`·`contenteditable`. 그 Ctrl+Z 는 입력칸
  자체의 실행취소다. 끄는 중(3D drag)에도 받지 않는다 — 그때는 Esc 가 취소다.
- **보이는 자리**: 편집 막대에 `되돌리기 (Ctrl+Z)` 버튼을 두고, 마지막 편집을 한 줄로 보인다("AHU-1 옮김",
  "사무실 꼭짓점", "DUCT-01 → AT-101-02 방향" 같은 것). 스택이 비면 버튼을 끈다. 되돌린 뒤에는 무엇을 되돌렸는지
  `editNotice` 자리에 한 줄 띄운다.

### 설계

되돌리기는 **스냅숏 복원 + 재판정**이다. 역연산(옮긴 만큼 반대로 옮기기)으로 하면 안 된다 — `moveEquipment` 는
`positionSource` 를 `'edited'` 로 바꾸고 BIM 소속(`spaceSource: 'bim'`)을 지우므로, 반대로 옮겨도 원래 상태로
돌아가지 않는다(출처가 BIM → 편집으로 남는다).

**`src/lib/edit.ts` 에 둔다.** 복원 뒤 재판정을 호출부에 맡기지 않는다는 원칙 그대로다.

```ts
/** 편집 한 번 전의 상태. 되돌리기가 이것을 그대로 되돌려 놓고 소속을 다시 판정한다. */
export type Snapshot =
  | { kind: 'equipment'; id: string; storeyId: string; index: number; position: Vec3 | null;
      positionSource: Equipment['positionSource']; spaceId: string | null; spaceSource: Equipment['spaceSource'] }
  | { kind: 'space'; id: string; footprint: Vec2[]; areaM2: number; longName: string }
  | { kind: 'flow'; connection: Connection; edited: Connection['edited'] }
  | { kind: 'confirm'; connections: Connection[] }

export function snapshotEquipment(model: Model, id: string): Snapshot | null
export function snapshotSpace(model: Model, id: string): Snapshot | null
export function snapshotFlow(connection: Connection): Snapshot
/** 스냅숏을 되돌려 놓고 소속을 다시 판정한다. 좌표·경계를 되돌렸는데 소속이 그대로면 리포트가 거짓이 된다. */
export function restore(model: Model, snapshot: Snapshot): void
```

- `equipment` 복원: 원래 층의 원래 자리(`index`)로 되돌리고, `position`·`positionSource` 를 되돌린다.
  `spaceSource` 가 `'bim'` 이었으면 `spaceId` 도 되돌린다(BIM 소속은 좌표로 다시 판정하지 않는 값이다). 그다음
  `assignEquipmentToSpaces(model)`.
- `space` 복원: `footprint`·`areaM2`·`longName` 을 되돌리고 `assignEquipmentToSpaces(model)`. 그 층 설비의
  소속은 경계에서 결정적으로 다시 나오므로 따로 적어 둘 필요가 없다.
- `flow` 복원: `edited` 를 되돌린다(없었으면 `delete`). 재판정할 것은 없다.
- `confirm` 복원: 그 연결들의 `inferred.confirmed = false`. `confirmSystemFlow` 가 이번에 바꾼 연결 목록을 돌려주게
  한다(지금은 개수만 준다 — 개수는 `.length` 로 얻는다).

**`src/App.vue`** 는 스택과 화면 쪽만 맡는다.

```ts
type HistoryEntry = {
  label: string
  snapshot: Snapshot
  /** 이 편집 전의 리포트 길이. 되돌리면 그 길이로 자른다 — summarize 가 남은 것으로 다시 접는다. */
  changes: number
  areaChanges: number
  confirmations: number
  /** 다시 그릴 범위. 끌기는 3D 가 이미 놓은 자리에 있으므로 되돌릴 때는 다시 그려야 한다. */
  redraw: 'scene' | 'spaces' | 'flow' | 'none'
}
const history = shallowRef<HistoryEntry[]>([])
```

- 편집 함수(`relocate`·`moveToStorey`·`recordBoundary`·`dropVertex`·`setFlow`·`cycleFlow`·`applyRename`·
  `confirmRule`)마다 **고치기 전에** 스냅숏을 뜨고, 고친 것이 받아들여졌을 때만 `push` 한다.
- `undo()`:
  1. 마지막 항목을 꺼낸다.
  2. `equipment` 면 형상도 되돌린다 — `shiftMesh(id, 지금 좌표, 스냅숏 좌표)`. 안 하면 다시 그릴 때 형상이
     옮긴 자리에 남는다.
  3. `restore(model, snapshot)`.
  4. `changes`·`areaChanges`·`confirmations` 를 적어 둔 길이로 자른다. `storeyMoved` 에서도 그 설비를 뺀다(층
     출처 표시가 편집으로 남지 않게).
  5. `triggerRef(model)` 후 `redraw` 에 따라 `redraw()` / `viewer.updateSpaces()` / `flowVersion++`.
- 단축키: `window` 의 `keydown` 에서 `(e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'z'`.
  위 "받지 않는 때" 에 걸리면 그냥 둔다. 받으면 `preventDefault()`.
- 끄는 중인지는 뷰어만 안다. `Viewer` 에 `isDragging(): boolean` 을 더한다.

**리포트 자르기가 맞는 이유.** `changes` 는 편집마다 뒤에 붙기만 하고, 리포트는 `summarize(changes)` 로 매번
다시 접는다. 마지막 편집이 붙인 만큼 잘라 내면 그 편집 전의 리포트와 같다. 같은 설비를 여러 번 옮긴 뒤 한 번
되돌려도, 남은 이력의 처음·끝으로 다시 접으므로 맞다.

### 테스트

- 단위(`src/lib/edit.test.ts`)
  - E5: BIM 소속이 있던 설비를 방 밖으로 옮긴 뒤 `restore` → `position`·`positionSource`·`spaceId`·`spaceSource`
    가 옮기기 전과 같다.
  - E6: 층을 옮긴 뒤 `restore` → 원래 층 목록의 원래 자리, 높이도 원래 값.
  - E2: 꼭짓점을 옮겨 AT-101-02 가 밖으로 나간 뒤 `restore` → 넓이 80, AT-101-02 가 사무실.
  - flow: 규칙 방향만 있던 연결에 방향을 정한 뒤 `restore` → `edited` 가 없다. 포트 연결은 스냅숏을 떠도 `restore`
    전후가 같다.
  - confirm: 확정한 뒤 `restore` → 그 계통 연결의 `confirmed` 가 false, `withInferred(…, true)` 에 안 나온다.
- e2e(`e2e/edit-3d.spec.ts` 에 더한다)
  - 3D 로 AHU-1 을 방 밖으로 끈 뒤 Ctrl+Z → 좌표 칸이 끌기 전 값, 소속 사무실, 출처가 BIM, "바뀐 것 0건",
    리포트에 AHU-1 이 없다. 3D 에서도 제자리다(`__viewer.part(AHU)` 가 끌기 전 화면 좌표 근처).
  - 꼭짓점 끌기 → 층 옮기기 → 화살표 방향 순서로 세 번 고친 뒤 Ctrl+Z 세 번 → 한 단계씩 거꾸로 돌아간다.
  - 물리존 이름 입력칸에 초점을 두고 글자를 친 뒤 Ctrl+Z → 입력칸 글자만 지워지고, 그 전에 한 3D 편집은
    그대로다("바뀐 것" 수가 그대로).
  - 보기 모드에서 Ctrl+Z → 아무것도 안 바뀐다.
  - 편집 막대의 되돌리기 버튼이 스택이 비면 꺼진다.

---

## 3. 문서 한 줄씩

- `CLAUDE.md` "지금 어디까지 왔나" 첫 줄 뒤에: 3D 에서 고친다는 것과 되돌리기가 있다는 것. 예:
  "편집은 표와 3D 둘 다에서 한다 — 편집 모드의 3D 에서 설비·꼭짓점을 끌고 연결 방향을 누르며, Ctrl+Z 로 한 단계씩
  되돌린다."
- `docs/bim-to-dt-ontology.md` 6장 "만든 것" 표(830행 근처 `| 편집 |` 줄)에 3D 편집과 되돌리기를 더한다.
  6.2 표의 "편집 전후의 차이를 보여 준다 … 되돌릴 근거가 없다" 줄과 어긋나지 않게, 되돌리기는 리포트(#21)를
  편집 전 상태로 되돌린다고 적는다.
- 문장 톤은 두 문서의 기존 서술을 따른다("~다" 체, 이유를 먼저). 등급표·요구사항(R0~R24)은 건드리지 않는다.

---

## 검증

```sh
npx vue-tsc --noEmit
npm test
npm run e2e          # 5175 에 --mode e2e 로 뜬다. 5175 에 다른 서버가 떠 있으면 그 서버로 돈다 — 먼저 확인
```

`npm run check:sample` 은 이번 변경이 임포트·판정 기준(`SNAP`)을 건드리지 않으므로 필수가 아니다. `data/` 는 본
저장소에만 있다(worktree 에는 없다).

## 위험과 확인할 것

- **성수에서 되돌리기 비용.** E5 되돌리기는 `redraw()`(3D 전체 재구성)를 부른다. 성수(설비 1만 8천)에서 몇 초
  걸릴 수 있다. 느리면 뷰어에 설비 하나의 형상만 옮기는 메서드를 따로 두는 것이 다음 수다. 이번 회차에는 재기만
  한다(`data/` 가 있을 때).
- **E2 스냅숏의 크기.** 경계 스냅숏은 외곽선만 담고 소속은 재판정으로 되살린다. 재판정이 결정적이라는 전제다 —
  `assignEquipmentToSpaces` 가 순서에 따라 결과가 달라지는 경우(겹친 방)가 있으면 소속까지 떠야 한다. 단위 테스트가
  이것을 잡는다.
- **덧붙이기 버튼.** `canAppend` 는 `changes`·`areaChanges` 가 비었을 때만 참이다. 전부 되돌리면 덧붙이기가
  다시 열린다. 의도한 동작이다(편집이 없으니 합쳐도 잃는 것이 없다).

## ouroboros 로 다시 돌릴 때

인터뷰의 자동 답변이 매번 같은 비목표 문장만 되풀이해서, 목표가 넓으면 헛돈다. 이 문서의 "정한 것" 을 목표에
그대로 넣으면 인터뷰가 물을 것이 거의 남지 않는다. 예:

```
ooo auto "docs/plans/3d-edit-undo.md 대로 feature/3d-map-edit 에 세 커밋을 쌓는다(① 좌표 규칙 위반 ② Ctrl+Z ③ 문서).
정한 것은 문서에 있다. main 에 커밋하지 않는다."
```

cwd 는 `feature/3d-map-edit` worktree 로, `worktree_policy` 는 `current` 로 준다.
