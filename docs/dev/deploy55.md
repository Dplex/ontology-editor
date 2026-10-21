# 55 배포 · 정적 서버 · 문서 챗봇

CLAUDE.md 에서 옮겼다. 55 에 배포하거나, `serve.mjs`·`run.sh`·`/__data`·`/__chat` 을 고칠 때 연다.

## 55 에서는 정적 서버로 8084 에 뜬다

빌드한 번들을 `scripts/serve.mjs`(의존성 없는 node 정적 서버)가 `0.0.0.0:8084` 로 내준다.
주소는 `http://10.251.35.55:8084/`. 기동은 다른 repo 와 같은 인터페이스인 `scripts/run.sh`,
배포는 `scripts/deploy55.sh` 이고, **밤 자동 배포(`ieum-apm/scripts/autodeploy55.sh`)에는 넣지 않는다.**
PoC 라 원할 때 손으로 배포한다: `ssh 55 'cd /home/dt/git/dt/ontology-editor && scripts/deploy55.sh'`.
다른 서비스와 따로라 재시작해도 끊기는 것이 없으니 창(23:35)을 기다릴 이유가 없다.

**정문(8000)을 거치지 않는다.** 이 모듈은 dt 플랫폼과 따로다(폴더만 `~/git/dt` 아래 있다). 포털 `:80` 은 한 장짜리
`.html` 만 내주므로 여러 파일로 된 번들을 올릴 자리가 아니었다.

**[편집 저장] 은 8084 에 남는다(OE-COM-08 "웹에서 바로 확인").** data/ 에서 연 파일이면 `PUT /__data/__edits?key=<경로|경로>`
로 `data/.edits/` 에 두고, 같은 파일을 여는 사람 누구나 그 편집을 얹은 채로 본다(`src/server/saved-edits.ts`, 덮기 전 판은
`data/.edits/history/` 에 20개). 사내망 누구나 쓸 수 있다 — 잘못 덮으면 history 에서 되찾는다. 임시 저장은 브라우저에만 남고
서버에 오지 않는다. 8087 검토 판은 `data/` 를 따로 둬서(review55.sh 의 하드링크) 검토 중 저장이 8084 에 섞이지 않는다.

**프로젝트와 [새 프로젝트]의 IFC 는 8084 의 `data/` 에 남는다(OE-UI-02·03).** 프로젝트는 `data/.projects/<id>.json`,
[새 프로젝트]에서 올린 IFC 는 `data/uploads/<시각>-<이름>.ifc` 다(`src/server/projects.ts`). 올린 IFC 는 data/ 목록에도 보인다.
프로젝트로 연 판의 임시 저장본·잠금·반영 버전은 열쇠 앞에 `@<프로젝트 id>|` 가 붙어, 같은 IFC 로 만든 다른 프로젝트나 파일로 연 판과
섞이지 않는다. 올리기는 한 파일 1GB 까지다. 사내망 누구나 올릴 수 있어(사람 목록의 편집 역할이면) 디스크를 채울 수 있다 —
`data/uploads/` 를 가끔 보고 쓰지 않는 파일을 지운다.

## 예외: 문서 챗봇 `/__chat`

문서 챗봇 `/__chat`(Alt+Shift+K, docs/dev/deploy55.md)은 앱의 API 가 아니라 55 의 gemini 가 이 repo 의
PRD·티켓·ADR·`intent.md` 를 읽고 답하는 개발용 부속이다. 지키는 것은 토큰이 아니라 도구 제한이다:
`scripts/docs-chat.policy.toml`(admin 정책)이 문서 읽는 MCP 서버(`scripts/docs-mcp.mjs`) 밖의 도구를 전부 막는다.
이 정책을 느슨하게 하면 사내망 누구나 질문 한 줄로 55 에서 명령을 돌린다. 2026-10-02 에 셸·파일 쓰기·인증 파일 읽기를
시켜 보고 막히는 것을 확인했다(gemini 는 docs 도구 5개만 본다).

