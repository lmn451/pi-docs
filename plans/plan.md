# Implementation Plan: Robust Doc Injector (v0.3.0) — FINAL REVISION

> **Source spec:** `plans/spec.md`
> **Input change surface:** ~1,850 lines changed across 17 files (10 source + 7 test)
> **Total new files:** 5 source + 4 test
> **Plan status:** Final — all 3 Critic blockers + 2 major concerns resolved

**Revision notes (v3 — Final, post-Critic):**

- **BLOCKER 1 resolved**: Binary detection pipeline reordered. `isBinaryExtension` runs first (zero I/O). Then a **known-text extension whitelist** (`.md`, `.ts`, `.js`, `.json`, `.yaml`, etc.) skips content sampling entirely for common text files. Only unknown-extension files call `isBinaryContent(filePath)` — and crucially, this call happens **BEFORE `readFile`**, not after. Eliminates double file I/O. `isBinaryContent` stays filePath-based (does its own `open/read` on first 8KB) but is only reached for files that need it.

- **BLOCKER 2 resolved**: LLM tool execute handler calls `stat(join(cwd, relativePath))` for each generated file and writes **real `stats.mtimeMs`** into the cache entry instead of `Date.now()`. On the next scan, the mtime comparison succeeds → cache hit → LLM keywords are preserved. No cache format change needed.

- **BLOCKER 3 resolved**: Summary notification delivered from `agent_end` handler. The tool execute handler increments a `llmBatchesCompleted` counter. When `agent_end` fires and `keywordGenInFlight` is cleared, the handler checks the counter: if > 0, it calls `ctx.ui.notify("Doc keywords: X files across Y batches", "success")` and resets the counter. This avoids the fire-and-forget gap — notification arrives at a natural UX moment (end of turn).

- **MAJOR-1 resolved**: `keywordGenInFlight` safety-unbinds on both `input` event (user interrupts by typing) and `session_start` (fresh session). Prevents permanent flag-stuck. The flag is still normally cleared in `agent_end`, but these unbinds are belt-and-suspenders.

- **MAJOR-2 resolved**: `rebuild()` re-reads cache from disk via `loadCache(cwd)` **immediately before** calling `saveCache(cwd, dirtyEntries)`. Any LLM-written entries that landed during the scan are merged in (LLM `mtimeMs` takes precedence for matching keys). Prevents cache overwrite race between `/doc-reload` and LLM tool.

**Additional fixes in this revision:**

| Fix | Detail |
|-----|--------|
| Prompt injection sanitization | Strip `\n` and `\r` from keywords before injection; cap each keyword at 100 chars |
| Duplicate "their" in stop words | Remove second occurrence in `generateKeywords()` stop-word set |
| `binary-detect.ts` dynamic import | Replace `await import("node:fs/promises")` with static `import { open } from "node:fs/promises"` at top |
| `keywordSource` in test mocks | All `DocEntry` test fixtures now include `keywordSource` field (backward compat) |
| `/doc-inject list` shows source | Command output includes `keywordSource` column (non-blocking polish) |

---

## 1. Architecture Decision Record (ADR)

This section records the key architectural decisions, updated with Critic blocker resolutions.

### ADR-1: Glob Matching Library → picomatch
- **Status:** Decided (spec §1.1, §6 Q2)
- **Rationale:** 0 deps, ~18 KB, compiles patterns once for O(1) matching. We only need `isMatch(path, pattern)`, not directory walking.
- **Consequences:** New file `globber.ts`, new dep in `package.json`, `registry.ts` no longer hardcodes `.md` filter.

### ADR-2: Binary Detection → Two-Tier + Known-Text Whitelist (REVISED)
- **Status:** Decided (spec §1.2, §6 Q3); **revised for BLOCKER-1**
- **Rationale:** Extension blacklist catches 99% of binaries before any I/O. **Known-text extension whitelist** (`.md`, `.ts`, `.js`, `.json`, `.yaml`, `.yml`, `.toml`, `.txt`, `.css`, `.html`, `.py`, `.rs`, `.go`, `.java`, `.c`, `.h`, `.cpp`, `.rb`, `.sh`, `.graphql`, `.prisma`, `.proto`, `.vue`, `.svelte`, `.xml`, `.svg`, `.gitignore`, `.dockerignore`, `.editorconfig`, `.env`) skips content sampling for files that are always text — zero I/O for the common case. Content sampling (first 8KB, null-byte or >30% non-printable) only runs for unknown-extension files.
- **BLOCKER-1 FIX — Pipeline order**: The per-file pipeline now runs binary detection BEFORE `readFile`, not after:
  1. `isBinaryExtension(filePath)` → skip if true (no I/O)
  2. Known-text extension whitelist check → if whitelisted, skip to step 4 (no content-sampling I/O)
  3. `isBinaryContent(filePath)` → skip if binary (reads first 8KB, one I/O call, no full `readFile`)
  4. `stat(filePath)` → check size, mtime, cache hit
  5. `readFile(filePath)` → parse frontmatter or generate keywords
  This eliminates the double-read (previously: `readFile` full file + `isBinaryContent` reads 8KB again).
- **Consequences:** New file `binary-detect.ts` with added `KNOWN_TEXT_EXTENSIONS` set; `registry.ts` pipeline reordered.

### ADR-3: LLM Keyword Generation → Opt-In Command + Hidden Tool (REVISED)
- **Status:** Decided (spec §1.3, §6 Q1); **revised for BLOCKER-2, BLOCKER-3, MAJOR-1**
- **Rationale:** Pi has no `pi.callModel()` API. Hidden tool `_doc_injector_keywords` captures structured LLM output. `/doc-keywords-gen` command triggers it explicitly.
- **BLOCKER-1 (tool schema) — RESOLVED**: Tool parameter schema includes a `keywords` output field: `keywords: Type.Array(Type.Object({path: Type.String(), keywords: Type.Array(Type.String())}))`. The LLM populates this field when calling the tool. Execute handler reads `params.keywords` and writes to cache.
- **BLOCKER-2 (stale mtime) — RESOLVED**: The tool execute handler calls `stat(join(cwd, item.path))` for each file in the LLM's response, and writes **real `stats.mtimeMs`** into the cache entry. Previously used `Date.now()` which never matched actual file mtime, causing cache miss on next scan and heuristic overwrite.
  ```typescript
  // Inside execute handler:
  const { stat } = await import("node:fs/promises");
  for (const item of generated) {
    const absPath = join(cwd, item.path);
    const fileStat = await stat(absPath).catch(() => null);
    cache.files[item.path] = {
      mtimeMs: fileStat?.mtimeMs ?? Date.now(), // real mtime, fallback only if stat fails
      keywords: item.keywords.slice(0, 20),
    };
  }
  ```
