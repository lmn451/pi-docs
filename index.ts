/**
 * Doc Injector Extension for Pi
 *
 * Automatically injects relevant project documentation into the LLM context
 * by monitoring streaming output for keyword matches.
 */
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { resolve } from "node:path";
import { loadConfig } from "./config";
import { buildSystemPromptAppend, notifyInjection } from "./injector";
import { extractText, KeywordMatcher } from "./matcher";
import { DocRegistry } from "./registry";
import { DEFAULT_MATCHER_OPTIONS, type DocEntry, type MatchResult } from "./types";
import { registerCommands } from "./commands";

export default async function docInjectorExtension(pi: ExtensionAPI) {
  // ---- State ----
  let config = loadConfig(process.cwd());
  let registry: DocRegistry | null = null;
  let enabled = true;
  let textBuffer = "";
  let pendingMatches = new Map<string, string[]>(); // filePath → matchedKeywords

  // ---- Helpers ----
  const getRegistry = () => registry;
  const getEnabled = () => enabled;
  const setEnabled = (v: boolean) => {
    enabled = v;
  };

  const initRegistry = async (cwd: string) => {
    config = loadConfig(cwd);
    const docsPath = resolve(cwd, config.docsPath);
    registry = await DocRegistry.create(docsPath);
    const count = registry.getEntries().length;
    if (count > 0) {
      console.log(`[doc-injector] Loaded ${count} documents from ${docsPath}`);
    } else {
      console.warn(`[doc-injector] No documents found at ${docsPath}`);
    }
  };

  const buildMatcher = (): KeywordMatcher | null => {
    if (!registry) return null;
    return new KeywordMatcher(
      registry.getNonInjectedEntries(),
      { matchThreshold: config.matchThreshold },
    );
  };

  // ---- Event: session_start ----
  pi.on("session_start", async (_event, ctx) => {
    await initRegistry(ctx.cwd);
  });

  // ---- Event: resources_discover (reload) ----
  pi.on("resources_discover", async (_event, ctx) => {
    if (registry) {
      await registry.rebuild();
      const count = registry.getEntries().length;
      console.log(`[doc-injector] Reloaded: ${count} documents`);
    }
  });

  // ---- Event: message_update (streaming detection) ----
  pi.on("message_update", async (event, _ctx) => {
    if (!enabled || !registry) return;

    // Only process assistant messages
    const msg = event.message as Record<string, unknown> | undefined;
    if (!msg || msg.role !== "assistant") return;

    // Replace buffer with full message text (message_update contains full content)
    textBuffer = extractText(msg.content);
    if (!textBuffer) return;

    // Run matcher
    const matcher = buildMatcher();
    if (!matcher) return;

    const results = matcher.match(textBuffer);

    // Store matches (dedup by filePath)
    for (const result of results) {
      pendingMatches.set(result.entry.filePath, result.matchedKeywords);
    }
  });

  // ---- Event: message_end (finalize matches) ----
  pi.on("message_end", async (event, ctx) => {
    if (!enabled || !registry) return;

    const msg = event.message as Record<string, unknown> | undefined;
    if (!msg || msg.role !== "assistant") return;

    // Clear buffer
    textBuffer = "";

    // Notify user about pending injections
    if (pendingMatches.size > 0) {
      const matchedEntries: DocEntry[] = [];
      for (const [filePath] of pendingMatches) {
        const entry = registry.getEntries().find((e) => e.filePath === filePath);
        if (entry) matchedEntries.push(entry);
      }
      notifyInjection(ctx.ui, matchedEntries, pendingMatches);
    }
  });

  // ---- Event: before_agent_start (inject into system prompt) ----
  pi.on("before_agent_start", async (_event, _ctx) => {
    if (!enabled || !registry || pendingMatches.size === 0) return;

    const matchedEntries: DocEntry[] = [];
    for (const [filePath] of pendingMatches) {
      const entry = registry.getEntries().find((e) => e.filePath === filePath);
      if (entry) matchedEntries.push(entry);
    }

    if (matchedEntries.length === 0) {
      pendingMatches.clear();
      return;
    }

    // Check context budget before injecting
    const usage = _ctx.getContextUsage();
    if (usage && usage.tokens > 0 && usage.percentage && usage.percentage > 80) {
      console.warn("[doc-injector] Skipping injection: context usage > 80%");
      pendingMatches.clear();
      return;
    }

    const append = buildSystemPromptAppend(matchedEntries, pendingMatches);

    // Mark as injected only after confirming injection will happen
    for (const entry of matchedEntries) {
      entry.injected = true;
    }
    pendingMatches.clear();

    return {
      systemPrompt: (_event.systemPrompt || "") + "\n\n" + append,
    };
  });

  // ---- Commands ----
  registerCommands(pi, getRegistry, getEnabled, setEnabled);
}
