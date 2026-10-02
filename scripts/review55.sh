#!/usr/bin/env bash
# 55(dt-dev) **위에서** 돈다. 검토 판(`review` 브랜치)을 main 과 따로 된 트리에 받아 테스트하고 8087 로 띄운다.
# 8084 의 main 판(deploy55.sh)은 건드리지 않는다. 보통은 Actions(review.yml)가 부른다.
#
#   scripts/review55.sh <git 저장소 경로 또는 URL> [ref]     ref 기본은 review
#
# 트리는 /home/dt/review/ontology-editor 다. main 판과 pid·로그·dist 가 섞이지 않게 따로 둔다.
#
# **data/ 는 하드링크로 따로 둔다.** 등급 캐시(data/.profiles.json)는 src/lib 지문이 바뀌면 다시 잰다.
# 두 판이 한 data/ 를 쓰면 main 과 review 가 번갈아 캐시를 버리고 다시 재느라(성수 1분 가까이) 둘 다 멈춘다.
# 하드링크라 IFC 를 복사하지 않고(같은 디스크), 캐시 파일만 따로 생긴다.
set -euo pipefail

DT_SERVER_IP="${DT_SERVER_IP:-10.251.35.55}"
if ! hostname -I 2>/dev/null | tr " " "\n" | grep -qx "$DT_SERVER_IP"; then
  echo "!! 이 스크립트는 55(dt-dev · $DT_SERVER_IP) 위에서만 돈다." >&2
  exit 1
fi

SRC="${1:?저장소 경로나 URL 을 준다}"
REF="${2:-review}"
DIR="${REVIEW_DIR:-/home/dt/review/ontology-editor}"
MAIN_DATA="${MAIN_DATA:-/home/dt/git/dt/ontology-editor/data}"
export ONTOLOGY_EDITOR_ADDR="${REVIEW_ADDR:-0.0.0.0:8087}"
export ONTOLOGY_EDITOR_DATA="$DIR/data"
export PATH="/usr/local/bin:$HOME/.local/bin:$PATH"

say() { printf '\n\033[36m==>\033[0m %s\n' "$*"; }

# REVIEW_KEY: 판을 가리는 열쇠(main + 넣은 PR 의 head). 지난번에 띄운 것과 같으면 아무것도 안 한다.
# REVIEW_INFO: 화면에서 Alt+Shift+R 로 볼 정보(JSON). 있으면 빌드한 dist/ 에 끼워 넣는다.
KEYFILE="$DIR/run/review-key"
if [[ -n "${REVIEW_KEY:-}" && -f "$KEYFILE" && "$(cat "$KEYFILE")" == "$REVIEW_KEY" ]] && \
   ONTOLOGY_EDITOR_ADDR="$ONTOLOGY_EDITOR_ADDR" "$DIR/scripts/run.sh" status | grep -q running; then
  say "지난번과 같은 판이 떠 있다. 건너뛴다"
  [[ -n "${GITHUB_OUTPUT:-}" ]] && echo "skipped=1" >> "$GITHUB_OUTPUT"
  exit 0
fi

if [[ ! -d "$DIR/.git" ]]; then
  say "트리를 처음 만든다: $DIR"
  mkdir -p "$(dirname "$DIR")"
  git init -q "$DIR"
fi
cd "$DIR"

before="$(git rev-parse -q --verify HEAD:package-lock.json 2>/dev/null || true)"
say "받기: $SRC $REF"
git fetch -q "$SRC" "$REF"
git reset -q --hard FETCH_HEAD
# gitignore 된 node_modules·data·run·log 는 남기고 추적 안 되는 파일만 지운다
git clean -qfd
echo "$(git log --oneline -1)"

if [[ ! -d node_modules || "$before" != "$(git rev-parse HEAD:package-lock.json)" ]]; then
  say "npm ci (lock 이 바뀌었거나 node_modules 가 없다)"
  npm ci --no-audit --no-fund
fi

if [[ -d "$MAIN_DATA" ]]; then
  say "data/ 하드링크 맞추기 ($MAIN_DATA)"
  mkdir -p data
  # 원본에서 지워진 파일은 지우고 캐시는 남긴다
  find data -mindepth 1 \( -name .profiles.json -prune \) -o -type f -print0 | xargs -0r rm -f
  (cd "$MAIN_DATA" && find . -type f ! -name .profiles.json -print0) | while IFS= read -r -d '' f; do
    mkdir -p "data/$(dirname "$f")"
    ln -f "$MAIN_DATA/$f" "data/$f"
  done
  find data -mindepth 1 -type d -empty -delete
fi

say "npm test"
npm test

# 빌드를 먼저 끝내고 재시작한다. 빌드가 깨지면 떠 있던 8087 을 내리지 않는다.
say "빌드"
scripts/run.sh build

# 검토 판에만 붙는 정보 창. 앱 코드(src)가 아니라 빌드 결과에 끼워 넣어서 main 판(8084)에는 없다.
if [[ -n "${REVIEW_INFO:-}" && -f "$REVIEW_INFO" ]]; then
  say "정보 창 끼워 넣기 (Alt+Shift+R)"
  { printf 'window.__REVIEW__ = %s;\n' "$(cat "$REVIEW_INFO")"; cat scripts/review-info.js; } > dist/review-info.js
  sed -i 's#</body>#<script src="/review-info.js"></script></body>#' dist/index.html
  grep -q review-info.js dist/index.html
fi

say "재시작 ($ONTOLOGY_EDITOR_ADDR)"
NO_BUILD=1 scripts/run.sh restart
mkdir -p run
[[ -z "${REVIEW_KEY:-}" ]] || echo "$REVIEW_KEY" > "$KEYFILE"
