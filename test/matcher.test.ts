import { KeywordMatcher, extractText } from "../matcher";
import type { DocEntry } from "../types";
import { describe, expect, test } from "bun:test";

const makeEntry = (name: string, keywords: string[]): DocEntry => ({
  filePath: `/docs/${name}`,
  fileName: name,
  relativePath: name,
  title: name,
  keywords,
  content: `# ${name}`,
  injected: false,
});

describe("KeywordMatcher", () => {
  test("word boundary matching works", () => {
    const entries = [makeEntry("test.md", ["test", "testing"])];
    const matcher = new KeywordMatcher(entries, { matchThreshold: 1 });

    const r1 = matcher.match("how to write a test");
    expect(r1.length).toBeGreaterThan(0);
    expect(r1[0].matchedKeywords).toContain("test");
    expect(r1[0].matchedKeywords).not.toContain("testing");

    const r2 = matcher.match("unit testing is important");
    expect(r2.length).toBeGreaterThan(0);
    expect(r2[0].matchedKeywords).toContain("testing");
  });

  test("substring does NOT match (word boundary)", () => {
    const entries = [makeEntry("artifact.md", ["artifact"])];
    const matcher = new KeywordMatcher(entries);

    expect(matcher.match("the art of coding")).toHaveLength(0);
    expect(matcher.match("listing all artifacts")).toHaveLength(0);
  });

  test("case-insensitive matching", () => {
    const entries = [makeEntry("test.md", ["test", "assert"])];
    const matcher = new KeywordMatcher(entries, { matchThreshold: 1 });

    expect(matcher.match("TEST").length).toBeGreaterThan(0);
    expect(matcher.match("Test").length).toBeGreaterThan(0);
    expect(matcher.match("tEsT").length).toBeGreaterThan(0);
  });

  test("case-sensitive matching when enabled", () => {
    const entries = [makeEntry("test.md", ["TEST"])];
    const matcher = new KeywordMatcher(entries, { caseSensitive: true, wordBoundary: true, matchThreshold: 1 });

    expect(matcher.match("this is a test")).toHaveLength(0);
    expect(matcher.match("this is a TEST")).toHaveLength(1);
  });

  test("threshold filtering", () => {
    const entries = [makeEntry("test.md", ["test", "testing", "unit", "assert"])];
    const matcher = new KeywordMatcher(entries, { matchThreshold: 3 });

    expect(matcher.match("run the test")).toHaveLength(0);

    const r2 = matcher.match("unit testing with assert");
    expect(r2.length).toBeGreaterThan(0);
    expect(r2[0].hitCount).toBe(3);
  });

  test("already-injected docs excluded", () => {
    const entry = makeEntry("test.md", ["test", "testing"]);
    entry.injected = true;
    const matcher = new KeywordMatcher([entry]);

    expect(matcher.match("how to write a test")).toHaveLength(0);
  });
});

describe("extractText", () => {
  test("extracts from plain string", () => {
    expect(extractText("hello world")).toBe("hello world");
  });

  test("extracts from content array with thinking blocks", () => {
    const content = [
      { type: "text", text: "Hello " },
      { type: "thinking", text: "Let me think..." },
      { type: "text", text: "World" },
    ];
    const result = extractText(content);
    expect(result).toContain("Hello");
    expect(result).toContain("Let me think");
    expect(result).toContain("World");
  });

  test("returns empty for invalid types", () => {
    expect(extractText(null)).toBe("");
    expect(extractText(123)).toBe("");
    expect(extractText(undefined)).toBe("");
  });
});
