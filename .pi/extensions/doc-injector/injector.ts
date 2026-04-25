/**
 * Context Injector — formats matched docs into system prompt append
 * and sends TUI notifications.
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { DocEntry } from "./types";

/**
 * Build a system prompt append string from matched documents.
 */
export function buildSystemPromptAppend(
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
    const keywords = matchedKeywords.get(entry.filePath) ?? [];
    sections.push(`### ${entry.title}`);
    sections.push(`Source: \`${entry.fileName}\``);
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
  ui: { notify: (msg: string, type?: "info" | "warning" | "error" | "success") => void },
  entries: DocEntry[],
  matchedKeywords: Map<string, string[]>,
): void {
  for (const entry of entries) {
    const keywords = matchedKeywords.get(entry.filePath) ?? [];
    const kwList = keywords.join(", ");
    ui.notify(`📄 Injected: ${entry.fileName} (matched: ${kwList})`, "info");
  }
}
