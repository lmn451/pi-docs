/**
 * Pi extension that selects project docs from user input or assistant text/thinking.
 * The default matcher uses docs/{name}.md; keyword matching is opt-in.
 * Simple assistant matches inject at the completed turn boundary, with at most
 * one doc-triggered continuation per user run. Keyword matches wait for the
 * next run. Neither path aborts or sends a synthetic user message.
 *
 * Injection uses CustomMessages from before_agent_start or turn_end drafts.
 * The system prompt is not changed.
 */
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { resolve } from "node:path";
import { loadCache, saveCache } from "./cache";
import { loadConfig } from "./config";
import { buildInjectionContent, notifyInjection } from "./injector";
import { buildKeywordGenPrompt } from "./keyword-llm";
import { extractText, extractTextBlocks, KeywordMatcher } from "./matcher";
import { ExtensionNotifier, type Notifier } from "./notifier";
import { DocRegistry } from "./registry";
import {
  LLM_CACHE_SENTINEL,
  type DocEntry,
  type KeywordCache,
  type CacheEntry,
  type MatcherOptions,
} from "./types";
import { registerCommands } from "./commands";

export default async function docInjectorExtension(pi: ExtensionAPI) {
  // ---- State ----
  // The notifier buffers warnings emitted during startup (loadConfig,
  // loadCache, initRegistry) and flushes them via ctx.ui.notify() in
  // session_start. The notifier is bound to the extension lifecycle so
  // startup messages aren't lost.
  const notifier: Notifier = new ExtensionNotifier();
  let config = await loadConfig(process.cwd(), notifier);
  let registry: DocRegistry | null = null;
  let initRegistryPromise: Promise<void> | null = null;
  let enabled = true;
  let continuedForDocs = false;
  let continuationLimitNotified = false;
  let pendingMatches = new Map<string, string[]>(); // filePath → matchedKeywords (docs that met the threshold)
  // filePath → distinct keywords seen so far in the CURRENT streaming message.
  // The streaming matcher scans only a rolling tail window each chunk, so a
  // keyword can scroll out of the window before another appears. Accumulating
  // the union here lets matchThreshold be met across chunks; reset at message_end.
  let streamHits = new Map<string, Set<string>>();

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

  const safeSaveCache = async (
    cwd: string,
    dirtyEntries: Record<string, CacheEntry>,
  ) => {
    // MAJOR-2 fix: before saveCache, re-read cache from disk to merge
    // LLM-written entries that may have landed during the scan.
    const freshCache = await loadCache(cwd, notifier);
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
    config = await loadConfig(cwd, notifier);
    const docsPath = resolve(cwd, config.docsPath);
    cache =
      config.mode === "keywords"
        ? await loadCache(cwd, notifier)
        : { version: 1, files: {} };
    registry = await DocRegistry.create(docsPath, config, cache, notifier);

    const dirty = registry.getDirtyCache();
    if (Object.keys(dirty).length > 0) {
      await safeSaveCache(cwd, dirty);
    }
  };

  const buildMatcher = (
    options?: Partial<MatcherOptions>,
  ): KeywordMatcher | null => {
    if (!registry) return null;
    return new KeywordMatcher(registry.getNonInjectedEntries(), {
      matchThreshold: config.mode === "simple" ? 1 : config.matchThreshold,
      ...options,
    });
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
      const generated = params.keywords as Array<{
        path: string;
        keywords: string[];
      }>;
      const { stat } = await import("node:fs/promises");
      let saved = 0;
      for (const item of generated) {
        // Only documents in the registry may receive generated keywords.
        const entry = registry
          ?.getEntries()
          .find((doc) => doc.relativePath === item.path);
        if (config.mode !== "keywords" || !entry) continue;
        const fileStat = await stat(entry.filePath).catch(() => null);
        if (!fileStat?.isFile()) continue;
        cache.files[item.path] = {
          mtimeMs: LLM_CACHE_SENTINEL,
          keywords: item.keywords.map((k) => k.toLowerCase()).slice(0, 20),
        };
        saved++;
      }
      if (saved > 0) await saveCache(ctx.cwd, cache);
      llmBatchesCompleted++;
      llmTotalFiles += saved;
      return {
        content: [
          { type: "text" as const, text: `Keywords saved for ${saved} files.` },
        ],
        details: undefined as never,
      };
    },
  });

  // ---- Event: session_start ----
  // Pi creates a fresh extension runtime on reload and session replacement.
  // Initialize on every session_start; deduplicate only concurrent calls.
  pi.on("session_start", async (_event, ctx) => {
    // P5.4d — Safety unbind: clear all LLM keyword gen state on session start
    keywordGenInFlight = false;
    llmBatchesCompleted = 0;
    llmTotalFiles = 0;
    pendingMatches.clear();
    streamHits.clear();
    continuedForDocs = false;
    continuationLimitNotified = false;

    // Bind the notifier to the live context FIRST so any warnings emitted
    // during initRegistry below go directly to the TUI instead of being
    // buffered. Messages buffered from earlier (e.g. the factory-body
    // loadConfig call) are flushed here in arrival order.
    notifier.setContext(ctx);

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

    if (config.mode === "keywords") {
      cache = await loadCache(effectiveCwd, notifier);
      registry.updateCache(cache);
    }

    await registry.rebuild();

    const dirty = registry.getDirtyCache();
    if (Object.keys(dirty).length > 0) {
      await safeSaveCache(effectiveCwd, dirty);
    }

    const count = registry.getEntries().length;
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

  // Keyword mode retains its streaming tail and distinct-keyword accumulation.
  // Simple mode scans only finalized blocks at turn_end, never chunk prefixes.
  pi.on("message_update", async (event, _ctx) => {
    if (keywordGenInFlight || config.mode !== "keywords") return;

    if (!enabled || !registry) return;

    const msg = event.message;
    if (msg.role !== "assistant") return;

    const content = (msg as unknown as { content: unknown }).content;
    const textBuffer = extractText(content);
    if (!textBuffer) return;

    // Discovery matcher: threshold 1 finds any keyword present in the rolling
    // tail window. The real matchThreshold is applied below against the
    // keywords accumulated across all chunks of this message.
    const matcher = buildMatcher({
      matchThreshold: 1,
      windowSize: config.streamWindowSize,
    });
    if (!matcher) return;

    const results = matcher.match(textBuffer);

    for (const result of results) {
      const filePath = result.entry.filePath;
      const seen = streamHits.get(filePath) ?? new Set<string>();
      for (const kw of result.matchedKeywords) seen.add(kw);
      streamHits.set(filePath, seen);

      if (seen.size >= config.matchThreshold && !pendingMatches.has(filePath)) {
        pendingMatches.set(filePath, [...seen]);
      }
    }
  });

  // Hits belong to one assistant message. Clear them after any message ends.
  pi.on("message_end", async () => {
    streamHits.clear();
  });

  const prepareInjection = (ctx: ExtensionContext) => {
    if (keywordGenInFlight) return;

    if (!enabled || !registry || pendingMatches.size === 0) return;

    const matchedEntries: DocEntry[] = [];
    for (const [filePath] of pendingMatches) {
      const entry = registry.getEntries().find((e) => e.filePath === filePath);
      if (entry && !entry.injected) matchedEntries.push(entry);
    }

    if (matchedEntries.length === 0) {
      pendingMatches.clear();
      return;
    }

    // Skip injection if context usage exceeds the configured threshold
    // (default: 80%). This prevents doc injection from pushing the context
    // past the model's limit.
    const usage = ctx.getContextUsage();
    if (
      usage &&
      usage.tokens &&
      usage.tokens > 0 &&
      usage.percent &&
      usage.percent > config.contextThreshold
    ) {
      pendingMatches.clear();
      ctx.ui.notify(
        `Doc injection skipped: context usage exceeds ${config.contextThreshold}%.`,
        "warning",
      );
      return;
    }

    const content = buildInjectionContent(matchedEntries, pendingMatches);

    notifyInjection(ctx.ui, matchedEntries, pendingMatches);

    // Pi exposes no post-commit callback for returned messages/drafts. Mark
    // only after preparation succeeds, immediately before proposing them.
    registry.markInjected(matchedEntries.map((e) => e.filePath));
    pendingMatches.clear();
    return content;
  };

  // Preserve user-input injection before the first provider request.
  pi.on("before_agent_start", async (event, ctx) => {
    // Low-level agent starts/retries must not replenish the continuation cap.
    if (event.messageType === "user") {
      continuedForDocs = false;
      continuationLimitNotified = false;
    }

    const content = prepareInjection(ctx);
    if (!content) return;

    return {
      message: {
        customType: "doc-injector",
        content,
        display: true,
      },
    };
  });

  pi.on("turn_end", async (event, ctx) => {
    if (
      config.mode !== "simple" ||
      keywordGenInFlight ||
      !enabled ||
      !registry ||
      event.outcome !== "completed" ||
      event.message.role !== "assistant"
    )
      return;

    // The assistant and tools are already persisted. Scan every completed
    // thinking/text block in full, independently, without a sliding window.
    const matcher = buildMatcher();
    if (!matcher) return;
    for (const block of extractTextBlocks(event.message.content)) {
      for (const result of matcher.match(block)) {
        pendingMatches.set(result.entry.filePath, result.matchedKeywords);
      }
    }
    if (pendingMatches.size === 0) return;

    if (continuedForDocs) {
      if (!continuationLimitNotified) {
        ctx.ui.notify(
          "Doc continuation limit reached; additional matching docs will wait for the next user run.",
          "info",
        );
        continuationLimitNotified = true;
      }
      return;
    }

    const content = prepareInjection(ctx);
    if (!content) return;
    continuedForDocs = true;
    return {
      entries: [
        ...event.entries,
        {
          type: "custom_message" as const,
          customType: "doc-injector",
          content: `${content}\nContinue the user's current task using these documents as reference.`,
          display: true,
        },
      ],
      // Natural tool/steering continuation satisfies this same next request.
      continue: true,
    };
  });

  // ---- Event: agent_end (LLM keyword batch summary) ----
  pi.on("agent_end", async (_event, ctx) => {
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
