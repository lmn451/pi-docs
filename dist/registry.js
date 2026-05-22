import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import { createGlobFilter } from "./globber";
import { generateKeywords } from "./keyword-gen";
/**
 * Shared parser for frontmatter block content (title + keywords).
 * Extracts title and keywords from YAML-like content between delimiters.
 */
function parseFrontmatterBlock(block) {
    // Extract title
    const titleMatch = block.match(/^title:\s*["']?([^"'\n]+)["']?$/m);
    const title = titleMatch ? titleMatch[1].trim() : "";
    // Extract keywords — supports both flow array [a, b] and block array
    const keywords = [];
    // Try flow array: keywords: [a, b, c]
    const flowMatch = block.match(/keywords:\s*\[([^\]]*)\]/);
    if (flowMatch) {
        keywords.push(...flowMatch[1]
            .split(",")
            .map((k) => k.trim().replace(/^["']|["']$/g, ""))
            .filter(Boolean));
    }
    else {
        // Try block array: keywords:\n  - a\n  - b
        const blockMatches = block.matchAll(/keywords:\s*\n((?:\s*-\s*.+\n?)+)/g);
        for (const bm of blockMatches) {
            const items = bm[1].matchAll(/^\s*-\s*["']?([^"'\n]+)["']?$/gm);
            for (const im of items) {
                const k = im[1].trim();
                if (k)
                    keywords.push(k);
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
function parseYamlFrontmatter(content) {
    if (!content.startsWith("---"))
        return null;
    const secondDash = content.indexOf("---", 3);
    if (secondDash === -1)
        return null;
    const block = content.slice(3, secondDash).trim();
    const body = content.slice(secondDash + 3).trim();
    const parsed = parseFrontmatterBlock(block);
    if (!parsed)
        return null;
    return { ...parsed, body };
}
/**
 * Parse C-style block comment frontmatter: `/*--- ... ---*​/`
 */
function parseCStyleFrontmatter(content) {
    if (!content.startsWith("/*---"))
        return null;
    const end = content.indexOf("---*/", 5);
    if (end === -1)
        return null;
    let block = content.slice(5, end).trim();
    const body = content.slice(end + 5).trim();
    // Strip optional "* " or " * " prefix from each line (common in block comments)
    block = block
        .split("\n")
        .map((line) => line.replace(/^\s*\*\s?/, ""))
        .join("\n");
    const parsed = parseFrontmatterBlock(block);
    if (!parsed)
        return null;
    return { ...parsed, body };
}
/**
 * Parse HTML comment frontmatter: `<!-- ... -->`
 */
function parseHTMLFrontmatter(content) {
    if (!content.startsWith("<!--"))
        return null;
    const end = content.indexOf("-->", 4);
    if (end === -1)
        return null;
    const block = content.slice(4, end).trim();
    const body = content.slice(end + 3).trim();
    const parsed = parseFrontmatterBlock(block);
    if (!parsed)
        return null;
    return { ...parsed, body };
}
/**
 * Parse slash-slash comment frontmatter: `//--- ...` (blank line terminates).
 */
function parseSlashSlashFrontmatter(content) {
    if (!content.startsWith("//---"))
        return null;
    // Ensure //--- is followed by a newline (its own line)
    const afterOpener = content.indexOf("\n", 5);
    if (afterOpener === -1)
        return null;
    const rest = content.slice(afterOpener + 1);
    // Find blank line terminator
    const blankLineIdx = rest.indexOf("\n\n");
    let block;
    let body;
    if (blankLineIdx === -1) {
        // No blank line — remaining content is frontmatter block, body is empty
        block = rest;
        body = "";
    }
    else {
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
    if (!parsed)
        return null;
    return { ...parsed, body };
}
/**
 * Parse frontmatter from content, trying each supported style in order.
 * Returns { title, keywords, body } or null if no valid frontmatter found.
 *
 * Styles tried: YAML (---), C-style block (/*---), HTML comment (<!--),
 * slash-slash comment (//---, blank-line terminated).
 */
export function parseFrontmatter(content) {
    return (parseYamlFrontmatter(content)
        ?? parseCStyleFrontmatter(content)
        ?? parseHTMLFrontmatter(content)
        ?? parseSlashSlashFrontmatter(content));
}
// ─── PromisePool ───────────────────────────────────────────────────────
/**
 * Simple promise pool that runs async tasks with a concurrency limit.
 * Used for parallel file I/O during rebuild.
 */
class PromisePool {
    concurrency;
    running = 0;
    waitResolve = null;
    constructor(concurrency) {
        this.concurrency = concurrency;
    }
    /**
     * Run all tasks with at most `concurrency` in flight at once.
     * Returns results in the same order as the input tasks.
     */
    async all(tasks) {
        const results = new Array(tasks.length);
        let nextIndex = 0;
        const worker = async () => {
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
    entries = [];
    docsPath;
    config;
    cache = null;
    dirtyCache = { version: 1, files: {} };
    constructor(docsPath, config, cache) {
        this.docsPath = docsPath;
        this.config = config;
        this.cache = cache ?? null;
    }
    /** Create a registry by scanning the docs folder. */
    static async create(docsPath, config, cache) {
        const registry = new DocRegistry(docsPath, config, cache);
        await registry.rebuild();
        return registry;
    }
    /** Re-scan the docs folder and rebuild the index. */
    async rebuild() {
        const resolved = resolve(this.docsPath);
        const preserved = new Map();
        for (const e of this.entries) {
            preserved.set(e.filePath, e.injected);
        }
        // Start with a fresh dirty cache — only files that changed get added
        this.dirtyCache = { version: 1, files: {} };
        try {
            const scanResults = this.config.recursive
                ? await this.scanRecursive(resolved)
                : await this.scanFlat(resolved);
            // Process files concurrently with PromisePool
            const pool = new PromisePool(this.config.maxConcurrent);
            const tasks = scanResults.map((sr) => async () => {
                return this.processFile(sr, preserved);
            });
            const results = await pool.all(tasks);
            this.entries = results.filter((e) => e !== null);
        }
        catch {
            console.warn(`[doc-injector] Docs folder not found: ${resolved}`);
            this.entries = [];
        }
    }
    /**
     * Process a single file through the full pipeline.
     * Returns a DocEntry or null if the file should be skipped.
     */
    async processFile({ filePath, relativePath, fileName }, preserved) {
        try {
            // ═══ METADATA + CACHE ═══
            // Step 1: Stat the file for size and mtime
            const fileStat = await stat(filePath);
            // Step 2: Skip files exceeding maxFileSize
            if (fileStat.size > this.config.maxFileSize) {
                console.warn(`[doc-injector] Skipping ${relativePath}: size ${fileStat.size} > max ${this.config.maxFileSize}`);
                return null;
            }
            const cachedEntry = this.cache?.files[relativePath];
            // Step 6: Cache hit — mtime matches, use cached keywords
            if (cachedEntry && cachedEntry.mtimeMs === fileStat.mtimeMs) {
                // Still read the file for content and title (needed for injection),
                // but skip keyword generation entirely
                const raw = await readFile(filePath, "utf-8");
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
            // ═══ FULL READ + PARSE (cache miss) ═══
            // Step 7: Read file content
            const raw = await readFile(filePath, "utf-8");
            // Step 8: Try frontmatter parsing
            const parsed = parseFrontmatter(raw);
            let title;
            let keywords;
            let keywordSource;
            if (parsed) {
                // Step 9: Frontmatter found — use its title and keywords
                title = parsed.title;
                keywords = parsed.keywords;
                keywordSource = "frontmatter";
            }
            else if (this.config.autoKeywords) {
                // Step 10: No frontmatter, generate keywords heuristically
                title = extractTitle(raw, fileName);
                keywords = generateKeywords(fileName, raw);
                keywordSource = "heuristic";
            }
            else {
                // Step 11: No frontmatter and autoKeywords disabled — skip
                console.warn(`[doc-injector] Skipping ${relativePath}: no valid frontmatter with keywords`);
                return null;
            }
            // ═══ CACHE UPDATE ═══
            // Step 12: Mark as dirty (mtime changed or keywords generated)
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
                keywordSource,
            };
        }
        catch (err) {
            // Only warn for unexpected errors, not ENOENT (file deleted/moved after scan)
            if (err.code !== "ENOENT") {
                console.warn(`[doc-injector] Error reading ${relativePath}:`, err);
            }
            return null;
        }
    }
    /** Scan files (non-recursive) filtered by glob. */
    async scanFlat(dir) {
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
    async scanRecursive(dir) {
        const filter = createGlobFilter(this.config.include, this.config.exclude);
        const results = [];
        const dirents = await readdir(dir, { recursive: true, withFileTypes: true });
        for (const dirent of dirents) {
            if (!dirent.isFile())
                continue;
            const fileName = basename(dirent.name);
            // Resolve relative path cross-runtime
            let relPath;
            if (dirent.name === fileName) {
                const parentPath = dirent.parentPath
                    ?? dirent.path
                    ?? "";
                relPath = parentPath
                    ? relative(dir, join(parentPath, dirent.name))
                    : dirent.name;
            }
            else {
                relPath = dirent.name;
            }
            // Apply glob filter
            if (!filter.match(relPath))
                continue;
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
    getDirtyCache() {
        return { ...this.dirtyCache.files };
    }
    /**
     * Update the cache reference without rebuilding.
     * Used when reloading from disk (e.g. resources_discover) to pick up
     * LLM-written entries before the next rebuild.
     */
    updateCache(cache) {
        this.cache = cache;
    }
    /**
     * Get all registered entries.
     *
     * NOTE: Returned DocEntry objects share references with the internal registry.
     * Mutating `injected` on returned objects will affect the registry's internal state.
     * Prefer using markInjected() / markAllNotInjected() for explicit state changes.
     */
    getEntries() {
        return [...this.entries];
    }
    /** Get entries that haven't been injected yet. */
    getNonInjectedEntries() {
        return this.entries.filter((e) => !e.injected);
    }
    /** Mark entries matching the given file paths as injected. */
    markInjected(filePaths) {
        const pathSet = new Set(filePaths);
        for (const e of this.entries) {
            if (pathSet.has(e.filePath)) {
                e.injected = true;
            }
        }
    }
    /** Reset all entries to not-injected state. */
    markAllNotInjected() {
        for (const e of this.entries) {
            e.injected = false;
        }
    }
    /** @deprecated Use markAllNotInjected() for clarity. */
    reset() {
        this.markAllNotInjected();
    }
}
// ─── Helpers ────────────────────────────────────────────────────────────
/**
 * Extract a title from file content.
 * Uses the first markdown heading if present, otherwise falls back to filename.
 */
function extractTitle(content, fileName) {
    const match = content.match(/^#\s+(.+)$/m);
    if (match)
        return match[1].trim();
    // Fall back to filename without extension
    return fileName.replace(/\.[^.]+$/, "");
}
//# sourceMappingURL=registry.js.map