- **BLOCKER-3 (summary notification) — RESOLVED**: Summary delivered from `agent_end` handler, not from the fire-and-forget command. The tool execute handler increments `llmBatchesCompleted` per batch. When `agent_end` fires and `keywordGenInFlight` is cleared:
  ```typescript
  // In agent_end handler:
  keywordGenInFlight = false;
  if (llmBatchesCompleted > 0) {
    ctx.ui.notify(
      `Doc keywords: ${llmTotalFiles} files across ${llmBatchesCompleted} batch(es)`,
      "success"
    );
    llmBatchesCompleted = 0;
    llmTotalFiles = 0;
  }
  ```
  This places the notification at a natural UX moment (end of the keyword-gen turn).
- **MAJOR-1 (flag stuck) — RESOLVED**: `keywordGenInFlight` safety-unbinds on:
  - `input` event: `if (event.source === "interactive") { keywordGenInFlight = false; llmBatchesCompleted = 0; }` — user interrupted
  - `session_start` event: `keywordGenInFlight = false; llmBatchesCompleted = 0;` — fresh session
  - `agent_end` event: normal clear (primary path)
  This triple-unbind prevents permanent flag-stuck if `agent_end` doesn't fire for an interrupted turn.
- **MAJOR-2 (cache overwrite race) — RESOLVED**: `rebuild()` re-reads cache from disk immediately before writing dirty entries:
  ```typescript
  // In rebuild(), before saveCache:
  const freshCache = await loadCache(cwd); // pick up LLM-written entries
  for (const [key, entry] of Object.entries(freshCache.files)) {
    if (!dirtyCache.files[key]) {
      dirtyCache.files[key] = entry; // preserve LLM entries not in this scan
    }
    // If key exists in both, dirtyCache (from this scan) takes precedence
  }
  await saveCache(cwd, dirtyCache);
  ```
  This prevents the post-rebuild `saveCache` from overwriting LLM-generated keywords that landed during the scan.
- **Consequences:** Modified `keyword-llm.ts` (prompt builder only), modified `commands.ts` (deps + `/doc-keywords-gen` handler), heavily modified `index.ts` (inline tool registration, guard flags, safety unbinds).

### ADR-4: Cache Strategy → mtime-Based (REVISED)
- **Status:** Decided (spec §1.5, §6 Q5); **revised for BLOCKER-2, MAJOR-2**
- **Rationale:** mtime from `Stats.mtimeMs` is sufficient — any content change updates mtime. Content hash would require reading every file on every scan, defeating the purpose.
- **BLOCKER-2 consequence**: LLM-written cache entries now carry real mtime from `stat()`, not `Date.now()`. They survive subsequent scans.
- **MAJOR-2 consequence**: `rebuild()` now does a cache-reload-before-write dance to merge concurrent LLM writes.
- **Consequences:** New file `cache.ts`, cache at `.pi/doc-injector-cache.json`, `registry.ts` checks mtime before read.

### ADR-5: Config Async Refactor → Yes
- **Status:** Decided (spec §1.6, §6 Q6)
- **Rationale:** Extension factory already async. `existsSync` → try/catch `readFile`. ~5 lines change.
- **Consequences:** `config.ts` `loadConfig` returns `Promise<DocInjectorConfig>`, all call sites `await`.

### ADR-6: Directories-as-Docs → No Special Handling
- **Status:** Decided (spec §1.7, §6 Q7)
- **Rationale:** Recursive scan with `relativePath` naturally groups by directory.
- **Consequences:** No directory index abstraction needed.

### ADR-7: LLM Batching → 20 Files per Batch, Sequential
- **Status:** Decided (spec §1.4, §6 Q4)
- **Rationale:** Single prompt per batch keeps context manageable. Configurable via `llmBatchSize`.
- **Consequences:** Command handler loops over batches, sends one user message per batch, tracks progress.

### ADR-8: Frontmatter Parsing → Multi-Style (4 formats)
- **Status:** Decided (spec §5.8)
- **Rationale:** Beyond YAML `---`, add C-style `/*---`, HTML `<!--`, and `//---` single-line.
- **Consequences:** `parseFrontmatter` in `registry.ts` extended with 4 parsers tried in order.

### ADR-9 (NEW): Prompt Injection Sanitization
- **Status:** Decided (Critic feedback)
- **Rationale:** Keywords containing newlines or extreme lengths could corrupt the system prompt or enable prompt injection. Strip `\n` and `\r`, cap each keyword at 100 chars, and enforce a hard 20-keyword limit before injection.
- **Consequences:** `injector.ts` sanitization step added before building system prompt append.

---

## 2. Task Breakdown

Tasks organized into the 6 phases from spec §9. Each task targets one file where practical. Task IDs use `P<phase>.<sequence>` notation.

---

### Phase 1: Async I/O + Types + Config (Low Risk)

**Goal:** Convert sync I/O to async in `config.ts` and `registry.ts`, expand type definitions with new config fields. No behavioral changes yet.

| Task ID | Description | File(s) | Change Type |
|---------|-------------|---------|-------------|
| **P1.1** | Add new config fields to `DocInjectorConfig` and `DEFAULT_CONFIG`: `include`, `exclude`, `maxFileSize`, `autoKeywords`, `llmKeywords`, `maxConcurrent`, `llmBatchSize` (10 fields total — see spec §5.1) | `types.ts` | Modify |
| **P1.2** | Add new interfaces: `KeywordSource`, `KeywordCache`, `CacheEntry`, `BinaryDetectResult`, `GlobFilter` | `types.ts` | Modify |
| **P1.3** | Add `keywordSource: KeywordSource` field to `DocEntry` (default `"frontmatter"` for backward compat) | `types.ts` | Modify |
| **P1.4** | Convert `loadConfig` to async: replace `existsSync`/`readFileSync` with `readFile` from `fs/promises`; catch `ENOENT` for missing file | `config.ts` | Modify |
| **P1.5** | Add validation for new config fields: `clampInt` for numeric fields, `validateGlobArray` for include/exclude, defaults for all | `config.ts` | Modify |
| **P1.6** | Convert `DocRegistry.rebuild()` to async: replace `readdirSync` → `readdir` (fs/promises), `readFileSync` → `readFile` (fs/promises) | `registry.ts` | Modify |
| **P1.7** | Convert `scanFlat` and `scanRecursive` to async (`fs/promises`); add `recursive` class property to DocRegistry constructor | `registry.ts` | Modify |
| **P1.8** | Update `initRegistry` in `index.ts` to `await loadConfig()` | `index.ts` | Modify |
| **P1.9** | Update `test/config.test.ts` for async `loadConfig` and new field assertions | `test/config.test.ts` | Modify |
| **P1.10** | Update `test/registry.test.ts` for async scan methods; add `keywordSource: "frontmatter"` to all mock `DocEntry` fixtures | `test/registry.test.ts` | Modify |