- 창은 앱 코드가 아니라 `run.sh build` 가 `dist/` 에 끼워 넣는 `scripts/docs-chat.js` 라서 개발 서버(5174)에는 없다.
- 55 의 gemini 는 사내 계정이라 `GOOGLE_CLOUD_PROJECT` 가 없으면 바로 죽는다. `run.sh` 가 `~/.bashrc` 에서 옮겨 온다.
- **gemini 는 질문마다 띄우지 않는다.** `gemini --acp` 하나를 띄워 두고 질문마다 세션을 새로 연다(정문 `ieum-gateway` 의
  assistant.Gemini 와 같은 방식). 처음 질문만 기동 3~4초가 더 붙고, 30분 안 쓰이면 내린다(`DOCS_CHAT_IDLE`, 하나에 약 380MB).
- 같은 창의 [온톨로지] 칸은 `/__ask` 다(ADR-0050). 반영본(`data/.layouts` 의 현재 버전 TTL)을 읽기만 하는 MCP 서버
  (`scripts/onto-mcp.mjs`) 하나를 `scripts/onto-chat.policy.toml` 로 묶는다 — 문서 챗봇 정책과 같은 모양이고, 이것도 느슨하게 하지 않는다.
  gemini 는 칸마다 따로 떠서 둘 다 쓰면 둘이 뜬다. 질문 시험대의 gemini 채점은 55 에서 `npm run onto:bench -- --ask`.
  thinking 은 LOW 다(`DOCS_CHAT_THINKING`). 아래 실측에서 MEDIUM 보다 절반쯤 빨랐고 답은 같은 문서를 찾았다.
- 55 실측(2026-10-06, 같은 질문 셋, 한 번씩): 예전 `gemini -p` 12.4 · 15.0 · 16.8초 → `--acp` MEDIUM 15.4(기동 포함) · 11.9 · 11.5초,
  LOW 9.7(기동 포함) · 6.9 · 5.8초. 시간의 대부분은 모델이 생각하는 구간이라 thinking 단계가 기동보다 크게 움직인다.
- 정책의 docs 허용 줄에 `toolName = "*"` 를 붙이지 않는다. `--acp` 에서는 그 줄이 docs 도구까지 "denied by policy" 로 막았다.
- 도구를 많이 부를수록 길어지니, 답하는 법(`scripts/docs-chat.md`)을 고칠 때 도구 수를 같이 본다. 서버 로그(`log/ontology-editor.log` 의 `"msg":"chat"`)에 도구·시간이 남고 질문 내용은 안 남는다.
- 검색을 고치면 `scripts/docs-mcp.test.ts`(실제 문서로 1위를 박아 둔 것)를 같이 본다.
- 색인하는 곳은 `scripts/docs-index.mjs` 의 `SOURCES` 다. 문서 폴더를 새로 만들면 거기에 더해야 챗봇이 읽는다.

## 문서 챗봇 창의 `/issue` — 요청 한 줄을 GitHub 이슈로

문서 칸에 `/issue <요청>` 을 치면 `/__issue`(`scripts/issue-chat.mjs`)로 간다. gemini 가 문서와 소스를 읽고 이슈 초안(JSON)을 쓰면,
서버가 검사해 **미리보기 없이 바로** 이슈를 올리고 번호·주소·본문을 창에 답한다(2026-10-16 사용자 결정).

- **gemini 는 이슈를 올리지 못한다.** 붙는 MCP 서버(`scripts/issue-mcp.mjs`)는 문서 도구(`docs-tools.mjs`)와 소스를 읽는 도구(`code-tools.mjs`)뿐이고,
  정책(`scripts/issue-chat.policy.toml`)이 그 밖을 막는다. 올리는 것은 서버가 `gh issue create` 를 셸 없이 정해진 인자로 띄운다.
  저장소는 `ISSUE_REPO` 로 정해져 있어 요청 글이 무엇을 시켜도 다른 곳에 올라가지 않는다. 이 정책도 느슨하게 하지 않는다.
- **소스는 목록 안에서만 읽는다.** `src`·`scripts`·`e2e`·`e2e-seongsu`·`docs` 와 루트의 몇 파일이다. 점으로 시작하는 이름(`.env`·`.git`),
  `data`·`run`·`node_modules`·`fixtures`, 비밀처럼 보이는 이름은 목록에서부터 뺀다 — 경로를 받는 대로 읽으면 질문 한 줄로 `.env` 를 이슈 본문에 옮기게 된다.
