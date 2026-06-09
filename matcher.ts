/**
 * Keyword Matcher — matches streaming output text against document keywords.
 */
import type { DocEntry, MatchResult, MatcherOptions } from "./types";
import { DEFAULT_MATCHER_OPTIONS } from "./types";

/**
 * Extract text from message content. Handles:
 * - Plain string
 * - Content array with text/thinking blocks
 */
export function extractText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }

  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const b = block as Record<string, unknown>;
    if ((b.type === "text" || b.type === "thinking") && typeof b.text === "string") {
      parts.push(b.text);
    }
  }
  return parts.join("\n");
}

/** Characters treated as part of a "word" for boundary detection. */
const WORD_CHAR = /[A-Za-z0-9_]/;

/** Escape a string so it can be embedded literally in a RegExp. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Compile a keyword into a regex that matches it literally with smart word
 * boundaries.
 *
 * Boundaries are only asserted on an edge when the adjacent keyword character
 * is a word character ([A-Za-z0-9_]). This gives word-boundary semantics for
 * normal keywords ("test" won't match "latest" or "testing") while still
 * matching symbol keywords literally ("$", "C++", "func()", "[test]", "a|b").
 */
function buildKeywordRegex(keyword: string, caseSensitive: boolean): RegExp {
  const escaped = escapeRegExp(keyword);
  const left = WORD_CHAR.test(keyword[0]) ? "(?<![A-Za-z0-9_])" : "";
  const right = WORD_CHAR.test(keyword[keyword.length - 1]) ? "(?![A-Za-z0-9_])" : "";
  return new RegExp(`${left}${escaped}${right}`, caseSensitive ? "" : "i");
}

interface CompiledEntry {
  entry: DocEntry;
  patterns: Array<{ keyword: string; regex: RegExp }>;
}

export class KeywordMatcher {
  private options: MatcherOptions;
  // Regexes are precompiled once per matcher so streaming re-matches (which run
  // on every chunk) don't recompile patterns on each call.
  private compiled: CompiledEntry[];

  /**
   * @param entries - The document entries to match against
   * @param options - Optional matcher settings (merged with defaults)
   */
  constructor(entries: DocEntry[], options?: Partial<MatcherOptions>) {
    this.options = { ...DEFAULT_MATCHER_OPTIONS, ...options };
    this.compiled = entries.map((entry) => ({
      entry,
      patterns: (entry.keywords ?? [])
        // Skip empty/whitespace keywords — they'd match everything.
        .filter((kw) => kw && kw.trim().length > 0)
        .map((keyword) => ({ keyword, regex: buildKeywordRegex(keyword, this.options.caseSensitive) })),
    }));
  }

  /** Match text against keyword index. Returns matching docs with hit details. */
  match(text: string): MatchResult[] {
    if (!text || this.compiled.length === 0) return [];

    const results: MatchResult[] = [];

    for (const { entry, patterns } of this.compiled) {
      if (entry.injected) continue;
      if (patterns.length === 0) continue;

      const matchedKeywords: string[] = [];
      for (const { keyword, regex } of patterns) {
        if (regex.test(text)) {
          matchedKeywords.push(keyword);
        }
      }

      if (matchedKeywords.length >= this.options.matchThreshold) {
        results.push({
          entry,
          matchedKeywords,
          hitCount: matchedKeywords.length,
        });
      }
    }

    return results;
  }
}