**Acceptance Criteria:**
- `npm test` passes with async config and async registry
- New config fields all have defaults; old 4-field config files parse without error
- `clampInt` enforces range [min, max] for all numeric fields with console.warn on clamp
- `validateGlobArray` rejects non-array, non-string entries, returns defaults
- `loadConfig` returns `Promise<DocInjectorConfig>`; uses `fs/promises` only
- All test `DocEntry` fixtures include `keywordSource` field

---

### Phase 2: Glob + Binary Detection (Low Risk)

**Goal:** Replace hardcoded `.md` filter with picomatch glob patterns. Add binary detection with known-text whitelist. Still no auto-keywords.

| Task ID | Description | File(s) | Change Type |
|---------|-------------|---------|-------------|
| **P2.1** | Add `"picomatch": "^4.0.2"` to `dependencies` in `package.json`; run `npm install` | `package.json` | Modify |
| **P2.2** | Create `globber.ts` with `createGlobFilter(include: string[], exclude: string[]): GlobFilter` | `globber.ts` | **NEW** |
| **P2.3** | Create `binary-detect.ts` with: `isBinaryExtension(filePath): boolean`, `isBinaryContent(filePath): Promise<BinaryDetectResult>`, and `KNOWN_TEXT_EXTENSIONS` set (~30 common text extensions). **Static import** `import { open } from "node:fs/promises"` at top (not dynamic `await import(...)`) | `binary-detect.ts` | **NEW** |
| **P2.4** | Wire `GlobFilter` into `DocRegistry` — constructor accepts `config: DocInjectorConfig` instead of individual params; rebuild applies glob filter after scan | `registry.ts` | Modify |
| **P2.5** | **BLOCKER-1 fix**: Reorder binary detection pipeline in `rebuild()`: (a) `isBinaryExtension` → skip, (b) check `KNOWN_TEXT_EXTENSIONS` whitelist → skip content sampling, (c) `isBinaryContent(filePath)` — **before** `readFile` — skip if binary. All binary checks complete before any full `readFile`. | `registry.ts` | Modify |
| **P2.6** | (Removed — merged into P2.5 as pipeline reorder) | — | — |
| **P2.7** | Update `DocRegistry.create()` signature to accept `DocInjectorConfig` instead of `(docsPath, recursive)` | `registry.ts` | Modify |
| **P2.8** | Update call sites in `index.ts` (`initRegistry`, `reloadRegistry`) to pass full config to registry | `index.ts` | Modify |
| **P2.9** | Update `test/registry.test.ts` to create registry with config object; add `keywordSource` to mocks | `test/registry.test.ts` | Modify |
| **P2.10** | Create `test/globber.test.ts` — include/exclude matching, globstar, braces, character classes | `test/globber.test.ts` | **NEW** |
| **P2.11** | Create `test/binary-detect.test.ts` — extension hits, null byte detection, non-printable threshold, known-text whitelist coverage | `test/binary-detect.test.ts` | **NEW** |

**Acceptance Criteria:**
- `GlobFilter.match("api/auth.md")` returns true for `include: ["**/*.md"]`
- `GlobFilter.match("node_modules/pkg/readme.md")` returns false for `exclude: ["node_modules/**"]`
- `isBinaryExtension("photo.png")` returns true; `isBinaryExtension("readme.md")` returns false
- `isBinaryContent` correctly identifies null-byte and >30% non-printable files
- Registry skips `.png`, `.zip`, `.ttf` files in scan (extension blacklist, zero I/O)
- `.md`, `.ts`, `.js`, `.json` files skip content sampling entirely (known-text whitelist)
- Non-`.md` text files (`.txt`, `.json`, `.ts`) pass glob filter when `include` allows them
- `isBinaryContent` is called BEFORE `readFile` — verified: no full `readFile` for binary files
- `binary-detect.ts` uses static `import { open }` at top, no dynamic `await import()`

---

### Phase 3: Multi-Style Frontmatter Parsing (Low Risk)

**Goal:** Extend `parseFrontmatter` to support C-style `/*---` block comment, HTML `<!--` comment, and `//---` single-line comment prefix frontmatter.

| Task ID | Description | File(s) | Change Type |
|---------|-------------|---------|-------------|
| **P3.1** | Extract existing YAML logic into `parseYamlFrontmatter` private helper | `registry.ts` | Modify |
| **P3.2** | Add `parseCStyleFrontmatter` for `/*---\n...\n---*/` block | `registry.ts` | Modify |
| **P3.3** | Add `parseHTMLFrontmatter` for `<!--\n...\n-->` block | `registry.ts` | Modify |
| **P3.4** | Add `parseSlashSlashFrontmatter` for `//--- ...` (reads until blank line) | `registry.ts` | Modify |
| **P3.5** | Refactor `parseFrontmatter` to try each parser in order (YAML → C-style → HTML → slash-slash), return first success | `registry.ts` | Modify |
| **P3.6** | Add tests for each new frontmatter style to `test/registry.test.ts` | `test/registry.test.ts` | Modify |

**Acceptance Criteria:**
- `/*---\ntitle: Test\nkeywords: [a, b]\n---*/` parses correctly
- `<!--\ntitle: Test\nkeywords: [a, b]\n-->` parses correctly
- `//---\ntitle: Test\nkeywords: [a, b]\n\nBody here` parses correctly (reads until blank line)
- Existing YAML frontmatter still parses correctly (no regression)
- Content without any frontmatter format returns null

---

### Phase 4: Local Keyword Generation + Cache (Medium Risk)

**Goal:** Auto-generate keywords from filename and content heuristics. Cache generated keywords by mtime.

