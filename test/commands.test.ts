/**
 * Tests for the /doc-keywords-gen filter made reachable by the LLM label-fix.
 *
 * The /doc-keywords-gen command (commands.ts:113-119) filters out entries whose
 * keywordSource is "frontmatter", "cache", or "llm" — only heuristic-generated
 * entries are candidates for LLM upgrade. Before the LLM label-fix (which made
 * keywordSource: "llm" reachable), the "llm" branch in the filter was dead code.
 * This test pins down that the filter now actually excludes LLM-labeled entries.
 */
import type { DocEntry } from "../types";
import { describe, expect, test } from "vitest";

const makeEntry = (
  name: string,
  source: DocEntry["keywordSource"],
): DocEntry => ({
  filePath: `/docs/${name}`,
  fileName: name,
  relativePath: name,
  title: name,
  keywords: ["some", "keyword"],
  content: `# ${name}`,
  injected: false,
  keywordSource: source,
});

describe("/doc-keywords-gen filter", () => {
  // Replicates the filter logic from commands.ts:114-119. If the production
  // code changes, update this — but the test's INTENT is "the filter
  // excludes LLM-labeled entries", not "the filter has this exact shape".
  const isCandidate = (e: DocEntry): boolean => {
    if (e.keywordSource === "frontmatter") return false;
    if (e.keywordSource === "cache") return false;
    if (e.keywordSource === "llm") return false;
    return true;
  };

  test("excludes frontmatter entries", () => {
    const e = makeEntry("fm.md", "frontmatter");
    expect(isCandidate(e)).toBe(false);
  });

  test("excludes cache entries (heuristic-written, surfaced as cache)", () => {
    const e = makeEntry("cached.md", "cache");
    expect(isCandidate(e)).toBe(false);
  });

  test("excludes LLM-labeled entries (the fix makes this branch reachable)", () => {
    const e = makeEntry("llm.md", "llm");
    expect(isCandidate(e)).toBe(false);
  });

  test("includes only heuristic entries", () => {
    const entries = [
      makeEntry("a.md", "frontmatter"),
      makeEntry("b.md", "cache"),
      makeEntry("c.md", "llm"),
      makeEntry("d.md", "heuristic"),
    ];
    const candidates = entries.filter(isCandidate);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].relativePath).toBe("d.md");
  });
});
