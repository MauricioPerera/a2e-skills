---
name: example-echo
when_to_use: illustrates the SKILL convention; echoes a message with a UTC timestamp prefix
description: |
  Minimal skill provided as a reference implementation of the SKILL format.
  Takes one string argument and prints it prefixed with the current UTC timestamp.
  Not intended for production use by agents — delete when the repo has real content.
entry: run.sh
args:
  - name: message
    type: string
    required: true
    description: text to echo back
requires: [date, printf]
---

## Behavior

Invokes `date -u +%FT%TZ` to produce an ISO-8601 UTC timestamp, then `printf '[%s] %s\n'`
to emit `[<timestamp>] <message>` on stdout.

Exit codes:
- `0` on success
- `2` when no argument is supplied
