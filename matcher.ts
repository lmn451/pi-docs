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
  return extractTextBlocks(content).join("\n");
}

/** Keep completed blocks separate so matching cannot manufacture cross-block hits. */
export function extractTextBlocks(content: unknown): string[] {
  if (typeof content === "string") {
    return [content];
  }
  if (!Array.isArray(content)) {
    return [];
  }

  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const b = block as Record<string, unknown>;
    if (b.type === "text" && typeof b.text === "string") {
      parts.push(b.text);
    } else if (b.type === "thinking" && typeof b.thinking === "string") {
      parts.push(b.thinking);
    }
  }
  return parts;
}

/** Characters treated as part of a "word" for boundary detection. */
const WORD_CHAR = /[\p{L}\p{N}_]/u;

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
  const characters = Array.from(keyword);
  const left = WORD_CHAR.test(characters[0] ?? "")
    ? "(?<![\\p{L}\\p{N}_])"
    : "";
  const right = WORD_CHAR.test(characters[characters.length - 1] ?? "")
    ? "(?![\\p{L}\\p{N}_])"
    : "";
  return new RegExp(`${left}${escaped}${right}`, caseSensitive ? "gu" : "giu");
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
    this.compiled = entries.map((entry) => {
      const seen = new Set<string>();
      const patterns = (entry.keywords ?? [])
        .filter(
          (kw): kw is string => typeof kw === "string" && kw.trim().length > 0,
        )
        .filter((kw) => {
          const key = this.options.caseSensitive ? kw : kw.toLowerCase();
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        })
        .map((keyword) => ({
          keyword,
          regex: buildKeywordRegex(keyword, this.options.caseSensitive),
        }));
      return { entry, patterns };
    });
  }

  /** Match text against keyword index. Returns matching docs with hit details. */
  match(text: string): MatchResult[] {
    if (!text || this.compiled.length === 0) return [];

    // Rolling tail window: only scan the last `windowSize` chars. Keeps the
    // per-chunk cost bounded on long streaming messages. Callers that need the
    // full text (one-shot user input) pass windowSize 0. Matches still
    // accumulate across chunks in the caller, so keywords that scroll past the
    // window aren't lost.
    const { windowSize } = this.options;
    const sliced = windowSize > 0 && text.length > windowSize;
    // Preserve the complete preceding code point, including surrogate pairs.
    const windowStart = sliced ? text.length - windowSize : 0;
    let scanStart = Math.max(0, windowStart - 1);
    if (
      scanStart > 0 &&
      /[\uDC00-\uDFFF]/.test(text.charAt(scanStart)) &&
      /[\uD800-\uDBFF]/.test(text.charAt(scanStart - 1))
    ) {
      scanStart--;
    }
    const scanText = text.slice(scanStart);
    const minStart = windowStart - scanStart;

    const results: MatchResult[] = [];

    for (const { entry, patterns } of this.compiled) {
      if (entry.injected) continue;
      if (patterns.length === 0) continue;

      const matchedKeywords: string[] = [];
      for (const { keyword, regex } of patterns) {
        regex.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = regex.exec(scanText)) !== null) {
          if (match.index < minStart) continue;
          matchedKeywords.push(keyword);
          break;
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
