# Technical Specification: Robust Doc Injector (v0.3.0)

## 1. Tech Stack Decisions

### 1.1 Glob Library: picomatch

**Decision: picomatch (^4.0)**

| Option | Bundle | Deps | Verdict |
|--------|--------|------|---------|
| **picomatch** | ~18 KB | 0 | ✅ Use this |
| micromatch | ~60 KB | 2 (picomatch + braces) | Too heavy |
| minimatch | ~55 KB | 1 (brace-expansion) | Full glob semantics, overkill |
| Manual regex | 0 KB | 0 | Bug-prone, slow to iterate |

`picomatch` is the zero-dependency engine underneath micromatch/minimatch. It compiles glob patterns to regexes at parse time and tests paths in O(1). Supports `**`, `*`, `?`, `[abc]`, `{a,b}`. We only need `picomatch.isMatch(path, pattern)` — matching, not scanning. This is the exact use case it was built for.

Direct dependency: `"picomatch": "^4.0.2"`

### 1.2 Binary Detection: Two-Tier

**Decision: Extension blacklist (fast path) + content sampling (fallback)**

1. **Extension blacklist** — skip before any `readFile`:
   ```
   .png .jpg .jpeg .gif .bmp .ico .svg .webp .mp4 .mov .avi .mkv
   .mp3 .wav .ogg .flac .pdf .doc .docx .xls .xlsx .zip .gz .tar
   .exe .dll .so .dylib .wasm .o .a .class .pyc .ttf .woff .woff2
   .eot .db .sqlite .sqlite3 .bin .dat .pack .idx
   ```
   These are binary in every known universe. No false positives.

2. **Content sampling** — for files with unknown extensions, read first 8 KB.
   If a null byte (`\x00`) is found, or >30% of bytes are non-printable (outside `\x09`, `\x0A`, `\x0D`, `\x20`-`\x7E`, plus UTF-8 multi-byte sequences), classify as binary.
   
   Implementation: `isBinary(buffer: Buffer): boolean` — check for null byte OR non-printable ratio > 0.3 in first 8KB.

Rationale: Extension-only misses files like `Makefile`, `.gitignore` renamed as `.png`. Content-only wastes I/O on known-binary files. Combined gives safety + speed.

### 1.3 LLM Keyword Generation: Opt-In Command

**Decision: Local-first heuristics always. LLM mode via explicit `/doc-keywords-gen` command.**

Pi's ExtensionAPI has no `pi.callModel()`. Options evaluated:

| Approach | UX | Reliability | Verdict |
|----------|----|-------------|---------|
| Direct HTTP fetch | OK | Fragile (provider-specific auth, URL construction) | ❌ |
| Hidden tool + sendUserMessage | Bad (interrupts user session) | Works but noisy | ❌ |
| Opt-in command | ✅ User controls when | Clean, non-invasive | ✅ |
| Defer until API exists | N/A | Blocked indefinitely | ❌ |

**Mechanism**: When user runs `/doc-keywords-gen`:
1. Scan all text files, find those without keywords (or with stale cache)
2. Batch them into a single user message: `"Generate YAML frontmatter keywords for the following project files..."`
3. The LLM responds with keyword suggestions. The extension parses the response and updates the cache.
4. Alternatively, register a hidden tool `_doc_injector_keywords` that accepts `{files: [{path, content, existingKeywords}]}` and returns `{keywords: [{path, keywords}]}`. The command triggers a prompt that calls this tool.

**Recommended approach**: Hidden tool. Register `_doc_injector_keywords` with `promptSnippet` omitted (not shown in system prompt). The `/doc-keywords-gen` command calls `pi.sendUserMessage()` with a prompt that instructs the LLM to call `_doc_injector_keywords`. This gives structured output.

### 1.4 LLM Batching: Single Prompt, Structured Output

When `/doc-keywords-gen` runs:
- Batch all keyword-less files into one tool call
- Tool input: `files: Array<{path: string, snippet: string}>` (first 200 lines per file)
- Tool output: `keywords: Array<{path: string, keywords: string[]}>`
- Max files per batch: 20 (configurable `llmBatchSize`, default 20)
- If >20 files, split into multiple sequential batches

### 1.5 Cache Strategy: mtime-Based

**Decision: mtime, stored in `.pi/doc-injector-cache.json`.**

```json
{
  "version": 1,
  "files": {
    "api/auth.md": {
      "mtimeMs": 1715443200000,
      "keywords": ["api", "authentication", "jwt", "oauth"]
    }
  }
}
```

