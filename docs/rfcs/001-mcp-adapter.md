# RFC 001 — a2e-skills as MCP-serveable substrate (outbound)

| | |
|---|---|
| **Status** | Draft |
| **Author** | Mauricio Perera |
| **Created** | 2026-04-19 |
| **Target implementation** | new repo — tentative name `mcp-serve-catalog` |
| **Companion RFC** | `a2e-shell` RFC 001 — MCP gateway (inbound) |

## Summary

Define a thin, stateless adapter that exposes any a2e-skills catalog repo as a fully-functional **MCP server**. `skills/` maps to MCP **tools**, `docs/` to **resources**, `prompts/` to **prompts**. The adapter is a separate lightweight project (~200-400 lines) that mounts a cloned a2e-skills repo and translates MCP JSON-RPC requests into catalog reads + skill execution.

Result: **a2e-skills becomes distributable as an MCP server via git** — no database, no state, no per-server deployment story. Any MCP client (Claude Desktop, Cursor, or anything future) consumes it identically to any other MCP server. The "server" is the adapter + a git checkout.

## Motivation

The current MCP landscape requires each capability provider to run a dedicated process: a Node/Python server with auth, deploy, monitoring, state, scaling. For capabilities that are **read-heavy with review-based writes** (knowledge bases, skill catalogs, reference docs, prompt libraries, templated workflows), this is wildly over-engineered.

The a2e-skills catalog format already encodes these capabilities as files in a git repo:

- `skills/<name>/SKILL.md` — frontmatter describes args + requires, `run.sh` executes
- `docs/<name>.md` — frontmatter + body
- `prompts/<name>.md` — frontmatter with `input_vars`, body is the template

This RFC specifies a protocol-compliant adapter that makes that git repo consumable by **any** MCP client — without changing the repo format, without running a stateful server per catalog.

Economic impact per catalog maintainer: **eliminates the "deploy a server" step**. Your skill library is a git repo, reviewed via PR, versioned by commit, served from a CDN or mounted on a thin gateway. Zero ops for the content side.

## Non-goals

