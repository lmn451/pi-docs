/**
 * Context Injector — formats matched docs into a content string suitable for
 * injection as a `CustomMessage` (returned from `before_agent_start`) and
 * sends TUI notifications.
 *
 * The produced content is delivered to the LLM as a `CustomMessage` rather
 * than appended to the system prompt. This keeps the system prompt
 * byte-identical across turns so the provider's prompt cache stays warm.
 */
import type { DocEntry } from "./types";

/**
 * Interface for the UI notification capability needed by the injector.
 * Matches Pi's ExtensionContext['ui'] notify signature.
 */
export interface NotifyCapability {
  notify: (msg: string, type?: "info" | "warning" | "error") => void;
}

/**
 * Sanitize keywords for safe display in the injection content.
 *
 * - Strips \n and \r (replaces with space) to prevent prompt injection
 * - Caps each keyword at 100 characters
 * - Enforces a hard limit of 20 keywords
 */
function sanitizeKeywords(keywords: string[]): string[] {
  return keywords
    .map((k) => k.replace(/[\n\r]/g, " ").trim())
    .filter((k) => k.length > 0)
    .map((k) => (k.length > 100 ? k.slice(0, 100) : k))
    .slice(0, 20);
}

/**
 * Build the content string for a `CustomMessage` injection from matched
 * documents. This is the payload that gets returned in
 * `before_agent_start`'s `message.content` and sent to the LLM.
 */
export function buildInjectionContent(
    entries: DocEntry[],
    matchedKeywords: Map<string, string[]>,
): string {
  if (entries.length === 0) return "";

  const sections: string[] = [
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
export function notifyInjection(
  ui: NotifyCapability,
  entries: DocEntry[],
  matchedKeywords: Map<string, string[]>,
): void {
  for (const entry of entries) {
    const keywords = matchedKeywords.get(entry.filePath) ?? [];
    const kwList = keywords.join(", ");
    ui.notify(`📄 Injected: ${entry.relativePath} (matched: ${kwList})`, "info");
  }
}