| Approach | Accuracy | Speed | Verdict |
|----------|----------|-------|---------|
| mtime | Good enough | O(1) stat call | ✅ |
| Content hash | Perfect | O(n) must read file | ❌ defeats caching purpose |
| fs.watch | Real-time | Complex, platform-specific | ❌ overkill |

Edge cases:
- `mtimeMs` from `Stats.mtimeMs` (sub-ms precision on Linux, 1ms on macOS)
- Git clone restores mtime? Yes — git sets mtime to checkout time. This means a fresh clone invalidates cache. Acceptable: `resources_discover` triggers scan at session start anyway.
- Cache is not committed to git (`.pi/doc-injector-cache.json` is gitignored implicitly — it lives in `.pi/` which may or may not be committed).

### 1.6 Config Async Refactor: Yes, Worth It

**Decision: Refactor `loadConfig` to async (top-level await in factory).**

Current sync I/O (`existsSync`, `readFileSync`) blocks the extension factory. Async I/O:
- `existsSync` → try `readFile`, catch `ENOENT` (avoids TOCTOU race)
- `readFileSync` → `readFile` from `node:fs/promises`

The extension factory is already `async function docInjectorExtension(pi)` so `await loadConfig(cwd)` works seamlessly. Cost: negligible. Benefit: align with FR-3.

### 1.7 Directories-as-Docs: No Special Handling

With recursive scanning and `relativePath`, directory hierarchy is preserved naturally. A file at `docs/api/auth/oauth.md` has `relativePath: "api/auth/oauth.md"`. If users want a directory-level doc, they add an `index.md`. **No additional directory abstraction needed.**

---

## 2. Architecture Overview

### 2.1 Layer Diagram

```
┌─────────────────────────────────────────────┐
│  index.ts (Extension Entry)                  │
│  ┌───────────┐ ┌────────────┐ ┌───────────┐ │
│  │ Event     │ │ Command    │ │ Injection │ │
│  │ Handlers  │ │ Handlers   │ │ Logic     │ │
│  └─────┬─────┘ └─────┬──────┘ └─────┬─────┘ │
│        │              │              │        │
├────────┼──────────────┼──────────────┼────────┤
│        ▼              ▼              ▼        │
│  ┌──────────┐ ┌──────────┐ ┌──────────────┐ │
│  │ Registry │ │ Commands │ │ Injector     │ │
│  │ (scan,   │ │ (slash   │ │ (prompt      │ │
│  │  index,  │ │  cmds)   │ │  append,     │ │
│  │  match)  │ │          │ │  notify)     │ │
│  └────┬─────┘ └──────────┘ └──────────────┘ │
│       │                                       │
│       ▼                                       │
│  ┌──────────┐ ┌──────────┐ ┌──────────────┐ │
│  │ Globber  │ │ Binary   │ │ KeywordGen   │ │
│  │ (picom.  │ │ Detect   │ │ (local       │ │
│  │  match)  │ │ (ext+mag) │ │  heuristics) │ │
│  └──────────┘ └──────────┘ └──────┬───────┘ │
│                                    │          │
│                           ┌────────▼───────┐ │
│                           │ Cache          │ │
│                           │ (.pi/doc-inj-  │ │
│                           │  cache.json)   │ │
│                           └────────────────┘ │
│                                              │
│  ┌──────────────┐ ┌──────────────────────┐  │
│  │ Matcher      │ │ KeywordLLM (hidden   │  │
│  │ (keyword     │ │ tool, only via       │  │
│  │  stream mgr) │ │ /doc-keywords-gen)   │  │
│  └──────────────┘ └──────────────────────┘  │
├─────────────────────────────────────────────┤
│  types.ts   config.ts   (shared interfaces) │
└─────────────────────────────────────────────┘
```

### 2.2 Data Flow

