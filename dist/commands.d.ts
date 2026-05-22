/**
 * Slash commands for the Doc Injector extension.
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { DocRegistry } from "./registry";
import type { DocInjectorConfig } from "./types";
/** Dependencies injected into the command registrar. */
export interface CommandDeps {
    getRegistry: () => DocRegistry | null;
    getEnabled: () => boolean;
    setEnabled: (v: boolean) => void;
    reloadRegistry: () => Promise<number>;
    getConfig: () => DocInjectorConfig;
    generateKeywordsLLM: (files: Array<{
        path: string;
        snippet: string;
        existingKeywords: string[];
    }>) => Promise<void>;
}
/**
 * Register all doc-injector slash commands on the given ExtensionAPI.
 *
 * Commands:
 * - `/doc-inject [on|off|toggle|list|reset|status]` — manage injection state
 * - `/doc-reload` — re-scan docs folder
 * - `/doc-keywords-gen [path]` — generate LLM keywords for keyword-less files
 */
export declare function registerCommands(pi: ExtensionAPI, deps: CommandDeps): void;
