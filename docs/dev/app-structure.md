# 편집기 화면의 짜임 — `src/editor/` 와 `src/components/editor/`

App.vue 를 고치거나 "그 함수 어디 있지" 를 찾을 때 연다. 2026-10-15 에 한 파일 16,815줄이던 App.vue 를 나눴다.

## 요점

- **상태와 동작은 `src/editor/*.ts`, 화면 조각은 `src/components/editor/*.vue`, App.vue 는 둘을 잇는 껍데기다.**
- 편집기 상태는 모듈 최상위의 `ref`·`computed` 다. 편집기 화면(App)은 한 페이지에 하나만 뜨니 Vue 문서의
  "반응형 API 로 하는 간단한 상태 관리" 그대로다. 모듈끼리는 `import` 로 서로 읽는다.
- `watch`·`onBeforeUnmount`·이벤트 리스너·타이머처럼 **화면 수명에 묶인 것은 모듈의 `setupXxx()` 안에 있고, App.vue 가 setup 에서 차례로 부른다.**
  모듈을 import 하는 것만으로는 아무것도 돌지 않는다(예외: `read-settings.ts` 의 소속 허용 거리 읽기 — 바로 아래 선언이 그 값을 읽는다).
- 화면 조각은 그 템플릿이 쓰는 이름만 모듈에서 가져온다. props 없이 붙어서, 자기가 읽는 상태가 바뀔 때만 다시 그린다.

## 왜 나눴나 — 파일이 아니라 컴포넌트 경계

빌드하면 파일 수와 상관없이 같은 컴포넌트 트리다. 차이는 **다시 그리는 범위**다. Vue 는 컴포넌트마다 render 를 따로 추적해서,
템플릿이 읽는 반응형 값 하나가 바뀌면 그 컴포넌트의 render 전체가 다시 돈다. App.vue 하나에 템플릿 4,900줄이 있을 때는 설비 하나를
방향키로 옮겨도(편집은 `triggerRef(model)` 로 알린다) 4,900줄의 모든 식(`v-if` 조건, `v-for` 순회, `filter(...).length` 같은 칸 제목)이 다시 계산됐다.
지금은 바뀐 값을 읽는 조각만 다시 그린다. 고른 설비가 바뀌면 그것을 읽는 인스펙터 조각만, 보기 필터 칸의 방 목록은 그 목록이 읽는 값이 바뀔 때만이다.

잰 것(2026-10-15, 성수 건축+기계, GPU 크롬, `npm run e2e:seongsu` 의 같은 항목을 main 과 나란히): 방향키 한 번(E-3) 773 → 725ms,
끌어 놓기(E-1) 848 → 850ms, 연결망 보기(D-4) 248 → 248ms, JS 힙(B-10) 1020 → 954MB. 편집 한 번의 시간은 대부분 편집 뒤 재계산이 먹어서
(위 "큰 파일의 속도", Vue 몫은 조작마다 1~27ms) 나눈 효과가 ms 로는 작다. 느려진 항목은 없다.

## 지킬 것

- **다른 모듈의 `let` 에 대입하지 않는다.** ES 모듈의 import 는 읽기 전용이다. 다른 모듈이 바꿔야 하는 `let` 은 정의한 모듈에 `setX(v)` 를 두고
  그것을 부른다(`setAutosaveArmed`·`setPristine` 등).
- **모듈 최상위에서 다른 편집기 모듈의 값을 바로 읽지 않는다.** 모듈끼리 서로 import 해서(순환) 평가 순서가 정해져 있지 않다. 최상위는 선언만 두고,
  값을 읽는 것은 함수·`computed`·`setupXxx()` 안에서 한다. 함수 선언은 순환이어도 먼저 뜬다.
- **v-memo 아래의 조각은 자기 루트에도 같은 `v-memo="replayMemo()"` 를 단다.** 자식 컴포넌트는 제 의존성으로 따로 다시 그려서, 부모 요소의 v-memo 가
  리플레이 동안 막아 주지 못한다(성수에서 장면마다 0.2초 — `lib/replay-player.ts` 의 `replayMemo`).