```
session_start
  └─► initRegistry(cwd)
       ├─► loadConfig(cwd)        ── async JSON parse from .pi/doc-injector.json
       ├─► loadCache(cwd)         ── async JSON parse from .pi/doc-injector-cache.json
       └─► DocRegistry.create(docsPath, config)
            ├─► scanDirectory(docsPath, globPatterns)
            │    ├─► readdir(dir, {recursive, withFileTypes})  ── async
            │    ├─► filter by glob patterns                   ── picomatch
            │    ├─► filter by binary extension blacklist      ── fast skip
            │    └─► return file paths
            │
            ├─► for each file path (concurrent, limit 20):
            │    ├─► stat(filePath)                            ── for size, mtime
            │    ├─► check maxSize → skip if too large
            │    ├─► check cache → reuse keywords if mtime matches
            │    ├─► readFile(filePath)                        ── async
            │    ├─► isBinaryContent(buffer)                   ── sample first 8KB
            │    ├─► parseFrontmatter(content)                 ── YAML frontmatter
            │    │    ├─► try --- YAML --- (markdown style)
            │    │    ├─► try /*--- YAML ---*/ (C-style comment)
            │    │    ├─► try <!-- YAML --> (HTML comment)
            │    │    ├─► try //--- YAML (// comment, single-line variant)
            │    │    └─► if no frontmatter → generateKeywords(filename, content)
            │    │
            │    └─► push DocEntry to entries[]
            │
            └─► writeCache() if any new keywords generated

before_agent_start
  └─► if pendingMatches.size > 0
       ├─► check contextUsage against threshold
       ├─► buildSystemPromptAppend(matchedEntries)
       ├─► registry.markInjected(...)
       ├─► notifyInjection(ui, entries)
       └─► return { systemPrompt: event.systemPrompt + append }

/doc-keywords-gen command
  └─► scan files without keywords
       ├─► batch into groups of 20
       ├─► for each batch: pi.sendUserMessage(prompt)
       └─► hidden tool captures LLM response → writes cache
```

### 2.3 Key Design Patterns

- **Dependency injection via CommandDeps**: `index.ts` creates all singletons (registry, cache, config) and passes them down via typed deps objects. No global state.
- **Concurrency gate**: `PromisePool` — run N async operations concurrently, limit to `maxConcurrent` (default 20). Used when reading/parsing files.
- **Graceful degradation per file**: Each file's read/parse path is wrapped in try/catch. Failures log (once per category) and skip. One bad file doesn't kill the scan.
- **Backward compatibility**: All existing config fields keep defaults. `DocInjectorConfig` gains optional fields with sensible defaults. Old `.pi/doc-injector.json` files work without changes.

---

## 3. File Structure Changes

```
pi-doc-injector/
├── index.ts              # MODIFIED — async config load, new deps wiring
├── types.ts              # MODIFIED — new config fields, binary/file types
├── config.ts             # MODIFIED — async loadConfig, new fields
├── registry.ts           # HEAVILY MODIFIED — async I/O, glob, binary detect, auto-keywords
├── matcher.ts            # MINOR — escape regex edge cases
├── injector.ts           # UNCHANGED (already async-clean)
├── commands.ts           # MODIFIED — /doc-keywords-gen command, updated deps
├── keyword-gen.ts        # NEW — local heuristic keyword generation
├── keyword-llm.ts        # NEW — LLM-based keyword generation hidden tool
├── cache.ts              # NEW — keyword cache read/write
├── binary-detect.ts      # NEW — binary detection (ext blacklist + content sampling)
├── globber.ts            # NEW — glob pattern matching wrapper around picomatch
├── package.json          # MODIFIED — add picomatch dep
└── test/
    ├── registry.test.ts          # MODIFIED — async tests, glob patterns
    ├── binary-detect.test.ts     # NEW — binary detection tests
    ├── keyword-gen.test.ts       # NEW — heuristic keyword tests
    ├── cache.test.ts             # NEW — cache roundtrip tests
    ├── globber.test.ts           # NEW — glob matching tests
    ├── matcher.test.ts           # EXISTING (minor updates)
    └── injector.test.ts          # EXISTING (minor updates)
```

---

## 4. Dependencies

### New Runtime Deps

| Package | Version | Purpose | Size |
|---------|---------|---------|------|
| `picomatch` | `^4.0.2` | Glob pattern matching | ~18 KB |

### Existing Runtime Deps

None changed. `@mariozechner/pi-coding-agent` remains peer dep.

### Dev Deps (unchanged)

`@types/node`, `typescript`, `vitest` — no additions.

### Total Dependency Footprint

1 new package, 0 transitive dependencies. Total: ~18 KB added.

---

## 5. API / Interface Definitions

### 5.1 Updated `types.ts`

