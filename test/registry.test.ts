import { parseFrontmatter, DocRegistry } from "../registry";
import { silentNotifier } from "./_helpers/silentNotifier";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import { describe, expect, test, beforeEach, afterEach, vi } from "vitest";
import { DEFAULT_CONFIG, LLM_CACHE_SENTINEL, type DocInjectorConfig } from "../types";

/** Minimal config for registry tests — scans .md files only. */
const TEST_CONFIG: DocInjectorConfig = {
  ...DEFAULT_CONFIG,
  docsPath: "./.test-docs-recursive",
  include: ["**/*.md"],
  exclude: [],
};

describe("parseFrontmatter", () => {
  test("parses flow array keywords", () => {
    const content = `---
title: "Test Doc"
keywords: [test, testing, unit test]
---

# Body content here
Some text.
`;
    const result = parseFrontmatter(content);
    expect(result).not.toBeNull();
    expect(result!.title).toBe("Test Doc");
    expect(result!.keywords).toEqual(["test", "testing", "unit test"]);
    expect(result!.body).toContain("# Body content here");
  });

  test("parses block array keywords", () => {
    const content = `---
title: Block Array Doc
keywords:
  - test
  - testing
  - workflow
---

Body text.
`;
    const result = parseFrontmatter(content);
    expect(result).not.toBeNull();
    expect(result!.title).toBe("Block Array Doc");
    expect(result!.keywords).toEqual(["test", "testing", "workflow"]);
  });

  test("returns null for no frontmatter", () => {
    const content = `# Just a markdown doc
No frontmatter here.
`;
    expect(parseFrontmatter(content)).toBeNull();
  });

  test("returns null when no keywords", () => {
    const content = `---
title: No Keywords
---

Some content.
`;
    expect(parseFrontmatter(content)).toBeNull();
  });

  test("parses quoted keywords", () => {
    const content = `---
title: "Quoted Keywords"
keywords: ["test", "unit test", "integration"]
---

Body.
`;
    const result = parseFrontmatter(content);
    expect(result).not.toBeNull();
    expect(result!.keywords).toEqual(["test", "unit test", "integration"]);
  });

  test("parses quoted title", () => {
    const content = `---
title: 'Multi-word Title'
keywords: [test, workflow]
---

Content.
`;
    const result = parseFrontmatter(content);
    expect(result).not.toBeNull();
    expect(result!.title).toBe("Multi-word Title");
  });

  // --- Multi-style frontmatter (Phase 3) ---

  test("parses C-style block comment frontmatter", () => {
    const content = `/*---
title: CStyle Doc
keywords: [cstyle, block, comment]
---*/

Body content here.
`;
    const result = parseFrontmatter(content);
    expect(result).not.toBeNull();
    expect(result!.title).toBe("CStyle Doc");
    expect(result!.keywords).toEqual(["cstyle", "block", "comment"]);
    expect(result!.body).toContain("Body content here.");
  });

  test("parses HTML comment frontmatter", () => {
    const content = `<!--
title: HTML Doc
keywords: [html, comment, web]
-->

Body content here.
`;
    const result = parseFrontmatter(content);
    expect(result).not.toBeNull();
    expect(result!.title).toBe("HTML Doc");
    expect(result!.keywords).toEqual(["html", "comment", "web"]);
    expect(result!.body).toContain("Body content here.");
  });

  test("parses slash-slash comment frontmatter", () => {
    const content = `//---
title: SlashSlash Doc
keywords: [slash, comment]

Body content here.
`;
    const result = parseFrontmatter(content);
    expect(result).not.toBeNull();
    expect(result!.title).toBe("SlashSlash Doc");
    expect(result!.keywords).toEqual(["slash", "comment"]);
    expect(result!.body).toContain("Body content here.");
  });

  test("parses slash-slash frontmatter with // prefixes", () => {
    const content = `//---
// title: Prefixed Doc
// keywords: [prefixed, lines]
//

Body content here.
`;
    const result = parseFrontmatter(content);
    expect(result).not.toBeNull();
    expect(result!.title).toBe("Prefixed Doc");
    expect(result!.keywords).toEqual(["prefixed", "lines"]);
    expect(result!.body).toContain("Body content here.");
  });

  test("returns null for C-style with no keywords", () => {
    const content = `/*---
title: No Keywords
---*/

Body.
`;
    expect(parseFrontmatter(content)).toBeNull();
  });

  test("returns null for HTML with no keywords", () => {
    const content = `<!--
title: No Keywords
-->

Body.
`;
    expect(parseFrontmatter(content)).toBeNull();
  });

  test("returns null for slash-slash with no keywords", () => {
    const content = `//---
title: No Keywords

Body.
`;
    expect(parseFrontmatter(content)).toBeNull();
  });

  test("returns null for content without any frontmatter style", () => {
    const content = `# Just a markdown doc
No frontmatter here.
`;
    expect(parseFrontmatter(content)).toBeNull();
  });
});

