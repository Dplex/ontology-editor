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
**55 에서 `npm run fetch:sample` 은 안 된다** — 2026-09-23 실측으로 GitHub·tib.eu·npm 레지스트리에 전부
닿지 않았다. 개발 PC 의 `data/` 에서 IFC 만 복사한다:
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

## WASM 은 커밋하지 않는다

`public/web-ifc.wasm` 은 `scripts/sync-wasm.mjs` 가 node_modules 에서 복사한다. 릴리스 바이트
그대로여야 버전 올리기가 재배치가 아니라 설치 한 번으로 끝난다. `predev`·`prebuild`·`pree2e`
에 걸려 있어서 따로 부를 일은 없다.

## DT 와의 데이터 교환 방식은 아직 열려 있다

PRD 1.7 은 DT 와의 데이터 교환 방식을 셋으로 열어 두고 개발 확인이 필요하다고 적었다
(① 파일 export→import ② 온톨로지 서버에 API 로 직접 쓰기 ③ 공유 DB). 지금 이 repo 는
①을 전제로 만들어져 있다. ②·③ 으로 정해지면 서버가 생기고, 그때 부모 `~/git/dt/CLAUDE.md`(플랫폼 공통 규칙)의
"새 서비스를 붙일 때" 다섯 단계가 전부 걸린다.
