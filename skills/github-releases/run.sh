#!/usr/bin/env bash
set -euo pipefail

repo="${1:-}"
count="${2:-3}"

if [[ -z "$repo" ]]; then
  echo "usage: run.sh <owner/repo> [count]" >&2
  exit 2
fi

if ! [[ "$count" =~ ^[0-9]+$ ]] || (( count < 1 )) || (( count > 20 )); then
  echo "count must be 1..20" >&2
  exit 2
fi

http=$(curl -sS -o /tmp/releases.$$.json -w '%{http_code}' \
  "https://api.github.com/repos/${repo}/releases?per_page=${count}")

if [[ "$http" != "200" ]]; then
  echo "github api returned http=${http}" >&2
  rm -f /tmp/releases.$$.json
  exit 3
fi

jq '[.[] | {tag_name, published_at, name}]' < /tmp/releases.$$.json
rm -f /tmp/releases.$$.json