describe("DocRegistry recursive scanning", () => {
  const tmpDir = join(process.cwd(), ".test-docs-recursive");

  beforeEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    mkdirSync(join(tmpDir, "sub"), { recursive: true });
    writeFileSync(
      join(tmpDir, "root.md"),
      "---\ntitle: Root\nkeywords: [root]\n---\nRoot doc.\n",
    );
    writeFileSync(
      join(tmpDir, "sub", "nested.md"),
      "---\ntitle: Nested\nkeywords: [nested]\n---\nNested doc.\n",
    );
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("recursive=true finds nested .md files", async () => {
    const reg = await DocRegistry.create(tmpDir, { ...DEFAULT_CONFIG, docsPath: tmpDir, include: ["**/*.md"], exclude: [], recursive: true }, undefined, silentNotifier);
    const entries = reg.getEntries();
    expect(entries.length).toBe(2);
    const relPaths = entries.map((e) => e.relativePath);
    expect(relPaths.some((p) => p.includes("nested") || p.includes("sub"))).toBe(true);
    expect(entries.every((e) => e.fileName === basename(e.relativePath) || e.fileName === e.relativePath.split("/").pop())).toBe(true);
  });

  test("recursive=false only finds top-level .md files", async () => {
    const reg = await DocRegistry.create(tmpDir, { ...DEFAULT_CONFIG, docsPath: tmpDir, include: ["**/*.md"], exclude: [], recursive: false }, undefined, silentNotifier);
    const entries = reg.getEntries();
    expect(entries.length).toBe(1);
    expect(entries[0].fileName).toBe("root.md");
    expect(entries[0].relativePath).toBe("root.md");
  });

  test("entries have correct relativePath", async () => {
    const reg = await DocRegistry.create(tmpDir, { ...DEFAULT_CONFIG, docsPath: tmpDir, include: ["**/*.md"], exclude: [], recursive: true }, undefined, silentNotifier);
    const nested = reg.getEntries().find((e) => e.title === "Nested");
    expect(nested).toBeDefined();
    expect(nested!.relativePath).toContain("nested.md");
    expect(nested!.fileName).toBe("nested.md");
  });
});