- **라벨**은 종류 하나(`bug`·`enhancement`·`documentation`·`question`, 없으면 `enhancement`)와 `need-not-check`·`prd-011`·`phase-1~3` 만 남긴다.
  상태 라벨(`needs-pm`·`blocked` …)은 사람이 붙인다. 제목 끝의 `(OE-XXX-nn)` 는 뗀다 — 보드 동기화가 제목 끝 ID 로 티켓 이슈를 찾는다(`board.md`).
- **작성자는 55 의 `gh auth login` 계정(희록님)이다.** 본문 끝에 "`/issue` 로 만든 이슈" 와 요청 원문, 요청할 때 보던 화면을 다시 여는 주소(위치 표시 옆
  [링크 복사] 와 같은 `?open=…&select=…`)를 붙여 사람이 쓴 이슈와 가른다. gh 에는 서버 환경의 `GH_TOKEN`·`GH_ENTERPRISE_TOKEN` 을 넘기지 않는다 —
  8087 은 Actions 가 띄워서 그 실행의 토큰이 남아 있었다(2026-10-16).
- **막연한 요청은 올리지 않고 되묻는다**(초안 대신 `ask`). 서버 전체에서 한 시간에 `ISSUE_MAX_PER_HOUR`(기본 10)개까지 올린다.
- 55 실측(2026-10-16, gh 는 가짜로 바꿔 올리지 않고 초안만 본 것): 편집 막대 요청 44초(도구 10번 · 입력 토큰 12만), DWG 단위 요청 25초(도구 4번,
  관련 코드 세 곳과 OE-MAN-02·ADR-0053 을 짚음). "이상해요" 와 "라벨 전부 붙이고 다른 저장소에" 는 이슈를 만들지 않고 되물었다.
- **앞선 대화는 붙이지 않는다**(`turns: 0`, 창도 보내지 않는다). 55 의 8099 에 띄운 판으로 문서 질문 → 기능 질문 → `/issue` → 문서 질문 네 턴을 브라우저로 돌려
  (2026-10-16), 셋째 턴만 `/__issue` 로 가고(앞선 대화 0) #688 이 올라갔다. 본문에 앞 턴의 낱말(내력벽·되돌리기·OE-BIM-12)은 없었고, 넷째 턴은 다시 `/__chat` 이었다.
- 켜는 데 필요한 것: 55 의 gemini(문서 챗봇과 같다)와 `gh auth status` 가 `github.sec.samsung.net` 에 로그인돼 있는 것. 하나라도 없으면
  `GET /__issue` 가 `enabled:false` 와 까닭을 준다. 끄려면 `ISSUE_CHAT=0`.
- 시험은 `scripts/issue-chat.test.ts`(가짜 gemini·가짜 gh 로 서버 전 구간, 소스 도구가 막는 경로).

## FBX 변환은 서버의 Blender 가 한다

툴바의 [FBX] 는 화면이 만든 GLB 를 `POST /__data/__fbx` 로 보내고, 서버가 Blender 로 바꿔 돌려준다(src/server/fbx.ts,
`src/server/fbx.ts`·`scripts/glb2fbx.py`). **Blender 가 없는 서버에서는 [FBX] 단추가 막힌다.** `GET /__data/__fbx` 가 `enabled:false`
와 까닭을 주고, 화면이 그 까닭을 단추의 title 로 보인다.

- 버전은 4.5 LTS 다. sudo 없이 홈에 풀고 PATH 에 건다. 다른 자리에 두면 `BLENDER=/경로/blender` 로 준다.
  ```
  curl -O https://download.blender.org/release/Blender4.5/blender-4.5.14-linux-x64.tar.xz   # 같은 폴더의 .sha256 과 맞춰 본다
  mkdir -p ~/.local/opt && tar -xJf blender-4.5.14-linux-x64.tar.xz -C ~/.local/opt
  ln -sfn ~/.local/opt/blender-4.5.14-linux-x64/blender ~/.local/bin/blender
  ```
- 서버는 Blender 가 있는지를 처음 물을 때 한 번만 잰다. 깔았으면 서버를 다시 띄운다.
- 변환은 한 번에 하나씩 한다. 성수는 개발 PC 에서 46초, 메모리 4.3GB 였다. 둘이 겹치면 뒤의 것이 앞의 것을 기다린다.
- 받은 GLB 와 만든 FBX 는 OS 임시 폴더(`oe-fbx-*`)에 두고 답한 뒤 지운다. `data/` 에는 남지 않는다.

