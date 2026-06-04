/**
 * Document Registry — scans a docs folder, parses frontmatter, maintains index.
 *
 * Processing pipeline:
 * 1. stat(filePath) → size check, mtime check, cache hit
 * 2. readFile(filePath) → parse frontmatter or generate keywords
 */
import type { Dirent } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { basename, extname, join, relative, resolve } from "node:path";
import { LLM_CACHE_SENTINEL, type CacheEntry, type DocEntry, type DocInjectorConfig, type KeywordCache } from "./types";
import type { Notifier } from "./notifier";
import { createGlobFilter } from "./globber";
import { generateKeywords } from "./keyword-gen";

/**
 * Shared parser for frontmatter block content (title + keywords).
 * Extracts title and keywords from YAML-like content between delimiters.
 */
function parseFrontmatterBlock(block: string): { title: string; keywords: string[] } | null {
  // Extract title
  const titleMatch = block.match(/^title:\s*["']?([^"'\n]+)["']?$/m);
  const title = titleMatch ? titleMatch[1].trim() : "";

  // Extract keywords — supports both flow array [a, b] and block array
  const keywords: string[] = [];

  // Try flow array: keywords: [a, b, c]
  const flowMatch = block.match(/keywords:\s*\[([^\]]*)\]/);
  if (flowMatch) {
    keywords.push(
      ...flowMatch[1]
        .split(",")
        .map((k) => k.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean),
    );
  } else {
    // Try block array: keywords:\n  - a\n  - b
    const blockMatches = block.matchAll(/keywords:\s*\n((?:\s*-\s*.+\n?)+)/g);
    for (const bm of blockMatches) {
      const items = bm[1].matchAll(/^\s*-\s*["']?([^"'\n]+)["']?$/gm);
      for (const im of items) {
        const k = im[1].trim();
        if (k) keywords.push(k);
      }
    }
  }

  if (keywords.length === 0) {
    return null;
  }

  return { title: title || "Untitled", keywords };
}

/**
 * Parse YAML-style frontmatter: `--- ... ---`
 */
function parseYamlFrontmatter(
  content: string,
): { title: string; keywords: string[]; body: string } | null {
  if (!content.startsWith("---")) return null;

  const secondDash = content.indexOf("---", 3);
  if (secondDash === -1) return null;

  const block = content.slice(3, secondDash).trim();
  const body = content.slice(secondDash + 3).trim();

  const parsed = parseFrontmatterBlock(block);
  if (!parsed) return null;

  return { ...parsed, body };
}

/**
 * Parse C-style block comment frontmatter: `/*--- ... ---*​/`
 */
function parseCStyleFrontmatter(
  content: string,
): { title: string; keywords: string[]; body: string } | null {
  if (!content.startsWith("/*---")) return null;

  const end = content.indexOf("---*/", 5);
  if (end === -1) return null;

  let block = content.slice(5, end).trim();
  const body = content.slice(end + 5).trim();

  // Strip optional "* " or " * " prefix from each line (common in block comments)
  block = block
    .split("\n")
    .map((line) => line.replace(/^\s*\*\s?/, ""))
    .join("\n");

  const parsed = parseFrontmatterBlock(block);
  if (!parsed) return null;

  return { ...parsed, body };
}

/**
 * Parse HTML comment frontmatter: `<!-- ... -->`
 */
function parseHTMLFrontmatter(
  content: string,
): { title: string; keywords: string[]; body: string } | null {
  if (!content.startsWith("<!--")) return null;

  const end = content.indexOf("-->", 4);
  if (end === -1) return null;

  const block = content.slice(4, end).trim();
  const body = content.slice(end + 3).trim();

  const parsed = parseFrontmatterBlock(block);
  if (!parsed) return null;

  return { ...parsed, body };
}

/**
 * Parse slash-slash comment frontmatter: `//--- ...` (blank line terminates).
 */
