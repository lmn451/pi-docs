import { DEFAULT_MATCHER_OPTIONS } from "./types";
/**
 * Extract text from message content. Handles:
 * - Plain string
 * - Content array with text/thinking blocks
 */
export function extractText(content) {
    if (typeof content === "string") {
        return content;
    }
    if (!Array.isArray(content)) {
        return "";
    }
    const parts = [];
    for (const block of content) {
        if (!block || typeof block !== "object")
            continue;
        const b = block;
        if ((b.type === "text" || b.type === "thinking") && typeof b.text === "string") {
            parts.push(b.text);
        }
    }
    return parts.join("\n");
}
export class KeywordMatcher {
    entries;
    options;
    /**
     * @param entries - The document entries to match against
     * @param options - Optional matcher settings (merged with defaults)
     */
    constructor(entries, options) {
        this.entries = entries;
        this.options = { ...DEFAULT_MATCHER_OPTIONS, ...options };
    }
    /** Match text against keyword index. Returns matching docs with hit details. */
    match(text) {
        if (!text || this.entries.length === 0)
            return [];
        const results = [];
        for (const entry of this.entries) {
            if (entry.injected)
                continue;
            // Skip entries with no keywords (empty array or falsy)
            if (!entry.keywords || entry.keywords.length === 0)
                continue;
            const matchedKeywords = [];
            for (const keyword of entry.keywords) {
                // Skip empty keywords — they'd match everything with word boundaries
                if (!keyword || keyword.trim().length === 0)
                    continue;
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
     * Uses simple substring inclusion (case-insensitive by default).
     */
    keywordMatches(text, keyword) {
        const search = this.options.caseSensitive ? text : text.toLowerCase();
        const kw = this.options.caseSensitive ? keyword : keyword.toLowerCase();
        return search.includes(kw);
    }
}
//# sourceMappingURL=matcher.js.map