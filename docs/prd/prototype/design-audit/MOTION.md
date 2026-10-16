# 개발 앱 모션 목록과 정리안 (2026-10-15)

조사 방법: `src/styles.css`·컴포넌트 CSS 의 `transition`/`animation` 전수(약 25개 규칙), `src/lib/motion.ts`, `Roll.vue`·`Meter.vue`·리플레이, `scrollIntoView` 호출. 앱을 돌려 실제 속도를 재지는 않았다(CSS·코드에 적힌 값 기준).

기준(시간 · 커브 · `transition: all` 금지 · 눌림 · 움직임 끄기)은 [디자인 시스템 A6](../../design-system.md#a6-모션) 이 정본이다. 이 문서는 개발 앱의 지금 모션을 그 기준에 비춰 남길 것 · 줄일 것 · 바꿀 것 · 더할 것으로 나눈 이전 작업 목록이다.

## 현재 앱은 이미 이 원칙에 가깝다
- `lib/motion.ts` 머리 주석: "바뀐 것만 움직인다", 움직임 끈 사용자·숨은 탭에서는 전부 정지, 3D·큰 표에는 안 쓴다(성수에서 App 한 번 그리기 0.2초).
- 호버·색 전환은 대부분 0.12~0.16s. 모션 끄기 대응(`prefers-reduced-motion`)이 CSS·리플레이 양쪽에 있다.

## 남길 것 (그대로)
| 모션 | 값 | 이유 |
|---|---|---|
| 호버 색·테두리 전환: `.drop` `.actions button` `.theme` `.diag-chip` `.view-pill` `.preset-chip` `.filter-group label` | 0.12~0.15s ease | 짧고 색만 바뀜 |
| `.chev` 접기 화살표 회전 | 0.15s transform | 상태를 알려 주는 최소 동작 |
| `.swap-enter/leave` 패널 교체 | 0.08s 나감 / 0.18~0.22s ease-out 들어옴 | 나감이 더 빠른 비대칭이라 모범적 |
| `.filter-panel` 슬라이드 인 `facadeSlideIn` | 0.18s ease-out | 자주 안 여는 패널, 짧음 |
| `.facade-dock .dock-btn` | 0.16s | 짧음(단 아래 `all` 수정) |
| 진행 막대 `.bar i` width 0.2s, 불확정 `bar-flow` 반복 | 로딩 상태라 허용 |
| 리플레이(`ReplayHud`·`ReplayGeo`) 전체 | 0.4~1.9s, 단어별 지연 | 사용자가 일부러 보는 "보여 주기" 모드라 300ms 규칙의 대상이 아님. 단 아래 확인 필요 |

## 줄일 것
| 모션 | 지금 | 제안 | 이유 |
|---|---|---|---|
| 숫자 굴림 `roll()` (`Roll` 19곳) | 900ms, 편집할 때마다 굴림 | 처음 열 때만 굴리고 250~300ms, 편집 중 바뀜은 값만 바꾸고 번쩍임으로 알림 | 편집은 가장 잦은 동작. 900ms 면 값을 읽으려고 기다림 |
| `.num-bump` | 0.5s | 0.2s | 굴림과 겹치는 이중 신호 |
| `.flash` 번쩍임(`v-flash` 26곳) | 1.6s | 0.6~0.8s | 바뀐 줄을 알리는 신호는 좋지만 1.6s 는 길다. 편집 몇 번이면 줄이 계속 번쩍임 |
| `.meter i` 채움 | 0.9s + 줄마다 120ms 지연(Meter.vue) | 0.3s, 지연 없이 | 4줄이면 마지막 막대가 0.5s 뒤에 시작 |
| `.rule-state .confirmed` `settle-in` | 0.45s | 0.2s | 확정은 잦은 동작 |
| `scrollIntoView({behavior:'smooth'})` 14곳(목록 선택→3D/패널로 이동 등) | 브라우저 기본 부드러운 스크롤(수백 ms) | 목록 클릭·선택으로 일어나는 것은 `auto`(즉시). 먼 곳으로 점프해 방향을 잃기 쉬운 1~2곳만 유지 | 선택은 잦은 동작 |
| `button.done::after` 체크 `done-check` | 1.8s | 체크 표시 자체는 0.2s 로 등장, 유지 시간은 1.8s 로(나중에 제거) | "애니메이션 길이"와 "표시 유지 시간"이 섞여 있음 |

## 바꿀 것 (속성 지정)
- `transition: all 0.15s ease` 3곳: `.side-tabs button`(5679), `.diag-chip`(5819), `.dock-btn`(6037, 커브는 좋음). 실제로 바뀌는 속성(background·color·border-color·transform)만 나열.
- 진입 커브: 일반 `ease` 가 많다(호버는 무방). 들어오는 것(패널·칩)은 이미 `cubic-bezier(0.22,1,0.36,1)` 로 맞아 있어 추가 변경 불필요.

## 더할 것
- `:active` 눌림 피드백이 앱에 0개. 주요 버튼(`.primary-action`, 모드 스위치, 툴바 알약, 팔레트 버튼)에 `transform: scale(0.97)` + 100ms. 빽빽한 표 안의 링크형 버튼에는 넣지 않는다.
- 모션 끈 사용자: 지금은 `animation: none; transition: none` 으로 `flash`(배경색)까지 끈다. 색 변화는 움직임이 아니므로 `flash` 는 유지하고(짧게) 이동·확대만 끄는 쪽이 "무엇이 바뀌었나" 신호를 잃지 않는다.

## 빼도 되는 것
- 새로 빼야 할 장식은 못 찾았다. 장식 모션(패럴랙스·스크롤 연출·로고 애니메이션)은 없다. 줄일 것이 대부분이다.

## 확인하지 못한 것
- 3D 카메라 이동(`viewer.flyToHeight` 등)의 시간·커브는 보지 않았다(Three.js 쪽 코드).
- 리플레이에 건너뛰기(Esc 등)가 있는지, 모션 끄기에서 장면이 어떻게 넘어가는지는 확인 전. 리플레이는 별도 시험(`e2e/replay-reduced.spec.ts` 존재)이 있다.
- 실제 체감(속도·번쩍임 빈도)은 눈으로 봐야 한다. 이 표는 코드에 적힌 값 기준이다.
- 바꾸면 `e2e/motion.spec.ts`(굴림·차오름·번쩍임을 확인)를 같이 고쳐야 한다.