```typescript
// ── Document Entry ──

export interface DocEntry {
  /** Absolute path on disk */
  filePath: string;
  /** Path relative to docsPath (e.g. "guides/setup.md") */
  relativePath: string;
  /** Basename (e.g. "setup.md") */
  fileName: string;
  /** Document title (from frontmatter or auto-generated) */
  title: string;
  /** Keywords for matching */
  keywords: string[];
  /** Full file content */
  content: string;
  /** Whether this doc has been injected in current session */
  injected: boolean;
  /** Source of keywords: "frontmatter" | "heuristic" | "llm" | "cache" */
  keywordSource: KeywordSource;
}

export type KeywordSource = "frontmatter" | "heuristic" | "llm" | "cache";

// ── Config ──

export interface DocInjectorConfig {
  /** Path to docs folder (relative to cwd) */
  docsPath: string;
  /** Minimum keyword matches to trigger injection */
  matchThreshold: number;
  /** Skip injection if context usage exceeds this % (0-100) */
  contextThreshold: number;
  /** Whether to scan subdirectories */
  recursive: boolean;
  /** Glob patterns for files to include (default: ["**​/*.md"]) */
  include: string[];
  /** Glob patterns for files/dirs to exclude (default: ["node_modules/**​"]) */
  exclude: string[];
  /** Maximum file size in bytes to parse (default: 100KB = 102400) */
  maxFileSize: number;
  /** Enable auto-generation of keywords when frontmatter is missing (default: true) */
  autoKeywords: boolean;
  /** Enable LLM-based keyword generation via /doc-keywords-gen (default: true) */
  llmKeywords: boolean;
  /** Max concurrent file I/O operations (default: 20) */
  maxConcurrent: number;
  /** Max files per LLM keyword-gen batch (default: 20) */
  llmBatchSize: number;
}

export const DEFAULT_CONFIG: DocInjectorConfig = {
  docsPath: "./docs",
  matchThreshold: 1,
  contextThreshold: 80,
  recursive: true,
  include: ["**/*.md"],
  exclude: ["node_modules/**", ".git/**", "dist/**", "build/**", ".next/**"],
  maxFileSize: 102400,        // 100 KB
  autoKeywords: true,
  llmKeywords: true,
  maxConcurrent: 20,
  llmBatchSize: 20,
};

// ── Match Types (unchanged) ──
// MatcherOptions, MatchResult — same as current.

// ── Cache Types (new) ──

export interface KeywordCache {
  version: 1;
  files: Record<string, CacheEntry>;  // relativePath → CacheEntry
}

export interface CacheEntry {
  mtimeMs: number;
  keywords: string[];
}

// ── Binary Detection (new) ──

export interface BinaryDetectResult {
  isBinary: boolean;
  reason: "extension" | "nullByte" | "nonPrintable" | "none";
}

// ── Globber (new) ──

export interface GlobFilter {
  /** Returns true if the path matches any include pattern and no exclude pattern */
  match(relativePath: string): boolean;
}
```

### 5.2 Updated `config.ts`

```typescript
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { DEFAULT_CONFIG, type DocInjectorConfig } from "./types";

/**
 * Load config from `.pi/doc-injector.json` relative to cwd.
 * Now async — uses readFile from fs/promises.
 * Validates and clamps all numeric fields.
 */
export async function loadConfig(cwd: string): Promise<DocInjectorConfig> {
  const configPath = join(cwd, ".pi", "doc-injector.json");
  
  try {
    const raw = await readFile(configPath, "utf-8");
    const parsed = JSON.parse(raw) as Partial<DocInjectorConfig>;

    return {
      docsPath: parsed.docsPath ?? DEFAULT_CONFIG.docsPath,
      matchThreshold: clampInt(parsed.matchThreshold, DEFAULT_CONFIG.matchThreshold, 1, Infinity, "matchThreshold"),
      contextThreshold: clampInt(parsed.contextThreshold, DEFAULT_CONFIG.contextThreshold, 0, 100, "contextThreshold"),
      recursive: parsed.recursive ?? DEFAULT_CONFIG.recursive,
      include: validateGlobArray(parsed.include, DEFAULT_CONFIG.include),
      exclude: validateGlobArray(parsed.exclude, DEFAULT_CONFIG.exclude),
      maxFileSize: clampInt(parsed.maxFileSize, DEFAULT_CONFIG.maxFileSize, 1024, 10 * 1024 * 1024, "maxFileSize"),
      autoKeywords: parsed.autoKeywords ?? DEFAULT_CONFIG.autoKeywords,
      llmKeywords: parsed.llmKeywords ?? DEFAULT_CONFIG.llmKeywords,
      maxConcurrent: clampInt(parsed.maxConcurrent, DEFAULT_CONFIG.maxConcurrent, 1, 100, "maxConcurrent"),
      llmBatchSize: clampInt(parsed.llmBatchSize, DEFAULT_CONFIG.llmBatchSize, 1, 100, "llmBatchSize"),
    };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      console.warn(`[doc-injector] Failed to parse config: ${err instanceof Error ? err.message : String(err)}`);
    }
    return { ...DEFAULT_CONFIG };
  }
}
```

