import { KeywordMatcher, extractText } from "../matcher";
import type { DocEntry } from "../types";
import { describe, expect, test } from "vitest";

const makeEntry = (name: string, keywords: string[]): DocEntry => ({
  filePath: `/docs/${name}`,
  fileName: name,
  relativePath: name,
  title: name,
  keywords,
  content: `# ${name}`,
  injected: false,
  keywordSource: "frontmatter",
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

  test("case-insensitive matching", () => {
    const entries = [makeEntry("test.md", ["test", "assert"])];
    const matcher = new KeywordMatcher(entries, { matchThreshold: 1 });

    expect(matcher.match("TEST").length).toBeGreaterThan(0);
    expect(matcher.match("Test").length).toBeGreaterThan(0);
    expect(matcher.match("tEsT").length).toBeGreaterThan(0);
  });

  test("case-sensitive matching when enabled", () => {
    const entries = [makeEntry("test.md", ["TEST"])];
    const matcher = new KeywordMatcher(entries, { caseSensitive: true, matchThreshold: 1 });

    expect(matcher.match("this is a test")).toHaveLength(0);
    expect(matcher.match("this is a TEST")).toHaveLength(1);
  });

  test("threshold filtering", () => {
    const entries = [makeEntry("test.md", ["test", "testing", "unit", "assert"])];
    const matcher = new KeywordMatcher(entries, { matchThreshold: 3 });

    expect(matcher.match("run the test")).toHaveLength(0);

    const r2 = matcher.match("unit testing with assert");
    expect(r2.length).toBeGreaterThan(0);
    expect(r2[0].hitCount).toBe(4);
  });

  test("already-injected docs excluded", () => {
    const entry = makeEntry("test.md", ["test", "testing"]);
    entry.injected = true;
    const matcher = new KeywordMatcher([entry]);

    expect(matcher.match("how to write a test")).toHaveLength(0);
  });

  test("handles regex special characters in keywords", () => {
    // Keywords like $, ^, *, +, (, [, | etc. should be matched literally
    const entries = [
      makeEntry("dollar.md", ["$", "cost", "price"]),
      makeEntry("caret.md", ["^", "power", "exponent"]),
      makeEntry("star.md", ["*", "wildcard", "glob"]),
      makeEntry("plus.md", ["C++", "language"]),
      makeEntry("parens.md", ["func()", "method"]),
      makeEntry("brackets.md", ["[test]", "array"]),
      makeEntry("pipe.md", ["a|b", "alternative"]),
    ];
    const matcher = new KeywordMatcher(entries, { matchThreshold: 1 });

    // Dollar sign
    const r1 = matcher.match("the cost is $50 total");
    expect(r1.length).toBeGreaterThan(0);
    expect(r1.map((r) => r.entry.fileName)).toContain("dollar.md");

    // Caret
    const r2 = matcher.match("we use ^ to denote powers");
    expect(r2.length).toBeGreaterThan(0);
    expect(r2.map((r) => r.entry.fileName)).toContain("caret.md");

    // Asterisk
    const r3 = matcher.match("use a * for wildcard matching");
    expect(r3.length).toBeGreaterThan(0);
    expect(r3.map((r) => r.entry.fileName)).toContain("star.md");

    // C++ with plus signs
    const r4 = matcher.match("I write C++ code");
    expect(r4.length).toBeGreaterThan(0);
    expect(r4.map((r) => r.entry.fileName)).toContain("plus.md");

    // Parentheses
    const r5 = matcher.match("call func() to execute");
    expect(r5.length).toBeGreaterThan(0);
    expect(r5.map((r) => r.entry.fileName)).toContain("parens.md");

    // Square brackets
    const r6 = matcher.match("looking at [test] results");
    expect(r6.length).toBeGreaterThan(0);
    expect(r6.map((r) => r.entry.fileName)).toContain("brackets.md");

    // Pipe
    const r7 = matcher.match("choose a|b as alternative");
    expect(r7.length).toBeGreaterThan(0);
    expect(r7.map((r) => r.entry.fileName)).toContain("pipe.md");
  });

  test("handles consecutive special characters in keywords", () => {
    const entries = [
      makeEntry("consecutive.md", ["$$", "$^", "**"]),
    ];
    const matcher = new KeywordMatcher(entries, { matchThreshold: 1 });

    const r1 = matcher.match("use $$ for display math");
    expect(r1.length).toBeGreaterThan(0);
    expect(r1[0].matchedKeywords).toContain("$$");

    const r2 = matcher.match("the $^ combination is weird");
    expect(r2.length).toBeGreaterThan(0);
    expect(r2[0].matchedKeywords).toContain("$^");
  });

  test("skips empty keywords", () => {
    const entries = [makeEntry("empty.md", ["test", "", "  ", "valid"])];
    const matcher = new KeywordMatcher(entries, { matchThreshold: 1 });

    const r = matcher.match("this is a test of valid keywords");
    expect(r.length).toBeGreaterThan(0);
    expect(r[0].matchedKeywords).toContain("test");
    expect(r[0].matchedKeywords).toContain("valid");
    // Empty and whitespace-only keywords should not match
    expect(r[0].matchedKeywords).not.toContain("");
    expect(r[0].matchedKeywords).not.toContain("  ");
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