| Task ID | Description | File(s) | Change Type |
|---------|-------------|---------|-------------|
| **P4.1** | Create `cache.ts` with `loadCache(cwd): Promise<KeywordCache>` and `saveCache(cwd, cache): Promise<void>` | `cache.ts` | **NEW** |
| **P4.2** | Create `keyword-gen.ts` with `generateKeywords(fileName, content): string[]`. **Fix duplicate "their"** in stop-words set (line 561 of spec). | `keyword-gen.ts` | **NEW** |
| **P4.3** | Add `PromisePool` helper inline in `registry.ts` (spec §8) for concurrent file I/O | `registry.ts` | Modify |
| **P4.4** | Integrate cache: `rebuild()` loads cache; per-file: `stat` → if mtime matches cache, use cached keywords without reading file | `registry.ts` | Modify |
| **P4.5** | Add `getDirtyCache()` method to `DocRegistry` — returns `Record<string, CacheEntry>` of entries whose mtime changed or keywords were generated | `registry.ts` | Modify |
| **P4.6** | Wire `generateKeywords` as fallback when frontmatter parse fails AND `config.autoKeywords === true`; set `keywordSource = "heuristic"` | `registry.ts` | Modify |
| **P4.7** | Implement concurrent file processing with `PromisePool` using `config.maxConcurrent` limit | `registry.ts` | Modify |
| **P4.8** | Implement `maxFileSize` check: skip files with `stat.size > config.maxFileSize` (default 100KB) | `registry.ts` | Modify |
| **P4.9** | Wire cache load/save in `index.ts` `initRegistry`: load cache, pass to `DocRegistry.create()`, call `getDirtyCache()` + `saveCache()` after rebuild. **MAJOR-2 fix**: before `saveCache`, re-read cache from disk to merge LLM-written entries. | `index.ts` | Modify |
| **P4.10** | Create `test/cache.test.ts` — load/save roundtrip, version validation, corrupted JSON → reset | `test/cache.test.ts` | **NEW** |
| **P4.11** | Create `test/keyword-gen.test.ts` — filename parsing, heading extraction, code symbol extraction, stop-word removal (verify "their" appears only once), 20-keyword cap | `test/keyword-gen.test.ts` | **NEW** |

**Acceptance Criteria:**
- Cache roundtrip: save → load returns same data
- Cache with invalid version resets to `{ version: 1, files: {} }`
- `generateKeywords("api-auth.md", content)` returns keywords including "api", "auth"
- `generateKeywords` skips stop words; "their" appears only once in stop-word set
- `generateKeywords` never returns more than 20 keywords
- When mtime matches cache, `readFile` is NOT called (verify via spy in test)
- When mtime differs, `readFile` is called and cache entry is marked dirty
- Files > `maxFileSize` are skipped with warning
- `PromisePool` runs at most `maxConcurrent` operations simultaneously

---

### Phase 5: LLM Keyword Generation (Medium Risk — BLOCKER-2, BLOCKER-3, MAJOR-1, MAJOR-2)

**Goal:** Implement opt-in `/doc-keywords-gen` command and hidden `_doc_injector_keywords` tool. **All 3 Critic blockers and 2 major concerns resolved in this phase.**

| Task ID | Description | File(s) | Change Type |
|---------|-------------|---------|-------------|
| **P5.1** | Create `keyword-llm.ts` with `buildKeywordGenPrompt(files: FileInput[]): string` helper only | `keyword-llm.ts` | **NEW** |
| **P5.2** | Add `generateKeywordsLLM` and `getConfig` to `CommandDeps` interface in `commands.ts` | `commands.ts` | Modify |
| **P5.3** | Add `/doc-keywords-gen [path]` command handler in `commands.ts`: scans registry for keyword-less files, batches by `llmBatchSize`, sends one user message per batch via `generateKeywordsLLM` | `commands.ts` | Modify |
| **P5.4** | **Inline tool registration + guard flags in `index.ts`** (BLOCKER-2, BLOCKER-3, MAJOR-1): | `index.ts` | Modify |

**P5.4 Details — The critical integration task:**

**P5.4a — Inline tool registration (BLOCKER-2):**
Register `_doc_injector_keywords` inside the extension factory with closure access to:
- `cache: KeywordCache` — the in-memory cache object
- `cwd: string` — for `saveCache(cwd, cache)` and `stat(join(cwd, ...))`
- `saveCache` function reference
- `llmBatchesCompleted` counter (for BLOCKER-3 summary)

Tool schema includes the `keywords` output field (BLOCKER-1).

Execute handler writes **real mtime** (BLOCKER-2 fix):
```typescript
async execute(_id, params, _signal, _onUpdate, ctx) {
  const generated = params.keywords as Array<{ path: string; keywords: string[] }>;
  const { stat } = await import("node:fs/promises");
  const { join } = await import("node:path");
  let saved = 0;
  for (const item of generated) {
    const absPath = join(cwd, item.path);
    const fileStat = await stat(absPath).catch(() => null);
    cache.files[item.path] = {
      mtimeMs: fileStat?.mtimeMs ?? Date.now(),
      keywords: item.keywords.slice(0, 20),
    };
    saved++;
  }
  await saveCache(cwd, cache);
  llmBatchesCompleted++;
  llmTotalFiles += saved;
  return {
    content: [{ type: "text" as const, text: `Keywords saved for ${saved} files.` }],
  };
}
```

**P5.4b — Guard flags (MAJOR-1, BLOCKER-3):**
```typescript
let keywordGenInFlight = false;
let llmBatchesCompleted = 0;
let llmTotalFiles = 0;
```

Effects when `keywordGenInFlight === true`:
1. `message_update` handler: skip auto-abort logic (`if (keywordGenInFlight) return;`)
2. `input` handler: skip keyword matching (`if (keywordGenInFlight) return;`)
3. `before_agent_start` handler: skip injection (`if (keywordGenInFlight) return;`)

**P5.4c — Summary notification from `agent_end` (BLOCKER-3):**
```typescript
// In agent_end handler:
keywordGenInFlight = false;
if (llmBatchesCompleted > 0) {
  ctx.ui.notify(
    `Doc keywords: ${llmTotalFiles} files across ${llmBatchesCompleted} batch(es)`,
    "success"
  );
  llmBatchesCompleted = 0;
  llmTotalFiles = 0;
}
```

**P5.4d — Safety unbinds (MAJOR-1):**
```typescript
// In input handler (fires before keywordGenInFlight check):
if (event.source === "interactive") {
  keywordGenInFlight = false;
  llmBatchesCompleted = 0;
  llmTotalFiles = 0;
}

// In session_start handler:
keywordGenInFlight = false;
llmBatchesCompleted = 0;
llmTotalFiles = 0;
```

**P5.4e — Cache reload-before-write in rebuild (MAJOR-2):**
```typescript
// In rebuild(), before saveCache:
const freshCache = await loadCache(cwd);
const mergedCache: KeywordCache = { version: 1, files: {} };
// Start with fresh (disk) entries (includes any LLM writes during scan)
for (const [key, entry] of Object.entries(freshCache.files)) {
  mergedCache.files[key] = entry;
}
// Overlay dirty entries from this scan (scan results take precedence)
for (const [key, entry] of Object.entries(dirtyCache.files)) {
  mergedCache.files[key] = entry;
}
await saveCache(cwd, mergedCache);
```

