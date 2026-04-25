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

  constructor(private entries: DocEntry[], options?: Partial<MatcherOptions>) {
    this.options = { ...DEFAULT_MATCHER_OPTIONS, ...options };
  }

  /** Match text against keyword index. Returns matching docs with hit details. */
  match(text: string): MatchResult[] {
    if (!text || this.entries.length === 0) return [];

    const results: MatchResult[] = [];

    for (const entry of this.entries) {
      if (entry.injected) continue;

      const matchedKeywords: string[] = [];
      for (const keyword of entry.keywords) {
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

  private keywordMatches(text: string, keyword: string): boolean {
    const search = this.options.caseSensitive ? text : text.toLowerCase();
    const kw = this.options.caseSensitive ? keyword : keyword.toLowerCase();

    if (this.options.wordBoundary) {
      // Escape special regex chars in keyword, then apply word boundary
      const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(`\\b${escaped}\\b`, "i");
      return regex.test(search);
    }

    return search.includes(kw);
  }
}