### 5.3 New `binary-detect.ts`

```typescript
import { readFile } from "node:fs/promises";
import type { BinaryDetectResult } from "./types";

/** Extensions that are always binary — skip before any I/O */
const BINARY_EXTENSIONS = new Set([
  // Images
  ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".ico", ".svg", ".webp", ".avif",
  // Video / Audio
  ".mp4", ".mov", ".avi", ".mkv", ".webm",
  ".mp3", ".wav", ".ogg", ".flac", ".aac", ".m4a",
  // Documents
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx",
  // Archives
  ".zip", ".gz", ".tar", ".bz2", ".xz", ".7z", ".rar",
  // Binaries
  ".exe", ".dll", ".so", ".dylib", ".wasm",
  ".o", ".a", ".class", ".pyc", ".pyo",
  // Fonts
  ".ttf", ".otf", ".woff", ".woff2", ".eot",
  // Database / Data
  ".db", ".sqlite", ".sqlite3", ".bin", ".dat", ".pack", ".idx",
  // Other
  ".DS_Store",
]);

/** Check if a file path has a known-binary extension */
export function isBinaryExtension(filePath: string): boolean {
  const ext = filePath.slice(filePath.lastIndexOf(".")).toLowerCase();
  return BINARY_EXTENSIONS.has(ext);
}

/**
 * Check file content for binary signature.
 * Reads first 8192 bytes. Returns true if:
 * - Any null byte (0x00) present
 * - >30% of bytes are non-printable
 * Non-printable excludes: TAB(0x09), LF(0x0A), CR(0x0D), 0x20-0x7E,
 * and UTF-8 continuation bytes (0x80-0xBF) / leading bytes (0xC0-0xF7).
 */
export async function isBinaryContent(filePath: string): Promise<BinaryDetectResult> {
  try {
    const fh = await import("node:fs/promises").then(m => m.open(filePath, "r"));
    const buf = Buffer.alloc(8192);
    const { bytesRead } = await fh.read(buf, 0, 8192, 0);
    await fh.close();

    const slice = buf.subarray(0, bytesRead);

    for (let i = 0; i < slice.length; i++) {
      if (slice[i] === 0) {
        return { isBinary: true, reason: "nullByte" };
      }
    }

    let nonPrintable = 0;
    for (let i = 0; i < slice.length; i++) {
      const b = slice[i];
      // Printable ASCII, whitespace, or UTF-8 multi-byte sequences
      if (b === 0x09 || b === 0x0A || b === 0x0D || (b >= 0x20 && b <= 0x7E) || (b >= 0x80)) {
        continue;
      }
      nonPrintable++;
    }

    if (slice.length > 0 && nonPrintable / slice.length > 0.3) {
      return { isBinary: true, reason: "nonPrintable" };
    }

    return { isBinary: false, reason: "none" };
  } catch {
    return { isBinary: false, reason: "none" }; // unreadable — let caller handle
  }
}
```

### 5.4 New `globber.ts`

```typescript
import picomatch from "picomatch";
import type { GlobFilter } from "./types";

/**
 * Create a glob filter from include/exclude patterns.
 * Uses picomatch for zero-dependency, fast matching.
 */
export function createGlobFilter(include: string[], exclude: string[]): GlobFilter {
  const includeMatchers = include.map(p => picomatch(p));
  const excludeMatchers = exclude.map(p => picomatch(p));
  
  return {
    match(relativePath: string): boolean {
      // Must match at least one include pattern
      const included = includeMatchers.some(m => m(relativePath));
      if (!included) return false;
      
      // Must not match any exclude pattern
      const excluded = excludeMatchers.some(m => m(relativePath));
      return !excluded;
    },
  };
}
```

### 5.5 New `keyword-gen.ts`

