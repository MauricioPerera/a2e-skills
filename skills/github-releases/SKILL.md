---
name: github-releases
when_to_use: when the user asks for the latest release(s) of a GitHub repo — tag, publish date, release name
description: >
  Fetches the N most recent releases of a GitHub repository via the public
  releases API and formats tag, published_at, and name as a compact JSON
  array. Uses `jq` projection so the exec preview never overflows 2KB.
entry: run.sh
args:
  - name: repo
    type: string
    required: true
    description: "owner/repo — e.g. microsoft/TypeScript"
  - name: count
    type: integer
    required: false
    description: "How many releases to return. Defaults to 3. Max 20."
requires: [curl, jq]
---

## Behavior

1. Validates `count` is between 1 and 20 (defaults 3).
2. GETs `https://api.github.com/repos/<repo>/releases?per_page=<count>`.
3. Projects each release with `jq` to `{tag_name, published_at, name}` — drops
   `body`, `assets`, `author`, and all other large fields so the subprocess
   stdout stays under a few KB even for a full 20-release list.
4. Prints the resulting JSON array on stdout.

The agent should bind the result with `bind_as` if it intends to reference
specific fields across multiple turns (e.g. formatting per release). Since
the canonical output shape will be `json<Array<Object>>[N]`, the preview is
already the parsed array — no need to re-run with a different command.

## Exit codes

- `0` — success
- `2` — missing `repo` argument
- `3` — GitHub API returned a non-200 status (e.g. rate limit, not found)

## Why this skill exists

Without guidance, models often call `curl ... | head -n 3` which cuts the
JSON stream mid-object, producing malformed text that makes the model
hallucinate the rest. This skill enforces the `jq`-project-then-emit path
so the preview is always valid structured data.
