# pi-doc-injector: Implementation Plan

**Date:** 2026-04-26  
**Status:** Approved (Consensus: Planner ✓ → Architect ✓ → Critic ✓)

## Reordered Steps (per Architect Review)

Steps are ordered by dependency: identity-affecting changes first, cleanups last, strict mode at the very end.

---

## Step 1: Recursive Directory Scanning (BUG-3)

**Files:** `types.ts`, `config.ts`, `registry.ts`, `index.ts`  
**Priority:** High — changes entry identity (filePath, fileName semantics)  
**Risk:** Medium — behavior change, must verify backward compat

### 1a. `types.ts` — Add `recursive` to config + add `relativePath` to DocEntry

```ts
export interface DocInjectorConfig {
  docsPath: string;
  matchThreshold: number;
  contextThreshold: number;
  recursive: boolean;
}

export const DEFAULT_CONFIG: DocInjectorConfig = {
  docsPath: "./docs",
  matchThreshold: 2,
  contextThreshold: 80,
  recursive: true,
};

export interface DocEntry {
  filePath: string;       // Absolute path (unchanged)
  fileName: string;       // Basename only: "guide.md" (unchanged semantics)
  relativePath: string;  // NEW: Path relative to docs root, e.g. "guides/setup.md"
  title: string;
  keywords: string[];
  content: string;
  injected: boolean;
}
```

### 1b. `config.ts` — Read `recursive` from config

```ts
recursive: parsed.recursive ?? DEFAULT_CONFIG.recursive,
```

### 1c. `registry.ts` — Recursive scanning with `withFileTypes`

**Key changes:**
- `recursive` is a class property, not a method param
- Use `readdirSync(dir, { recursive: true, withFileTypes: true })` for non-flat scan
- No `statSync` needed — `withFileTypes` gives `Dirent` objects with `.isFile()`
- `relativePath` is computed from the relative path within the docs folder
- `fileName` stays as basename for backward compat

```ts
import { Dirent, readdirSync, readFileSync } from "node:fs";
import { basename, join, resolve, relative } from "node:path";

export class DocRegistry {
  private entries: DocEntry[] = [];
  private docsPath: string;
  private recursive: boolean;

  private constructor(docsPath: string, recursive: boolean = true) {
    this.docsPath = docsPath;
    this.recursive = recursive;
  }

  static async create(docsPath: string, recursive: boolean = true): Promise<DocRegistry> {
    const registry = new DocRegistry(docsPath, recursive);
    await registry.rebuild();
    return registry;
  }

  async rebuild(): Promise<void> {
    const resolved = resolve(this.docsPath);
    const preserved = new Map<string, boolean>();
    for (const e of this.entries) {
      preserved.set(e.filePath, e.injected);
    }

    try {
      const entries = this.recursive
        ? this.scanRecursive(resolved)
        : this.scanFlat(resolved);

      const newEntries: DocEntry[] = [];
      for (const { filePath, relativePath, fileName } of entries) {
        try {
          const raw = readFileSync(filePath, "utf-8");
          const parsed = parseFrontmatter(raw);
          if (!parsed) {
            console.warn(`[doc-injector] Skipping ${relativePath}: no valid frontmatter with keywords`);
            continue;
          }
          newEntries.push({
            filePath,
            fileName,
            relativePath,
            title: parsed.title,
            keywords: parsed.keywords,
            content: raw,
            injected: preserved.get(filePath) ?? false,
          });
        } catch (err) {
          console.warn(`[doc-injector] Error reading ${relativePath}:`, err);
        }
      }

      this.entries = newEntries;
    } catch {
      console.warn(`[doc-injector] Docs folder not found: ${resolved}`);
      this.entries = [];
    }
  }

  private scanFlat(dir: string): Array<{ filePath: string; relativePath: string; fileName: string }> {
    return readdirSync(dir)
      .filter((f) => f.endsWith(".md"))
      .map((f) => ({
        filePath: join(dir, f),
        relativePath: f,
        fileName: f,
      }));
  }

  private scanRecursive(dir: string): Array<{ filePath: string; relativePath: string; fileName: string }> {
    const results: Array<{ filePath: string; relativePath: string; fileName: string }> = [];
    const dirents = readdirSync(dir, { recursive: true, withFileTypes: true }) as Dirent[];

    for (const dirent of dirents) {
      if (!dirent.isFile() || !dirent.name.endsWith(".md")) continue;

      // Build the relative path from the directory structure
      // Dirent.path gives the parent directory path in Node 20+
      // For older Node/Bun, we reconstruct from parent
      const parentPath = (dirent as Dirent & { path?: string }).path ?? "";
      const relativePath = parentPath
        ? relative(dir, join(parentPath, dirent.name))
        : dirent.name;
      const filePath = join(dir, relativePath);

      results.push({
        filePath,
        relativePath,
        fileName: dirent.name,
      });
    }

    return results;
  }

  // ... rest unchanged ...
}
```

