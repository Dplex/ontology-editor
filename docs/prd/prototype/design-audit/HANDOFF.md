# 인수인계 — 화면 디자인 시스템·컴포넌트 정의 작업 (2026-10-15)

> **가져온 뒤 바뀐 것(2026-10-15, 워크트리 `ontology-platform-roadmap-79b585`).** 이 문서는 원본 워크트리에서 쓴 그대로 둔다. 가져올 때 main 에 `OE-UI-16`(존 종류별 보기 필터)과 v1.9 가 이미 있어,
> 이 문서의 `OE-UI-16` 은 **`OE-UI-23`** 으로, 변경 이력은 **v1.10** 으로 옮겼다. 10장의 `index-changes.patch` 는 옛 main(251건) 기준이라 가져오지 않고 색인을 손으로 맞췄다.
> 에디터 화면 쪽 확장(뼈대·의미 색·존 색·편집 부품)은 [`../../design-system.md`](../../design-system.md) 가 이 폴더의 `DESIGN.md` 위에 얹는다.

다른 Claude 세션이 이 작업의 맥락과 위치를 이해하고 같이 고려하도록 쓴 문서다. 먼저 이 파일만 읽으면 된다.

## 1. 한 줄 요약
ontology-editor 앱(`src/App.vue`, 55 서버 `10.251.35.55:8084` 에 배포된 판과 같은 코드)의 **화면 디자인·인터랙션 진단 → 후보 비교 → 컴포넌트 인벤토리 → 디자인 시스템 초안(DESIGN.md) → PRD 신규 티켓(OE-UI-16)** 까지 만들었다. 앱 코드는 고치지 않았다(진단·시험은 Playwright 로 CSS 를 덧입혀 측정).

## 2. 위치 (중요)
- **워크트리**: `C:\Users\jennet49.kim\git\bim-to-dt-ontology\.claude\worktrees\website-usability-design-upgrade-cedba5`
- **브랜치**: `claude/website-usability-design-upgrade-cedba5` (기준 커밋 `e252f68` = `main` 과 같음)
- **커밋·push 안 됨.** 전부 uncommitted. 사용자가 "아직 커밋하지 말고 검토하자"고 했다. **메인 체크아웃이나 다른 워크트리에서는 이 파일들이 안 보인다.** 읽으려면 위 절대 경로로 직접 열어라(같은 PC 에서 파일 읽기는 된다).
- 변경 파일:
  - 새 폴더 `docs/prd/prototype/design-audit/` (이 문서 포함)
  - 새 티켓 `docs/prd/features/E03-UI/OE-UI-16.md`
  - 건수·색인만 수정: `docs/prd/PRD_011.md`(E03 15→16·총 252건·3장 표·변경 이력 v1.9), `docs/prd/README.md`(251→252), `docs/prd/features/E03-UI/README.md`(14건→16건·표 행)
- 측정 결과물(스샷·JSON)은 gitignore 된 `.local/design-audit/` (워크트리 안). 보기용 `components-sheet*.png` 두 장만 `design-audit/` 에 있다.

## 3. 읽는 순서
1. `design-audit/README.md` — 색인과 실행법
2. `design-audit/DESIGN.md` — **디자인 시스템 초안(정본 역할)**: 색 토큰, 척도(글자 12·13·14·16·20 / 간격 4·6·8·12·16·24 / 컨트롤 24·28·32), 컴포넌트 규칙, 상태(호버·눌림·포커스·비활성·다크), 모션
3. `design-audit/COMPONENTS.md` — 컴포넌트 인벤토리(계열별 모양 수), 상태·다크 측정, 시스템 시험 결과
4. `docs/prd/features/E03-UI/OE-UI-16.md` — PRD 티켓(prd-review, AC1~AC12)
5. 근거: `FINDINGS.md`(진단) · `COMPARE.md`(후보 3종 비교·레이아웃·편집 모드) · `MOTION.md`(모션 정리) · `TOKEN-MAP.md`(현재 값→척도 이동량)

