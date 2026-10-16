# PRD 프로토타입

PRD 요구사항을 눈으로 확인하는 프로토타입이다. PR #393(`feature/OE-UI-01-platform-prototype`)의 `prototype.html`·`src/platform/`·`e2e/platform.spec.ts`
를 개발 코드와 겹치지 않게 이 폴더로 옮겨 온 것이다. **이 폴더 밖의 파일(`src/` 포함)은 고치지 않는다.**
임포터·모델 같은 로직은 `../../../src/lib/` 를 읽기만 한다.

| 파일 | 내용 |
|---|---|
| `index.html` · `src/` | 화면(Platform.vue·Scene.vue), 상태(state.ts), PRD 티켓 목록(catalog.ts — `../features/` 를 빌드 시 읽는다) |
| `vite.config.ts` | 이 폴더 전용 설정 |
| `e2e/` · `playwright.config.ts` | 화면 확인 |

## 실행

저장소 루트에서 한다.

```bash
npx vite --config docs/prd/prototype/vite.config.ts
```

화면 확인(e2e)도 저장소 루트에서 한다.

```bash
npx playwright test -c docs/prd/prototype/playwright.config.ts
```

http://localhost:5176/ 에서 열린다. 프로젝트 · 임시 저장 · 버전은 브라우저 IndexedDB 에 남는다(`src/store.ts`, 2026-10-16 — localStorage 5MB 한도로 성수가 저장되지 않던 것을 고침). 옛 localStorage 저장본은 처음 열 때 옮겨 온다. 형상 메시는 탭에만 남는다. 한계는 `docs/dev/platform-prototype.md` 의 "저장 및 한계" 와 같다.