### 1d. `index.ts` — Pass `recursive` config to DocRegistry

```ts
const initRegistry = async (cwd: string) => {
  config = loadConfig(cwd);
  const docsPath = resolve(cwd, config.docsPath);
  registry = await DocRegistry.create(docsPath, config.recursive);
  // ...
};
```

### 1e. `injector.ts` — Use `relativePath` in system prompt for clarity

```ts
// In buildSystemPromptAppend:
for (const entry of entries) {
  const keywords = matchedKeywords.get(entry.filePath) ?? [];
  sections.push(`### ${entry.title}`);
  sections.push(`Source: \`${entry.relativePath}\``);  // Changed from fileName to relativePath
  if (keywords.length > 0) {
    sections.push(`Matched keywords: ${keywords.join(", ")}`);
  }
  // ...
}
```

### Tests (Step 1):

```ts
// test/registry.test.ts — Add new describe block
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

describe("DocRegistry recursive scanning", () => {
  const tmpDir = join(process.cwd(), ".test-docs-recursive");

  beforeEach(() => {
    mkdirSync(join(tmpDir, "sub"), { recursive: true });
    writeFileSync(join(tmpDir, "root.md"), "---\ntitle: Root\nkeywords: [root]\n---\nRoot doc.\n");
    writeFileSync(join(tmpDir, "sub", "nested.md"), "---\ntitle: Nested\nkeywords: [nested]\n---\nNested doc.\n");
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("recursive=true finds nested .md files", async () => {
    const reg = await DocRegistry.create(tmpDir, true);
    const entries = reg.getEntries();
    expect(entries.length).toBe(2);
    const relPaths = entries.map((e) => e.relativePath);
    expect(relPaths.some((p) => p.includes("nested") || p.includes("sub"))).toBe(true);
    expect(entries.every((e) => e.fileName === basename(e.relativePath) || e.fileName === e.relativePath.split("/").pop())).toBe(true);
  });

  test("recursive=false only finds top-level .md files", async () => {
    const reg = await DocRegistry.create(tmpDir, false);
    const entries = reg.getEntries();
    expect(entries.length).toBe(1);
    expect(entries[0].fileName).toBe("root.md");
  });

  test("entries have correct relativePath", async () => {
    const reg = await DocRegistry.create(tmpDir, true);
    const nested = reg.getEntries().find((e) => e.title === "Nested");
    expect(nested).toBeDefined();
    expect(nested!.relativePath).toContain("nested.md");
    expect(nested!.fileName).toBe("nested.md");
  });
});
```

---

## Step 2: Encapsulate Injected Flag Mutation (REFACTOR-5, was BUG-5)

**Files:** `registry.ts`, `index.ts`  
**Priority:** Medium — not a bug, but improves encapsulation  
**Risk:** Low — additive change

> **Note:** The original claim that "the injected flag system is broken" is **incorrect**.  
> `getEntries()` returns shared object references, so `entry.injected = true` does propagate to `this.entries`.  
> This is a refactoring to make the design explicit and future-proof.

### 2a. `registry.ts` — Add `markInjected()` and `markAllNotInjected()`

```ts
/** Mark entries matching the given file paths as injected. */
markInjected(filePaths: string[]): void {
  const pathSet = new Set(filePaths);
  for (const e of this.entries) {
    if (pathSet.has(e.filePath)) {
      e.injected = true;
    }
  }
}

/** Reset all entries to not-injected state. */
markAllNotInjected(): void {
  for (const e of this.entries) {
    e.injected = false;
  }
}

/** @deprecated Use markAllNotInjected() for clarity. */
reset(): void {
  this.markAllNotInjected();
}
```

Add JSDoc to `getEntries()`:

```ts
/**
 * Get all registered entries.
 *
 * NOTE: Returned DocEntry objects share references with the internal registry.
 * Mutating `injected` on returned objects will affect the registry's internal state.
 * Prefer using markInjected() / markAllNotInjected() for explicit state changes.
 */
getEntries(): DocEntry[] {
  return [...this.entries];
}
```

### 2b. `index.ts` — Replace direct mutation with `markInjected()`

```ts
// BEFORE:
for (const entry of matchedEntries) {
  entry.injected = true;
}

// AFTER:
registry.markInjected(matchedEntries.map((e) => e.filePath));
```

Also update `/doc-inject reset` command in `commands.ts` to recommend `markAllNotInjected()` but keep `reset()` working:

```ts
// No change needed — reset() is still available as deprecated alias
```

### Tests (Step 2):

```ts
// test/registry.test.ts — Add to existing file

describe("DocRegistry mutation methods", () => {
  // Use the real docs directory or create a temp one
  test("markInjected marks only specified entries", async () => {
    const reg = await DocRegistry.create(resolve(__dirname, "../docs"));
    const entries = reg.getEntries();
    if (entries.length < 2) return;
    const targetPath = entries[0].filePath;
    reg.markInjected([targetPath]);
    expect(reg.getEntries().find((e) => e.filePath === targetPath)?.injected).toBe(true);
    expect(reg.getEntries().filter((e) => e.injected).length).toBe(1);
  });

  test("markAllNotInjected resets all entries", async () => {
    const reg = await DocRegistry.create(resolve(__dirname, "../docs"));
    const entries = reg.getEntries();
    reg.markAllNotInjected();
    expect(reg.getNonInjectedEntries().length).toBe(entries.length);
    expect(reg.getEntries().every((e) => !e.injected)).toBe(true);
  });

  test("reset is alias for markAllNotInjected", async () => {
    const reg = await DocRegistry.create(resolve(__dirname, "../docs"));
    reg.markInjected(reg.getEntries().map((e) => e.filePath));
    reg.reset();
    expect(reg.getEntries().every((e) => !e.injected)).toBe(true);
  });
});
```

---

## Step 3: ContextThreshold Config (ENH-2)

**Files:** `types.ts`, `config.ts`, `index.ts`  
**Priority:** Low — quality-of-life config improvement  
**Risk:** Low — backward-compatible default

### 3a. `types.ts` — Add `contextThreshold`

Already added in Step 1. Verify it's in `DocInjectorConfig` and `DEFAULT_CONFIG`.

### 3b. `config.ts` — Read `contextThreshold` with validation

```ts
contextThreshold: (() => {
  const val = parsed.contextThreshold ?? DEFAULT_CONFIG.contextThreshold;
  if (typeof val === "number" && (val < 0 || val > 100)) {
    console.warn(`[doc-injector] contextThreshold must be 0-100, got ${val}. Clamping.`);
    return Math.max(0, Math.min(100, val));
  }
  return val;
})(),
```

### 3c. `index.ts` — Use `config.contextThreshold` instead of hardcoded 80

```ts
// BEFORE:
if (usage && usage.tokens > 0 && usage.percentage && usage.percentage > 80) {

// AFTER:
if (usage && usage.tokens > 0 && usage.percentage && usage.percentage > config.contextThreshold) {
```

### Tests (Step 3):

```ts
// test/config.test.ts — New file
import { loadConfig } from "../config";
import { DEFAULT_CONFIG } from "../types";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

describe("loadConfig", () => {
  test("returns defaults when no config file exists", () => {
    const config = loadConfig("/nonexistent/path");
    expect(config).toEqual(DEFAULT_CONFIG);
  });

  test("clamps out-of-range contextThreshold", () => {
    const tmpDir = join(process.cwd(), ".test-config-clamp");
    const configDir = join(tmpDir, ".pi");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "doc-injector.json"), JSON.stringify({ contextThreshold: 150 }));
    const config = loadConfig(tmpDir);
    expect(config.contextThreshold).toBe(100);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("preserves valid contextThreshold", () => {
    const tmpDir = join(process.cwd(), ".test-config-valid");
    const configDir = join(tmpDir, ".pi");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, "doc-injector.json"), JSON.stringify({ contextThreshold: 70 }));
    const config = loadConfig(tmpDir);
    expect(config.contextThreshold).toBe(70);
    rmSync(tmpDir, { recursive: true, force: true });
  });
});
```

---

## Step 4: Shared reloadRegistry Helper (BUG-4)

**Files:** `index.ts`, `commands.ts`  
**Priority:** Low — maintainability improvement  
**Risk:** Low — refactoring only, no behavior change

### 4a. `index.ts` — Extract `reloadRegistry()`

```ts
const reloadRegistry = async (): Promise<number> => {
  if (!registry) throw new Error("No registry loaded");
  await registry.rebuild();
  const count = registry.getEntries().length;
  console.log(`[doc-injector] Reloaded: ${count} documents`);
  return count;
};
```

Update `resources_discover` handler:

```ts
pi.on("resources_discover", async (_event, _ctx) => {
  await reloadRegistry();
});
```

### 4b. `commands.ts` — Accept `reloadRegistry` callback via deps object

Define a `CommandDeps` interface instead of sprawling function params:

```ts
export interface CommandDeps {
  getRegistry: () => DocRegistry | null;
  getEnabled: () => boolean;
  setEnabled: (v: boolean) => void;
  reloadRegistry: () => Promise<number>;
}

export function registerCommands(pi: ExtensionAPI, deps: CommandDeps): void {
  // ... use deps.getRegistry(), deps.getEnabled(), deps.setEnabled(), deps.reloadRegistry()
```

Update `/doc-reload` handler:

```ts
cmd("doc-reload", "Re-scan docs folder and rebuild registry", async (_args, ctx) => {
  try {
    const count = await deps.reloadRegistry();
    ctx.ui.notify(`📄 Reloaded: ${count} documents found`, "success");
  } catch (err) {
    ctx.ui.notify(`📄 Reload failed: ${err instanceof Error ? err.message : String(err)}`, "error");
  }
});
```

Update call site in `index.ts`:

```ts
registerCommands(pi, {
  getRegistry,
  getEnabled,
  setEnabled,
  reloadRegistry,
});
```

### Tests (Step 4): Update existing injector test to use new deps interface (no new tests needed — refactoring only)

---

## Step 5: notifyInjection Type Cleanup (STYLE-1, was BUG-6)

**Files:** `injector.ts`  
**Priority:** Low — code style improvement  
**Risk:** None — type-only change, no runtime impact

### 5a. Define `NotifyCapability` interface

```ts
/**
 * Interface for the UI notification capability needed by the injector.
 * Structurally compatible with Pi's ExtensionContext['ui'] notify method.
 */
export interface NotifyCapability {
  notify: (msg: string, type?: "info" | "warning" | "error" | "success") => void;
}
```

### 5b. Use `NotifyCapability` in `notifyInjection`

```ts
export function notifyInjection(
  ui: NotifyCapability,
  entries: DocEntry[],
  matchedKeywords: Map<string, string[]>,
): void {
```

### Tests (Step 5): Existing `notifyInjection` tests pass — structural typing is compatible.

---

## Step 6: Documentation (BUG-1, BUG-2, ENH-3)

**Files:** `index.ts`, `README.md`  
**Priority:** Low — documentation only  
**Risk:** None

### 6a. Module-level doc block for `index.ts`

```ts
/**
 * Doc Injector Extension for Pi
 *
 * Automatically injects relevant project documentation into the LLM context
 * by monitoring streaming output for keyword matches.
 *
 * ## Streaming Model
 *
 * This extension relies on Pi's streaming event contract:
 * - `message_update`: Fires with the FULL accumulated assistant content on each
 *   streaming chunk. The extension replaces (not appends to) its text buffer
 *   on each update.
 * - `message_end`: Fires once when the assistant's response is complete.
 *   The extension finalizes matches and notifies the user.
 * - `before_agent_start`: Fires before the next agent turn. The extension
 *   injects matched docs into the system prompt, then marks them as injected.
 *
 * ## Injection Lifecycle
 *
 * The `injected` flag is per-session: when `session_start` fires, the registry
 * is recreated from scratch (via initRegistry), resetting all flags. Within a
 * session, once a doc is injected, it won't be re-injected unless the user
 * manually runs `/doc-inject reset`.
 *
 * ## Race Condition Note
 *
 * If `resources_discover` (rebuild) fires while `before_agent_start` is running,
 * `registry.entries` gets replaced. The `matchedEntries` array would hold stale
 * references. The current code is safe because `pendingMatches` (a Map by filePath)
 * is cleared after injection, and `markInjected()` operates on the registry's
 * current entries, not the stale array.
 */
```

### 6b. Contract comment on `message_update` handler

```ts
// NOTE: Pi's message_update event sends the full accumulated content of the
// assistant message on each update, not just the delta. We therefore REPLACE
// (not append to) the text buffer on each event, ensuring we always match
// against the complete message text.
pi.on("message_update", async (event, _ctx) => {
```

### 6c. Contract comment on `before_agent_start` context check

```ts
// Skip injection if context usage exceeds the configured threshold
// (default: 80%). This prevents doc injection from pushing the context
// past the model's limit.
if (usage && usage.tokens > 0 && usage.percentage && usage.percentage > config.contextThreshold) {
```

### 6d. README updates — add Config section

Add to README.md:

```md
## Configuration

Create `.pi/doc-injector.json` in your project root:

```json
{
  "docsPath": "./docs",
  "matchThreshold": 2,
  "contextThreshold": 80,
  "recursive": true
}
```

| Option | Default | Description |
|--------|---------|-------------|
| `docsPath` | `"./docs"` | Path to docs folder (relative to project root) |
| `matchThreshold` | `2` | Minimum keyword matches required to inject a doc |
| `contextThreshold` | `80` | Skip injection when context usage exceeds this % (0-100) |
| `recursive` | `true` | Scan docs subdirectories recursively |

> **Note:** The `injected` flag resets automatically at the start of each Pi session.
> Within a session, you can manually reset it with `/doc-inject reset`.

## Commands

| Command | Description |
|---------|-------------|
| `/doc-inject on` | Enable doc injection |
| `/doc-inject off` | Disable doc injection |
| `/doc-inject toggle` | Toggle doc injection |
| `/doc-inject list` | List all registered docs and their injection status |
| `/doc-inject reset` | Reset all injected flags (docs become re-injectable) |
| `/doc-inject status` | Show current status |
| `/doc-reload` | Re-scan docs folder and rebuild registry |
```

---

## Step 7: Add tsconfig.json with strict mode (ENH-1)

**Files:** `tsconfig.json` (new), fix any type errors in existing files  
**Priority:** Low — type safety best practice  
**Risk:** Medium — may surface latent type errors

### 7a. Create `tsconfig.json`

```json
{
  "compilerOptions": {
    "strict": true,
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "outDir": "dist",
    "rootDir": ".",
    "declaration": true,
    "sourceMap": true,
    "types": ["bun-types"]
  },
  "include": ["*.ts", "test/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

### 7b. Fix type errors surfaced by strict mode

Expected issues:
- `event.message` cast to `Record<string, unknown>` — add proper type narrowing
- `injector.ts` `NotifyCapability` — already fixed in Step 5
- `commands.ts` handler return types — ensure async handlers return `Promise<void>`
- Any `undefined` issues in `index.ts` with `_ctx`, `usage`, etc.

### 7c. Verify all tests pass

```bash
bun test
```

---

## Summary

| Step | ID | Priority | Files | Risk |
|------|----|----------|-------|------|
| 1 | BUG-3 | High | types.ts, config.ts, registry.ts, index.ts, injector.ts | 🟡 Medium |
| 2 | REFACTOR-5 | Medium | registry.ts, index.ts | 🟢 Low |
| 3 | ENH-2 | Low | types.ts, config.ts, index.ts | 🟢 Low |
| 4 | BUG-4 | Low | index.ts, commands.ts | 🟢 Low |
| 5 | STYLE-1 | Low | injector.ts | 🟢 None |
| 6 | BUG-1/2/ENH-3 | Low | index.ts, README.md | 🟢 None |
| 7 | ENH-1 | Low | tsconfig.json (new), existing fixes | 🟡 Medium |

## Architect Issues Resolved

| # | Issue | Resolution |
|---|-------|-----------|
| 1 | Strict mode must come last | ✅ Moved to Step 7 |
| 2 | `fileName` semantic change with recursive | ✅ Added `relativePath` field, `fileName` stays as basename |
| 3 | `statSync` not needed | ✅ Use `withFileTypes` + `isFile()` instead |
| 4 | "Bug" characterization wrong | ✅ Relabeled to REFACTOR-5 |
| 5 | O(n·m) `markInjected` | ✅ Uses Set for O(n) total |
| 6 | Weak encapsulation | ✅ JSDoc + explicit methods (`markInjected`, `markAllNotInjected`) |
| 7 | `registerCommands` signature | ✅ Refactored to `CommandDeps` interface |
| 8 | `recursive` as class property | ✅ Set via constructor, used as `this.recursive` |
| 9 | Missing test plan | ✅ Tests specified per step |
| 10 | Not a bug (BUG-6) | ✅ Relabeled to STYLE-1 |
| 11 | Vague documentation | ✅ Full content written out |
| 12 | `contextThreshold` bounds | ✅ 0-100 clamping with warning |
| 13 | Race condition note | ✅ Documented in module doc block |
| 14 | `reset()` deprecation | ✅ Kept as thin `@deprecated` wrapper |
| 15 | Divergent log messages | ✅ Unified via shared `reloadRegistry()` |