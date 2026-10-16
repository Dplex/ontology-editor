# design-audit — 개발 앱 화면 진단 시험 코드와 이전 자료

디자인 시스템의 정본은 [`docs/prd/design-system.md`](../../design-system.md) 하나다(공통 층 A1~A7 = OE-UI-23, 에디터 확장 1~8 = OE-UI-17, 진단 · 후보 비교 · 시험 결과는 부록). 이 폴더는 그 공통 층을 정할 때 개발 앱(`src/`)을 잰 시험 코드와, 개발 앱에 옮길 때 쓰는 자료만 둔다. 앱은 읽기만 하고 고치지 않는다. 결과물(스샷 · JSON)은 gitignore 된 `.local/design-audit/` 에 쓴다.

## 문서

| 문서 | 담는 것 | 읽는 때 |
|---|---|---|
| [TOKEN-MAP.md](TOKEN-MAP.md) | 개발 앱의 지금 CSS 값이 토큰 척도로 얼마나 움직이는지(글자 · gap · padding · 모서리 · 그림자 · z-index) | 개발 앱에 옮기는 비용을 가늠할 때 |
| [MOTION.md](MOTION.md) | 개발 앱의 지금 모션을 남길 것 · 줄일 것 · 바꿀 것 · 더할 것으로 나눈 목록 | 개발 앱 모션을 고칠 때 |
| `components-sheet.png` · `components-sheet-system.png` | 개발 앱 컴포넌트 29종 대표 사진(원본 / 시험 시스템 적용) | 한눈에 |

2026-10-16 진단(FINDINGS) · 후보 비교(COMPARE) · 컴포넌트 인벤토리(COMPONENTS) · 시스템 초안(DESIGN) · 인수인계(HANDOFF) 문서는 design-system.md 로 합치고 지웠다(git 이력에 남음).

## 시험 코드

| 파일 | 하는 일 |
|---|---|
| `themes.ts` | 후보 토큰 3종(Linear·Vercel·Stripe) — 앱의 `:root` 변수를 덮어 입힘 |
| `fixes.css` · `layout.css` | 1단계 문제(작은 글자·클릭 영역·툴바 위계·편집 막대)를 고치는 시험용 오버라이드 |
| `system.css` | design-system.md A3~A5 의 척도 · 컴포넌트 · 상태 규칙을 앱 CSS 위에 얹는 시험판 |
| `audit.spec.ts` · `after.spec.ts` · `compare.spec.ts` · `edit-large.spec.ts` | 스샷 + axe + 전후 측정 |
| `inventory.spec.ts` · `gallery.spec.ts` · `states.spec.ts` | 컴포넌트 계측·대표 사진·상태(호버·눌림·포커스·비활성)·다크 측정 |

## 실행

샘플 BIM 이 필요하다: `npm run fetch:sample`, 그 뒤 `unzip -o data/NBU_Duplex_ifc.zip -d data/` 와 `unzip -o data/NBU_MedicalClinic_ifc.zip -d data/`. 성수는 `AUDIT_FILES` 로 경로를 넘긴다(쉼표로 구분).

```bash
# 원본 화면 측정
npx playwright test -c docs/prd/prototype/design-audit/playwright.audit.config.ts inventory states

# 시험 시스템을 입혀 측정 (AUDIT_TAG 로 결과 파일 이름을 가름)
AUDIT_TAG=system AUDIT_THEME=linear AUDIT_CSS_FILES=fixes.css,system.css \
  npx playwright test -c docs/prd/prototype/design-audit/playwright.audit.config.ts inventory states

# 성수
AUDIT_FILES="<경로>/Factorial_건축.ifc,<경로>/Factorial_기계.ifc" AUDIT_TAG=seongsu-base \
  npx playwright test -c docs/prd/prototype/design-audit/playwright.audit.config.ts states
```

브라우저는 Edge(`AUDIT_BROWSER_CHANNEL` 로 바꿈). 개발 서버는 5187 포트로 따로 뜬다.

## 한계
- 컴포넌트 계측(`inventory`·`gallery`)은 NBU Medical Clinic 만, 성수는 `states`(상태·axe·스샷)만 돌렸다.
- 시험 CSS 는 `!important` 를 쓴 덮어쓰기라 실제 반영 결과와 다를 수 있다(값은 소스 치환, `TOKEN-MAP.md`).
- 눈으로 본 것은 스크린샷 몇 장이다. 색·속도 같은 감각은 사람이 봐야 한다.