describe("DocRegistry mutation methods", () => {
  const tmpDir = join(process.cwd(), ".test-docs-mutation");
  const testConfig: DocInjectorConfig = { ...DEFAULT_CONFIG, docsPath: tmpDir, include: ["**/*.md"], exclude: [], recursive: false };

  beforeEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(
      join(tmpDir, "alpha.md"),
      "---\ntitle: Alpha\nkeywords: [alpha]\n---\nAlpha doc.\n",
    );
    writeFileSync(
      join(tmpDir, "beta.md"),
      "---\ntitle: Beta\nkeywords: [beta]\n---\nBeta doc.\n",
    );
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("markInjected marks only specified entries", async () => {
    const reg = await DocRegistry.create(tmpDir, testConfig, undefined, silentNotifier);
    const entries = reg.getEntries();
    expect(entries.length).toBe(2);

    const targetPath = entries[0].filePath;
    reg.markInjected([targetPath]);

    const after = reg.getEntries();
    expect(after.find((e) => e.filePath === targetPath)?.injected).toBe(true);
    expect(after.filter((e) => e.injected).length).toBe(1);
  });

  test("markAllNotInjected resets all entries", async () => {
    const reg = await DocRegistry.create(tmpDir, testConfig, undefined, silentNotifier);
    const entries = reg.getEntries();
    reg.markInjected(entries.map((e) => e.filePath));
    expect(reg.getEntries().every((e) => e.injected)).toBe(true);

    reg.markAllNotInjected();
    expect(reg.getEntries().every((e) => !e.injected)).toBe(true);
    expect(reg.getNonInjectedEntries().length).toBe(entries.length);
  });

  test("reset is alias for markAllNotInjected", async () => {
    const reg = await DocRegistry.create(tmpDir, testConfig, undefined, silentNotifier);
    reg.markInjected(reg.getEntries().map((e) => e.filePath));
    expect(reg.getEntries().every((e) => e.injected)).toBe(true);

    reg.reset();
    expect(reg.getEntries().every((e) => !e.injected)).toBe(true);
  });

  test("markInjected with empty array does nothing", async () => {
    const reg = await DocRegistry.create(tmpDir, testConfig, undefined, silentNotifier);
    reg.markInjected([]);
    expect(reg.getEntries().every((e) => !e.injected)).toBe(true);
  });

  test("markInjected with nonexistent path does nothing", async () => {
    const reg = await DocRegistry.create(tmpDir, testConfig, undefined, silentNotifier);
    reg.markInjected(["/nonexistent/path.md"]);
    expect(reg.getEntries().every((e) => !e.injected)).toBe(true);
  });

  test("getNonInjectedEntries respects markInjected", async () => {
    const reg = await DocRegistry.create(tmpDir, testConfig, undefined, silentNotifier);
    const entries = reg.getEntries();
    reg.markInjected([entries[0].filePath]);

    const nonInjected = reg.getNonInjectedEntries();
    expect(nonInjected.length).toBe(1);
    expect(nonInjected[0].filePath).toBe(entries[1].filePath);
  });
});