**P5.4f — GenerateKeywordsLLM deps function:**
```typescript
async function generateKeywordsLLM(files: Array<{ path: string; snippet: string; existingKeywords: string[] }>) {
  keywordGenInFlight = true;
  const prompt = buildKeywordGenPrompt(files);
  pi.sendUserMessage(prompt, { deliverAs: "followUp" });
}
```

**Acceptance Criteria:**
- `npm test` passes
- `_doc_injector_keywords` tool registered without `promptSnippet`
- Tool parameter schema includes `keywords: Array<{path, keywords}>` output field
- Tool execute handler writes **real `mtimeMs`** from `stat()` — verified via unit test with a real temp file
- `/doc-keywords-gen` without args processes all keyword-less files
- `/doc-keywords-gen docs/api.md` only processes the specified file
- `keywordGenInFlight` suppresses keyword matching, injection, and auto-abort during generation
- `keywordGenInFlight` is cleared on `input` (interactive), `session_start`, and `agent_end`
- Summary notification fires from `agent_end` when batches complete
- `rebuild()` merges LLM-written cache entries instead of overwriting

---

### Phase 6: Integration Wiring + Tests (High Risk)

**Goal:** Tie all phases together, fix matcher edge cases, add prompt injection sanitization, finalize `index.ts` wiring, verify backward compatibility.

| Task ID | Description | File(s) | Change Type |
|---------|-------------|---------|-------------|
| **P6.1** | Fix regex escaping edge cases in `matcher.ts` (keywords with consecutive special chars like `$$`, empty keywords) | `matcher.ts` | Modify |
| **P6.2** | Finalize `index.ts` wiring: async config, cache, LLM tool, updated deps, all guard flags and safety unbinds | `index.ts` | Modify |
| **P6.3** | Update `test/injector.test.ts` for `keywordSource` field on all test `DocEntry` mocks | `test/injector.test.ts` | Modify |
| **P6.4** | Update `test/matcher.test.ts` for regex edge case tests (special chars, empty strings) | `test/matcher.test.ts` | Modify |
| **P6.5** | Integration test: end-to-end scan → match → inject with glob, binary detect, auto-keywords, cache | `test/integration/` | Modify/New |
| **P6.6** | **Prompt injection sanitization** in `injector.ts` (or the injection path in `index.ts`): strip `\n` and `\r` from each keyword, cap each keyword at 100 chars, enforce 20-keyword max before building system prompt append | `injector.ts` or `index.ts` | Modify |
| **P6.7** | JSDoc pass: verify all JSDoc comments accurate for new/changed APIs | All source files | Modify |
| **P6.8** | Run `npm test` — all suites must pass: config, registry, matcher, injector, globber, binary-detect, keyword-gen, cache, integration | — | — |
| **P6.9** | Manual smoke test in Pi: start session, verify docs load, verify keyword matching, test `/doc-keywords-gen` | — | — |
| **P6.10** | Non-blocking polish: show `keywordSource` in `/doc-inject list` output | `commands.ts` | Modify |

**Acceptance Criteria:**
- `npm test` passes all 9+ test suites
- Old `.pi/doc-injector.json` with only 4 fields loads without error (backward compatibility)
- No TypeScript compilation errors (`npx tsc --noEmit`)
- No sync I/O anywhere in the codebase (`readFileSync`, `readdirSync`, `existsSync` only in test files)
- All `console.warn` messages use `[doc-injector]` prefix
- `keywordGenInFlight` prevents auto-abort and keyword matching during LLM keyword generation turns
- `keywordGenInFlight` is safety-cleared on `input` (interactive) and `session_start`
- Keywords in system prompt append have no newlines, are capped at 100 chars each, max 20 keywords
- `/doc-inject list` shows `keywordSource` for each entry

---

## 3. Dependency Graph

```
┌──────────────────────────────────────────────────────────────────┐
│ LEGEND                                                           │
│ ─── = sequential (must complete before)                          │
│ ···· = parallel (can run concurrently)                           │
└──────────────────────────────────────────────────────────────────┘

Phase 1 (Async I/O + Types + Config)
├── P1.1 ─── P1.2 ─── P1.3                    (types.ts, ordered within file)
├── P1.4 ···· P1.5                              (config.ts)
│   └── depends on: P1.1, P1.2                 (needs new types)
├── P1.6 ···· P1.7                              (registry.ts async conversion)
│   └── depends on: P1.1, P1.3                 (needs new DocEntry fields)
├── P1.8                                        (index.ts awaiting config)
│   └── depends on: P1.4
├── P1.9                                        (config test updates)
│   └── depends on: P1.4, P1.5
└── P1.10                                       (registry test updates + keywordSource mocks)
    └── depends on: P1.6, P1.3

Phase 2 (Glob + Binary Detection)
├── P2.1                                        (package.json - standalone)
├── P2.2                                        (globber.ts - NEW)
│   └── depends on: P1.2                        (needs GlobFilter type)
├── P2.3                                        (binary-detect.ts - NEW, static import fix)
│   └── depends on: P1.2                        (needs BinaryDetectResult type)
├── P2.4 ─── P2.5 ─── P2.7                      (registry.ts: glob, BLOCKER-1 pipeline reorder, create() sig)
│   └── depends on: P2.2, P2.3, P1.6            (needs glob/binary, async base)
├── P2.8                                        (index.ts call sites)
│   └── depends on: P2.7                        (new create() signature)
├── P2.9                                        (registry test updates + keywordSource)
│   └── depends on: P2.7
├── P2.10                                       (globber.test.ts - NEW)
│   └── depends on: P2.2
└── P2.11                                       (binary-detect.test.ts - NEW)
    └── depends on: P2.3

Phase 3 (Multi-Style Frontmatter)
├── P3.1 ─── P3.2 ···· P3.3 ···· P3.4           (parser extraction + new parsers)
│   └── depends on: P1.6                        (working async registry base)
├── P3.5                                        (refactored parseFrontmatter)
│   └── depends on: P3.1, P3.2, P3.3, P3.4
└── P3.6                                        (frontmatter tests)
    └── depends on: P3.5

Phase 4 (Local Keywords + Cache)
├── P4.1                                        (cache.ts - NEW)
│   └── depends on: P1.2                        (needs KeywordCache type)
├── P4.2                                        (keyword-gen.ts - NEW, fixed stop words)
│   └── depends on: none                        (pure logic, zero deps)
├── P4.3 ···· P4.4 ···· P4.5                    (registry.ts — PromisePool + cache)
│   └── depends on: P4.1, P2.7, P3.5
├── P4.6 ─── P4.7 ─── P4.8                      (registry.ts — keyword gen + concurrent + size)
│   └── depends on: P4.2, P4.3, P4.4
├── P4.9                                        (index.ts cache wiring + MAJOR-2 cache merge)
│   └── depends on: P4.1, P4.5, P1.8
├── P4.10                                       (cache.test.ts - NEW)
│   └── depends on: P4.1
└── P4.11                                       (keyword-gen.test.ts - NEW)
    └── depends on: P4.2

Phase 5 (LLM Keywords)
├── P5.1                                        (keyword-llm.ts - NEW, prompt builder only)
│   └── depends on: none                        (pure string formatting)
├── P5.2                                        (commands.ts — deps interface)
│   └── depends on: P1.1                        (needs config type)
├── P5.3                                        (commands.ts — /doc-keywords-gen handler)
│   └── depends on: P5.1, P5.2, P4.5            (needs prompt builder, deps, getDirtyCache)
└── P5.4                                        (index.ts — P5.4a through P5.4f)
    └── depends on: P5.1, P5.3, P4.9            (needs prompt builder, command handler, cache wiring)

Phase 6 (Integration + Finalize)
├── P6.1                                        (matcher.ts edge cases)
│   └── depends on: none                        (standalone fix)
├── P6.2                                        (index.ts final wiring)
│   └── depends on: P5.4                        (all phases wired)
├── P6.3 ···· P6.4                              (test updates, parallel)
│   └── depends on: P6.1, P1.3                  (need new types/edge case fixes)
├── P6.5                                        (integration tests)
│   └── depends on: P6.2                        (full wiring done)
├── P6.6                                        (prompt injection sanitization)
│   └── depends on: P6.2                        (wiring stable)
├── P6.7                                        (JSDoc pass)
│   └── depends on: P6.2, P6.6                  (all code stable)
├── P6.8                                        (npm test)
│   └── depends on: P6.3, P6.4, P6.5, P6.7
├── P6.9                                        (manual smoke test)
│   └── depends on: P6.8
└── P6.10                                       (keywordSource in /doc-inject list)
    └── depends on: P5.3                        (command handler stable)
```

