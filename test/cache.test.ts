/**
 * Tests for cache persistence (cache.ts).
 *
 * Covers: load/save roundtrip, version validation, corrupted JSON reset.
 */
import { describe, test, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { loadCache, saveCache } from "../cache";
import { silentNotifier } from "./_helpers/silentNotifier";
import type { KeywordCache } from "../types";

const TEST_DIR = join(process.cwd(), ".test-cache");

beforeEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
  mkdirSync(join(TEST_DIR, ".pi"), { recursive: true });
});

afterEach(() => {
  rmSync(TEST_DIR, { recursive: true, force: true });
});

describe("loadCache", () => {
  test("returns empty cache when no file exists", async () => {
    const cache = await loadCache(TEST_DIR, silentNotifier);
    expect(cache.version).toBe(1);
    expect(cache.files).toEqual({});
  });

  test("returns empty cache for corrupted JSON", async () => {
    writeFileSync(join(TEST_DIR, ".pi", "doc-injector-cache.json"), "not json {{{");
    const cache = await loadCache(TEST_DIR, silentNotifier);
    expect(cache.version).toBe(1);
    expect(cache.files).toEqual({});
  });

  test("returns empty cache for wrong version", async () => {
    writeFileSync(
      join(TEST_DIR, ".pi", "doc-injector-cache.json"),
      JSON.stringify({ version: 2, files: {} }),
    );
    const cache = await loadCache(TEST_DIR, silentNotifier);
    expect(cache.version).toBe(1);
    expect(cache.files).toEqual({});
  });

  test("returns empty cache when version field is missing", async () => {
    writeFileSync(
      join(TEST_DIR, ".pi", "doc-injector-cache.json"),
      JSON.stringify({ files: { "test.md": { mtimeMs: 123, keywords: ["a"] } } }),
    );
    const cache = await loadCache(TEST_DIR, silentNotifier);
    expect(cache.version).toBe(1);
    expect(cache.files).toEqual({});
  });

  test("returns empty cache when files field is missing", async () => {
    writeFileSync(
      join(TEST_DIR, ".pi", "doc-injector-cache.json"),
      JSON.stringify({ version: 1 }),
    );
    const cache = await loadCache(TEST_DIR, silentNotifier);
    expect(cache.version).toBe(1);
    expect(cache.files).toEqual({});
  });
});

describe("saveCache + loadCache roundtrip", () => {
  test("saves and loads cache correctly", async () => {
    const cache: KeywordCache = {
      version: 1,
      files: {
        "docs/api.md": { mtimeMs: 1000, keywords: ["api", "rest"] },
        "docs/auth.md": { mtimeMs: 2000, keywords: ["auth", "login"] },
      },
    };

    await saveCache(TEST_DIR, cache);

    const loaded = await loadCache(TEST_DIR, silentNotifier);
    expect(loaded.version).toBe(1);
    expect(loaded.files).toEqual(cache.files);
  });

  test("saves empty cache", async () => {
    const cache: KeywordCache = { version: 1, files: {} };
    await saveCache(TEST_DIR, cache);

    const loaded = await loadCache(TEST_DIR, silentNotifier);
    expect(loaded.version).toBe(1);
    expect(loaded.files).toEqual({});
  });

  test("creates parent .pi directory if missing", async () => {
    rmSync(join(TEST_DIR, ".pi"), { recursive: true, force: true });

    const cache: KeywordCache = {
      version: 1,
      files: { "test.md": { mtimeMs: 500, keywords: ["test"] } },
    };

    await saveCache(TEST_DIR, cache);
    const loaded = await loadCache(TEST_DIR, silentNotifier);
    expect(loaded.files).toEqual(cache.files);
  });

  test("overwrites existing cache file", async () => {
    const first: KeywordCache = {
      version: 1,
      files: { "old.md": { mtimeMs: 1, keywords: ["old"] } },
    };
    await saveCache(TEST_DIR, first);

    const second: KeywordCache = {
      version: 1,
      files: { "new.md": { mtimeMs: 2, keywords: ["new"] } },
    };
    await saveCache(TEST_DIR, second);

    const loaded = await loadCache(TEST_DIR, silentNotifier);
    expect(loaded.files).toEqual(second.files);
  });
});