function parseSlashSlashFrontmatter(
  content: string,
): { title: string; keywords: string[]; body: string } | null {
  if (!content.startsWith("//---")) return null;

  // Ensure //--- is followed by a newline (its own line)
  const afterOpener = content.indexOf("\n", 5);
  if (afterOpener === -1) return null;

  const rest = content.slice(afterOpener + 1);

  // Find blank line terminator
  const blankLineIdx = rest.indexOf("\n\n");

  let block: string;
  let body: string;

  if (blankLineIdx === -1) {
    // No blank line — remaining content is frontmatter block, body is empty
    block = rest;
    body = "";
  } else {
    block = rest.slice(0, blankLineIdx);
    body = rest.slice(blankLineIdx + 2).trim();
  }

  // Strip optional "//" prefix from each line
  block = block
    .split("\n")
    .map((line) => line.replace(/^\/\/\s?/, ""))
    .join("\n")
    .trim();

  const parsed = parseFrontmatterBlock(block);
  if (!parsed) return null;

  return { ...parsed, body };
}

/**
 * Parse frontmatter from content, trying each supported style in order.
 * Returns { title, keywords, body } or null if no valid frontmatter found.
 *
 * Styles tried: YAML (---), C-style block (/*---), HTML comment (<!--),
 * slash-slash comment (//---, blank-line terminated).
 */
export function parseFrontmatter(
  content: string,
): { title: string; keywords: string[]; body: string } | null {
  return (
    parseYamlFrontmatter(content)
    ?? parseCStyleFrontmatter(content)
    ?? parseHTMLFrontmatter(content)
    ?? parseSlashSlashFrontmatter(content)
  );
}

interface ScanResult {
  filePath: string;
  relativePath: string;
  fileName: string;
}

// ─── PromisePool ───────────────────────────────────────────────────────

/**
 * Simple promise pool that runs async tasks with a concurrency limit.
 * Used for parallel file I/O during rebuild.
 */
class PromisePool {
  private running = 0;
  private waitResolve: (() => void) | null = null;

  constructor(private concurrency: number) {}

  /**
   * Run all tasks with at most `concurrency` in flight at once.
   * Returns results in the same order as the input tasks.
   */
  async all<T>(tasks: Array<() => Promise<T>>): Promise<T[]> {
    const results: T[] = new Array(tasks.length);
    let nextIndex = 0;

    const worker = async (): Promise<void> => {
      while (nextIndex < tasks.length) {
        const idx = nextIndex++;
        results[idx] = await tasks[idx]();
      }
    };

    const workerCount = Math.min(this.concurrency, tasks.length);
    const workers = Array.from({ length: workerCount }, () => worker());
    await Promise.all(workers);

    return results;
  }
}

// ─── DocRegistry ───────────────────────────────────────────────────────

/**
 * Document Registry class. Scans a docs folder and maintains an index of DocEntry.
 */
export class DocRegistry {
    private entries: DocEntry[] = [];
    private docsPath: string;
    private config: DocInjectorConfig;
    private cache: KeywordCache | null = null;
    private dirtyCache: KeywordCache = { version: 1, files: {} };
    private notifier: Notifier;
    // Per-registry flag: warn about a missing docs folder at most once.
    // rebuild() is called twice at startup (once from session_start, once
    // from resources_discover); without this flag the user sees the
    // same warning twice. Not reset across rebuilds — a missing folder
    // is a persistent condition, not a transient one.
    private warnedMissingDocs = false;

    private constructor(
        docsPath: string,
        config: DocInjectorConfig,
        cache: KeywordCache | undefined,
        notifier: Notifier,
    ) {
        this.docsPath = docsPath;
        this.config = config;
        this.cache = cache ?? null;
        this.notifier = notifier;
    }

    /** Create a registry by scanning the docs folder. */
    static async create(
        docsPath: string,
        config: DocInjectorConfig,
        cache: KeywordCache | undefined,
        notifier: Notifier,
    ): Promise<DocRegistry> {
        const registry = new DocRegistry(docsPath, config, cache, notifier);
        await registry.rebuild();
        return registry;
    }