## 4. 무엇을 했나 (시간순)
1. **진단**: Playwright(Edge)로 시작·열람 화면을 3개 폭에서 찍고 axe(WCAG)·글자 크기·클릭 영역 측정. 결과: 12px 미만 글자 약 70곳, 24px 미만 클릭 대상, 17종 글자 크기.
2. **후보 비교**: 앱의 `:root` 토큰만 덮어 Linear·Vercel·Stripe 계열 3종을 같은 화면에 입힘(`themes.ts`). 모두 AA 통과. **사용자가 Linear 계열로 선택**.
3. **레이아웃 시험**: `fixes.css`(작은 글자·클릭 영역), `layout.css`(상단 툴바 위계, 모바일 3D 영역). 편집 모드·큰 파일(Medical Clinic·성수)에서 전후 확인. 모바일 편집 막대 가로 넘침(1287px)을 발견해 고침.
4. **모션 조사**: CSS `transition/animation` 전수 + `lib/motion.ts`·`Roll`·`Meter`·리플레이. 숫자 굴림 900ms·번쩍임 1.6s·`transition: all` 3곳·눌림(`:active`) 0개 등 정리(`MOTION.md`).
5. **PRD 티켓**: OE-UI-16 신설(E03). 모바일 사용 근거가 PRD 에 없어 **사용자가 "모바일·태블릿은 이 티켓 범위 밖"으로 결정**.
6. **컴포넌트 인벤토리**: `styles.css` 정적 분석(규칙 약 1550·선언 약 5000) + 런타임 계측(단추 250개/31 모양, 알약 35/11, 카드 21/14, 입력 16/7, 표, 제목). 대표 사진 29종.
7. **상태·다크 확장**: 호버·눌림·포커스·비활성·다크 측정. 시스템 시험(`system.css`)으로 Clinic·성수 전후 비교. DESIGN.md 를 컴포넌트·상태 규칙까지 확장, TOKEN-MAP 작성.

## 5. 핵심 발견
- 토큰은 **색·모서리에만** 있고 글자·간격·높이에는 없다(글자 크기 24종, gap 16종, padding 40종, 단추 높이 16종). `:active` 규칙 0개. `@media` 4개뿐.
- 같은 컴포넌트가 여러 모양: 알약 단추 36/34/34px, 분절·탭 5곳 따로 구현, 네이티브로 남은 체크박스 154개·숫자 입력·단추 1개.
- 시스템 시험 결과(Clinic): 단추 높이 16→9종, 12px 미만 73→3, axe 색 대비 위반 1~3→0. 단추 모양 수는 31→27 로 조금만 줄어 **소스 클래스 정리가 필요**.
- 다크 위반: accent 켠 칸 글자가 흰색 하드코딩(밝은 accent 위 2.9:1) → `--on-accent` 로.
- 원래부터 있던 문제: 편집 모드 3D 아래 안내 글이 범례와 겹침, 경고 영역 키보드 스크롤 불가(`tabindex` 필요).

## 6. 사용자가 정한 것 / 아직 안 정한 것
- **정함**: Linear 계열 방향 · 모바일·태블릿 범위 밖 · 커밋 전 검토.
- **안 정함(제가 임의로 두지 않음)**: 티켓 우선순위(P2 vs P1)와 한 장/세 장 분리, "Linear 제안" 문구 수준, 실제 반영 방식(소스 치환), 브랜치 이름(CLAUDE.md 규칙상 `main` 에서 `feature/OE-UI-16-…` 로 옮길 수 있음).

## 7. 제약 (다른 세션도 지킬 것)
- 메모리 규칙: **수정은 `docs/prd/`·`docs/presentation/` 안에서만**. `src/`·`CLAUDE.md`·`docs/adr/`·`docs/dev/` 는 건드리지 않는다(구현 금지).
- 사용자가 커밋·push 를 지시하기 전에는 하지 않는다. 같은 파일을 동시에 고치면 충돌하니 이 폴더를 고칠 때는 사용자에게 먼저 알린다.
- 문체: 친근한 한국어, 결론 먼저. 남는 글(PR·커밋)은 `docs/dev/writing-style.md`(존댓말, 서술어로 맺기).
- 셸에서 따옴표 섞인 긴 heredoc 은 깨지기 쉬워 Write 도구로 파일을 만든다.

## 8. 실행법 (측정을 다시 돌릴 때)
샘플 BIM: `npm run fetch:sample` 후 `unzip -o data/NBU_Duplex_ifc.zip -d data/`, `unzip -o data/NBU_MedicalClinic_ifc.zip -d data/`. 성수는 `.local/ontology/`(메인 체크아웃 루트)에 있다 — `AUDIT_FILES` 로 넘긴다. 상세는 `design-audit/README.md`.

```bash
npx playwright test -c docs/prd/prototype/design-audit/playwright.audit.config.ts inventory states
AUDIT_TAG=system AUDIT_THEME=linear AUDIT_CSS_FILES=fixes.css,system.css \
  npx playwright test -c docs/prd/prototype/design-audit/playwright.audit.config.ts inventory states
```

