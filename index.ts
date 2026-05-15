/**
 * Doc Injector Extension for Pi
 *
 * Automatically injects relevant project documentation into the LLM context
 * by monitoring streaming output for keyword matches.
 *
 * ## Streaming Model
 *
 * This extension relies on Pi's streaming event contract:
 * - `message_update`: Fires with the FULL accumulated assistant content on each
 *   streaming chunk. The extension replaces (not appends to) its text buffer
 *   on each update.
 * - `message_end`: Fires once when the assistant's response is complete.
 *   The extension finalizes matches and notifies the user.
 * - `before_agent_start`: Fires before the next agent turn. The extension
 *   injects matched docs into the system prompt, then marks them as injected.
 *
 * ## Injection Lifecycle
 *
 * The `injected` flag is per-session: when `session_start` fires, the registry
 * is recreated from scratch (via initRegistry), resetting all flags. Within a
 * session, once a doc is injected, it won't be re-injected unless the user
 * manually runs `/doc-inject reset`.
 *
 * ## System Prompt Lifecycle (verified against pi v0.70.6)
 *
 * Pi **reconstructs the system prompt from source files each turn**. Here is
 * the exact flow, verified via source-code review of dist/core/agent-session.js
 * and dist/core/extensions/runner.js (v0.70.6):
 *
 * 1. Before each agent turn, pi calls `this._rebuildSystemPrompt(toolNames)`.
 *    This builds the prompt from `AGENTS.md`, `SYSTEM.md`, skills, enabled
 *    tool snippets — never from a previously modified (injected) prompt.
 * 2. The rebuilt prompt is stored in `this._baseSystemPrompt`.
 * 3. `emitBeforeAgentStart(..., this._baseSystemPrompt, ...)` passes this
 *    *fresh* base prompt to every extension handler.
 * 4. Extension handlers can return a modified `systemPrompt` for the current
 *    turn. Pi uses the modified prompt **only for this turn**.
 * 5. When no extension modifies the prompt, pi explicitly resets to
 *    `this._baseSystemPrompt` (comment in source: "Ensure we're using the
 *    base prompt (in case previous turn had modifications)").
 *
 * **Therefore**: Previous injections from `before_agent_start` do NOT persist
 * across turns. Duplicate sections cannot accumulate in the system prompt.
 * The `injected` flag alone is sufficient to prevent re-injection — no
 * marker-based stripping or deduplication is needed.
 *
 * ## Race Condition Note
 *
 * If `resources_discover` (rebuild) fires while `before_agent_start` is running,
 * `registry.entries` gets replaced. The `matchedEntries` array would hold stale
 * references. The current code is safe because `pendingMatches` (a Map by filePath)
 * is cleared after injection, and `markInjected()` operates on the registry's
 * current entries, not the stale array.
 */
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { resolve } from "node:path";
import { loadCache, saveCache } from "./cache";
import { loadConfig } from "./config";
import { buildSystemPromptAppend, notifyInjection } from "./injector";
import { buildKeywordGenPrompt } from "./keyword-llm";
import { extractText, KeywordMatcher } from "./matcher";
import { DocRegistry } from "./registry";
import { DEFAULT_MATCHER_OPTIONS, type DocEntry, type MatchResult, type KeywordCache, type CacheEntry } from "./types";
import { registerCommands } from "./commands";