describe("DocRegistry keyword-source priority", () => {
  const tmpDir = join(process.cwd(), ".test-docs-priority");
  const testConfig: DocInjectorConfig = {
    ...DEFAULT_CONFIG,
    docsPath: tmpDir,
    include: ["**/*.md"],
    exclude: [],
    recursive: false,
  };

  beforeEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    mkdirSync(tmpDir, { recursive: true });
  });
  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  // Helper: read mtime of a file so the test cache entry matches it exactly.
  const mtimeOf = (relPath: string): number => {
    const { statSync } = require("node:fs");
    return statSync(join(tmpDir, relPath)).mtimeMs;
  };

  test("priority 1: frontmatter wins over a valid cache entry (mtime match)", async () => {
    // File has frontmatter keywords.
    writeFileSync(
      join(tmpDir, "with-fm.md"),
      "---\ntitle: FM Doc\nkeywords: [from-frontmatter]\n---\nBody.\n",
    );
    // Cache has the same mtime but DIFFERENT keywords (simulating stale cache).
    const cache = {
      version: 1 as const,
      files: {
        "with-fm.md": { mtimeMs: mtimeOf("with-fm.md"), keywords: ["from-cache"] },
      },
    };

    const reg = await DocRegistry.create(tmpDir, testConfig, cache, silentNotifier);
    const entry = reg.getEntries().find((e) => e.relativePath === "with-fm.md")!;
    expect(entry).toBeDefined();
    expect(entry.keywords).toEqual(["from-frontmatter"]);
    expect(entry.keywordSource).toBe("frontmatter");
  });

  test("priority 1: frontmatter wins on cache miss (no cache entry at all)", async () => {
    writeFileSync(
      join(tmpDir, "no-cache.md"),
      "---\ntitle: NoCache\nkeywords: [explicit]\n---\nBody.\n",
    );

    const reg = await DocRegistry.create(tmpDir, testConfig, undefined, silentNotifier);
    const entry = reg.getEntries().find((e) => e.relativePath === "no-cache.md")!;
    expect(entry.keywords).toEqual(["explicit"]);
    expect(entry.keywordSource).toBe("frontmatter");
  });

  test("priority 2: cache used when no frontmatter and mtime matches", async () => {
    // No frontmatter — just a body.
    writeFileSync(
      join(tmpDir, "no-fm.md"),
      "# No Frontmatter\n\nBody text with the word testing appearing twice testing.\n",
    );
    const cache = {
      version: 1 as const,
      files: {
        "no-fm.md": { mtimeMs: mtimeOf("no-fm.md"), keywords: ["cached", "keywords"] },
      },
    };

    const reg = await DocRegistry.create(tmpDir, testConfig, cache, silentNotifier);
    const entry = reg.getEntries().find((e) => e.relativePath === "no-fm.md")!;
    expect(entry.keywords).toEqual(["cached", "keywords"]);
    expect(entry.keywordSource).toBe("cache");
  });

  test("priority 3: heuristic runs when no frontmatter and no cache", async () => {
    writeFileSync(
      join(tmpDir, "fresh.md"),
      "# Test Heading\n\nbody testing content.\n",
    );

    const reg = await DocRegistry.create(tmpDir, testConfig, undefined, silentNotifier);
    const entry = reg.getEntries().find((e) => e.relativePath === "fresh.md")!;
    expect(entry.keywordSource).toBe("heuristic");
    // Heuristic should pick up the heading word "Test" and the body word "testing".
    expect(entry.keywords.length).toBeGreaterThan(0);
    // The dirty cache should now hold this entry for persistence.
    const dirty = reg.getDirtyCache();
    expect(dirty["fresh.md"]).toBeDefined();
    expect(dirty["fresh.md"].keywords).toEqual(entry.keywords);
  });

  test("priority 3: cache mtime mismatch falls through to heuristic (cache is stale)", async () => {
    writeFileSync(
      join(tmpDir, "stale.md"),
      "# Heading\n\nbody.\n",
    );
    // Cache has an OLD mtime — must not match.
    const cache = {
      version: 1 as const,
      files: {
        "stale.md": { mtimeMs: mtimeOf("stale.md") - 10_000, keywords: ["old-cached"] },
      },
    };

    const reg = await DocRegistry.create(tmpDir, testConfig, cache, silentNotifier);
    const entry = reg.getEntries().find((e) => e.relativePath === "stale.md")!;
    expect(entry.keywordSource).toBe("heuristic");
    // Stale cache keywords must NOT leak through.
    expect(entry.keywords).not.toContain("old-cached");
  });

  test("priority 4: skip when no frontmatter, no cache, autoKeywords=false", async () => {
    const noAutoConfig: DocInjectorConfig = { ...testConfig, autoKeywords: false };
    writeFileSync(join(tmpDir, "skip-me.md"), "# No FM\n\nbody.\n");

    const reg = await DocRegistry.create(tmpDir, noAutoConfig, undefined, silentNotifier);
    const entry = reg.getEntries().find((e) => e.relativePath === "skip-me.md");
    expect(entry).toBeUndefined();
  });

  test("priority order: frontmatter file never marks the cache dirty", async () => {
    writeFileSync(
      join(tmpDir, "fm.md"),
      "---\ntitle: FM\nkeywords: [k1, k2]\n---\nbody.\n",
    );

    const reg = await DocRegistry.create(tmpDir, testConfig, undefined, silentNotifier);
    expect(reg.getDirtyCache()).toEqual({});
  });

  test("priority 2 (LLM): sentinel mtime in cache surfaces keywordSource: \"llm\"", async () => {
    // File without frontmatter, but cache has a sentinel mtime (LLM-written).
    writeFileSync(
      join(tmpDir, "llm-cache.md"),
      "# No Frontmatter\n\nBody text.\n",
    );
    const cache = {
      version: 1 as const,
      files: {
        "llm-cache.md": {
          mtimeMs: LLM_CACHE_SENTINEL,
          keywords: ["llm-generated", "keyword"],
        },
      },
    };

    const reg = await DocRegistry.create(tmpDir, testConfig, cache, silentNotifier);
    const entry = reg.getEntries().find((e) => e.relativePath === "llm-cache.md")!;
    expect(entry).toBeDefined();
    expect(entry.keywordSource).toBe("llm");
    expect(entry.keywords).toEqual(["llm-generated", "keyword"]);
  });

  test("priority 1: frontmatter beats an LLM-sentinel cache entry", async () => {
    // File has frontmatter keywords; cache has DIFFERENT keywords with
    // sentinel mtime (as if the LLM previously generated them).
    // Frontmatter must still win.
    writeFileSync(
      join(tmpDir, "fm-beats-llm.md"),
      "---\ntitle: Fm\nkeywords: [from-frontmatter]\n---\nbody.\n",
    );
    const cache = {
      version: 1 as const,
      files: {
        "fm-beats-llm.md": {
          mtimeMs: LLM_CACHE_SENTINEL,
          keywords: ["from-llm-cache"],
        },
      },
    };

    const reg = await DocRegistry.create(tmpDir, testConfig, cache, silentNotifier);
    const entry = reg.getEntries().find((e) => e.relativePath === "fm-beats-llm.md")!;
    expect(entry).toBeDefined();
    expect(entry.keywordSource).toBe("frontmatter");
    expect(entry.keywords).toEqual(["from-frontmatter"]);
  });
});