## 9. 이 작업을 "같이 고려"할 때 보면 좋은 질문
- 이 시스템 초안이 다른 세션이 만드는 화면(프로토타입·PRD 화면 정의)과 충돌하는가? (특히 색 토큰·컴포넌트 이름·클래스 이름)
- 8084 판(희록님 진행 중)이 이 repo `main` 과 얼마나 같은지는 확인하지 못했다(이 PC 에서 접속 불가).
- 한계: 계측은 Duplex·NBU Medical Clinic 중심이고 성수는 상태·axe·스샷만. 시험 CSS 는 `!important` 덮어쓰기라 실제 반영 결과와 다를 수 있다. 호버·눌림의 "느낌"은 눈으로 안 봤다.

## 10. 가져가는 방법 — 새 세션이 복사해 가서 자기 브랜치에서 커밋 (사용자 결정, 2026-10-15)

이 작업은 커밋 전이라 git 으로 "합칠" 수 없다. 새 세션은 **파일을 복사해 가서 자기 브랜치에서 한 번에 커밋**한다. 이 워크트리의 브랜치(`claude/website-usability-design-upgrade-cedba5`)는 건드리지 않는다.

### 순서
1. **브랜치**: 새 세션 쪽에서 `main` 에서 새로 따 `feature/OE-UI-16-…` (CLAUDE.md 규칙). 이미 다른 브랜치에서 작업 중이면 그 브랜치에서 해도 되지만, 이 작업은 따로 한 커밋으로 둔다.
2. **충돌 확인(복사 전)**: 새 세션의 브랜치에서 아래 세 파일이 바뀌었는지 `git diff main -- <파일>` 로 본다. 바뀌었으면 5번의 패치를 통째로 적용하지 말고 건수·표 행만 손으로 맞춘다.
   - `docs/prd/PRD_011.md`, `docs/prd/README.md`, `docs/prd/features/E03-UI/README.md`
   - 또 `docs/prd/features/E03-UI/OE-UI-16.md` 가 이미 있거나 E03 에 `OE-UI-16` 이 다른 용도로 쓰였는지(번호 충돌) 확인한다.
3. **새 파일 복사(덮어쓸 파일이 없는 것)** — 원본 워크트리 경로를 `$SRC` 라 하자.
   - 폴더 통째: `$SRC/docs/prd/prototype/design-audit/` → 같은 위치(`docs/prd/prototype/design-audit/`). `.local/` 의 측정 결과물은 gitignore 라 복사하지 않는다(필요하면 `.local/design-audit/` 를 따로 복사).
   - 파일 하나: `$SRC/docs/prd/features/E03-UI/OE-UI-16.md` → `docs/prd/features/E03-UI/OE-UI-16.md`
4. **색인 3곳은 파일을 복사하지 말고 패치로 적용**한다(새 세션 쪽 내용이 다를 수 있다): 같은 폴더의 `index-changes.patch`
   ```bash
   git apply --check --ignore-whitespace docs/prd/prototype/design-audit/index-changes.patch
   git apply --ignore-whitespace docs/prd/prototype/design-audit/index-changes.patch
   ```
   패치 내용은 E03 건수 14→16(Epic 표는 15→16)·총 251→252건·3장 표와 E03 README 표에 `OE-UI-16` 행·변경 이력 v1.9 한 행이다. 안 맞으면 `--3way` 를 쓰거나 위 설명대로 손으로 고친다.
5. **검증**: `npx vitest run src/lib/prd.test.ts` 가 통과해야 한다(티켓·색인 일치를 본다). 새 세션에서 `npm ci` 와 `@axe-core/playwright` 가 없으면 시험 스펙은 돌지 않지만 문서만 커밋할 때는 영향 없다(스펙은 `import` 만 하고 `prd.test.ts` 는 읽지 않는다).
6. **커밋**: 사용자 지시가 있을 때만. 메시지는 한 줄 "~한다"(예: `OE-UI-16 화면 디자인·모션 기준 티켓과 디자인 시스템 초안 근거 자료를 더한다`). 티켓 md 와 색인 3곳을 한 커밋에 담는다(README "prd-updated 쓰는 법" 1번과 같은 이유 — 셋이 어긋나면 `prd.test.ts` 가 실패). push·PR·merge 는 사용자가 시킬 때만 하고, merge 는 사람이 한다.

### 지킬 것
- 복사해 간 뒤에도 **원본 워크트리 파일은 읽기만** 하고 고치지 않는다. 한쪽에서 계속 고치면 두 벌이 갈라진다. 이 작업을 더 고쳐야 하면 어느 쪽을 정본으로 삼을지 사용자에게 먼저 묻는다.
- 수정은 계속 `docs/prd/`(+ `docs/presentation/`) 안에서만(7장).
- 복사 시 줄바꿈: 이 repo 는 CRLF 로 체크아웃된다. 새 파일은 LF 여도 git 이 맞춰 주므로 신경 쓰지 않아도 된다.
