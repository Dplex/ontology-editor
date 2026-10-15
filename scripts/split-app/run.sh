#!/bin/bash
# App.vue(16,815줄)를 src/editor/*.ts(상태·동작)와 src/components/editor/*.vue(화면 조각)로 나눈 도구. 손으로 옮기지 않고
# 이 도구로 만들어서, 나누기 전 App.vue 와 같은 코드가 자리만 옮겼음을 다시 만들어 보며 확인할 수 있다.
#
#   scripts/split-app/run.sh <나누기 전 App.vue 가 있는 커밋>      예) scripts/split-app/run.sh origin/main
#
# 그 커밋의 App.vue 를 읽어 src/editor/, src/components/editor/, src/App.vue 를 새로 쓴다(있던 것은 지운다).
# 어디서 자를지는 parts.mjs(스크립트의 섹션 머리 → 모듈, 템플릿의 요소 → 컴포넌트). 짜임은 docs/dev/app-structure.md.
# 나눈 뒤 main 에 App.vue 를 고친 PR 이 들어오면 그 커밋으로 다시 돌려 맞춘다. 나누기가 main 에 들어가면 지운다.
set -e
REV=${1:?나누기 전 App.vue 가 있는 커밋}
REPO=$(git -C "$(dirname "$0")" rev-parse --show-toplevel)
D=$(cd "$(dirname "$0")" && pwd)
TMP=$(mktemp -d)
git -C "$REPO" show "$REV:src/App.vue" > "$TMP/App.orig.vue"
export ORIG=$TMP/App.orig.vue
rm -rf "$REPO/src/editor" "$REPO/src/components/editor"
node "$D/analyze.mjs" "$REPO" "$TMP/a.json" | head -1
node "$D/gen.mjs" "$REPO" "$TMP/a.json" --write | grep -v '^  즉시 labels:.* replay →'
