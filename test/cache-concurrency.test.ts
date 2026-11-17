import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { mergeAndSaveCache } from "../cache";
import { silentNotifier } from "./_helpers/silentNotifier";
import { LLM_CACHE_SENTINEL } from "../types";
import type { CacheEntry } from "../types";
import type * as FsPromises from "node:fs/promises";

const fsMockState = vi.hoisted(() => ({
  cachePath: "",
  cacheReadCount: 0,
  beforeNextCacheMkdir: null as (() => Promise<void>) | null,
  failNextCacheWrite: null as Error | null,
  writeTail: Promise.resolve(),
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof FsPromises>();

  return {
    ...actual,
    readFile: (...args: Parameters<typeof actual.readFile>) => {
      if (String(args[0]) === fsMockState.cachePath) {
        fsMockState.cacheReadCount++;
        // Take the real on-disk snapshot at read invocation, not when the
        // returned promise is later consumed.
        return Promise.resolve(readFileSync(fsMockState.cachePath, "utf-8"));
      }
      return actual.readFile(...args);
    },
    mkdir: async (...args: Parameters<typeof actual.mkdir>) => {
      if (String(args[0]) === dirname(fsMockState.cachePath)) {
        const beforeMkdir = fsMockState.beforeNextCacheMkdir;
        if (beforeMkdir) {
          fsMockState.beforeNextCacheMkdir = null;
          await beforeMkdir();
        }
      }
      return actual.mkdir(...args);
    },
    writeFile: (...args: Parameters<typeof actual.writeFile>) => {
      if (String(args[0]) !== fsMockState.cachePath)
        return actual.writeFile(...args);

      // Keep real target-file writes ordered so this test isolates stale
      // read/merge snapshots rather than filesystem truncation interleavings.
      const write = fsMockState.writeTail.then(async () => {
        const failure = fsMockState.failNextCacheWrite;
        if (failure) {
          fsMockState.failNextCacheWrite = null;
          throw failure;
        }
        await actual.writeFile(...args);
      });
      fsMockState.writeTail = write.catch(() => {});
      return write;
    },
  };
});

const heuristicEntry: CacheEntry = {
  mtimeMs: 1720000000000,
  keywords: ["heuristic keyword"],
};

let testCwd = "";

function writeInitialCache(files: Record<string, CacheEntry>) {
  const cachePath = join(testCwd, ".pi", "doc-injector-cache.json");
  writeFileSync(cachePath, JSON.stringify({ version: 1, files }));
  fsMockState.cachePath = cachePath;
}

beforeEach(() => {
  testCwd = mkdtempSync(join(tmpdir(), "doc-injector-cache-concurrency-"));
  mkdirSync(join(testCwd, ".pi"), { recursive: true });
  fsMockState.cachePath = "";
  fsMockState.cacheReadCount = 0;
  fsMockState.beforeNextCacheMkdir = null;
  fsMockState.failNextCacheWrite = null;
  fsMockState.writeTail = Promise.resolve();
});

afterEach(() => {
  fsMockState.cachePath = "";
  fsMockState.beforeNextCacheMkdir = null;
  fsMockState.failNextCacheWrite = null;
  rmSync(testCwd, { recursive: true, force: true });
  testCwd = "";
});

describe("mergeAndSaveCache concurrency", () => {
  test("preserves a newer LLM entry over a stale scan result", async () => {
    const llmEntry: CacheEntry = {
      mtimeMs: LLM_CACHE_SENTINEL,
      keywords: ["new-llm-keyword"],
    };
    writeInitialCache({ "guide.md": llmEntry });

    await mergeAndSaveCache(
      testCwd,
      { "guide.md": heuristicEntry },
      silentNotifier,
    );

    const cache = JSON.parse(readFileSync(fsMockState.cachePath, "utf-8"));
    expect(cache.files["guide.md"]).toEqual(llmEntry);
  });

  test("merges overlapping updates from fresh disk state without losing heuristic entries", async () => {
    writeInitialCache({ "heuristic.md": heuristicEntry });
    const { promise: mkdirEntered, resolve: signalMkdirEntered } =
      Promise.withResolvers<void>();
    const { promise: releaseFirstSave, resolve: resumeFirstSave } =
      Promise.withResolvers<void>();
    fsMockState.beforeNextCacheMkdir = async () => {
      signalMkdirEntered();
      await releaseFirstSave;
    };

    const firstUpdate = mergeAndSaveCache(
      testCwd,
      { "first.md": { mtimeMs: LLM_CACHE_SENTINEL, keywords: ["first"] } },
      silentNotifier,
    );
    await mkdirEntered;
    const readsAfterFirstSnapshot = fsMockState.cacheReadCount;

    const secondUpdate = mergeAndSaveCache(
      testCwd,
      { "second.md": { mtimeMs: LLM_CACHE_SENTINEL, keywords: ["second"] } },
      silentNotifier,
    );
    const readsWhileFirstSaveIsBlocked = fsMockState.cacheReadCount;

    resumeFirstSave();
    await Promise.all([firstUpdate, secondUpdate]);

    expect(readsAfterFirstSnapshot).toBe(1);
    expect(readsWhileFirstSaveIsBlocked).toBe(1);

    const cache = JSON.parse(readFileSync(fsMockState.cachePath, "utf-8"));
    expect(cache.version).toBe(1);
    expect(cache.files["heuristic.md"]).toEqual(heuristicEntry);
    expect(cache.files["first.md"]).toEqual({
      mtimeMs: LLM_CACHE_SENTINEL,
      keywords: ["first"],
    });
    expect(cache.files["second.md"]).toEqual({
      mtimeMs: LLM_CACHE_SENTINEL,
      keywords: ["second"],
    });
  });

  test("releases the queue after a failed write so a later update can persist", async () => {
    const existingEntry: CacheEntry = {
      mtimeMs: 1720000000001,
      keywords: ["kept"],
    };
    writeInitialCache({ "existing.md": existingEntry });
    const writeFailure = new Error("controlled cache write failure");
    fsMockState.failNextCacheWrite = writeFailure;

    await expect(
      mergeAndSaveCache(
        testCwd,
        {
          "failed.md": {
            mtimeMs: LLM_CACHE_SENTINEL,
            keywords: ["not-written"],
          },
        },
        silentNotifier,
      ),
    ).rejects.toBe(writeFailure);

    await mergeAndSaveCache(
      testCwd,
      {
        "recovered.md": {
          mtimeMs: LLM_CACHE_SENTINEL,
          keywords: ["recovered"],
        },
      },
      silentNotifier,
    );

    const cache = JSON.parse(readFileSync(fsMockState.cachePath, "utf-8"));
    expect(cache.files["existing.md"]).toEqual(existingEntry);
    expect(cache.files["failed.md"]).toBeUndefined();
    expect(cache.files["recovered.md"]).toEqual({
      mtimeMs: LLM_CACHE_SENTINEL,
      keywords: ["recovered"],
    });
  });
});