export default async function docInjectorExtension(pi: ExtensionAPI) {
  // ---- State ----
  let config = await loadConfig(process.cwd());
  let registry: DocRegistry | null = null;
  let initRegistryPromise: Promise<void> | null = null;
  let enabled = true;
  let textBuffer = "";
  let pendingMatches = new Map<string, string[]>(); // filePath → matchedKeywords
  let abortingForInjection = false; // guard against cascading aborts

  // P5.4b — Guard flags for LLM keyword generation
  let keywordGenInFlight = false;
  let llmBatchesCompleted = 0;
  let llmTotalFiles = 0;
  let cache: KeywordCache = { version: 1, files: {} };

  // ---- Helpers ----
  const getRegistry = () => registry;
  const getEnabled = () => enabled;
  const setEnabled = (v: boolean) => {
    enabled = v;
  };
  const getConfig = () => config;

  const safeSaveCache = async (cwd: string, dirtyEntries: Record<string, CacheEntry>) => {
    // MAJOR-2 fix: before saveCache, re-read cache from disk to merge
    // LLM-written entries that may have landed during the scan.
    const freshCache = await loadCache(cwd);
    const mergedCache: KeywordCache = { version: 1, files: {} };

    // Start with fresh (disk) entries — includes any LLM writes during scan
    for (const [key, entry] of Object.entries(freshCache.files)) {
      mergedCache.files[key] = entry;
    }

    // Overlay dirty entries from this scan (scan results take precedence)
    for (const [key, entry] of Object.entries(dirtyEntries)) {
      mergedCache.files[key] = entry;
    }

    await saveCache(cwd, mergedCache);
  };

  const initRegistry = async (cwd: string) => {
    config = await loadConfig(cwd);
    const docsPath = resolve(cwd, config.docsPath);
    cache = await loadCache(cwd);
    registry = await DocRegistry.create(docsPath, config, cache);

    const dirty = registry.getDirtyCache();
    if (Object.keys(dirty).length > 0) {
      await safeSaveCache(cwd, dirty);
    }

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

  // P5.4f — generateKeywordsLLM: sets keywordGenInFlight and sends a user message
  // with the prompt built by buildKeywordGenPrompt. The LLM will respond by
  // calling the _doc_injector_keywords tool.
  const generateKeywordsLLM = async (
    files: Array<{ path: string; snippet: string; existingKeywords: string[] }>,
  ) => {
    keywordGenInFlight = true;
    const prompt = buildKeywordGenPrompt(files);
    pi.sendUserMessage(prompt, { deliverAs: "followUp" });
  };

  // P5.4a — Inline tool registration (BLOCKER-2 fix).
  // Registered inside the factory for closure access to cache, cwd, saveCache,
  // and llmBatchesCompleted. Uses real mtime from stat().
  pi.registerTool({
    name: "_doc_injector_keywords",
    label: "Doc Injector Keywords",
    description:
      "Save LLM-generated keywords for documentation files. Call this tool with the keywords array after analyzing file snippets.",
    parameters: Type.Object({
      keywords: Type.Array(
        Type.Object({
          path: Type.String(),
          keywords: Type.Array(Type.String()),
        }),
      ),
    }),
    execute: async (_id, params, _signal, _onUpdate, ctx) => {
      const generated = params.keywords as Array<{ path: string; keywords: string[] }>;
      const { stat } = await import("node:fs/promises");
      const { join } = await import("node:path");
      let saved = 0;
      for (const item of generated) {
        const absPath = join(ctx.cwd, item.path);
        const fileStat = await stat(absPath).catch(() => null);
        cache.files[item.path] = {
          mtimeMs: fileStat?.mtimeMs ?? Date.now(),
          keywords: item.keywords.map((k) => k.toLowerCase()).slice(0, 20),
        };
        saved++;
      }
      await saveCache(ctx.cwd, cache);
      llmBatchesCompleted++;
      llmTotalFiles += saved;
      return {
        content: [{ type: "text" as const, text: `Keywords saved for ${saved} files.` }],
        details: undefined as never,
      };
    },
  });

  // ---- Event: session_start ----
  // Pi emits session_start for startup, reload, and real session transitions.
  // Skip the reload variant because resources_discover will rebuild docs right
  // after it, and deduplicate any overlapping non-reload inits.
  pi.on("session_start", async (event, ctx) => {
    // P5.4d — Safety unbind: clear all LLM keyword gen state on session start
    keywordGenInFlight = false;
    llmBatchesCompleted = 0;
    llmTotalFiles = 0;

    if (event.reason === "reload") return;

    if (initRegistryPromise) {
      await initRegistryPromise;
      return;
    }

    initRegistryPromise = initRegistry(ctx.cwd);
    try {
      await initRegistryPromise;
    } finally {
      initRegistryPromise = null;
    }
  });

  const reloadRegistry = async (cwd?: string): Promise<number> => {
    if (!registry) throw new Error("No registry loaded");
    const effectiveCwd = cwd ?? process.cwd();

    // Reload cache from disk to pick up LLM-generated entries
    const freshCache = await loadCache(effectiveCwd);
    cache = freshCache;
    registry.updateCache(cache);

    await registry.rebuild();

    const dirty = registry.getDirtyCache();
    if (Object.keys(dirty).length > 0) {
      await safeSaveCache(effectiveCwd, dirty);
    }

    const count = registry.getEntries().length;
    console.log(`[doc-injector] Reloaded: ${count} documents`);
    return count;
  };

  // ---- Event: resources_discover (reload) ----
  pi.on("resources_discover", async (_event, ctx) => {
    await reloadRegistry(ctx.cwd);
  });

  // ---- Event: input (user message matching) ----
  // message_update only fires for assistant streaming messages, not user
  // messages. We use the input event instead to populate pendingMatches
  // BEFORE before_agent_start fires, so docs are injected in time for
  // the assistant's immediate response.
  pi.on("input", async (event, _ctx) => {
    // P5.4d — Safety unbind: if the user is typing interactively, clear all
    // LLM keyword gen state (they may have aborted the generation).
    if (event.source === "interactive") {
      keywordGenInFlight = false;
      llmBatchesCompleted = 0;
      llmTotalFiles = 0;
    }

    // P5.4b — Guard: skip keyword matching during LLM keyword generation
    if (keywordGenInFlight) return;

    if (!enabled || !registry) return;
    if (!event.text) return;

    const matcher = buildMatcher();
    if (!matcher) return;

    const results = matcher.match(event.text);
    for (const result of results) {
      pendingMatches.set(result.entry.filePath, result.matchedKeywords);
    }
  });

  // ---- Event: message_update (assistant streaming) ----
  // For assistant streaming messages: if we detect NEW keyword matches for
  // non-injected docs, abort the current generation and restart with the
  // injected context — no waiting for the next turn.
  pi.on("message_update", async (event, ctx) => {
    // P5.4b — Guard: skip auto-abort logic during LLM keyword generation
    if (keywordGenInFlight) return;

    if (!enabled || !registry) return;

    const msg = event.message;
    if (msg.role !== "assistant") return;

    const content = (msg as unknown as { content: unknown }).content;
    textBuffer = extractText(content);
    if (!textBuffer) return;

    const matcher = buildMatcher();
    if (!matcher) return;

    const results = matcher.match(textBuffer);

    let hasNew = false;
    for (const result of results) {
      if (!pendingMatches.has(result.entry.filePath)) {
        hasNew = true;
      }
      pendingMatches.set(result.entry.filePath, result.matchedKeywords);
    }

    if (hasNew && !ctx.isIdle() && !abortingForInjection) {
      abortingForInjection = true;
      ctx.abort();
    }
  });

  // ---- Event: message_end (finalize matches) ----
  // Notification moved to before_agent_start so it fires for both user-triggered
  // and auto-abort-triggered injections. message_end now just resets state.
  pi.on("message_end", async (event, _ctx) => {
    if (!enabled || !registry) return;
    const msg = event.message;
    if (msg.role !== "assistant") return;
    textBuffer = "";
  });

  // ---- Event: before_agent_start (inject into system prompt) ----
  pi.on("before_agent_start", async (event, ctx) => {
    // P5.4b — Guard: skip injection during LLM keyword generation
    if (keywordGenInFlight) return;

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

    // Skip injection if context usage exceeds the configured threshold
    // (default: 80%). This prevents doc injection from pushing the context
    // past the model's limit.
    const usage = ctx.getContextUsage();
    if (usage && usage.tokens && usage.tokens > 0 && usage.percent && usage.percent > config.contextThreshold) {
      console.warn(`[doc-injector] Skipping injection: context usage > ${config.contextThreshold}%`);
      pendingMatches.clear();
      return;
    }

    const append = buildSystemPromptAppend(matchedEntries, pendingMatches);

    // Mark as injected only after confirming injection will happen
    registry.markInjected(matchedEntries.map((e) => e.filePath));

    // Notify user about injection (moved here from message_end so it fires
    // even when matches come from user messages, which get cleared before
    // the assistant's message_end)
    notifyInjection(ctx.ui, matchedEntries, pendingMatches);

    pendingMatches.clear();

    return {
      systemPrompt: (event.systemPrompt || "") + "\n\n" + append,
    };
  });

  // ---- Event: agent_end (restart after auto-abort + LLM batch summary) ----
  pi.on("agent_end", async (event, ctx) => {
    // P5.4c — Summary notification from agent_end (BLOCKER-3)
    keywordGenInFlight = false;
    if (llmBatchesCompleted > 0) {
      await ctx.ui.notify(
        `Doc keywords: ${llmTotalFiles} files across ${llmBatchesCompleted} batch(es)`,
        "info",
      );
      llmBatchesCompleted = 0;
      llmTotalFiles = 0;
    }

    if (abortingForInjection) {
      abortingForInjection = false;
      // Send a follow-up message to restart the turn.
      // before_agent_start will inject the matched docs into context.
      pi.sendUserMessage("continue", { deliverAs: "followUp" });
    }
  });

  // ---- Commands ----
  registerCommands(pi, {
    getRegistry,
    getEnabled,
    setEnabled,
    reloadRegistry,
    getConfig,
    generateKeywordsLLM,
  });
}
