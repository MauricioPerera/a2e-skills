#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: run.sh <message>" >&2
  exit 2
fi

printf '[%s] %s\n' "$(date -u +%FT%TZ)" "$1"