  /** Re-scan the docs folder and rebuild the index. */
  async rebuild(): Promise<void> {
    const resolved = resolve(this.docsPath);
    const preserved = new Map<string, boolean>();
    for (const e of this.entries) {
      preserved.set(e.filePath, e.injected);
    }

    // Start with a fresh dirty cache — only files that changed get added
    this.dirtyCache = { version: 1, files: {} };

    // Pre-check folder existence. The previous catch-all "Docs folder not
    // found" warning was misleading (it also fired for scan errors) and was
    // emitted twice at startup (once from session_start, once from
    // resources_discover). The warnedMissingDocs flag deduplicates across
    // rebuilds for the lifetime of this registry.
    const folderStat = await stat(resolved).catch(() => null);
    if (!folderStat || !folderStat.isDirectory()) {
      if (!this.warnedMissingDocs) {
        this.notifier.warn(`[doc-injector] Docs folder not found: ${resolved}`);
        this.warnedMissingDocs = true;
      }
      this.entries = [];
      return;
    }

    try {
      const scanResults = this.config.recursive
        ? await this.scanRecursive(resolved)
        : await this.scanFlat(resolved);

      // Process files concurrently with PromisePool
      const pool = new PromisePool(this.config.maxConcurrent);

      const tasks = scanResults.map((sr) => async (): Promise<DocEntry | null> => {
        return this.processFile(sr, preserved);
      });

      const results = await pool.all(tasks);
      this.entries = results.filter((e): e is DocEntry => e !== null);
    } catch (err) {
      // This catch now only fires for actual scan errors (not folder-missing).
      this.notifier.warn(
        `[doc-injector] Error scanning docs folder ${resolved}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      this.entries = [];
    }
  }

  /**
   * Process a single file through the priority chain.
   * Returns a DocEntry or null if the file should be skipped.
   *
   * Priority (highest to lowest):
   *   1. Frontmatter (authoritative — explicitly written by the doc author)
   *   2. Cache (perf layer — mtime match means content hasn't changed)
   *   3. Heuristic (free, automatic, local — filename + headings + code symbols)
   *   4. Skip (no frontmatter, no cache, autoKeywords disabled)
   *
   * LLM-generated keywords populate the cache via the `_doc_injector_keywords`
   * tool, so they surface as `keywordSource: "cache"` on the next rebuild
   * (their `mtimeMs` is set to the file's current mtime when written).
   */
  private async processFile(
    { filePath, relativePath, fileName }: ScanResult,
    preserved: Map<string, boolean>,
  ): Promise<DocEntry | null> {
    try {
      // ─── METADATA ─────────────────────────────────────────────
      const fileStat = await stat(filePath);

      if (fileStat.size > this.config.maxFileSize) {
        this.notifier.warn(
          `[doc-injector] Skipping ${relativePath}: size ${fileStat.size} > max ${this.config.maxFileSize}`,
        );
        return null;
      }

      // Read once — needed for frontmatter parse, content, and title.
      const raw = await readFile(filePath, "utf-8");

      // ─── PRIORITY 1: Frontmatter (authoritative) ─────────────
      const parsed = parseFrontmatter(raw);
      if (parsed) {
        // Frontmatter is self-caching (lives in the file), no dirty mark needed.
        return {
          filePath,
          fileName,
          relativePath,
          title: parsed.title,
          keywords: parsed.keywords,
          content: raw,
          injected: preserved.get(filePath) ?? false,
          keywordSource: "frontmatter",
        };
      }

      // ─── PRIORITY 2: Cache (mtime match means content unchanged) ──
      const cachedEntry = this.cache?.files[relativePath];
      if (cachedEntry) {
        // LLM-generated: sentinel mtime never matches a real file
        if (cachedEntry.mtimeMs === LLM_CACHE_SENTINEL) {
          const title = extractTitle(raw, fileName);
          return {
            filePath,
            fileName,
            relativePath,
            title,
            keywords: cachedEntry.keywords,
            content: raw,
            injected: preserved.get(filePath) ?? false,
            keywordSource: "llm",
          };
        }
        // Real mtime match: heuristic or prior LLM-upgrade cache hit
        if (cachedEntry.mtimeMs === fileStat.mtimeMs) {
          const title = extractTitle(raw, fileName);
          return {
            filePath,
            fileName,
            relativePath,
            title,
            keywords: cachedEntry.keywords,
            content: raw,
            injected: preserved.get(filePath) ?? false,
            keywordSource: "cache",
          };
        }
      }

      // ─── PRIORITY 3: Heuristic (free, automatic fallback) ─────────
      if (this.config.autoKeywords) {
        const title = extractTitle(raw, fileName);
        const keywords = generateKeywords(fileName, raw);

        // Mark cache dirty (newly generated keywords must be persisted).
        this.dirtyCache.files[relativePath] = {
          mtimeMs: fileStat.mtimeMs,
          keywords,
        };

        return {
          filePath,
          fileName,
          relativePath,
          title,
          keywords,
          content: raw,
          injected: preserved.get(filePath) ?? false,
          keywordSource: "heuristic",
        };
      }

      // ─── PRIORITY 4: Skip ───────────────────────────────────────────
      this.notifier.warn(
        `[doc-injector] Skipping ${relativePath}: no valid frontmatter with keywords`,
      );
      return null;
    } catch (err) {
      // Only warn for unexpected errors, not ENOENT (file deleted/moved after scan)
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
        this.notifier.warn(`[doc-injector] Error reading ${relativePath}: ${err instanceof Error ? err.message : String(err)}`);
      }
      return null;
    }
  }

  /** Scan files (non-recursive) filtered by glob. */
  private async scanFlat(dir: string): Promise<ScanResult[]> {
    const filter = createGlobFilter(this.config.include, this.config.exclude);
    const entries = await readdir(dir);
    return entries
      .filter((f) => filter.match(f))
      .map((f) => ({
        filePath: join(dir, f),
        relativePath: f,
        fileName: f,
      }));
  }

  /** Scan files recursively filtered by glob. */
  private async scanRecursive(dir: string): Promise<ScanResult[]> {
    const filter = createGlobFilter(this.config.include, this.config.exclude);
    const results: ScanResult[] = [];
    const dirents = await readdir(dir, { recursive: true, withFileTypes: true }) as Dirent[];

    for (const dirent of dirents) {
      if (!dirent.isFile()) continue;

      const fileName = basename(dirent.name);

      // Resolve relative path cross-runtime
      let relPath: string;
      if (dirent.name === fileName) {
        const parentPath = (dirent as Dirent & { parentPath?: string; path?: string }).parentPath
          ?? (dirent as Dirent & { path?: string }).path
          ?? "";
        relPath = parentPath
          ? relative(dir, join(parentPath, dirent.name))
          : dirent.name;
      } else {
        relPath = dirent.name;
      }

      // Apply glob filter
      if (!filter.match(relPath)) continue;

      results.push({
        filePath: join(dir, relPath),
        relativePath: relPath,
        fileName,
      });
    }

    return results;
  }

  /**
   * Return cache entries that were dirtied (created or updated) during the
   * most recent rebuild. These need to be persisted to disk.
   */
  getDirtyCache(): Record<string, CacheEntry> {
    return { ...this.dirtyCache.files };
  }

  /**
   * Update the cache reference without rebuilding.
   * Used when reloading from disk (e.g. resources_discover) to pick up
   * LLM-written entries before the next rebuild.
   */
  updateCache(cache: KeywordCache): void {
    this.cache = cache;
  }


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

  /** Get entries that haven't been injected yet. */
  getNonInjectedEntries(): DocEntry[] {
    return this.entries.filter((e) => !e.injected);
  }

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
}

// ─── Helpers ────────────────────────────────────────────────────────────

/**
 * Extract a title from file content.
 * Uses the first markdown heading if present, otherwise falls back to filename.
 */
function extractTitle(content: string, fileName: string): string {
  const match = content.match(/^#\s+(.+)$/m);
  if (match) return match[1].trim();

  // Fall back to filename without extension
  return fileName.replace(/\.[^.]+$/, "");
}
