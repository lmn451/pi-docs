import type { CacheEntry, DocEntry, DocInjectorConfig, KeywordCache } from "./types";
/**
 * Parse frontmatter from content, trying each supported style in order.
 * Returns { title, keywords, body } or null if no valid frontmatter found.
 *
 * Styles tried: YAML (---), C-style block (/*---), HTML comment (<!--),
 * slash-slash comment (//---, blank-line terminated).
 */
export declare function parseFrontmatter(content: string): {
    title: string;
    keywords: string[];
    body: string;
} | null;
/**
 * Document Registry class. Scans a docs folder and maintains an index of DocEntry.
 */
export declare class DocRegistry {
    private entries;
    private docsPath;
    private config;
    private cache;
    private dirtyCache;
    private constructor();
    /** Create a registry by scanning the docs folder. */
    static create(docsPath: string, config: DocInjectorConfig, cache?: KeywordCache): Promise<DocRegistry>;
    /** Re-scan the docs folder and rebuild the index. */
    rebuild(): Promise<void>;
    /**
     * Process a single file through the full pipeline.
     * Returns a DocEntry or null if the file should be skipped.
     */
    private processFile;
    /** Scan files (non-recursive) filtered by glob. */
    private scanFlat;
    /** Scan files recursively filtered by glob. */
    private scanRecursive;
    /**
     * Return cache entries that were dirtied (created or updated) during the
     * most recent rebuild. These need to be persisted to disk.
     */
    getDirtyCache(): Record<string, CacheEntry>;
    /**
     * Update the cache reference without rebuilding.
     * Used when reloading from disk (e.g. resources_discover) to pick up
     * LLM-written entries before the next rebuild.
     */
    updateCache(cache: KeywordCache): void;
    /**
     * Get all registered entries.
     *
     * NOTE: Returned DocEntry objects share references with the internal registry.
     * Mutating `injected` on returned objects will affect the registry's internal state.
     * Prefer using markInjected() / markAllNotInjected() for explicit state changes.
     */
    getEntries(): DocEntry[];
    /** Get entries that haven't been injected yet. */
    getNonInjectedEntries(): DocEntry[];
    /** Mark entries matching the given file paths as injected. */
    markInjected(filePaths: string[]): void;
    /** Reset all entries to not-injected state. */
    markAllNotInjected(): void;
    /** @deprecated Use markAllNotInjected() for clarity. */
    reset(): void;
}