- Writes via MCP (the MCP spec doesn't really define content-creation semantics for catalogs). Writes continue through git PRs — that's the whole point.
- Replacing language-specific MCP servers (GitHub's, Postgres', etc.). Those expose their own runtime state. This RFC targets the **content catalog** niche.
- `sampling/createMessage` — this adapter is strictly server-side, no client capabilities.

## Design

### 1. Adapter architecture

```
┌──────────────────────────────┐
│  MCP client                  │  (Claude Desktop, Cursor,
│  (any transport: http/sse/stdio) │   a2e-shell's RFC 001 gateway, etc.)
└────────────┬─────────────────┘
             │ JSON-RPC 2.0
             ▼
┌──────────────────────────────┐
│  mcp-serve-catalog           │  ← this project
│  ├─ router: method → handler │
│  ├─ skills → tools           │
│  ├─ docs   → resources       │
│  ├─ prompts → prompts         │
│  └─ subprocess for tool exec │
└────────────┬─────────────────┘
             │ filesystem reads + spawn
             ▼
┌──────────────────────────────┐
│  Local a2e-skills checkout   │
│  ├─ index branch (shallow)   │  ← manifest + partitions
│  └─ main branch (partial)    │  ← SKILL.md, run.sh, docs, prompts
└──────────────────────────────┘
```

The adapter is **stateless per request**. It holds:

- Open transport connections (HTTP server, SSE streams, stdio handle)
- A filesystem path to the catalog checkout
- An in-memory cache of parsed partition files (invalidated on signal or timer)

Everything else derives from the filesystem on each request.

### 2. Protocol mapping

| MCP method | a2e-skills source | Adapter behavior |
|---|---|---|
| `initialize` | static capabilities | Declare `tools + resources + prompts`; no client capabilities required |
| `tools/list` | `<catalog>/skills.json` | Read partition, reshape each entry into MCP `Tool` schema |
| `tools/call` | `<catalog>/skills/<name>/run.sh` | Spawn the entry script with mapped args; wrap stdout as MCP `CallToolResult` |
| `notifications/tools/list_changed` | git hook / polling | Emit when catalog index commit changes |
| `resources/list` | `<catalog>/docs.json` | Read partition, reshape into MCP `Resource` schema with `catalog://` URI prefix |
| `resources/read` | `<catalog>/docs/<name>.md` | Read file, return as MCP `ResourceContents` (text or blob) |
| `resources/templates/list` | (optional v2) | Expose parametric URIs — e.g. `catalog://skills/{name}/schema` |
| `prompts/list` | `<catalog>/prompts.json` | Read partition, reshape into MCP `Prompt` schema |
| `prompts/get` | `<catalog>/prompts/<name>.md` | Parse frontmatter + body, substitute `input_vars` with `arguments`, return as MCP `GetPromptResult` |
| `logging/setLevel` | internal | Adjust adapter's own log verbosity |
| `notifications/message` | internal | Forward adapter log events if client subscribed |

### 3. URI scheme

MCP resources use URIs. a2e-skills uses file paths. The adapter uses a synthetic scheme:

```
catalog://<category>/<name>
```

Examples:
- `catalog://docs/authoring-skills` → `<catalog>/docs/authoring-skills.md`
- `catalog://skills/github-releases/schema` → synthesized schema extracted from SKILL.md frontmatter
- `catalog://prompts/code-review/source` → raw prompt body before substitution

The scheme is internal to the adapter — the MCP client only sees URIs as opaque strings.

### 4. Tool call execution

```
tools/call { name: "github-releases", arguments: { repo: "microsoft/TypeScript", count: 3 } }
  ↓
1. Look up skills.json[entries][github-releases]
2. Validate arguments against args schema (type checks + required)
3. Set up env:
   - pass allowed env vars (respecting any allowlist config)
   - set A2E_CATALOG_INDEX, A2E_CATALOG_CONTENT to the mount paths
4. spawn <catalog>/skills/github-releases/run.sh microsoft/TypeScript 3
   - cwd: a session-scoped tmpdir (or configured)
   - timeout: configurable (default 30s)
   - stdin: arguments.stdin if provided
5. Collect stdout, stderr, exit code
6. Wrap as CallToolResult:
   - content: [{ type: "text", text: stdout }]
   - isError: exit_code !== 0
```

The adapter does NOT implement a2e-shell's canonical response format (preview/shape/binding). That's a2e-shell's concern — this adapter speaks vanilla MCP so any client (disciplined or not) can consume it.

a2e-shell consumes it via RFC 001 gateway and applies its own canonical wrapping on top.

### 5. Configuration

```
CATALOG_PATH        required. Filesystem path to the a2e-skills checkout.
TRANSPORT           one of: "http" | "sse" | "stdio". Default "http".
PORT                for http/sse transports. Default 8787.
ALLOWLIST_BINARIES  comma-separated. Skills requiring anything outside this fail tools/call with isError=true.
EXEC_TIMEOUT_MS     per tool call. Default 30000.
CACHE_TTL_MS        how long to cache parsed partitions. Default 60000.
LOG_LEVEL           debug | info | warn | error. Default info.
```

No auth config — auth is expected to be handled at the ingress layer (reverse proxy with bearer, CF Access, mTLS, etc.). The adapter itself is behind whatever gate the operator chooses. If none, it's open.

### 6. Transports

- **HTTP**: POST `/mcp` with JSON-RPC body. Simplest. Request/response; no long-lived connection. Good for serverless (CF Workers, Lambda).
- **SSE**: POST `/mcp/sse` to open a stream. Good for local dev where progress notifications matter.
- **stdio**: for local dev tools that spawn the adapter as a subprocess. Good for Claude Desktop integration.

All three speak the same JSON-RPC 2.0. The adapter shares the protocol handler; only the transport adapter differs.

### 7. Live updates via git

Optional feature. The adapter can watch the catalog path for changes:

- On `SIGHUP`, invalidate the partition cache
- On a polling timer (configurable), check `git log -1 --format=%H` on the index branch; if it changed, invalidate cache and emit `notifications/tools/list_changed` + `notifications/resources/list_changed`

More advanced: use a webhook from the git host to trigger the signal. That's an integration concern, not part of the adapter itself.

### 8. Capabilities declaration

On `initialize`, the adapter responds:

```json
{
  "capabilities": {
    "tools": { "listChanged": true },
    "resources": { "listChanged": true, "subscribe": false },
    "prompts": { "listChanged": true }
  },
  "serverInfo": {
    "name": "mcp-serve-catalog",
    "version": "0.1.0"
  }
}
```

`resources.subscribe: false` in v1.0 — subscriptions require stateful tracking that complicates the stateless design. Consider for v1.1.

### 9. Error semantics

Standard JSON-RPC error codes per MCP spec:

- `-32601` Method not found — for unsupported methods (e.g. sampling)
- `-32602` Invalid params — args don't match schema, or tool/resource/prompt name unknown
- `-32603` Internal error — skill execution failed at OS level (spawn error, etc.)

Tool-level failures (skill ran but exited non-zero) use MCP's `isError: true` on `CallToolResult`, not JSON-RPC errors.

### 10. Deployment targets

The adapter is designed for:

- **Node server** in a container (`node dist/stdio.mjs` or `node dist/http.mjs`)
- **Cloudflare Worker** — HTTP transport only; `spawn` unavailable, so skill execution is limited to skills with `entry_type: declarative` (a future category that stores the command's full template in SKILL.md without needing to spawn — see Open Questions)
- **AWS Lambda / GCP Functions** — same constraints as Workers

For full flexibility (tool execution via spawn), run on a Node host with the catalog mounted. For read-only deployments (resources + prompts only, no tools), the Worker/Lambda story works today.

## Security considerations

1. **Tool execution is arbitrary code execution**. Any skill can do whatever its `run.sh` permits. Operators MUST run the adapter in a sandboxed environment (container with dropped capabilities, no access to secrets beyond what the skill explicitly needs, etc.).
2. **Arguments are untrusted**. The adapter validates against the args schema but cannot prevent misuse — a skill taking a `url` argument can be pointed at internal services unless the skill itself validates.
3. **Resources can be loaded freely by any client once the adapter is reachable**. If `docs/` contains sensitive content, auth MUST be enforced at ingress.
4. **No redaction** by default. Secrets in stdout or document bodies propagate verbatim to the client. Operators wanting redaction should layer it at ingress or use a2e-shell as the intermediate client (which has its own redactor).

## Migration / compatibility

New project — no migration concerns. a2e-skills repos consumed by a2e-shell today continue to work unchanged; the adapter is an additional consumer, not a replacement.

If a2e-skills evolves its frontmatter schema (adding fields, changing types), the adapter updates in lockstep. The adapter pins to the a2e-skills `INDEX-SCHEMA.json` version.

## Alternatives considered

### A. Extend a2e-skills itself with a built-in MCP server

Rejected — a2e-skills is a content repo. Shipping a server inside it bloats the repo with dependencies and conflates roles. Keeping the adapter separate preserves a2e-skills as pure content.

### B. Fork an existing MCP server template

Rejected — existing templates (from Anthropic, community) are oriented around stateful runtime servers (DB, API clients, filesystem). The catalog-serving case is structurally simpler (stateless, read-heavy, spawn-backed for tools) and benefits from a fresh minimal design.

### C. Serve the catalog as static HTTP (no MCP)

Rejected because it loses the tool call flow. Static HTTP works for resources (`GET catalog://docs/foo` → serve `docs/foo.md`) but can't handle `tools/call` (which requires spawning a process with args). An MCP adapter covers all three primitives uniformly.

### D. Write the adapter in Go / Rust for performance

Rejected — zero runtime advantage for IO-bound workloads, and the Node ecosystem matches a2e-skills / a2e-shell / js-git-store / js-doc-store / js-vector-store. Consistency wins.

## Open questions

1. **Declarative skills (no spawn)**. Some skills are conceptually pure templates — e.g. `github-releases` is just "curl + jq", no shell state required. Could we express such skills **entirely in SKILL.md frontmatter** (a curl+jq DSL) so the adapter can run them in constrained environments like Workers without `spawn`? This would unlock serverless deployment of tool-capable adapters. Deferred to a follow-up RFC.

2. **Auth at the adapter layer or at ingress?**. Pro-ingress: simpler adapter. Pro-adapter: native OAuth flow integration for MCP's emerging auth spec. Leaning ingress for v1.0.

3. **Multi-catalog serving**. Can one adapter process serve multiple a2e-skills repos on different URL paths? E.g. `/kb-public/mcp` vs `/kb-internal/mcp`. Useful for multi-tenant but adds complexity. Leaning "one adapter per catalog, compose at reverse-proxy level".

4. **Resource `subscribe`**. Git hooks or polling can drive `notifications/resources/updated`. Worth doing in v1.0? Adds stateful client tracking. Leaning v1.1.

## Rollout plan

### v0.1 — MVP
- HTTP transport only
- `tools/list` + `tools/call` with spawn execution
- `resources/list` + `resources/read`
- `prompts/list` + `prompts/get` with input_var substitution
- Consumed successfully by a2e-shell's RFC 001 gateway (dogfooding)
- Consumed successfully by Claude Desktop configured with `mcp.json` pointing at the adapter

### v0.2
- SSE transport + progress notifications from tool execution
- stdio transport
- Live cache invalidation via SIGHUP + git-log polling
- Multi-catalog support

### v0.3
- `resources/subscribe`
- Declarative skills exploration (maybe separate RFC)
- Benchmark suite measuring token/latency vs baseline MCP servers

### v1.0
- Stability lock on config + transport behavior
- Deployed at least one public catalog via this adapter
- External security review

## Benchmark plan

A fair comparison against a hypothetical "traditional" MCP server exposing the same capabilities:

- **Baseline**: a Node-based MCP server with a DB holding the skill definitions
- **Treatment**: a2e-skills repo + this adapter
- **Metrics**:
  - Deploy time (first clone → first successful `tools/list` response)
  - Memory footprint (adapter RSS vs baseline server RSS)
  - Latency on `tools/list`, `tools/call`, `resources/read`
  - Update cycle time (edit skill → live in production)

Expected: deploy time and update cycle are orders of magnitude faster (git-push vs full redeploy). Memory and latency roughly equivalent.

## Related

- Companion RFC: [a2e-shell RFC 001 — MCP gateway (inbound)](https://github.com/MauricioPerera/a2e-shell/blob/main/docs/rfcs/001-mcp-gateway.md)
- Current a2e-skills structure: [INDEX-SCHEMA.json](../../INDEX-SCHEMA.json), [CONVENTION.md](../../CONVENTION.md)
- MCP specification: https://modelcontextprotocol.io/specification/2025-06-18
