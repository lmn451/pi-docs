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

export class KeywordMatcher {
  private options: MatcherOptions;

  /**
   * @param entries - The document entries to match against
   * @param options - Optional matcher settings (merged with defaults)
   */
  constructor(private entries: DocEntry[], options?: Partial<MatcherOptions>) {
    this.options = { ...DEFAULT_MATCHER_OPTIONS, ...options };
  }

  /** Match text against keyword index. Returns matching docs with hit details. */
  match(text: string): MatchResult[] {
    if (!text || this.entries.length === 0) return [];

    const results: MatchResult[] = [];

    for (const entry of this.entries) {
      if (entry.injected) continue;

      // Skip entries with no keywords (empty array or falsy)
      if (!entry.keywords || entry.keywords.length === 0) continue;

      const matchedKeywords: string[] = [];
      for (const keyword of entry.keywords) {
        // Skip empty keywords — they'd match everything with word boundaries
        if (!keyword || keyword.trim().length === 0) continue;
        if (this.keywordMatches(text, keyword)) {
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


  /**
   * Check if a single keyword matches the given text.
   * Escapes regex special characters before constructing word-boundary pattern.
   * Falls back to simple `includes` when wordBoundary is disabled.
   */
  private keywordMatches(text: string, keyword: string): boolean {
    const search = this.options.caseSensitive ? text : text.toLowerCase();
    const kw = this.options.caseSensitive ? keyword : keyword.toLowerCase();

    if (this.options.wordBoundary) {
      // Escape special regex chars in keyword
      const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const flags = this.options.caseSensitive ? "" : "i";

      // \\b only works between word chars. For keywords starting/ending with
      // non-word chars (e.g. "^", "$$", "func()"), use whitespace/string-boundary
      // anchors instead.
      const startsWord = /^\w/.test(kw);
      const endsWord = /\w$/.test(kw);
      const prefix = startsWord ? "\\b" : "(?:^|\\s)";
      const suffix = endsWord ? "\\b" : "(?:$|\\s)";

      const regex = new RegExp(`${prefix}${escaped}${suffix}`, flags);
      return regex.test(search);
    }

    return search.includes(kw);
  }
}
