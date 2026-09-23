#!/usr/bin/env bash
#
# ontology-editor 를 빌드해서 정적 서버(scripts/serve.mjs)로 띄운다.
#
#   scripts/run.sh start      빌드하고 백그라운드로 띄운 뒤 healthz 가 뜰 때까지 기다린다
#   scripts/run.sh stop
#   scripts/run.sh restart
#   scripts/run.sh status
#   scripts/run.sh logs
#   scripts/run.sh build      빌드만 한다
#   scripts/run.sh fg         포그라운드로 띄운다 (Ctrl-C 로 끝낸다)
#
# ieum-artifact·ieum-gateway 의 run.sh 와 같은 인터페이스다. 배포가 repo 마다 다른 모양이
# 되지 않게 맞춘 것이니 여기만 다른 이름을 쓰지 말 것.
#
# 개발할 때는 이것이 아니라 `npm run dev`(5174)를 쓴다. 이 스크립트는 빌드한 번들을 내준다.
#
# **왜 pid 파일을 쓰나:** `ssh 'nohup ... &'` 로 띄우면 세션이 닫힐 때 같이 죽는다.
# 세션에서 떼어내고 pid 를 남겨 두면 stop 과 status 가 추측 없이 된다.
#
# .env 가 있으면 읽되, 이미 환경에 있는 값은 덮어쓰지 않는다:
#   ONTOLOGY_EDITOR_ADDR=127.0.0.1:9999 scripts/run.sh fg
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ -f .env ]]; then
  while IFS='=' read -r k v; do
    [[ -z "$k" || "$k" == \#* ]] && continue
    [[ -n "${!k:-}" ]] || export "$k=$v"
  done < .env
fi

# cron·ssh 의 PATH 에는 /usr/local/bin 이 빠지기도 한다. node 가 거기 있다.
export PATH="/usr/local/bin:$PATH"

ADDR="${ONTOLOGY_EDITOR_ADDR:-0.0.0.0:8084}"
export ONTOLOGY_EDITOR_ADDR="$ADDR"
PORT="${ADDR##*:}"
PIDFILE="$ROOT/run/ontology-editor.pid"
LOGFILE="$ROOT/log/ontology-editor.log"
mkdir -p "$ROOT/run" "$ROOT/log"

pid() { [[ -f "$PIDFILE" ]] && cat "$PIDFILE" || true; }
alive() { local p; p="$(pid)"; [[ -n "$p" ]] && kill -0 "$p" 2>/dev/null; }

build() {
  # prebuild 가 node_modules 의 web-ifc.wasm 을 public/ 으로 복사하고, vue-tsc 가 타입을 본다.
  npm run build
}

wait_health() {
  local i
  for i in $(seq 1 15); do
    [[ "$(curl -s -o /dev/null -w '%{http_code}' -m 3 "http://127.0.0.1:$PORT/healthz" || true)" == 200 ]] && return 0
    sleep 1
  done
  echo "!! 15초 안에 http://127.0.0.1:$PORT/healthz 가 200 을 안 줬다. 로그:" >&2
  tail -n 20 "$LOGFILE" >&2 || true
  return 1
}

start() {
  if alive; then
    echo "이미 떠 있다 (pid $(pid))"
    return 0
  fi
  build
  # setsid 로 세션에서 떼어낸다. 부른 ssh 가 닫혀도 안 죽는다.
  setsid node scripts/serve.mjs >>"$LOGFILE" 2>&1 < /dev/null &
  echo $! >"$PIDFILE"
  wait_health
  echo "떴다 · pid $(pid) · http://$ADDR"
}

stop() {
  if ! alive; then
    rm -f "$PIDFILE"
    echo "안 떠 있다"
    return 0
  fi
  local p; p="$(pid)"
  kill "$p"
  for _ in $(seq 1 10); do kill -0 "$p" 2>/dev/null || break; sleep 0.5; done
  kill -0 "$p" 2>/dev/null && kill -9 "$p"
  rm -f "$PIDFILE"
  echo "내렸다 (pid $p)"
}

case "${1:-}" in
  start) start ;;
  stop) stop ;;
  restart) stop; start ;;
  status)
    if alive; then echo "running · pid $(pid) · $ADDR"; else echo "stopped"; fi
    ;;
  logs) tail -n "${2:-100}" -f "$LOGFILE" ;;
  build) build ;;
  fg) build; exec node scripts/serve.mjs ;;
  *) sed -n '3,11p' "$0"; exit 2 ;;
esac