```typescript
import { basename, extname } from "node:path";

/**
 * Generate keywords from filename + content heuristics.
 * No LLM involved. Runs locally in <1ms per file.
 */
export function generateKeywords(fileName: string, content: string): string[] {
  const keywords = new Set<string>();
  
  // 1. Split filename by common separators
  const nameWithoutExt = basename(fileName, extname(fileName));
  const parts = nameWithoutExt.split(/[-_\s.]+/);
  for (const part of parts) {
    const cleaned = part.toLowerCase().replace(/[^a-z0-9]/g, "");
    if (cleaned.length >= 2 && cleaned.length <= 30) {
      keywords.add(cleaned);
    }
  }
  
  // 2. Extract markdown headings (## Title → "title")
  const headMatch = content.matchAll(/^#{1,6}\s+(.+)$/gm);
  for (const m of headMatch) {
    const heading = m[1].toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
    const words = heading.split(/\s+/).filter(w => w.length >= 2);
    for (const w of words) {
      keywords.add(w);
    }
  }
  
  // 3. Extract code symbols (function/class/const names)
  const ext = extname(fileName).toLowerCase();
  if ([".ts", ".tsx", ".js", ".jsx", ".py", ".rs", ".go", ".java"].includes(ext)) {
    // function/class/const declarations
    const symbolMatch = content.matchAll(
      /(?:export\s+)?(?:async\s+)?(?:function|class|const|let|var|interface|type|enum)\s+(\w+)/gm
    );
    for (const m of symbolMatch) {
      const sym = m[1].toLowerCase();
      if (sym.length >= 2 && sym !== "default") {
        keywords.add(sym);
      }
    }
  }
  
  // 4. Remove common stop words
  const stopWords = new Set([
    "the", "and", "for", "are", "but", "not", "you", "all", "can",
    "had", "her", "was", "one", "our", "out", "has", "have", "from",
    "they", "that", "with", "this", "will", "your", "which", "their",
    "been", "would", "there", "their",
  ]);
  for (const sw of stopWords) {
    keywords.delete(sw);
  }
  
  // 5. Cap at 20 keywords
  return [...keywords].slice(0, 20);
}
```

### 5.6 New `keyword-llm.ts`

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "typebox";

export interface KeywordLLMOptions {
  maxBatchSize: number;
}

interface FileInput {
  path: string;
  snippet: string;
  existingKeywords: string[];
}

interface FileOutput {
  path: string;
  keywords: string[];
}

/**
 * Register the hidden `_doc_injector_keywords` tool.
 * Not shown in system prompt (no promptSnippet).
 * Called only via /doc-keywords-gen command.
 */
export function registerKeywordTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "_doc_injector_keywords",
    label: "Doc Keyword Generator",
    description: "Generate 5-10 relevant lowercase keywords for each file based on its content, filename, and purpose. Keywords should help find documentation relevant to development topics.",
    parameters: Type.Object({
      files: Type.Array(Type.Object({
        path: Type.String({ description: "Relative file path" }),
        snippet: Type.String({ description: "First 200 lines of file content" }),
        existingKeywords: Type.Array(Type.String(), { description: "Currently known keywords (can be empty)" }),
      })),
    }),
    async execute(_id, params) {
      // This tool doesn't execute logic — it exists to capture the LLM's
      // structured response. The response is parsed by the command handler
      // via the tool result.
      // The LLM fills in keywords for each file.
      return {
        content: [{ type: "text" as const, text: "Keywords generated." }],
        details: { generated: params.files.map((f: FileInput) => ({
          path: f.path,
          keywords: f.existingKeywords, // LLM should replace these
        })) },
      };
    },
  });
}

/**
 * Build a user prompt asking the LLM to generate keywords for files.
 */
export function buildKeywordGenPrompt(files: FileInput[]): string {
  const fileList = files.map(f => 
    `### ${f.path}\n\`\`\`\n${f.snippet.slice(0, 2000)}\n\`\`\`\nCurrent keywords: ${JSON.stringify(f.existingKeywords)}`
  ).join("\n\n");

  return `Generate keywords for the following project documentation files. For each file, provide 5-10 lowercase keywords that describe its topic and content. Keywords should be reusable terms someone might mention during programming (e.g., "api", "authentication", "deployment", "testing", "database").

Use the _doc_injector_keywords tool to submit your keyword suggestions.

Files:\n\n${fileList}`;
}
```

### 5.7 New `cache.ts`

```typescript
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { KeywordCache } from "./types";

const CACHE_FILENAME = ".pi/doc-injector-cache.json";

export async function loadCache(cwd: string): Promise<KeywordCache> {
  try {
    const raw = await readFile(join(cwd, CACHE_FILENAME), "utf-8");
    const parsed = JSON.parse(raw);
    if (parsed.version === 1 && typeof parsed.files === "object") {
      return parsed as KeywordCache;
    }
    return { version: 1, files: {} };
  } catch {
    return { version: 1, files: {} };
  }
}

