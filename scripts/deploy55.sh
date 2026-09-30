#!/usr/bin/env bash
# 55(dt-dev) **위에서** 돌린다. origin/main 을 받아 번들을 다시 빌드하고 정적 서버를 재시작한다.
#
#   ssh 55 'cd /home/dt/git/dt/ontology-editor && scripts/deploy55.sh'
#
#   --no-pull     git pull 을 건너뛴다 (이미 받아 뒀을 때)
#   --no-restart  받기만 하고 빌드·재시작하지 않는다
#
# 다른 네 repo 와 같은 이름·같은 인자다. **밤 자동 배포에는 넣지 않는다** — PoC 라 원할 때 손으로 부른다.
# 이 서버는 API 가 없어서 재시작해도 다른 서비스가 끊기지 않는다.
set -euo pipefail

# 가드는 호스트명이 아니라 주소로 건다. 개발 PC 와 55 의 이름이 겹친 적이 있다.
DT_SERVER_IP="${DT_SERVER_IP:-10.251.35.55}"
if ! hostname -I 2>/dev/null | tr " " "\n" | grep -qx "$DT_SERVER_IP"; then
  echo "!! 이 스크립트는 55(dt-dev · $DT_SERVER_IP) 위에서만 돈다." >&2
  echo "   지금 기계의 주소: $(hostname -I 2>/dev/null)" >&2
  echo "   ssh 55 'cd /home/dt/git/dt/ontology-editor && scripts/deploy55.sh'" >&2
  exit 1
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PULL=1
RESTART=1
for a in "$@"; do
  case "$a" in
    --no-pull)    PULL=0 ;;
    --no-restart) RESTART=0 ;;
    *) echo "모르는 인자: $a" >&2; exit 2 ;;
  esac
done

say() { printf '\n\033[36m==>\033[0m %s\n' "$*"; }
export PATH="/usr/local/bin:$PATH"

before="$(git rev-parse HEAD:package-lock.json 2>/dev/null || true)"
if [[ $PULL -eq 1 ]]; then
  say "git pull"
  git pull --ff-only
fi

# 의존성은 lock 이 바뀌었을 때만 다시 받는다. node_modules 는 gitignore 라 pull 로 안 오고,
# 옛 node_modules 로 빌드하면 lock 과 다른 버전의 web-ifc 가 번들에 들어간다.
if [[ ! -d node_modules || "$before" != "$(git rev-parse HEAD:package-lock.json)" ]]; then
  say "npm ci (lock 이 바뀌었거나 node_modules 가 없다)"
  npm ci --no-audit --no-fund
fi

if [[ $RESTART -eq 0 ]]; then
  say "빌드·재시작은 건너뛴다. 반영하려면 scripts/run.sh restart"
  exit 0
fi

say "빌드 + 재시작 (run.sh)"
scripts/run.sh restart