### Execution Order Summary

| Pass | Phases | Tasks | Estimated changes |
|------|--------|-------|-------------------|
| **Pass 1** | P1 → P2 → P3 | P1.1–P1.10, P2.1–P2.11, P3.1–P3.6 | ~850 lines; mechanical refactors + BLOCKER-1 pipeline fix |
| **Pass 2** | P4 → P5 | P4.1–P4.11, P5.1–P5.4 | ~650 lines; new features with BLOCKER-2, BLOCKER-3, MAJOR-1, MAJOR-2 fixes |
| **Pass 3** | P6 | P6.1–P6.10 | ~350 lines; integration + sanitization + polish |

**Rationale:** Phases 1–3 are refactors with no behavioral change. Phases 4–5 add new behavior. Phase 5 specifically resolves all Critic blockers. Phase 6 ties everything together.

---

## 4. Detailed Acceptance Criteria per Task

### Phase 1 Criteria

| Task | Criteria |
|------|----------|
| P1.1 | `DocInjectorConfig` has 10 fields; `DEFAULT_CONFIG` matches spec §5.1 values exactly |
| P1.2 | `KeywordSource`, `KeywordCache`, `CacheEntry`, `BinaryDetectResult`, `GlobFilter` exported from `types.ts` |
| P1.3 | `DocEntry.keywordSource` is `"frontmatter" \| "heuristic" \| "llm" \| "cache"` |
| P1.4 | `loadConfig` returns `Promise<DocInjectorConfig>`, uses `readFile` from `fs/promises`, catches `ENOENT` |
| P1.5 | New fields validated: `include`/`exclude` are string arrays, `maxFileSize` ≥ 1024 and ≤ 10MB, `maxConcurrent` 1–100, `llmBatchSize` 1–100 |
| P1.6 | `rebuild()` uses `readdir`/`readFile` from `fs/promises`; is `async` |
| P1.7 | `scanFlat`/`scanRecursive` use `readdir` from `fs/promises`; DocRegistry stores `this.recursive` |
| P1.8 | `initRegistry` does `config = await loadConfig(cwd)` |
| P1.9 | All existing config tests pass with async; new tests for new config fields |
| P1.10 | All existing registry tests pass with async scan; all `DocEntry` mocks have `keywordSource` |

### Phase 2 Criteria

| Task | Criteria |
|------|----------|
| P2.1 | `"picomatch": "^4.0.2"` in `dependencies`; `npm install` succeeds |
| P2.2 | `createGlobFilter` returns `{ match: (path) => boolean }`; include/exclude both filter |
| P2.3 | `isBinaryExtension("file.png") → true`; `isBinaryContent` returns `{isBinary, reason}`; `KNOWN_TEXT_EXTENSIONS` has ≥28 entries; static `import { open }` at top (no dynamic import) |
| P2.4 | `DocRegistry` constructor and `create()` accept `config: DocInjectorConfig` |
| P2.5 | **BLOCKER-1 verify**: `isBinaryExtension` → known-text whitelist → `isBinaryContent` → all BEFORE `readFile`; no file is both `readFile`'d AND `isBinaryContent`'d |
| P2.7 | `DocRegistry.create(docsPath, config)` — all call sites updated |
| P2.8 | All `index.ts` registry calls pass full config |
| P2.9 | All registry tests pass with new constructor signature; `keywordSource` in mocks |
| P2.10 | globber.test.ts: `**/*.md`, `*.ts`, `{a,b}.md`, `[abc]*`, exclude overrides include, empty patterns |
| P2.11 | binary-detect.test.ts: extension hits, null byte detection, non-printable threshold (0%→false, 50%→true), edge cases: empty file, very short file, known-text whitelist entries |

### Phase 3 Criteria

| Task | Criteria |
|------|----------|
| P3.1 | `parseYamlFrontmatter` exists, identical logic to current `parseFrontmatter` |
| P3.2 | `parseCStyleFrontmatter` handles `/*---\n...\n---*/` with title, keywords |
| P3.3 | `parseHTMLFrontmatter` handles `<!--\n...\n-->` with title, keywords |
| P3.4 | `parseSlashSlashFrontmatter` handles `//--- ...` parsing until blank line |
| P3.5 | `parseFrontmatter` tries YAML → C-style → HTML → slash-slash, returns first match |
| P3.6 | Each style has ≥1 test: title, keywords (flow array), keywords (block array), missing keywords → null |