export async function saveCache(cwd: string, cache: KeywordCache): Promise<void> {
  try {
    await writeFile(join(cwd, CACHE_FILENAME), JSON.stringify(cache, null, 2), "utf-8");
  } catch (err) {
    console.warn(`[doc-injector] Failed to write keyword cache: ${err instanceof Error ? err.message : String(err)}`);
  }
}
```

### 5.8 Updated `registry.ts` (Key Changes)

The existing `DocRegistry` class is heavily refactored:

- **Constructor** now takes `DocInjectorConfig` instead of individual params
- **`rebuild()`** is fully async:
  1. `readdir(dir, {recursive, withFileTypes})` from `fs/promises`
  2. Filters by `GlobFilter.match(relativePath)`
  3. Filters by `isBinaryExtension(filePath)` — skips without I/O
  4. For remaining files, processes concurrently with a `PromisePool` (max `config.maxConcurrent`)
  5. Each file: `stat` → check `maxFileSize` → check `mtime` in cache → `readFile` → `isBinaryContent` → `parseFrontmatter` → `generateKeywords` fallback
  6. `parseFrontmatter` now tries multiple comment styles:
     - `--- ... ---` (YAML frontmatter)
     - `/*--- ... ---*/` (C-style block comment)
     - `<!-- ... -->` (HTML comment)
     - `//--- ...` (single-line comment prefix, reads until blank line)

Key method signatures:
```typescript
export class DocRegistry {
  static async create(docsPath: string, config: DocInjectorConfig, cache: KeywordCache): Promise<DocRegistry>;
  async rebuild(): Promise<void>;
  getEntries(): DocEntry[];
  getNonInjectedEntries(): DocEntry[];
  markInjected(filePaths: string[]): void;
  markAllNotInjected(): void;
  getDirtyCache(): KeywordCache; // Returns entries to write back to cache
}
```

### 5.9 Updated `commands.ts`

New deps interface:
```typescript
export interface CommandDeps {
  getRegistry: () => DocRegistry | null;
  getEnabled: () => boolean;
  setEnabled: (v: boolean) => void;
  reloadRegistry: () => Promise<number>;
  getConfig: () => DocInjectorConfig;
  generateKeywordsLLM: (files: Array<{path: string; snippet: string; existingKeywords: string[]}>) => Promise<void>;
}
```

New command:
```
/doc-keywords-gen [path] — Generate keywords for docs using LLM.
  Without path: all docs missing keywords
  With path: only that specific file
```

---

## 6. Answers to Architect Questions

### Q1: LLM keyword gen mechanism

**Answer: Opt-in command `/doc-keywords-gen` using a hidden tool `_doc_injector_keywords`.**

Pi has no `pi.callModel()` API. Options evaluated:
- **Direct HTTP** — fragile, must reconstruct provider auth/URL from context. Rejected.
- **Hidden tool** — register tool without `promptSnippet`, trigger via `pi.sendUserMessage()`. The LLM calls the tool with structured keyword output. Best option.
- **Interruptive auto-gen** — injects keyword-gen requests into user's session. Terrible UX. Rejected.
- **Defer** — indefinite block. Rejected.

The command batches keyword-less files into a single prompt. The LLM calls `_doc_injector_keywords` with structured JSON. Results are written to the mtime cache. User controls when this happens.

### Q2: Glob library choice

**Answer: picomatch (^4.0.2), 0 dependencies, ~18 KB.**

Only need `isMatch(path, pattern)`, not directory walking. picomatch is the zero-dep matching engine used by micromatch/minimatch. Supports `**`, `*`, `?`, `{a,b}`, character classes. Compiles patterns once, tests in O(1). Manual regex implementation would be fragile with edge cases (escaping, globstar semantics, negation patterns).

### Q3: Binary detection

**Answer: Extension blacklist (fast skip) + content sampling (safety net).**

Two-tier for speed + correctness:
1. Extension blacklist: 60+ known-binary extensions. Skip before any read. Covers 99% of binaries.
2. Content sampling: first 8KB. Null byte OR >30% non-printable ratio → binary. Catches misnamed files and extensionless binaries.

### Q4: LLM batching

**Answer: Single prompt per batch, 20 files/batch, sequential batches.**

The `/doc-keywords-gen` command:
1. Scans registry for entries without keywords (or stale cache)
2. Groups into batches of `config.llmBatchSize` (default 20)
3. For each batch, sends a user message with file paths + snippets (first 200 lines)
4. LLM responds by calling `_doc_injector_keywords` tool with structured JSON
5. Results written to cache

