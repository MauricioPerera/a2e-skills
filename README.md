# a2e-skills

Reference knowledge-base repo consumed by LLM agents (e.g. via [a2e-shell](../a2e-shell)).

**Pattern**: tree-first, blob-on-demand. An `index` orphan branch is auto-regenerated from the content branches and carries a small manifest plus one JSON partition per category. Agents clone `index` cheaply and hydrate specific blobs from content branches as needed.

## Layout

```
skills/<name>/SKILL.md  + <entry-file>   # executable units
docs/<name>.md                            # reference documentation
prompts/<name>.md                         # prompt templates
templates/<name>.md                       # output templates
```

See [CONVENTION.md](./CONVENTION.md) for exact authoring rules (STRICT — CI fails on violations).

## How the index is produced

1. Push to any branch other than `index` (matching paths under the four category dirs) triggers `.github/workflows/regen-index.yml`.
2. CI runs `tools/gen-index.ts`, which:
   - Scans the four category dirs
   - Validates every entry's frontmatter against [INDEX-SCHEMA.json](./INDEX-SCHEMA.json)
   - Resolves git blob SHAs for referenced files
   - Emits `manifest.json` + `{skills,docs,prompts,templates}.json`
3. CI commits the output as a force-push to the `index` branch (orphan history).
4. Agents consume `origin/index` and never touch content branches unless hydrating.

Invalid frontmatter → CI fails → merge blocked. Zero-drift by construction.

## How an agent consumes this

```
git clone --single-branch --branch index --depth=1 <url> /session/catalog
cat /session/catalog/manifest.json                      # 2–5KB
cat /session/catalog/skills.json | jq '.entries["refund-order"]'
git show origin/main:skills/refund-order/run.sh         # hydrate only what's needed
```

`manifest.json` has a SHA for each partition and a `source_sha` pinning the content commit the index was generated from. Agents that need reproducibility pin the `index` commit SHA at session start.

## Local dev

```
npm ci
npm run gen-index        # writes .index-out/*.json
npm run check            # validates every entry without emitting
```

Node 22 only. No runtime deps beyond `gray-matter` and `ajv`.
