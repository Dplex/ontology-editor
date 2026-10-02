# 55 배포 · 정적 서버 · 문서 챗봇

CLAUDE.md 에서 옮겼다. 55 에 배포하거나, `serve.mjs`·`run.sh`·`/__data`·`/__chat` 을 고칠 때 연다.

## 55 에서는 정적 서버로 8084 에 뜬다

빌드한 번들을 `scripts/serve.mjs`(의존성 없는 node 정적 서버)가 `0.0.0.0:8084` 로 내준다.
주소는 `http://10.251.35.55:8084/`. 기동은 다른 repo 와 같은 인터페이스인 `scripts/run.sh`,
배포는 `scripts/deploy55.sh` 이고, **밤 자동 배포(`ieum-apm/scripts/autodeploy55.sh`)에는 넣지 않는다.**
PoC 라 원할 때 손으로 배포한다: `ssh 55 'cd /home/dt/git/dt/ontology-editor && scripts/deploy55.sh'`.
API 가 없어 재시작해도 다른 서비스가 끊기지 않으니 창(23:35)을 기다릴 이유가 없다.

**정문(8000)을 거치지 않는다.** 이 앱은 브라우저 안에서만 돌고 API 가 없어서, 정문의 유일한
일인 토큰 검증이 지킬 것이 없다. 포털 `:80` 은 한 장짜리 `.html` 만 내주므로 여러 파일로 된
번들을 올릴 자리가 아니었다.

## 예외: 문서 챗봇 `/__chat`

문서 챗봇 `/__chat`(Alt+Shift+K, ADR-0001)은 앱의 API 가 아니라 55 의 gemini 가 이 repo 의
PRD·티켓·ADR·`intent.md` 를 읽고 답하는 개발용 부속이다. 지키는 것은 토큰이 아니라 도구 제한이다:
`scripts/docs-chat.policy.toml`(admin 정책)이 문서 읽는 MCP 서버(`scripts/docs-mcp.mjs`) 밖의 도구를 전부 막는다.
이 정책을 느슨하게 하면 사내망 누구나 질문 한 줄로 55 에서 명령을 돌린다. 2026-10-02 에 셸·파일 쓰기·인증 파일 읽기를
시켜 보고 막히는 것을 확인했다(gemini 는 docs 도구 5개만 본다).

- 창은 앱 코드가 아니라 `run.sh build` 가 `dist/` 에 끼워 넣는 `scripts/docs-chat.js` 라서 개발 서버(5174)에는 없다.
- 55 의 gemini 는 사내 계정이라 `GOOGLE_CLOUD_PROJECT` 가 없으면 바로 죽는다. `run.sh` 가 `~/.bashrc` 에서 옮겨 온다.
- 한 번 묻는 데 10~30초다(gemini 기동만 10초). 도구를 많이 부를수록 길어지니, 답하는 법(`scripts/docs-chat.md`)을 고칠 때
  도구 수를 같이 본다. 서버 로그(`log/ontology-editor.log` 의 `"msg":"chat"`)에 도구·시간이 남고 질문 내용은 안 남는다.
- 검색을 고치면 `scripts/docs-mcp.test.ts`(실제 문서로 1위를 박아 둔 것)를 같이 본다.
- 색인하는 곳은 `scripts/docs-index.mjs` 의 `SOURCES` 다. 문서 폴더를 새로 만들면 거기에 더해야 챗봇이 읽는다.

## `data/` 샘플 목록과 등급 칩

**dev 서버와 55 가 같은 코드로 낸다.** `src/server/data-catalog.ts`
하나를 vite 플러그인이 쓰고, `npm run build:server` 로 묶은 판을 `serve.mjs` 가 `/__data` 에 붙인다.
둘이 따로 구현하면 같은 파일에 다른 칩이 뜬다. 55 의 `data/` 는 gitignore 라 pull 로 오지 않는다.
**55 에서 `npm run fetch:sample` 은 안 된다** — 2026-09-23 실측으로 GitHub·tib.eu·npm 레지스트리에 전부
닿지 않았다. 개발 PC 의 `data/` 에서 IFC 만 복사한다:
`rsync -a --prune-empty-dirs --include='*/' --include='*.ifc' --exclude='*' data/ 55:/home/dt/git/dt/ontology-editor/data/`.
등급은 첫 요청 때 재서 `data/.profiles.json` 에 캐시하고(17개 18초), 임포터 코드가 바뀌면 다시 잰다.

## WASM 은 커밋하지 않는다

`public/web-ifc.wasm` 은 `scripts/sync-wasm.mjs` 가 node_modules 에서 복사한다. 릴리스 바이트
그대로여야 버전 올리기가 재배치가 아니라 설치 한 번으로 끝난다. `predev`·`prebuild`·`pree2e`
에 걸려 있어서 따로 부를 일은 없다.

## DT 와의 데이터 교환 방식은 아직 열려 있다

PRD 1.7 은 DT 와의 데이터 교환 방식을 셋으로 열어 두고 개발 확인이 필요하다고 적었다
(① 파일 export→import ② 온톨로지 서버에 API 로 직접 쓰기 ③ 공유 DB). 지금 이 repo 는
①을 전제로 만들어져 있다. ②·③ 으로 정해지면 서버가 생기고, 그때 부모 `~/git/dt/CLAUDE.md`(플랫폼 공통 규칙)의
"새 서비스를 붙일 때" 다섯 단계가 전부 걸린다.
