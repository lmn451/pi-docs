import type { KeywordCache } from "./types";
/**
 * Load the keyword cache from disk.
 * Returns an empty cache (version 1, no files) if the file doesn't exist,
 * has wrong version, or is corrupted.
 */
export declare function loadCache(cwd: string): Promise<KeywordCache>;
/**
 * Save the keyword cache to disk.
 * Creates parent directories if needed.
 */
export declare function saveCache(cwd: string, cache: KeywordCache): Promise<void>;
