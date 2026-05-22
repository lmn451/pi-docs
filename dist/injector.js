/**
 * Sanitize keywords for safe injection into the system prompt.
 *
 * - Strips \n and \r (replaces with space) to prevent prompt injection
 * - Caps each keyword at 100 characters
 * - Enforces a hard limit of 20 keywords
 */
function sanitizeKeywords(keywords) {
    return keywords
        .map((k) => k.replace(/[\n\r]/g, " ").trim())
        .filter((k) => k.length > 0)
        .map((k) => (k.length > 100 ? k.slice(0, 100) : k))
        .slice(0, 20);
}
/**
 * Build a system prompt append string from matched documents.
 */
export function buildSystemPromptAppend(entries, matchedKeywords) {
    if (entries.length === 0)
        return "";
    const sections = [
        "## Relevant Context Documents\n",
        "The following documents from the project docs folder are relevant to the current conversation context. Use them as reference when responding.",
        "",
    ];
    for (const entry of entries) {
        // Sanitize keywords before display to prevent prompt injection
        const rawKeywords = matchedKeywords.get(entry.filePath) ?? [];
        const keywords = sanitizeKeywords(rawKeywords);
        sections.push(`### ${entry.title}`);
        sections.push(`Source: \`${entry.relativePath}\``);
        if (keywords.length > 0) {
            sections.push(`Matched keywords: ${keywords.join(", ")}`);
        }
        sections.push("---");
        sections.push(entry.content);
        sections.push("");
    }
    return sections.join("\n");
}
/**
 * Notify the user via TUI when documents are injected.
 */
export function notifyInjection(ui, entries, matchedKeywords) {
    for (const entry of entries) {
        const keywords = matchedKeywords.get(entry.filePath) ?? [];
        const kwList = keywords.join(", ");
        ui.notify(`📄 Injected: ${entry.relativePath} (matched: ${kwList})`, "info");
    }
}
//# sourceMappingURL=injector.js.map