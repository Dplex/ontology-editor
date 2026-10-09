# 편집 리플레이를 main 으로 옮길 때

`realworld` 브랜치의 편집 리플레이(PoC)는 main 과 겹치는 파일을 적게 고치도록 나눠 두었다. 옮길 때는 **리플레이 파일은 그대로
복사**하고, main 파일에는 아래 **꽂는 자리만** 다시 넣는다.

## 그대로 복사하는 것

| 파일 | 하는 일 |
|---|---|
| `src/lib/replay-player.ts` | 진행(열기·되감기·장면·반복·닫기). `useReplay(host)` 와 `replayOpen`·`pausedInReplay`·`replayMemo` |
| `src/lib/replay-viewer.ts` | 3D 연출(카메라 호 비행, 빛기둥, 층 쌓기, 밤 다이오라마, 단면 자르기, 흐름 알갱이). `createReplayFx(host)` |
| `src/lib/replay.ts` · `replay.worker.ts` · `replay-geo.ts` · `replay-relations.ts` | 장면 카드(TTL·GeoJSON 변화) 계산. 워커에서 돈다 |
| `src/lib/replay-report.ts` | 변경 리포트(.md) — 장면마다 TTL 의 바뀐 줄, GeoJSON 의 바뀐 feature. 화면 카드의 이름 표(nameTable)도 여기 |
| `src/components/ReplayHud.vue` · `ReplayGeo.vue` · `ReplayRelations.vue` | 극장 화면. 극장 CSS(`.viewport.theater`)도 ReplayHud 의 전역 `<style>` 에 있다 |
| `src/lib/replay*.test.ts` · `e2e/edit-replay.spec.ts` · `e2e/replay-reduced.spec.ts` · `e2e-seongsu/replay.spec.ts` | 시험 |

리플레이 안의 조작(시간줄 끌기·층 레일·B 편집 전 보기·갈래 거르기·녹화·변경 지도·리포트)은 전부 위 파일 안에서 끝난다 —
main 파일에 꽂는 자리는 아래 표에서 늘지 않았다.

`[임시 — 리플레이 데모]` 표시가 붙은 것(`replay-demo*`, `ReplayDemoMenu.vue`, App.vue 의 "여기부터 … 여기까지" 블록)은
옮기지 않는다. 지울 곳은 `src/lib/replay-demo.ts` 맨 위에 있다.

## main 파일의 꽂는 자리

| 파일 | 찾을 말 | 무엇 |
|---|---|---|
| `src/lib/viewer.ts` | `fx.` · `createReplayFx` | tick 의 `fx.step`, 비행·미끄러짐의 `fx.flight`·`fx.glide`·`fx.glided`, `fit` 의 `fx.fitFrom`, 누르기·마우스 위의 `fx.hitSpot`, 벽·문·창의 `fx.reveals`, `setModel` 의 `fx.modelChanged`, `frameAll` 의 `fx.fitHeight`, `api` 의 `...fx.api` |
| | `ReplayViewerApi` | `Viewer` 타입 끝의 `& ReplayViewerApi` |
| | `arrowsShown` · `lastArch` · `hemi` | 편집 모드 밖 화살표(`setArrowsShown`), 외곽선 다시 그리기, 밤 조명이 쓰는 하늘빛 |
| | `export type Chunk` · `export type Part` | replay-viewer 가 타입만 가져간다 |
| | `addUpdateRange` · `sameSet` · `frame(ids, margin` | 리플레이 때문에 넣었지만 main 에도 이득인 손질(미끄러짐·칠하기는 그 설비 범위만 GPU 로, 같은 층 필터면 인덱스를 다시 안 짠다, 시점 여백) |
| `src/App.vue` | `useReplay` | 빌려줄 것을 넘기는 한 덩어리(`activeTab` 선언 바로 뒤) |
| | `replayOpen` | 리플레이 중이면 건너뛰는 자리: 알림·키·자동 저장·등급 재기·층 떠나기 확인·천장 표시·잠근 설비·3D 강조의 옆 패널 몫 |
| | `pausedInReplay` · `replayMemo` | 극장에 가려진 패널의 계산·다시 그리기를 멈춘다(성수에서 장면마다 0.2초 끊기던 것) |
| | `replayArch` · `replayElement` | 벽·문·창 장면이 외곽선 층을 켠다(`setArchitecture` watch) |
| | `<ReplayHud` | 템플릿 한 줄(`v-bind="replay.hud.value" v-on="replay.hudOn"`) |
| `src/lib/shortcuts.ts` | `'replay'` | P 키 |
| `src/lib/export/geojson.ts` | `geoFileNames` | 층 파일 이름을 내보내기와 같이 쓴다(동작은 그대로) |
| `src/lib/edit-fuzz.ts` | `capture` | 무작위 편집의 이력을 리플레이 시험이 받는다 |

## 옮길 때 부딪힐 것

- main 의 편집 이력에는 이 브랜치에 없는 스냅숏 종류가 있다(`hvac-zones` 공조존, `verticals` 수직 관통). `replay.ts` 의
  `categoryOf` 가 모든 종류를 나열하는 switch 라 타입 검사가 바로 알린다 — 갈래(색·이름)를 정해 더한다.
- main 의 여러 개 고르기 키는 Ctrl(⌘)이고 이 브랜치는 Shift 다. 리플레이와 상관없는 차이라 main 쪽을 둔다.
