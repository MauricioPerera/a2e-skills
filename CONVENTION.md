# Authoring convention

STRICT. Any violation → CI fails → merge blocked. Fix at authoring time is cheaper than fix at runtime.

## Categories

Four fixed categories. Each has its own layout.

| Category | Layout | Required files |
|---|---|---|
| `skills/` | directory per entry | `SKILL.md` + entry file referenced by frontmatter |
| `docs/` | flat markdown | `<name>.md` |
| `prompts/` | flat markdown | `<name>.md` |
| `templates/` | flat markdown | `<name>.md` |

### Naming

Every entry `name` MUST:

- Match `^[a-z][a-z0-9-]{1,62}$` (lowercase kebab-case)
- Match the directory or filename exactly
  - `skills/refund-order/` → `name: refund-order`
  - `docs/stripe-api.md` → `name: stripe-api`
- Be unique within its category (duplicates across categories are allowed)

## Skill entry

Directory `skills/<name>/` with at minimum:

- `SKILL.md` (frontmatter + body)
- The `entry` file referenced by frontmatter (typically a `.sh` script, any executable file is acceptable)

Optional: `tests/`, `README.md`, auxiliary files — ignored by the scanner.

### `SKILL.md` frontmatter

```yaml
---
name: refund-order
when_to_use: one-line trigger hint for the LLM
description: |
  Full LLM-readable description. Used when the agent hydrates the SKILL.
entry: run.sh
args:
  - { name: order_id, type: string, required: true, description: Shopify order id }
  - { name: reason,   type: string, required: false, description: refund reason note }
requires: [curl, jq]
---
```

Rules:

- `name`, `when_to_use`, `description`, `entry` are REQUIRED.
- `args` is REQUIRED; use `[]` explicitly when the skill takes none.
- `requires` is REQUIRED; list every external binary the entry invokes. Session capability policy validates against this list before hydration.
- `args[].type` ∈ `{string, number, boolean, path}`.
- `entry` must refer to a file that exists inside the skill directory.

## Doc entry

Flat file `docs/<name>.md`.

```yaml
---
name: stripe-api
title: Stripe REST API — reference
summary: one-line summary used in agent catalogs
topics: [payments, stripe, http-api]
---
Markdown body. No length limit, but remember: hydration cost is your responsibility.
```

Required: `name`, `title`, `summary`. `topics` optional (array of strings).

## Prompt entry

Flat file `prompts/<name>.md`.

```yaml
---
name: pr-review
purpose: Produce a structured code-review report for a diff
input_vars:
  - { name: diff,  required: true,  description: unified diff to review }
  - { name: focus, required: false, description: optional emphasis area }
description: |
  When to use this prompt and what shape of output it produces.
---
Full prompt body. Placeholders use {{var_name}} convention (interpolation is the caller's responsibility).
```

Required: `name`, `purpose`, `description`. `input_vars` REQUIRED; use `[]` if the prompt is parameterless.

## Template entry

Flat file `templates/<name>.md`.

```yaml
---
name: followup-email
purpose: Post-resolution customer follow-up in a formal tone
format: markdown
description: |
  Rules on tone, length, placeholders, etc.
---
Template body with {{placeholders}}.
```

Required: `name`, `purpose`, `format`, `description`. `format` ∈ `{markdown, html, json, yaml, sql, text}`.

## What the scanner does

For every candidate file:

1. Load file; extract frontmatter via `gray-matter`.
2. Validate frontmatter against the per-category JSON Schema in [INDEX-SCHEMA.json](./INDEX-SCHEMA.json).
3. Enforce the name/path rule.
4. For skills: verify `entry` file exists and resolve its git blob SHA.
5. On any failure: CI exits non-zero with a line-referenced error list.

## What is NOT in scope

- Live data (runbooks referencing metrics, dashboards) — out of the repo pattern.
- Binary assets — use Git LFS pointers; the scanner only resolves text blobs.
- Cross-category linking — each entry is standalone.
- Translation / localization — if needed, use suffixes `<name>.en.md` and add a category convention. Not supported in v1.

## Failure modes you WILL hit

- Directory name ≠ frontmatter `name` → fail.
- `entry` references a missing file → fail.
- YAML frontmatter malformed → fail with yq line number.
- Two entries in the same category with the same `name` → fail.
- `requires` listing a binary the validator cannot find in the default PATH at scan time → WARNING, not failure (the session's capability policy is what enforces; here we only warn for obvious typos).
