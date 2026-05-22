import type { DocEntry } from "./types";
/**
 * Interface for the UI notification capability needed by the injector.
 * Matches Pi's ExtensionContext['ui'] notify signature.
 */
export interface NotifyCapability {
    notify: (msg: string, type?: "info" | "warning" | "error") => void;
}
/**
 * Build a system prompt append string from matched documents.
 */
export declare function buildSystemPromptAppend(entries: DocEntry[], matchedKeywords: Map<string, string[]>): string;
/**
 * Notify the user via TUI when documents are injected.
 */
export declare function notifyInjection(ui: NotifyCapability, entries: DocEntry[], matchedKeywords: Map<string, string[]>): void;