### Phase 4 Criteria

| Task | Criteria |
|------|----------|
| P4.1 | `loadCache` returns `{version:1, files:{}}` on missing/invalid file; `saveCache` writes JSON |
| P4.2 | `generateKeywords` returns `string[]`; "their" appears exactly once in stop-word set; uses filename parts, headings, code symbols |
| P4.3 | `PromisePool` runs N workers, processes all items, at most `concurrency` simultaneously |
| P4.4 | `rebuild()` loads cache before processing; per-file checks mtime against cache |
| P4.5 | `getDirtyCache()` returns entries whose mtime changed or keywords were generated |
| P4.6 | When frontmatter fails and `autoKeywords === true`, `generateKeywords` is called; `keywordSource = "heuristic"` |
| P4.7 | File processing uses `PromisePool` with `config.maxConcurrent` (default 20) |
| P4.8 | `stat.size > config.maxFileSize` → skip with `console.warn`, no readFile |
| P4.9 | `initRegistry` loads cache, passes to `DocRegistry.create()`, calls `getDirtyCache()` then **MAJOR-2**: re-reads cache from disk, merges LLM entries, then `saveCache()` |
| P4.10 | cache.test.ts: roundtrip, version validation, corrupted JSON → reset |
| P4.11 | keyword-gen.test.ts: "api-authentication.md" → includes "api", "authentication"; headings → includes heading words; `.ts` with `export function login` → includes "login"; stop words absent; no duplicate stop words; never >20 |

### Phase 5 Criteria

| Task | Criteria |
|------|----------|
| P5.1 | `buildKeywordGenPrompt` formats files with path + snippet (max 2000 chars each); instruction mentions `_doc_injector_keywords` tool |
| P5.2 | `CommandDeps` includes `generateKeywordsLLM: (files) => Promise<void>` and `getConfig: () => DocInjectorConfig` |
| P5.3 | `/doc-keywords-gen` without args processes all keyword-less files in batches; with arg processes specific file |
| P5.4a | Tool registered inline with closure access to cache; `keywords` output field in schema; execute handler writes **real `mtimeMs`** via `stat()` |
| P5.4b | `keywordGenInFlight`, `llmBatchesCompleted`, `llmTotalFiles` flags exist and are used |
| P5.4c | **BLOCKER-3 verify**: `agent_end` handler checks `llmBatchesCompleted > 0`, sends `ctx.ui.notify(...)` with summary, resets counters |
| P5.4d | **MAJOR-1 verify**: `input` handler (interactive source) clears `keywordGenInFlight`; `session_start` handler clears it |
| P5.4e | **MAJOR-2 verify**: `rebuild()` cache reload-and-merge step preserves LLM-written entries |
| P5.4f | `generateKeywordsLLM` sets `keywordGenInFlight = true`, calls `pi.sendUserMessage(prompt)` |

**BLOCKER-1 verification**: Tool schema includes `keywords: Type.Array(Type.Object({path: Type.String(), keywords: Type.Array(Type.String())}))` — verified via unit test that inspects registered tool parameters.

**BLOCKER-2 verification**: Unit test with real temp file: tool writes keywords, test calls `stat()` on temp file, verifies cache `mtimeMs` matches real file mtime (not `Date.now()`).

**MAJOR-2 verification**: Integration test: start rebuild, concurrently write to cache via tool, verify both sets of entries survive in final `saveCache`.

### Phase 6 Criteria

| Task | Criteria |
|------|----------|
| P6.1 | `KeywordMatcher.keywordMatches` handles keywords with `$`, `^`, consecutive special chars, empty string |
| P6.2 | `index.ts` has clean dependency wiring; all guard flags and safety unbinds in place |
| P6.3 | `test/injector.test.ts` all `DocEntry` fixtures include `keywordSource` field |
| P6.4 | `test/matcher.test.ts` includes tests for special-char keywords, empty keywords |
| P6.5 | Integration test: temp dir with mixed files (.md, .ts, .png), scan, verify correct entries and keywords |
| P6.6 | Keywords sanitized before system prompt injection: no `\n`, no `\r`, max 100 chars each, max 20 keywords |
| P6.7 | Every exported function has JSDoc; deprecated `reset()` has `@deprecated` tag |
| P6.8 | `npm test` exits 0; all 9+ suites green |
| P6.9 | Manual smoke: `/doc-inject status`, keyword matching, `/doc-keywords-gen` without collisions |
| P6.10 | `/doc-inject list` shows `keywordSource` column |

---

## 5. Implementation Notes for Subagent Execution

### Per-File Processing Pipeline (in `registry.ts rebuild()`) — BLOCKER-1 Fixed

```
for each file in scan results (concurrent via PromisePool):
  ═══ PRE-READ BINARY CHECKS (zero or minimal I/O) ═══
  1. if isBinaryExtension(filePath) → skip, console.warn     (no I/O)
  2. if KNOWN_TEXT_EXTENSIONS.has(ext) → skip to step 4      (no I/O, whitelisted)
  3. result = await isBinaryContent(filePath)                 (reads first 8KB only)
     if result.isBinary → skip, console.warn
  
  ═══ METADATA + CACHE ═══
  4. stat = await stat(filePath)                              (metadata only)
  5. if stat.size > config.maxFileSize → skip, console.warn
  6. if cache.has(relativePath) && cache.mtimeMs === stat.mtimeMs:
       entry.keywords = cache.keywords
       entry.keywordSource = "cache"
       continue (skip readFile)
  
  ═══ FULL READ + PARSE (only for cache miss + text files) ═══
  7. content = await readFile(filePath, "utf-8")
  8. parsed = parseFrontmatter(content)
  9. if parsed: title, keywords = parsed.title, parsed.keywords; keywordSource = "frontmatter"
  10. else if config.autoKeywords:
        keywords = generateKeywords(fileName, content)
        keywordSource = "heuristic"
  11. else: skip (no keywords, auto disabled) — console.warn
  
  ═══ CACHE UPDATE ═══
  12. mark dirty in cache (relativePath → { mtimeMs: stat.mtimeMs, keywords })
  13. push DocEntry to entries[]
```

Key: `isBinaryContent` is called at step 3 **before** `readFile` at step 7. No file is both `readFile`'d and `isBinaryContent`'d.

### Frontmatter Parser Dispatch (in `registry.ts parseFrontmatter()`)