- 새 조각을 떼어 낼 때 그 안이 바깥 `v-for` 의 변수(`s`, `e` 등)를 읽으면 props 로 받는다. 지금 조각은 모두 바깥 범위 변수를 읽지 않는다.
- `testing.md` 의 "화면 뼈대" 는 App.vue 와 여러 조각이 같이 읽는 모듈(`core`·`changes`·`edit-report`·`history`·`keyboard`·`scene`·`multi-select`)이다.
  이것을 고치면 e2e 전체를 돌린다.
- 문서·주석의 "App.vue 의 `xxx`" 는 대개 `src/editor/` 의 어느 모듈에 있다. `grep -rn "function xxx\|const xxx" src/editor` 로 찾는다.

## 다시 나누기

`scripts/split-app/run.sh <커밋>` 이 그 커밋의 App.vue 를 읽어 지금 짜임을 다시 만든다(어디서 자르는지는 `parts.mjs`). 이 PR 이 들어가기 전에
main 에 App.vue 를 고친 PR 이 들어오면 그 main 으로 다시 돌리고, 손으로 고친 커밋(편집 리포트 목록의 `shallowRef`)만 얹는다.
나누기가 main 에 들어가면 이 도구는 지운다.

## 모듈 지도

섹션 머리(`// --- …`)는 나누기 전 그대로 모듈 맨 위에 있다.

| 모듈 | 무엇 |
|---|---|
| `core` | 테마·파일 이름·모델(`model`)·3D 캔버스·보기/편집 모드 |
| `people` · `read-settings` | 사람·역할(OE-COM-01·02), 읽을 것(벽·문·창)·사이트 설정 |
| `changes` · `edit-report` | 바뀐 것의 수·연 때 기준(`baseline`), 편집 리포트 |
| `scene` · `redraw` · `hover-tip` · `labels` | 3D 뷰어 만들기·다시 그리기·설명 풍선·설비 라벨 |
| `history` · `keyboard` · `multi-select` | 되돌리기, 단축키·비행 모드·방향키, 여러 개 고르기 |
| `open-file` · `open-many` · `versions` · `share-link` | 파일 열기(`load`)·덧붙이기, 여러 파일 한 번에·미리보기, 판본 비교, 지금 화면을 여는 링크 |
| `autosave` · `layout-storeys` · `projects` · `exit-edit` · `publish` · `storey-progress` | 자동·임시 저장, 층 표시, 프로젝트, 편집 종료, 반영·잠금, 층 진행 |
| `flow-rules` · `flow-map` · `systems` · `connections` | 규칙 방향, 흐름 지도·경로, 계통 편집, 연결 잇기·해제·말로 편집 |
| `rooms` · `space-edit` · `space-objects` · `vertical` · `vertical-create` · `facade` · `ceiling` | 공간·룸·커스텀존, 추가 오브젝트, 수직 관통, 외벽, 천장 |
| `equipment-edit` · `equipment-shape` · `place` · `pipe-handoff` · `cross-storey` · `offset` · `manual-draw` | 설비 편집·형상, 놓기, 배관(다중층·층간·오프셋·수동) |
| `view-filter` · `multi-view` · `context-menu` · `grid-snap` · `background` | 보기 필터·공간 보기, 다중층 뷰, 우클릭, 그리드·스냅, 평면도 배경 |
| `checks` · `kinds` · `panels` · `reports` · `requirement-items` · `chat-view` · `export-compare` · `export-lines` · `idf-zones` · `progress` | 검사·종류·패널·리포트·요구사항 줄 펴기·챗 보기·나란히 보기·고른 것의 내보내는 줄·공조존·진행 |

화면 조각(`src/components/editor/`)은 이름이 곧 자리다 — `AppBar`, `ViewportPanel`(안에 `ToolPalette`·`FilterPanel`·`RightCol`…),
`SidePanel`(안에 `EquipmentInspector`·`SpaceInspector`… 인스펙터들), `ReviewPanel`, 접는 칸(`…Fold`), `EditorSection`.
