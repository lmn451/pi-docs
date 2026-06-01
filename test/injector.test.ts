import { buildInjectionContent, notifyInjection } from "../injector";
import type { DocEntry } from "../types";
import { describe, expect, test } from "vitest";

const makeEntry = (name: string, keywords: string[], content: string): DocEntry => ({
  filePath: `/docs/${name}`,
  fileName: name,
  relativePath: name,
  title: name,
  keywords,
  content,
  injected: false,
  keywordSource: "frontmatter",
});

describe("buildInjectionContent", () => {
  test("formats a single doc", () => {
    const entry = makeEntry("test.md", ["test", "testing"], "# Test Guide\nContent here.");
    const map = new Map<string, string[]>();
    map.set(entry.filePath, ["test", "testing"]);

    const result = buildInjectionContent([entry], map);
    expect(result).toContain("## Relevant Context Documents");
    expect(result).toContain("### test.md");
    expect(result).toContain("Matched keywords: test, testing");
    expect(result).toContain("# Test Guide");
  });

  test("formats multiple docs", () => {
    const e1 = makeEntry("test.md", ["test"], "# Test");
    const e2 = makeEntry("workflow.md", ["workflow"], "# Workflow");
    const map = new Map<string, string[]>();
    map.set(e1.filePath, ["test"]);
    map.set(e2.filePath, ["workflow"]);

    const result = buildInjectionContent([e1, e2], map);
    expect(result).toContain("### test.md");
    expect(result).toContain("### workflow.md");
  });

  test("returns empty string for no entries", () => {
    expect(buildInjectionContent([], new Map())).toBe("");
  });

  test("uses relativePath in Source line", () => {
    const entry: DocEntry = {
      filePath: "/docs/guides/setup.md",
      fileName: "setup.md",
      relativePath: "guides/setup.md",
      title: "Setup Guide",
      keywords: ["setup"],
      content: "# Setup Guide",
      injected: false,
      keywordSource: "frontmatter",
    };
    const map = new Map<string, string[]>();
    map.set(entry.filePath, ["setup"]);

    const result = buildInjectionContent([entry], map);
    expect(result).toContain("Source: `guides/setup.md`");
    expect(result).not.toContain("Source: `setup.md`");
  });
});

describe("notifyInjection", () => {
  test("emits one notification per doc", () => {
    const notifications: string[] = [];
    const mockUi = {
      notify: (msg: string) => { notifications.push(msg); },
    };

    const entry = makeEntry("test.md", ["test", "testing"], "# Test");
    const map = new Map<string, string[]>();
    map.set(entry.filePath, ["test", "testing"]);

    notifyInjection(mockUi, [entry], map);
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toContain("test.md");
    expect(notifications[0]).toContain("test, testing");
  });

  test("emits multiple notifications for multiple docs", () => {
    const notifications: string[] = [];
    const mockUi = { notify: (msg: string) => { notifications.push(msg); } };

    const e1 = makeEntry("test.md", ["test"], "# Test");
    const e2 = makeEntry("workflow.md", ["workflow"], "# Workflow");
    const map = new Map<string, string[]>();
    map.set(e1.filePath, ["test"]);
    map.set(e2.filePath, ["workflow"]);

    notifyInjection(mockUi, [e1, e2], map);
    expect(notifications).toHaveLength(2);
  });
});
