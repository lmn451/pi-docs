/**
 * Keyword Matcher — matches streaming output text against document keywords.
 */
import type { DocEntry, MatchResult, MatcherOptions } from "./types";
/**
 * Extract text from message content. Handles:
 * - Plain string
 * - Content array with text/thinking blocks
 */
export declare function extractText(content: unknown): string;
export declare class KeywordMatcher {
    private entries;
    private options;
    /**
     * @param entries - The document entries to match against
     * @param options - Optional matcher settings (merged with defaults)
     */
    constructor(entries: DocEntry[], options?: Partial<MatcherOptions>);
    /** Match text against keyword index. Returns matching docs with hit details. */
    match(text: string): MatchResult[];
    /**
     * Check if a single keyword matches the given text.
     * Uses simple substring inclusion (case-insensitive by default).
     */
    private keywordMatches;
}
