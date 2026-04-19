/**
 * gen-index — scan the repo, validate every entry, emit manifest + partitions.
 *
 * Usage:
 *   tsx tools/gen-index.ts            # writes .index-out/*.json
 *   tsx tools/gen-index.ts --check    # validates only, no output files
 *
 * Env:
 *   INDEX_OUT_DIR       where to write artifacts (default: .index-out)
 *   INDEX_SOURCE_BRANCH override source branch name for manifest (default: git branch --show-current)
 *
 * Exit codes:
 *   0  success (or check-only with no errors)
 *   1  validation errors
 *   2  generator self-schema violation (generator bug)
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as crypto from "node:crypto";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import matter from "gray-matter";
import type { ValidateFunction } from "ajv";

const require_ = createRequire(import.meta.url);
// Ajv and ajv-formats ship CJS only; interop under NodeNext strict is cleanest via createRequire.
const Ajv = require_("ajv").default as typeof import("ajv").default;
const addFormats = require_("ajv-formats").default as typeof import("ajv-formats").default;

const REPO_ROOT = process.cwd();
const OUT_DIR = process.env.INDEX_OUT_DIR ?? path.join(REPO_ROOT, ".index-out");
const CHECK_ONLY = process.argv.includes("--check");

const SCHEMA_PATH = path.join(REPO_ROOT, "INDEX-SCHEMA.json");
const schemas = JSON.parse(fs.readFileSync(SCHEMA_PATH, "utf8"));
const ajv = new Ajv({ allErrors: true, strict: false });
addFormats(ajv);
ajv.addSchema(schemas, "index-schema");

function compile(defName: string): ValidateFunction {
  return ajv.compile({ $ref: `index-schema#/definitions/${defName}` });
}

const V = {
  skill:       compile("SkillFrontmatter"),
  doc:         compile("DocFrontmatter"),
  prompt:      compile("PromptFrontmatter"),
  template:    compile("TemplateFrontmatter"),
  skillE:      compile("SkillEntry"),
  docE:        compile("DocEntry"),
  promptE:     compile("PromptEntry"),
  templateE:   compile("TemplateEntry"),
  manifest:    compile("Manifest"),
  partition:   compile("Partition"),
};

const errors: string[] = [];
const warnings: string[] = [];

function fail(loc: string, msg: string): void {
  errors.push(`${loc}: ${msg}`);
}
function warn(loc: string, msg: string): void {
  warnings.push(`${loc}: ${msg}`);
}

function git(cmd: string): string {
  return execSync(`git ${cmd}`, { cwd: REPO_ROOT, encoding: "utf8" }).trim();
}
function gitBlobSha(relPath: string): string {
  return git(`rev-parse HEAD:${posix(relPath)}`);
}
function headSha(): string {
  return git("rev-parse HEAD");
}
function currentBranch(): string {
  return process.env.INDEX_SOURCE_BRANCH ?? git("branch --show-current") ?? "HEAD";
}
function posix(p: string): string {
  return p.replace(/\\/g, "/");
}
function ajvErrors(fn: ValidateFunction): string {
  return (fn.errors ?? []).map((e) => `${e.instancePath || "/"} ${e.message}`).join("; ");
}
function estimateTokens(bytes: number): number {
  // Byte-based approximation. For exact token counts, swap in tiktoken downstream.
  return Math.ceil(bytes / 4);
}

// ----- Scanners -------------------------------------------------------------

type EntryMap = Record<string, unknown>;

function scanSkills(): EntryMap {
  const dir = path.join(REPO_ROOT, "skills");
  if (!fs.existsSync(dir)) return {};
  const entries: EntryMap = {};
  for (const name of fs.readdirSync(dir).sort()) {
    const skillDir = path.join(dir, name);
    const rel = `skills/${name}`;
    const st = fs.statSync(skillDir);
    if (!st.isDirectory()) {
      fail(rel, "expected a directory");
      continue;
    }
    const skillMd = path.join(skillDir, "SKILL.md");
    if (!fs.existsSync(skillMd)) {
      fail(rel, "missing SKILL.md");
      continue;
    }
    const { data } = matter(fs.readFileSync(skillMd, "utf8"));
    if (!V.skill(data)) {
      fail(`${rel}/SKILL.md`, ajvErrors(V.skill));
      continue;
    }
    const fm = data as {
      name: string;
      when_to_use: string;
      description: string;
      entry: string;
      args: unknown[];
      requires: string[];
    };
    if (fm.name !== name) {
      fail(`${rel}/SKILL.md`, `frontmatter name='${fm.name}' does not match directory name`);
      continue;
    }
    const entryRel = `skills/${name}/${fm.entry}`;
    const entryAbs = path.join(REPO_ROOT, entryRel);
    if (!fs.existsSync(entryAbs)) {
      fail(rel, `entry '${fm.entry}' not found`);
      continue;
    }
    const bytes = fs.statSync(entryAbs).size;
    let sha: string;
    try {
      sha = gitBlobSha(entryRel);
    } catch {
      fail(rel, `entry '${fm.entry}' is not tracked by git`);
      continue;
    }
    const entry = {
      name,
      when_to_use: fm.when_to_use,
      description: fm.description,
      skill_path: rel,
      entry: fm.entry,
      entry_path: entryRel,
      entry_sha: sha,
      entry_bytes: bytes,
      estimated_tokens: estimateTokens(bytes),
      args: fm.args,
      requires: fm.requires,
    };
    if (!V.skillE(entry)) {
      fail(rel, `generated entry fails schema: ${ajvErrors(V.skillE)}`);
      continue;
    }
    entries[name] = entry;
  }
  return entries;
}

function scanFlat(
  category: "docs" | "prompts" | "templates",
  fmValidator: ValidateFunction,
  entryValidator: ValidateFunction,
  build: (
    name: string,
    fm: Record<string, unknown>,
    path_: string,
    bodySha: string,
    bytes: number,
  ) => Record<string, unknown>,
): EntryMap {
  const dir = path.join(REPO_ROOT, category);
  if (!fs.existsSync(dir)) return {};
  const entries: EntryMap = {};
  for (const file of fs.readdirSync(dir).sort()) {
    if (!file.endsWith(".md")) continue;
    const rel = `${category}/${file}`;
    const name = file.slice(0, -3);
    const { data } = matter(fs.readFileSync(path.join(dir, file), "utf8"));
    if (!fmValidator(data)) {
      fail(rel, ajvErrors(fmValidator));
      continue;
    }
    if ((data as { name: string }).name !== name) {
      fail(rel, `frontmatter name='${(data as { name: string }).name}' does not match filename`);
      continue;
    }
    const bytes = fs.statSync(path.join(dir, file)).size;
    let sha: string;
    try {
      sha = gitBlobSha(rel);
    } catch {
      fail(rel, "file is not tracked by git");
      continue;
    }
    const entry = build(name, data as Record<string, unknown>, rel, sha, bytes);
    if (!entryValidator(entry)) {
      fail(rel, `generated entry fails schema: ${ajvErrors(entryValidator)}`);
      continue;
    }
    entries[name] = entry;
  }
  return entries;
}

// ----- Main ----------------------------------------------------------------

function main(): void {
  const data: Record<string, EntryMap> = {
    skills: scanSkills(),
    docs: scanFlat("docs", V.doc, V.docE, (name, fm, p, sha, bytes) => ({
      name,
      title: fm.title,
      summary: fm.summary,
      ...(Array.isArray(fm.topics) ? { topics: fm.topics } : {}),
      path: p,
      body_sha: sha,
      bytes,
      estimated_tokens: estimateTokens(bytes),
    })),
    prompts: scanFlat("prompts", V.prompt, V.promptE, (name, fm, p, sha, bytes) => ({
      name,
      purpose: fm.purpose,
      description: fm.description,
      input_vars: fm.input_vars,
      path: p,
      body_sha: sha,
      bytes,
      estimated_tokens: estimateTokens(bytes),
    })),
    templates: scanFlat("templates", V.template, V.templateE, (name, fm, p, sha, bytes) => ({
      name,
      purpose: fm.purpose,
      format: fm.format,
      description: fm.description,
      path: p,
      body_sha: sha,
      bytes,
      estimated_tokens: estimateTokens(bytes),
    })),
  };

  if (errors.length > 0) {
    console.error(`\n${errors.length} validation error(s):`);
    for (const e of errors) console.error(`  - ${e}`);
    if (warnings.length > 0) {
      console.error(`\n${warnings.length} warning(s):`);
      for (const w of warnings) console.error(`  - ${w}`);
    }
    process.exit(1);
  }
  if (warnings.length > 0) {
    console.warn(`\n${warnings.length} warning(s):`);
    for (const w of warnings) console.warn(`  - ${w}`);
  }

  if (CHECK_ONLY) {
    console.log("OK: all entries valid (check-only, no output written)");
    return;
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });

  const manifest = {
    schema_version: "1.0" as const,
    source_sha: headSha(),
    source_branch: currentBranch(),
    generated_at: new Date().toISOString(),
    categories: {} as Record<string, { path: string; count: number; bytes: number; sha256: string }>,
  };

  for (const [category, entries] of Object.entries(data)) {
    const partition = { schema_version: "1.0" as const, category, entries };
    if (!V.partition(partition)) {
      console.error(`generator bug: partition for ${category} fails self-schema: ${ajvErrors(V.partition)}`);
      process.exit(2);
    }
    const body = JSON.stringify(partition, null, 2) + "\n";
    const filename = `${category}.json`;
    fs.writeFileSync(path.join(OUT_DIR, filename), body);
    manifest.categories[category] = {
      path: filename,
      count: Object.keys(entries).length,
      bytes: Buffer.byteLength(body, "utf8"),
      sha256: crypto.createHash("sha256").update(body).digest("hex"),
    };
  }

  if (!V.manifest(manifest)) {
    console.error(`generator bug: manifest fails self-schema: ${ajvErrors(V.manifest)}`);
    process.exit(2);
  }

  fs.writeFileSync(
    path.join(OUT_DIR, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );

  const total = Object.values(manifest.categories).reduce((a, c) => a + c.count, 0);
  console.log(`OK: ${total} entries across ${Object.keys(manifest.categories).length} categories → ${OUT_DIR}`);
}

if (import.meta.url === `file://${fileURLToPath(import.meta.url)}` || process.argv[1]) {
  main();
}
