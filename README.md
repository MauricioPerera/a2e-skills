# a2e-skills

Reference knowledge-base repo consumed by LLM agents via [a2e-shell](../a2e-shell) (or any compatible catalog consumer).

**Pattern**: tree-first, blob-on-demand. An `index` orphan branch, auto-regenerated from content on every push, carries a small manifest plus one JSON partition per category. Agents clone `index` cheaply, pay blob cost only for what they hydrate.

## Categories

Four fixed in v1:

| Category | Layout | Contains | Required frontmatter |
|---|---|---|---|
| `skills/` | `skills/<name>/SKILL.md` + entry file | Executable units | `name`, `when_to_use`, `description`, `entry`, `args`, `requires` |
| `docs/` | `docs/<name>.md` | Reference documentation | `name`, `title`, `summary` |
| `prompts/` | `prompts/<name>.md` | Prompt templates | `name`, `purpose`, `description`, `input_vars` |
| `templates/` | `templates/<name>.md` | Output templates | `name`, `purpose`, `format`, `description` |

Full authoring rules: [CONVENTION.md](./CONVENTION.md). **Strict** — invalid frontmatter fails CI; no soft-fallback.

## The index branch

Orphan branch with no shared history. CI force-pushes a regenerated snapshot on every content change. An agent can clone it shallow:

```bash
git clone --single-branch --branch index --depth=1 <repo> /catalog
cat /catalog/manifest.json
cat /catalog/skills.json
```

Layout:

```
manifest.json         ← list of categories with sizes + sha256
skills.json           ← { schema_version, category, entries: { <name>: {..., entry_path, entry_sha, requires, args, ...} } }
docs.json
prompts.json
templates.json
```

Full schema: [INDEX-SCHEMA.json](./INDEX-SCHEMA.json).

## How agents consume it via a2e-shell

```json
{
  "catalog": {
    "repo_url": "https://github.com/org/knowledge",
    "index_ref": "index",
    "content_ref": "main",
    "auth": { "type": "token", "env_var": "GITHUB_TOKEN" }
  }
}
```

a2e-shell clones both refs into the session, computes reachability (skills whose `requires` are all in `binaries_allowlist`), and exposes via subprocess env:

- `$A2E_CATALOG_INDEX` — path to index partitions
- `$A2E_CATALOG_CONTENT` — path to content files
- `$A2E_CATALOG_REACHABILITY` — path to `reachability.json`

See [a2e-shell/docs/CATALOG.md](../a2e-shell/docs/CATALOG.md) for the full integration contract.

## Local development

Requires Node 22.

```bash
npm ci
npm run check           # validates every entry against the schema; no output files
npm run gen-index       # emits manifest + partitions into .index-out/
npm run typecheck
```

### Before pushing

CI runs `npm run check` as a gate. If any `SKILL.md` / `docs/*.md` / `prompts/*.md` / `templates/*.md` has invalid frontmatter, mismatched name, or missing `entry` file → **CI fails, merge blocked**. Fix the offending file, not the generator.

### Adding a category

Not supported in v1 — categories are hardcoded in `tools/gen-index.ts`. A future extension will read a `categories.yaml` from the repo root.

## The generator pipeline

On push to any branch that touches `skills/`, `docs/`, `prompts/`, `templates/`, `tools/`, or `INDEX-SCHEMA.json`:

```
.github/workflows/regen-index.yml
  ├── checkout
  ├── npm ci
  ├── npm run typecheck                 # generator compiles
  ├── npm run check                     # STRICT validation of every entry
  ├── npm run gen-index                 # emits .index-out/{manifest,<cats>}.json
  └── tools/push-index.sh               # force-pushes an orphan init commit to `index` branch
```

The `index` branch is overwritten atomically. Tags / branches like `index-2026-04-19` can be pushed alongside if you want an immutable reference.

## What NOT to put here

- Secrets or credentials (even encrypted — use your existing secret management)
- Binary assets larger than a few MB (use Git LFS or an object store, reference by URL from doc frontmatter)
- Dynamic data (metrics, inventory, user state) — catalog is static-at-commit
- Category-specific extensions that require scanner changes (yet) — propose a convention extension first

## Samples

Each category has one `example-*` placeholder. Delete when the repo has real content; keep the structure as a reference for new authors.

## License

(whatever your project policy — intentionally unset in the reference repo).
