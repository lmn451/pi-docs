/**
 * Keyword cache persistence — load/save the `.pi/doc-injector-cache.json` file.
 *
 * Cache format:
 *   { version: 1, files: { [relativePath]: { mtimeMs: number, keywords: string[] } } }
 *
 * Invalid files (wrong version, bad JSON, ENOENT) result in an empty cache.
 */
import { withFileMutationQueue } from "@earendil-works/pi-coding-agent";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import {
  LLM_CACHE_SENTINEL,
  type CacheEntry,
  type KeywordCache,
} from "./types";
import type { Notifier } from "./notifier";

const CACHE_FILENAME = ".pi/doc-injector-cache.json";
const CACHE_VERSION = 1;

/**
 * Load the keyword cache from disk.
 * Returns an empty cache (version 1, no files) if the file doesn't exist,
 * has wrong version, or is corrupted.
 *
 * Recoverable issues (corrupt JSON, wrong version) emit a warning via the
 * `notifier`. ENOENT (no cache file yet) is silent.
 */
export async function loadCache(
  cwd: string,
  notifier: Notifier,
): Promise<KeywordCache> {
  const cachePath = join(cwd, CACHE_FILENAME);

  try {
    const raw = await readFile(cachePath, "utf-8");
    const parsed: unknown = JSON.parse(raw);

    if (!isValidCache(parsed)) {
      notifier.warn(
        `[doc-injector] Invalid cache format or version at ${cachePath}, resetting.`,
      );
      return emptyCache();
    }

    return parsed;
  } catch (err) {
    // ENOENT = no cache file yet, that's fine
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      const detail = err instanceof Error ? err.message : String(err);
      notifier.warn(
        `[doc-injector] Failed to read cache at ${cachePath}: ${detail}`,
      );
    }
    return emptyCache();
  }
}

/**
 * Save the keyword cache to disk.
 * Creates parent directories if needed.
 */
export async function saveCache(
  cwd: string,
  cache: KeywordCache,
): Promise<void> {
  const cachePath = join(cwd, CACHE_FILENAME);

  try {
    await mkdir(dirname(cachePath), { recursive: true });
  } catch {
    // Ignore — directory may already exist
  }

  await writeFile(cachePath, JSON.stringify(cache, null, 2), "utf-8");
}

/**
 * Merge dirty keyword entries into the latest on-disk cache and save it under
 * Pi's per-file mutation queue.
 */
export async function mergeAndSaveCache(
  cwd: string,
  dirtyEntries: Record<string, CacheEntry>,
  notifier: Notifier,
): Promise<void> {
  await withFileMutationQueue(resolve(cwd, CACHE_FILENAME), async () => {
    const cache = await loadCache(cwd, notifier);
    for (const [path, entry] of Object.entries(dirtyEntries)) {
      const current = cache.files[path];
      if (
        current?.mtimeMs === LLM_CACHE_SENTINEL &&
        entry.mtimeMs !== LLM_CACHE_SENTINEL
      ) {
        continue;
      }
      cache.files[path] = entry;
    }
    await saveCache(cwd, cache);
  });
}

/** Check that a parsed value matches the KeywordCache shape. */
function isValidCache(value: unknown): value is KeywordCache {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const c = value as Record<string, unknown>;
  if (c.version !== CACHE_VERSION) return false;
  if (!c.files || typeof c.files !== "object" || Array.isArray(c.files)) {
    return false;
  }
  return Object.values(c.files).every((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return false;
    }
    const record = entry as Record<string, unknown>;
    return (
      typeof record.mtimeMs === "number" &&
      Number.isFinite(record.mtimeMs) &&
      Array.isArray(record.keywords) &&
      record.keywords.every((keyword) => typeof keyword === "string")
    );
  });
}

/** Return a fresh empty cache. */
function emptyCache(): KeywordCache {
  return { version: CACHE_VERSION, files: {} };
}