```
try in order:
  1. parseYamlFrontmatter(content)       // "---\n...\n---"
  2. parseCStyleFrontmatter(content)     // "/*---\n...\n---*/"
  3. parseHTMLFrontmatter(content)       // "<!--\n...\n-->"
  4. parseSlashSlashFrontmatter(content) // "//---\n...\n\n" (blank line terminator)

Each parser returns {title, keywords, body} | null.
```

### Prompt Injection Sanitization (in `injector.ts` or injection path)

```typescript
function sanitizeKeywords(keywords: string[]): string[] {
  return keywords
    .map(k => k.replace(/[\n\r]/g, " ").trim())  // strip newlines
    .filter(k => k.length > 0)
    .map(k => k.length > 100 ? k.slice(0, 100) : k)  // cap at 100 chars
    .slice(0, 20);  // hard cap at 20
}
```

---

## 6. Risk Register

| ID | Risk | Probability | Impact | Mitigation | Phase |
|----|------|------------|--------|------------|-------|
| **R1** | Glob patterns break existing `.md`-only behavior | Low | Medium | Test `.md.bak` (should NOT match), `.hidden.md` (should match). Verify vs picomatch docs. | P2 |
| **R2** | TOCTOU race in async scan — file deleted between `readdir` and `readFile` | Medium | Low | Already handled: catch `ENOENT` in per-file try/catch (existing code) | P1 |
| **R3** | mtime precision differences across OS (macOS 1ms, Linux ns, Windows 2s) | Low | Medium | `stats.mtimeMs` (number). Cache invalidation is conservative. | P4 |
| **R4** | picomatch API break (4.x pre-1.0) | Low | Low | Pin `^4.0.2` (minor/patch only). Only `isMatch` used. | P2 |
| **R5** | Tool name collision — `_doc_injector_keywords` clashes with another extension | Low | Medium | Underscore prefix convention; document in extension README. | P5 |
| **R6** | `sendUserMessage` collision with auto-abort flow | ~~High~~ **Low** | ~~High~~ **Low** | **RESOLVED:** `keywordGenInFlight` guard flag + safety unbinds on `input`/`session_start`. | P5 |
| **R7** | PromisePool deadlock/starvation — file read hangs indefinitely | Low | High | **Defer:** per-file timeout (`Promise.race` with 10s) only if observed. Not in v0.3.0. | P4 |
| **R8** | Binary content detection false positives — base64 blocks, emoji | Low | Medium | 8KB sample (base64 after text preamble); bytes ≥ 0x80 treated as UTF-8. Known-text whitelist removes risk entirely for `.md`/`.ts`/`.json` etc. | P2 |
| **R9** | Cache file grows unbounded — deleted docs remain in cache | Low | Low | Accept for now. Orphaned entries harmless. **Defer:** GC if >10KB. | P4 |
| **R10** | Backward compatibility — old 4-field `.pi/doc-injector.json` breaks | Low | Critical | All new fields have defaults; `loadConfig` handles missing fields. Verified by P1.5 tests. | P1 |
| **R11** | Vitest async test flakiness — concurrent temp dir I/O | Medium | Low | Unique temp dirs per test via `beforeEach`/`afterEach`; `rmSync({force: true})`. | P1-P6 |
| **R12** | **(NEW)** `keywordGenInFlight` stuck due to edge-case interrupt | Low | High | **RESOLVED (MAJOR-1):** Triple-unbind on `agent_end`, `input` (interactive), and `session_start`. No single path failure can permanently disable injection. | P5 |
| **R13** | **(NEW)** Cache overwrite race between LLM tool and `/doc-reload` | Low | High | **RESOLVED (MAJOR-2):** `rebuild()` reloads cache from disk before writing; merges LLM entries. | P4/P5 |

### Deferred Items (Not in v0.3.0 scope)

| Item | Reason | When |
|------|--------|------|
| Per-file I/O timeout in PromisePool | Low risk; file reads typically fast | Follow-up if hangs observed |
| Cache garbage collection for deleted files | Cache entries are tiny; orphaned harmless | v0.4.0 or after cache >10KB |
| Language-aware frontmatter styles (`#---` for Python, `--[[` for Lua) | Spec §6 Q3 explicitly defers | Follow-up release |
| Auto-run `/doc-keywords-gen` on first session | Spec §6 Q2 explicitly says no — too intrusive | Never unless user demand |

---

## 7. Key Source File Change Summary

| File | Current Lines | Est. New Lines | Delta | Key Changes |
|------|---------------|----------------|-------|-------------|
| `types.ts` | 51 | ~120 | +69 | New config fields, cache/binary/glob types, `KeywordSource` |
| `config.ts` | 51 | ~80 | +29 | Async `loadConfig`, new field validation |
| `registry.ts` | 212 | ~330 | +118 | Async I/O, glob filter, BLOCKER-1 binary pipeline, multi-style frontmatter, cache integration, MAJOR-2 cache merge |
| `matcher.ts` | 80 | ~90 | +10 | Regex edge case fixes |
| `injector.ts` | 59 | ~70 | +11 | P6.6 prompt injection sanitization |
| `commands.ts` | 84 | ~175 | +91 | `/doc-keywords-gen` command, new deps, `/doc-inject list` keywordSource |
| `index.ts` | 255 | ~350 | +95 | Async wiring, inline LLM tool (P5.4a-f), guard flags, safety unbinds, MAJOR-2 merge |
| `globber.ts` | — | ~30 | NEW | picomatch wrapper |
| `binary-detect.ts` | — | ~95 | NEW | Extension blacklist + known-text whitelist + content sampling; static imports |
| `keyword-gen.ts` | — | ~60 | NEW | Heuristic keyword extraction; fixed stop words |
| `keyword-llm.ts` | — | ~50 | NEW | Prompt builder only |
| `cache.ts` | — | ~30 | NEW | Cache load/save |
| `package.json` | 48 | 49 | +1 | picomatch dep |

**Total:** ~1,850 lines changed across 17 files (10 source + 7 test).

---

*Plan generated from spec v0.3.0, revised to resolve all 3 Critic blockers (BLOCKER-1: binary pipeline reorder + known-text whitelist; BLOCKER-2: real mtime from stat(); BLOCKER-3: agent_end summary notification) and 2 major concerns (MAJOR-1: safety unbinds on input/session_start; MAJOR-2: cache reload-before-write merge). Additional fixes: prompt injection sanitization, duplicate stop-word removed, static import in binary-detect.ts, keywordSource in test mocks and /doc-inject list. Execution by subagent: 3 passes (~1,850 lines across 17 files).*
