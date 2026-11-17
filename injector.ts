/**
 * Context Injector — formats matched docs into a content string suitable for
 * injection as a `CustomMessage` (from `before_agent_start` or `turn_end`) and
 * sends TUI notifications.
 *
 * The produced content is delivered to the LLM as a `CustomMessage` rather
 * than appended to the system prompt. This keeps the system prompt
 * byte-identical across turns so the provider's prompt cache stays warm.
 */
import type { InjectionHistory, InjectionHistoryRecord } from "./audit";
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
 * Format saved injection audit records for the history command.
 *
 * Audit records are stored oldest-first, so the formatter walks them backward
 * without changing the history object.
 */
export function formatInjectionHistory(
  history: InjectionHistory,
  limit: number | "all" = 20,
): string {
  const total = history.records.length;
  const shown =
    limit === "all" ? total : Math.min(total, Math.max(0, Math.floor(limit)));
  const lines = ["Saved document injection history (newest first)"];
  lines.push(`Showing ${shown} of ${total} readable saved injection records.`);

  if (total === 0) {
    lines.push(
      history.unavailableMessages > 0
        ? "No readable saved injection records were found on this branch."
        : "No saved injection records were found on this branch.",
    );
  } else {
    if (shown < total) {
      lines.push("Older records are omitted by the requested limit.");
    }

    for (let index = total - 1; index >= total - shown; index--) {
      const record = history.records[index];
      formatInjectionHistoryRecord(record, lines);
      if (index > total - shown) lines.push("");
    }
  }

  if (history.unavailableMessages > 0) {
    const count = history.unavailableMessages;
    lines.push(
      `Notice: ${count} doc-inject message${count === 1 ? "" : "s"} had legacy, missing, malformed, or unsupported audit metadata; their injection reasons and timing are unknown.`,
    );
  }

  return lines.join("\n");
}

function formatInjectionHistoryRecord(
  record: InjectionHistoryRecord,
  lines: string[],
): void {
  lines.push(
    `${new Date(record.timestamp).toISOString()} — ${record.relativePath}`,
  );
  lines.push(
    `  Mode: ${record.mode} (keyword source: ${record.keywordSource})`,
  );

  const matchedBySource: Record<"input" | "assistant", string[]> = {
    input: [],
    assistant: [],
  };
  for (const trigger of record.triggers) {
    const keywords = matchedBySource[trigger.source];
    for (const keyword of trigger.matchedKeywords) {
      keywords.push(keyword);
    }
  }
  const matchSources: string[] = [];
  for (const source of ["input", "assistant"] as const) {
    const keywords = sanitizeKeywords(matchedBySource[source]);
    if (keywords.length > 0) {
      matchSources.push(`${source}: ${keywords.join(", ")}`);
    }
  }
  lines.push(
    `  Matched from: ${matchSources.length > 0 ? matchSources.join("; ") : "unknown"}`,
  );
  lines.push(`  Boundary: ${record.boundary}`);
  if (record.turnIndex !== undefined) {
    lines.push(`  Turn index: ${record.turnIndex}`);
  }
}

/**
 * Build the content string for a `CustomMessage` injection from matched
 * documents. This is the payload that gets returned in
 * `before_agent_start`'s `message.content` or a `turn_end` entry draft.
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
    ui.notify(
      `📄 Injected: ${entry.relativePath} (matched: ${kwList})`,
      "info",
    );
  }
}
