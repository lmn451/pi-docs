import type { KeywordSource } from "./types";

export type InjectionBoundary = "before_agent_start" | "turn_end";
export type InjectionMatchSource = "input" | "assistant";

export interface InjectionTrigger {
  source: InjectionMatchSource;
  matchedKeywords: string[];
}

export interface InjectionAuditDocument {
  relativePath: string;
  keywordSource: KeywordSource;
  triggers: InjectionTrigger[];
}

export interface InjectionAuditDetails {
  version: 1;
  mode: "simple" | "keywords";
  boundary: InjectionBoundary;
  turnIndex?: number;
  documents: InjectionAuditDocument[];
}

export interface InjectionHistoryRecord {
  timestamp: string;
  entryId: string;
  mode: "simple" | "keywords";
  boundary: InjectionBoundary;
  turnIndex?: number;
  relativePath: string;
  keywordSource: KeywordSource;
  triggers: InjectionTrigger[];
}

export interface InjectionHistory {
  records: InjectionHistoryRecord[];
  unavailableMessages: number;
}

function isKeywordSource(value: unknown): value is KeywordSource {
  return (
    value === "filename" ||
    value === "frontmatter" ||
    value === "heuristic" ||
    value === "llm" ||
    value === "cache"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonemptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function formatTimestamp(value: unknown): string | null {
  let milliseconds: number;
  if (typeof value === "number" && Number.isFinite(value)) {
    milliseconds = value;
  } else if (typeof value === "string" && value.trim().length > 0) {
    milliseconds = Date.parse(value);
  } else {
    return null;
  }

  if (!Number.isFinite(milliseconds)) return null;
  const date = new Date(milliseconds);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toISOString();
}

export function readInjectionAuditDetails(
  value: unknown,
): InjectionAuditDetails | null {
  if (!isRecord(value)) return null;
  if (value.version !== 1) return null;
  if (value.mode !== "simple" && value.mode !== "keywords") return null;
  if (value.boundary !== "before_agent_start" && value.boundary !== "turn_end")
    return null;

  const hasTurnIndex = Object.prototype.hasOwnProperty.call(value, "turnIndex");
  let turnIndex: number | undefined;
  if (hasTurnIndex) {
    const candidate = value.turnIndex;
    if (
      value.boundary !== "turn_end" ||
      typeof candidate !== "number" ||
      !Number.isInteger(candidate) ||
      candidate < 0
    )
      return null;
    turnIndex = candidate;
  }

  if (!Array.isArray(value.documents) || value.documents.length === 0)
    return null;

  const documents: InjectionAuditDocument[] = [];
  const rawDocuments: unknown[] = value.documents;
  for (const rawDocument of rawDocuments) {
    if (!isRecord(rawDocument)) return null;
    if (!isNonemptyString(rawDocument.relativePath)) return null;
    if (!isKeywordSource(rawDocument.keywordSource)) return null;
    if (
      !Array.isArray(rawDocument.triggers) ||
      rawDocument.triggers.length === 0
    )
      return null;

    const triggers: InjectionTrigger[] = [];
    const rawTriggers: unknown[] = rawDocument.triggers;
    for (const rawTrigger of rawTriggers) {
      if (!isRecord(rawTrigger)) return null;
      if (rawTrigger.source !== "input" && rawTrigger.source !== "assistant")
        return null;
      if (!Array.isArray(rawTrigger.matchedKeywords)) return null;
      const matchedKeywords: string[] = [];
      const rawKeywords: unknown[] = rawTrigger.matchedKeywords;
      for (const keyword of rawKeywords) {
        if (!isNonemptyString(keyword)) return null;
        matchedKeywords.push(keyword);
      }
      if (matchedKeywords.length === 0) return null;
      triggers.push({
        source: rawTrigger.source,
        matchedKeywords,
      });
    }

    documents.push({
      relativePath: rawDocument.relativePath,
      keywordSource: rawDocument.keywordSource,
      triggers,
    });
  }

  return {
    version: 1,
    mode: value.mode,
    boundary: value.boundary,
    ...(turnIndex !== undefined ? { turnIndex } : {}),
    documents,
  };
}

/** Read structured injection metadata from the native current-branch entries. */
export function readInjectionHistory(
  entries: readonly unknown[],
): InjectionHistory {
  const records: InjectionHistoryRecord[] = [];
  let unavailableMessages = 0;

  for (const entry of entries) {
    if (
      !isRecord(entry) ||
      entry.type !== "custom_message" ||
      entry.customType !== "doc-injector"
    )
      continue;

    const timestamp = formatTimestamp(entry.timestamp);
    const details = readInjectionAuditDetails(entry.details);
    if (!timestamp || !isNonemptyString(entry.id) || !details) {
      unavailableMessages++;
      continue;
    }

    for (const document of details.documents) {
      records.push({
        timestamp,
        entryId: entry.id,
        mode: details.mode,
        boundary: details.boundary,
        ...(details.turnIndex !== undefined
          ? { turnIndex: details.turnIndex }
          : {}),
        relativePath: document.relativePath,
        keywordSource: document.keywordSource,
        triggers: document.triggers,
      });
    }
  }

  return { records, unavailableMessages };
}