## DWG 변환은 서버의 LibreDWG·ezdxf 가 한다

평면도 배경(OE-MAN-02)에 DWG 를 고르면 화면이 파일을 `POST /__data/__dwg` 로 보내고, 서버가 PNG 로 바꿔 돌려준다(`src/server/dwg.ts`,
`scripts/dwg2png.py`). DWG 는 LibreDWG 의 `dwg2dxf` 로 DXF 로 바꾸고, DXF 는 파이썬 ezdxf 로 그린다. 머리 `X-Dwg2png` 에 그림이 덮는 도면 범위와
단위가 가고, 화면은 단위를 알면 실제 크기로 깐다. **변환기가 없으면 `GET /__data/__dwg` 가 `enabled:false` 와 까닭을 주고**, 도면 칸의 안내가
그 까닭을 보이며 DWG 를 받지 않는다.

- 55 에는 sudo 가 없고 pip 도 없다(Python 3.14, ensurepip 없음). 둘 다 홈에 깔고, 경로는 `.env` 의 `DWG_PYTHON`·`DWG2DXF` 로 준다.
  2026-10-14 에 아래대로 깔았다.
  - **GitHub 릴리스 파일은 55 에서 받지 못한다.** 프록시가 다운로드 서버(objects.githubusercontent.com)에 빈 응답을 준다. 개발 PC 에서 받아 scp 로 넘긴다.
  - **gcc 15(Ubuntu 26.04)는 LibreDWG 를 경고 때문에 멈춘다.** `--enable-release` 로도 `-Werror` 가 남아 make 에 `WARN_CFLAGS=-Wno-error` 를 준다.
  - **uv 는 사내 프록시의 인증서를 모른다.** `--system-certs` 를 준다. uv 도 GitHub 릴리스라 개발 PC 의 것을 넘긴다.
  ```
  # 개발 PC 에서: LibreDWG 0.13.3 릴리스 tarball 과 uv 를 넘긴다
  curl -LO https://github.com/LibreDWG/libredwg/releases/download/0.13.3/libredwg-0.13.3.tar.xz
  sha256sum libredwg-0.13.3.tar.xz   # 83f1f6e78a744777a481ff4520e4cef3f8ac4b2c1c25671077ca12fe81e8816e
  scp libredwg-0.13.3.tar.xz 55:.local/src/ && scp ~/.local/bin/uv 55:.local/bin/

  # 55 에서: LibreDWG 를 홈에 빌드한다(릴리스 tarball 에 configure 가 들어 있어 autoconf 가 없어도 된다)
  cd ~/.local/src && tar -xJf libredwg-0.13.3.tar.xz && cd libredwg-0.13.3
  ./configure --prefix=$HOME/.local --disable-bindings --enable-release
  make -j8 WARN_CFLAGS=-Wno-error && make install WARN_CFLAGS=-Wno-error
  # 파이썬 — uv 로 venv 를 만들고 ezdxf·matplotlib 을 넣는다
  ~/.local/bin/uv venv ~/.local/share/dwg2png/venv
  VIRTUAL_ENV=~/.local/share/dwg2png/venv ~/.local/bin/uv pip install --system-certs ezdxf==1.4.4 matplotlib
  # 확인 — DWG2PNG-PROBE {...} 가 찍히면 된다
  DWG2DXF=~/.local/bin/dwg2dxf ~/.local/share/dwg2png/venv/bin/python /home/dt/git/dt/ontology-editor/scripts/dwg2png.py --probe
  ```
  `/home/dt/git/dt/ontology-editor/.env` 에 두 줄을 둔다(`DWG_PYTHON=/home/dt/.local/share/dwg2png/venv/bin/python`,
  `DWG2DXF=/home/dt/.local/bin/dwg2dxf`). `.env` 는 gitignore 라 저장소에는 `.env.example` 만 있다.
