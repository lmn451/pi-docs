import { describe, test, expect } from "vitest";
import { createGlobFilter } from "../globber";

describe("createGlobFilter", () => {
  test("matches files with include pattern **/*.md", () => {
    const filter = createGlobFilter(["**/*.md"], []);
    expect(filter.match("api/auth.md")).toBe(true);
    expect(filter.match("readme.md")).toBe(true);
    expect(filter.match("guides/setup.md")).toBe(true);
    expect(filter.match("src/index.ts")).toBe(false);
    expect(filter.match("readme.txt")).toBe(false);
  });

  test("matches specific extension with *.ts", () => {
    const filter = createGlobFilter(["*.ts"], []);
    expect(filter.match("index.ts")).toBe(true);
    expect(filter.match("app.ts")).toBe(true);
    expect(filter.match("index.tsx")).toBe(false);
    expect(filter.match("src/index.ts")).toBe(false);
    expect(filter.match("readme.md")).toBe(false);
  });

  test("exclude overrides include", () => {
    const filter = createGlobFilter(["**/*.md"], ["node_modules/**"]);
    expect(filter.match("readme.md")).toBe(true);
    expect(filter.match("node_modules/pkg/readme.md")).toBe(false);
    expect(filter.match("node_modules/foo.md")).toBe(false);
  });

  test("supports brace expansion {a,b}.md", () => {
    const filter = createGlobFilter(["**/{alpha,beta}.md"], []);
    expect(filter.match("alpha.md")).toBe(true);
    expect(filter.match("beta.md")).toBe(true);
    expect(filter.match("gamma.md")).toBe(false);
    expect(filter.match("sub/alpha.md")).toBe(true);
  });

  test("supports character classes [abc]*", () => {
    const filter = createGlobFilter(["**/[abc]*.ts"], []);
    expect(filter.match("a.ts")).toBe(true);
    expect(filter.match("b.ts")).toBe(true);
    expect(filter.match("c.ts")).toBe(true);
    expect(filter.match("d.ts")).toBe(false);
    expect(filter.match("src/autils.ts")).toBe(true);
  });

  test("empty include matches everything (subject to exclude)", () => {
    const filter = createGlobFilter([], ["node_modules/**", ".git/**"]);
    expect(filter.match("readme.md")).toBe(true);
    expect(filter.match("src/index.ts")).toBe(true);
    expect(filter.match("node_modules/pkg/index.js")).toBe(false);
    expect(filter.match(".git/config")).toBe(false);
  });

  test("empty include and exclude matches everything", () => {
    const filter = createGlobFilter([], []);
    expect(filter.match("readme.md")).toBe(true);
    expect(filter.match("src/index.ts")).toBe(true);
    expect(filter.match(".hidden/file.txt")).toBe(true);
    expect(filter.match("node_modules/pkg/index.js")).toBe(true);
  });

  test("dot option matches hidden files", () => {
    const filter = createGlobFilter(["**/*.md"], []);
    expect(filter.match(".github/README.md")).toBe(true);
    expect(filter.match(".hidden/file.md")).toBe(true);
  });

  test("exclude dist and build directories", () => {
    const filter = createGlobFilter(["**/*.ts"], ["dist/**", "build/**"]);
    expect(filter.match("src/index.ts")).toBe(true);
    expect(filter.match("dist/index.ts")).toBe(false);
    expect(filter.match("build/app.ts")).toBe(false);
  });

  test("handles paths with multiple directory levels", () => {
    const filter = createGlobFilter(["**/*.json"], ["**/node_modules/**"]);
    expect(filter.match("package.json")).toBe(true);
    expect(filter.match("src/data/config.json")).toBe(true);
    expect(filter.match("a/b/c/d/file.json")).toBe(true);
    expect(filter.match("node_modules/pkg/package.json")).toBe(false);
  });

  test("globstar matches zero directories", () => {
    const filter = createGlobFilter(["**/*.md"], []);
    expect(filter.match("readme.md")).toBe(true);
  });

  test("globstar with specific subdir", () => {
    const filter = createGlobFilter(["docs/**/*.md"], []);
    expect(filter.match("docs/readme.md")).toBe(true);
    expect(filter.match("readme.md")).toBe(false);
    expect(filter.match("docs/guides/api.md")).toBe(true);
  });
});
