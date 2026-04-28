import { parseFrontmatter, DocRegistry } from "../registry";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import { describe, expect, test, beforeEach, afterEach } from "bun:test";

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
    expect(entries[0].relativePath).toBe("root.md");
  });

  test("entries have correct relativePath", async () => {
    const reg = await DocRegistry.create(tmpDir, true);
    const nested = reg.getEntries().find((e) => e.title === "Nested");
    expect(nested).toBeDefined();
    expect(nested!.relativePath).toContain("nested.md");
    expect(nested!.fileName).toBe("nested.md");
  });
});

describe("DocRegistry mutation methods", () => {
  const tmpDir = join(process.cwd(), ".test-docs-mutation");

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
    const reg = await DocRegistry.create(tmpDir, false);
    const entries = reg.getEntries();
    expect(entries.length).toBe(2);

    const targetPath = entries[0].filePath;
    reg.markInjected([targetPath]);

    const after = reg.getEntries();
    expect(after.find((e) => e.filePath === targetPath)?.injected).toBe(true);
    expect(after.filter((e) => e.injected).length).toBe(1);
  });

  test("markAllNotInjected resets all entries", async () => {
    const reg = await DocRegistry.create(tmpDir, false);
    const entries = reg.getEntries();
    reg.markInjected(entries.map((e) => e.filePath));
    expect(reg.getEntries().every((e) => e.injected)).toBe(true);

    reg.markAllNotInjected();
    expect(reg.getEntries().every((e) => !e.injected)).toBe(true);
    expect(reg.getNonInjectedEntries().length).toBe(entries.length);
  });

  test("reset is alias for markAllNotInjected", async () => {
    const reg = await DocRegistry.create(tmpDir, false);
    reg.markInjected(reg.getEntries().map((e) => e.filePath));
    expect(reg.getEntries().every((e) => e.injected)).toBe(true);

    reg.reset();
    expect(reg.getEntries().every((e) => !e.injected)).toBe(true);
  });

  test("markInjected with empty array does nothing", async () => {
    const reg = await DocRegistry.create(tmpDir, false);
    reg.markInjected([]);
    expect(reg.getEntries().every((e) => !e.injected)).toBe(true);
  });

  test("markInjected with nonexistent path does nothing", async () => {
    const reg = await DocRegistry.create(tmpDir, false);
    reg.markInjected(["/nonexistent/path.md"]);
    expect(reg.getEntries().every((e) => !e.injected)).toBe(true);
  });

  test("getNonInjectedEntries respects markInjected", async () => {
    const reg = await DocRegistry.create(tmpDir, false);
    const entries = reg.getEntries();
    reg.markInjected([entries[0].filePath]);

    const nonInjected = reg.getNonInjectedEntries();
    expect(nonInjected.length).toBe(1);
    expect(nonInjected[0].filePath).toBe(entries[1].filePath);
  });
});