### Q5: Cache strategy

**Answer: mtime-based, stored in `.pi/doc-injector-cache.json`.**

Cache schema: `{version: 1, files: {[relativePath]: {mtimeMs, keywords}}}`.

On scan: `stat(filePath)` → if `mtimeMs` matches cache, use cached keywords without reading file. Cache miss → read file, parse frontmatter or auto-gen, update cache.

mtime is sufficient: any content change updates mtime. Git clone sets mtime to checkout time (invalidates cache on fresh clone — acceptable). Content hash would require reading every file on every scan, defeating the purpose.

### Q6: Config async refactor

**Answer: Yes, trivial. `existsSync` → try/catch `readFile`. `readFileSync` → `readFile` from `fs/promises`.**

The extension factory is already async (`export default async function`). `loadConfig` returns `Promise<DocInjectorConfig>`. Total change: ~5 lines. Benefit: no sync I/O in entire codebase (FR-3 compliance).

### Q7: Directories-as-docs

**Answer: No special handling. Recursive scan with meaningful `relativePath` already provides directory grouping.**

A directory is not a document. Files within directories ARE documents, and `relativePath` (e.g., `"api/auth/oauth.md"`) gives natural grouping. If a user wants a directory-level entry point, they add an `index.md` or `README.md`. The `include` glob pattern can target specific directory patterns (e.g., `"api/**​/*.md"`).

---

## 7. Migration & Backward Compatibility

### Breaking Changes: None

All new config fields have defaults matching current behavior:
- `include: ["**/*.md"]` → same as current `.md`-only filter
- `autoKeywords: true` → no behavioral change for files with frontmatter
- `maxFileSize: 102400` → files >100KB were already problematic; now explicit
- `maxConcurrent: 20` → previously synchronous (1 at a time); now faster
- `cache` → transparent, no user-facing change

### Deprecated
- `DocRegistry.reset()` remains as `@deprecated` wrapper around `markAllNotInjected()` (already done in current codebase)

### Config Migration
Old `.pi/doc-injector.json`:
```json
{"docsPath": "./docs", "matchThreshold": 2, "contextThreshold": 80, "recursive": true}
```
Works unchanged. New fields use defaults.

---

## 8. Performance Budget

| Metric | Target | Strategy |
|--------|--------|----------|
| Scan 100 .md files | <300ms | Concurrent readFile × 20, mtime cache skips re-reads |
| Scan 100 text files (including binary) | <500ms | Extension blacklist skips I/O for binaries |
| Startup with 0 changed files (cache hit) | <50ms | stat-only, skip readFile |
| Memory: 100 files × 50KB each | <10MB | Stream processing, no full repo read into memory |

### Concurrency Control

`PromisePool` implementation (inline in `registry.ts`):
```typescript
async function promisePool<T>(items: T[], fn: (item: T) => Promise<void>, concurrency: number): Promise<void> {
  const queue = [...items];
  async function worker(): Promise<void> {
    while (queue.length > 0) {
      const item = queue.shift()!;
      await fn(item);
    }
  }
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
}
```

---

## 9. Implementation Order

| Phase | Scope | Files | Risk |
|-------|-------|-------|------|
| **1** | Async I/O + types + config | types.ts, config.ts, registry.ts (partial) | Low |
| **2** | Glob + binary detection | globber.ts, binary-detect.ts, registry.ts | Low |
| **3** | Multi-style frontmatter parsing | registry.ts (parseFrontmatter) | Low |
| **4** | Local keyword generation + cache | keyword-gen.ts, cache.ts, registry.ts | Medium |
| **5** | LLM keyword generation | keyword-llm.ts, commands.ts, index.ts | Medium |
| **6** | Integration wiring + tests | index.ts, test/* | High |

Phases 1-3 are mechanical refactors. Phases 4-5 are new features. Phase 6 ties everything together.

---

## 10. Open Questions

1. **Should the extension write back generated keywords to the source file's frontmatter?** — Leaning no: modifying user source files is dangerous territory. Cache is safer.

2. **Should `/doc-keywords-gen` auto-run on first session start if no docs have keywords?** — No: too intrusive. User must explicitly request it.

3. **Should comment-style frontmatter support be language-aware (e.g., `#---` for Python, `--[[` for Lua)?** — Defer: support the big three (YAML `---`, C-style `/*---`, HTML `<!--`) and add more in a follow-up if demanded.