- 서버는 변환기가 있는지를 처음 물을 때 한 번만 잰다. 깔았거나 `.env` 를 고쳤으면 서버를 다시 띄운다.
- 변환은 한 번에 하나씩 한다. 받은 DWG 와 만든 PNG 는 OS 임시 폴더(`oe-dwg-*`)에 두고 답한 뒤 지운다. `data/` 에는 남지 않는다.
- LibreDWG 가 핸들이 겹치는 DXF 를 쓰는 도면이 있다(LibreDWG 로 만든 DWG 가 그랬다). 그때는 개체만 담은 최소 DXF 로 다시 그리고, 블록으로 넣은 기호(문·가구)는
  빠질 수 있다고 화면이 알린다.
- dev 에서 쓰려면 같은 두 변수를 주고 `npm run dev` 한다. 시험(`src/server/dwg.test.ts`)도 두 변수가 있어야 돌고, 없으면 까닭을 찍고 건너뛴다.

## Laya 종류 후보는 133 의 GPU 가 답한다

편집 화면 "종류를 모르는 패밀리" 칸의 Laya 줄(ADR-0057)은 `GET /__laya`·`POST /__laya/kinds` 두 길만 133(RTX 5090, ssh 별칭 `5090`)의
`scripts/laya/serve.py` 로 넘긴다(`scripts/laya-proxy.mjs`). 55 는 GPU 드라이버가 없어서 133 에 둔다.

- 55 의 `.env` 에 `LAYA_URL=http://10.251.31.133:8096` 을 두면 켜진다. 없거나 133 이 안 받으면 `enabled:false` 와 까닭을 주고 Laya 줄이 안 보인다.
  dev 도 같다 — `LAYA_URL=… npm run dev`.
- 133 에서: `~/laya/run/start.sh`(체크포인트 `~/laya/run/out-all2/final`, 133 이 켜지면 crontab `@reboot` 가 부른다). venv 는 `~/laya/.venv`
  (torch cu128 — 5090 은 CUDA 12.8 이상 판이 필요하다, `laya[serve]`).
- 다시 배우는 법은 `scripts/laya/train.py` 머리말. 재료는 개발 PC 에서 `npx vitest run --config scripts/laya/vitest.config.ts` 로 뽑아(`data/laya/`) 옮긴다.
- 133 에는 llama-server(Qwen 27B, 8085)가 있었고 VRAM 을 27GB 잡았다. Laya 추론만이면 1.5GB 라 같이 돈다. 학습할 때 내렸다(2026-10-13) —
  다시 띄우려면 133 의 `~/llama_restart.sh`.

## `data/` 샘플 목록과 등급 칩

**dev 서버와 55 가 같은 코드로 낸다.** `src/server/data-catalog.ts`
하나를 vite 플러그인이 쓰고, `npm run build:server` 로 묶은 판을 `serve.mjs` 가 `/__data` 에 붙인다.
둘이 따로 구현하면 같은 파일에 다른 칩이 뜬다. 55 의 `data/` 는 gitignore 라 pull 로 오지 않는다.
**55 에서 `npm run fetch:sample` 은 안 된다** — 2026-09-23 실측으로 GitHub·tib.eu 에 닿지 않았다(npm 레지스트리는 그때 닿지 않았고
2026-10-20 에는 닿았다 — `npm view polygon-clipping version`). 개발 PC 의 `data/` 에서 IFC 만 복사한다:
`rsync -a --prune-empty-dirs --include='*/' --include='*.ifc' --exclude='*' data/ 55:/home/dt/git/dt/ontology-editor/data/`.
등급은 첫 요청 때 재서 `data/.profiles.json` 에 캐시하고(17개 18초), 임포터 코드가 바뀌면 다시 잰다.

첫 화면의 [바로 열기] 단추는 `data/.open-sets.json` 의 묶음이다(`GET /__data/__sets`, `data-catalog.ts` 의 `openSets`). PC·서버마다 `data/` 가
달라서 코드가 아니라 데이터 옆에 둔다. 묶음의 파일이 하나라도 없으면 그 단추는 안 보인다. 위 rsync 는 `.ifc` 만 옮기니 이 파일은 따로 복사한다.

