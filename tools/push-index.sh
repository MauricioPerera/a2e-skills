#!/usr/bin/env bash
# push-index — force-push the generated .index-out/ as the orphan `index` branch.
# Requires: git, a pushable remote named `origin`, push permission (PAT or deploy key).
# Env:
#   INDEX_OUT_DIR   directory containing manifest.json and partitions (default: .index-out)
#   INDEX_REMOTE    remote name (default: origin)
#   INDEX_BRANCH    target branch name (default: index)

set -euo pipefail

OUT_DIR="${INDEX_OUT_DIR:-.index-out}"
REMOTE="${INDEX_REMOTE:-origin}"
BRANCH="${INDEX_BRANCH:-index}"

if [[ ! -f "$OUT_DIR/manifest.json" ]]; then
  echo "error: $OUT_DIR/manifest.json not found; run gen-index first" >&2
  exit 1
fi

SOURCE_SHA="$(git -C . rev-parse HEAD)"
TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

cp -R "$OUT_DIR"/. "$TMPDIR/"

cd "$TMPDIR"
git init --quiet --initial-branch="$BRANCH"
git config user.name  "${GIT_AUTHOR_NAME:-index-bot}"
git config user.email "${GIT_AUTHOR_EMAIL:-index-bot@users.noreply.github.com}"
git add -A
git commit --quiet -m "index: regen from ${SOURCE_SHA}"

REMOTE_URL="$(git -C "$OLDPWD" remote get-url "$REMOTE")"
git remote add origin "$REMOTE_URL"
git push --force --quiet origin "$BRANCH":"$BRANCH"

echo "OK: pushed ${BRANCH} @ ${SOURCE_SHA:0:12} to ${REMOTE_URL}"