describe("DocRegistry missing-folder behavior", () => {
  const missingDir = join(process.cwd(), ".test-docs-missing");
  const testConfig: DocInjectorConfig = {
    ...DEFAULT_CONFIG,
    docsPath: missingDir,
    include: ["**/*.md"],
    exclude: [],
    recursive: false,
  };

  beforeEach(() => {
    rmSync(missingDir, { recursive: true, force: true });
  });
  afterEach(() => {
    rmSync(missingDir, { recursive: true, force: true });
  });

  test("emits exactly one warning across multiple rebuilds when folder is missing", async () => {
    // Bug: rebuild() was called twice at startup (session_start + resources_discover),
    // causing the same "Docs folder not found" warning to fire twice. The
    // warnedMissingDocs flag now deduplicates within a registry's lifetime.
    const notifier = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), setContext: vi.fn() };

    const reg = await DocRegistry.create(missingDir, testConfig, undefined, notifier);
    expect(notifier.warn).toHaveBeenCalledTimes(1);
    expect(notifier.warn).toHaveBeenCalledWith(expect.stringContaining("Docs folder not found"));

    // A second rebuild (simulating resources_discover firing) must NOT re-warn.
    await reg.rebuild();
    expect(notifier.warn).toHaveBeenCalledTimes(1);

    // A third rebuild (e.g. /doc-reload) also must NOT re-warn.
    await reg.rebuild();
    expect(notifier.warn).toHaveBeenCalledTimes(1);
  });

  test("rebuild clears entries to empty when folder is missing", async () => {
    const notifier = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), setContext: vi.fn() };
    const reg = await DocRegistry.create(missingDir, testConfig, undefined, notifier);
    expect(reg.getEntries()).toEqual([]);
  });

  test("rebuild succeeds silently when folder exists (no warning)", async () => {
    mkdirSync(missingDir, { recursive: true });
    writeFileSync(
      join(missingDir, "a.md"),
      "---\ntitle: A\nkeywords: [a]\n---\nbody.\n",
    );

    const notifier = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), setContext: vi.fn() };
    const reg = await DocRegistry.create(missingDir, testConfig, undefined, notifier);
    expect(notifier.warn).not.toHaveBeenCalled();
    expect(reg.getEntries().length).toBe(1);
  });

  test("treats a file at docsPath as missing (not a directory)", async () => {
    // docsPath exists but is a regular file, not a directory.
    mkdirSync(missingDir, { recursive: true });
    const filePath = join(missingDir, "not-a-dir.md");
    writeFileSync(filePath, "# not a directory\n");

    const notifier = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), setContext: vi.fn() };
    // Point docsPath at the file (not the dir).
    const reg = await DocRegistry.create(filePath, testConfig, undefined, notifier);
    expect(notifier.warn).toHaveBeenCalledTimes(1);
    expect(notifier.warn).toHaveBeenCalledWith(expect.stringContaining("Docs folder not found"));
    expect(reg.getEntries()).toEqual([]);
  });
});