```json
[
  { "title": "성수 건축 + 기계", "paths": ["성수/Factorial_건축.ifc", "성수/Factorial_기계.ifc"] },
  { "title": "성수 전부 (건축 + 기계 + 10층 인테리어 + 엘리베이터)",
    "paths": ["성수/Factorial_건축.ifc", "성수/Factorial_기계.ifc", "성수/Factorial_10F_Interior.ifc", "성수/Factorial_elevator.ifc"] }
]
```

성수 파일(2026-10-13, 사내 `http://10.251.2.225/ontology/` 에서 받음, 받을 때 프록시를 끈다 — `curl --noproxy "*"`)은 조경까지 다섯 개를 같이 열면 캐시가 찬
개발 PC 에서 116초였다. 엘리베이터 파일의 Proxy 6개(`EVEV.#1` …)는 이름 사전으로 설비 brick:Elevator 가 되고, 10층 인테리어의 가구 314개는 추가 공간
오브젝트가 된다(ADR-0016 "BIM 에서 받는 오브젝트").
조경 파일(`Factorial_조경.ifc`)은 "성수 전부" 묶음에 넣지 않는다. Proxy 131개(지형·건물 매스)가 축에 맞춘 상자 하나씩의 주변 모델이 될 뿐이고, TTL 에는
들어가지 않으며 3D 에서 고르지도 못한다. 볼 일이 있으면 목록에서 따로 연다. 인테리어의 벽 94장은 10F 에 더해지고(76 → 170장),
인테리어 파일에는 방(IfcSpace)이 없어 10F 물리존은 그대로다.

## 첫 화면 인트로는 서버에서 구운 장면을 띄운다

주소 끝에 `#intro` 를 붙이면(`http://<서버>:8084/#intro`) 첫 화면 위에 건물이 층마다 쌓이는 인트로(`public/intro/`)가 뜬다.
그냥 `/` 는 에디터 첫 화면이고, 거기의 [인트로 보기] 가 `#intro` 로 간다. 성수 원본(287MB)은 첫 화면에서 열 수 없어서,
에디터와 같은 임포터로 한 번 읽어 층·물리존 외곽선·벽·기기 점·관로 선만 남긴 JSON(0.6MB)을 `data/.intro/` 에 굽고, 그것을
`/__data/__intro`(`src/server/intro.ts`)로 내준다. **장면이 없는 서버에서는 `#intro` 여도 인트로가 뜨지 않고 [인트로 보기] 도 보이지 않는다.**

```bash
# 55 에서, 성수 파일이 data/성수/ 에 있을 때(개발 PC 실측 16초 · 메모리 1.5GB)
npm run intro:bake -- seongsu data/성수/Factorial_건축.ifc data/성수/Factorial_기계.ifc --title=성수\ Factorial
```

- 고객사 건물 형상이라 저장소에 커밋하지 않는다. `data/` 는 gitignore 이고, 구운 서버만 내준다.
- 화면의 숫자(소속 판정·물리존·연결망·흐름 방향)는 구울 때 `gradeCounts`·`profileOf` 로 센 값이다. 임포터가 바뀌면 다시 굽는다.
  `.profiles.json` 처럼 코드 지문으로 무효화하지 않으므로, 굽지 않으면 낡은 숫자가 남는다.
- 틀(조립 연출·Explode·Cut·X-ray·라벨·큰 숫자)은 machine-skill 의 kit(`public/intro/lab-kit.js`, MIT, `LICENSE-lab-kit`)을 고치지 않고 쓴다.
  kit 은 three 를 jsDelivr 에서 받게 되어 있어서, import map 이 `public/intro/three/` 를 가리킨다. 그 폴더는 `scripts/sync-three.mjs` 가
  node_modules 에서 kit·앞머리가 가져오는 파일만(25개) 옮기고 커밋하지 않는다. 아래 WASM 과 같은 이유다.

### 가이드의 3D 랩

사용 가이드(`public/guide/`)는 같은 페이지를 랩으로 세 번 띄운다(`?focus=assign|flow|floors`). 장면은 서버가 구운 성수가 아니라
저장소에 든 공개 샘플 Duplex(`public/intro/scenes/duplex.json`, 건축·HVAC·MEP 세 파일, 0.1MB)다. 성수(1.7MB)를 랩 셋이 각자 띄우면
가이드 한 장에 kit 세 벌이 성수를 그려 무거워서다. 흐름 랩은 입자가 움직여야 해서 화면에 보이는 동안 30fps 로 계속 그리고,
가이드가 iframe 이 화면 밖으로 나갔다고 알리면 멈춘다. 장면에 연결별 흐름 방향(`flows`)이 들어 있어 임포터가 바뀌면 다시 굽는다.

