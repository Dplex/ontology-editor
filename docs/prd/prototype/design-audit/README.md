# design-audit — 화면 디자인·인터랙션 진단과 시스템 시험

OE-UI-23(화면 디자인·모션 기준)의 근거 자료와 시험 코드다. 앱(`src/`)은 읽기만 하고 고치지 않는다. 결과물(스샷·JSON)은 gitignore 된 `.local/design-audit/` 에 쓴다(`components-sheet.png` 만 보기용으로 여기에 둠).

## 문서

| 문서 | 담는 것 | 읽는 때 |
|---|---|---|
| [DESIGN.md](DESIGN.md) | 디자인 시스템 초안 — 색 토큰·척도·컴포넌트·상태·모션 | 기준이 무엇인지 볼 때(정본) |
| [COMPONENTS.md](COMPONENTS.md) | 컴포넌트 인벤토리(계열별 모양 수·어긋남), 상태·다크 측정, 시스템 시험 결과 | 왜 이 기준이 필요한지 볼 때 |
| [TOKEN-MAP.md](TOKEN-MAP.md) | 현재 CSS 값이 척도로 얼마나 움직이는지 | 실제 반영 비용을 가늠할 때 |
| [FINDINGS.md](FINDINGS.md) | 1단계 진단(글자 크기·클릭 영역·접근성) | 출발점 |
| [COMPARE.md](COMPARE.md) | 후보 3종 비교(Linear·Vercel·Stripe), 레이아웃 시험, 편집 모드·큰 파일 점검 | 방향을 고른 근거 |
| [MOTION.md](MOTION.md) | 모션 목록과 정리안 | 모션 기준 |
| [HANDOFF.md](HANDOFF.md) | 다른 세션에 맥락을 넘기는 인수인계(위치·한 일·결정·제약·가져가는 방법) | 처음 읽을 때 |
| `index-changes.patch` | E03 색인 3곳(건수·표 행·변경 이력)만의 패치. 새 브랜치에 적용할 때 쓴다 | HANDOFF 10장 |
| `components-sheet.png` · `components-sheet-system.png` | 컴포넌트 29종 대표 사진(원본 / 시험 시스템 적용) | 한눈에 |

## 시험 코드

| 파일 | 하는 일 |
|---|---|
| `themes.ts` | 후보 토큰 3종(Linear·Vercel·Stripe) — 앱의 `:root` 변수를 덮어 입힘 |
| `fixes.css` · `layout.css` | 1단계 문제(작은 글자·클릭 영역·툴바 위계·편집 막대)를 고치는 시험용 오버라이드 |
| `system.css` | DESIGN.md 의 척도·컴포넌트·상태 규칙을 앱 CSS 위에 얹는 시험판 |
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
