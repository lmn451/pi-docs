import {
  buildInjectionContent,
  formatInjectionHistory,
  formatInjectionSummary,
  notifyInjection,
} from "../injector";
import type { InjectionHistory, InjectionHistoryRecord } from "../audit";
import type { DocEntry } from "../types";
import { describe, expect, test } from "vitest";

const makeHistoryRecord = (
  overrides: Partial<InjectionHistoryRecord> = {},
): InjectionHistoryRecord => ({
  timestamp: "2025-03-04T05:06:07.000Z",
  entryId: "entry-1",
  mode: "keywords",
  boundary: "turn_end",
  turnIndex: 7,
  relativePath: "guides/auth.md",
  keywordSource: "frontmatter",
  triggers: [
    { source: "input", matchedKeywords: ["auth"] },
    { source: "assistant", matchedKeywords: ["login"] },
  ],
  ...overrides,
});

const makeHistory = (
  records: InjectionHistoryRecord[],
  unavailableMessages = 0,
): InjectionHistory => ({ records, unavailableMessages });

const makeEntry = (
  name: string,
  keywords: string[],
  content: string,
): DocEntry => ({
  filePath: `/docs/${name}`,
  fileName: name,
  relativePath: name,
  title: name,
  keywords,
  content,
  injected: false,
  keywordSource: "frontmatter",
});

describe("formatInjectionSummary", () => {
  test("lists each path and only its recorded matches by source", () => {
    const first = {
      ...makeHistoryRecord(),
      relativePath: "guides/\x1b[31mauth.md\x1b[0m",
      triggers: [
        { source: "input", matchedKeywords: ["sign\nin"] },
        { source: "assistant", matchedKeywords: ["oauth\x07 callback"] },
      ],
    };
    const second = makeHistoryRecord({
      relativePath: "billing.md",
      triggers: [{ source: "assistant", matchedKeywords: ["invoice"] }],
    });
    expect(
      formatInjectionSummary({
        version: 1,
        mode: "keywords",
        boundary: "turn_end",
        documents: [first, second],
      }),
    ).toEqual([
      "guides/auth.md — user input: sign in; assistant: oauth  callback",
      "billing.md — assistant: invoice",
    ]);
  });

  test("does not guess match details for legacy or malformed messages", () => {
    expect(formatInjectionSummary(undefined)).toEqual([]);
    expect(
      formatInjectionSummary({
        version: 1,
        mode: "simple",
        boundary: "before_agent_start",
        documents: [{ relativePath: "auth.md", triggers: [] }],
      }),
    ).toEqual([]);
  });
});

describe("buildInjectionContent", () => {
  test("formats a single doc", () => {
    const entry = makeEntry(
      "test.md",
      ["test", "testing"],
      "# Test Guide\nContent here.",
    );
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
      notify: (msg: string) => {
        notifications.push(msg);
      },
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
    const mockUi = {
      notify: (msg: string) => {
        notifications.push(msg);
      },
    };

    const e1 = makeEntry("test.md", ["test"], "# Test");
    const e2 = makeEntry("workflow.md", ["workflow"], "# Workflow");
    const map = new Map<string, string[]>();
    map.set(e1.filePath, ["test"]);
    map.set(e2.filePath, ["workflow"]);

    notifyInjection(mockUi, [e1, e2], map);
    expect(notifications).toHaveLength(2);
  });
});

describe("formatInjectionHistory", () => {
  test("formats UTC timing and sanitizes displayed match terms", () => {
    const longKeyword = "x".repeat(101);
    const history = makeHistory([
      makeHistoryRecord({
        triggers: [
          {
            source: "input",
            matchedKeywords: [" auth\n bypass ", longKeyword],
          },
          {
            source: "assistant",
            matchedKeywords: Array.from(
              { length: 21 },
              (_, index) => `term-${index}`,
            ),
          },
        ],
      }),
    ]);

    const output = formatInjectionHistory(history);
    expect(output).toContain("2025-03-04T05:06:07.000Z");
    expect(output).toContain("guides/auth.md");
    expect(output).toMatch(/input: auth +bypass/);
    expect(output).toContain("x".repeat(100));
    expect(output).not.toContain(longKeyword);
    expect(output).toContain("assistant: term-0");
    expect(output).toContain("term-19");
    expect(output).not.toContain("term-20");
  });

  test("shows the newest records first and allows all records", () => {
    const records = Array.from({ length: 22 }, (_, index) =>
      makeHistoryRecord({
        entryId: `entry-${index}`,
        timestamp: new Date(Date.UTC(2025, 0, 1, 0, 0, index)).toISOString(),
        relativePath: `docs/${index}.md`,
      }),
    );
    const history = makeHistory(records);

    const recent = formatInjectionHistory(history);
    expect(recent).toContain("Showing 20 of 22");
    expect(recent.indexOf("docs/21.md")).toBeLessThan(
      recent.indexOf("docs/2.md"),
    );
    expect(recent).not.toContain("docs/1.md");

    const all = formatInjectionHistory(history, "all");
    expect(all).toContain("Showing 22 of 22");
    expect(all).toContain("docs/0.md");
    expect(all).not.toContain("Older records are omitted");
  });
});