```bash
npm run intro:bake -- duplex data/NBU_Duplex/NBU_Duplex-Apt_Arch.ifc data/NBU_Duplex/NBU_Duplex-Apt_Eng-HVAC.ifc data/NBU_Duplex/NBU_Duplex-Apt_Eng-MEP.ifc --title=Duplex
cp data/.intro/duplex.json public/intro/scenes/duplex.json
```

### 앞머리: 한강을 건너 성수로 날아간다

장면 이름과 같은 동네 지도(`public/intro/city/<이름>.json`)가 있으면 층 조립 앞에 13초 남짓한 앞머리(`public/intro/prologue.js`)가 붙는다.
검은 화면에 "Ontology-Editor" 가 뜨고, 한강 위에서 성수 쪽 야경을 보다가 강을 건너 팩토리얼 성수까지 날아간다. 건물에 닿으면 스캔선이
아래에서 위로 훑으며 층선(장면의 IFC 층 높이)이 드러나고, 그 자리에서 층 조립으로 넘어간다. 오른쪽 아래 [건너뛰기]·Space·Enter 로 넘긴다.
브라우저의 움직임 줄이기 설정이 켜져 있거나 주소에 `?prologue=0` 이 있으면 앞머리 없이 시작한다.

- 동네 지도는 OpenStreetMap 에서 받은 건물 외곽선·높이, 한강·중랑천·서울숲, 큰 길이다. 고객사 BIM 이 아니라 공개 지도라 커밋한다(535KB, gzip 195KB).
  ODbL 이라 화면 왼쪽 아래에 출처를 적는다.
- 건물 8,379동 중 6,747동은 OSM 에 높이가 없어 쓰임새·바닥 넓이로 정했다(`scripts/intro-city.mjs` 의 `heightOf`). 화면에도 "추정" 이라고 적는다.
- 팩토리얼 성수는 OSM 에 옛 이름 "예진상사 물류센터"(way 564869565, 연무장7길 13)로 올라 있다. 스크립트의 `PLACES` 표에 번호로 박았다.
- 다시 굽는 일은 동네를 넓히거나 OSM 이 크게 바뀌었을 때뿐이다. 개발 PC 에서 돌려 커밋하면 되고 55 에서 돌릴 일은 없다.

```bash
npm run intro:city -- seongsu --cache=/tmp/osm-seongsu   # Overpass 공개 서버가 자주 붐빈다. --cache 로 받은 응답을 남겨 두면 손질만 다시 굽는다
```

- 부하: 렌더 배율 1, bloom 절반 해상도, 강 반사는 512² 다. 1920×1080 실제 Chrome 에서 비행 내내 60fps 였고,
  첫 0.5초는 도시 형상을 만드느라 멈추지만 글자 연출(합성 단계 전환)이라 보이지 않는다. 넘긴 뒤 앞머리의 WebGL 을 버려 그래픽 메모리를 돌려준다.

## WASM 은 커밋하지 않는다

`public/web-ifc.wasm` 은 `scripts/sync-wasm.mjs` 가 node_modules 에서 복사한다. 릴리스 바이트
그대로여야 버전 올리기가 재배치가 아니라 설치 한 번으로 끝난다. `predev`·`prebuild`·`pree2e`
에 걸려 있어서 따로 부를 일은 없다.

## DT 와의 데이터 교환 방식은 아직 열려 있다

PRD 1.7 은 DT 와의 데이터 교환 방식을 셋으로 열어 두고 개발 확인이 필요하다고 적었다
(① 파일 export→import ② 온톨로지 서버에 API 로 직접 쓰기 ③ 공유 DB). 지금 이 repo 는
①을 전제로 만들어져 있다. ②·③ 으로 정해지면 서버가 생기고, 그때 부모 `~/git/dt/CLAUDE.md`(플랫폼 공통 규칙)의
"새 서비스를 붙일 때" 다섯 단계가 전부 걸린다.
