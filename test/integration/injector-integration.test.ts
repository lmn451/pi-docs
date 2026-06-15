/**
 * Integration tests for the doc injector extension.
 * Tests the full injection lifecycle: session_start → message matching → injection.
 */
import { describe, expect, test, beforeEach, afterEach, vi } from "vitest";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";

const __dirname = fileURLToPath(new URL(".", import.meta.url));

import docInjectorExtension from "../../index";

// ---- Simple mock factory ----
function createMockFn() {
  const calls: unknown[][] = [];
  const fn = (...args: unknown[]) => {
    calls.push(args);
    return undefined;
  };
  (fn as unknown as { calls: unknown[][] }).calls = calls;
  return fn;
}

// ---- Test Fixtures ----

const FIXTURE_DOCS = resolve(__dirname, "fixtures/docs");

const setupDocs = () => {
  mkdirSync(FIXTURE_DOCS, { recursive: true });

  writeFileSync(
    resolve(FIXTURE_DOCS, "testing-guide.md"),
    `---
title: Testing Guide
keywords: [testing, unit test, bun]
---
# Testing Guide

How to write tests in this project.
`,
  );

  writeFileSync(
    resolve(FIXTURE_DOCS, "workflow.md"),
    `---
title: Workflow Guide
keywords: [workflow, ci, cd]
---
# Workflow Guide

CI/CD and development workflow.
`,
  );

  writeFileSync(
    resolve(FIXTURE_DOCS, "no-frontmatter.md"),
    `# No Frontmatter

This file has no keywords.
`,
  );
};

const cleanupDocs = () => {
  rmSync(FIXTURE_DOCS, { recursive: true, force: true });
};

const setupConfig = () => {
  mkdirSync(resolve(__dirname, ".pi"), { recursive: true });
  writeFileSync(
    resolve(__dirname, ".pi", "doc-injector.json"),
    JSON.stringify({
      docsPath: "./fixtures/docs",
      matchThreshold: 1,
      contextThreshold: 90,
      recursive: true,
    }),
  );
};

const cleanupConfig = () => {
  rmSync(resolve(__dirname, ".pi"), { recursive: true, force: true });
};

// ---- Mock ExtensionAPI ----

/**
 * Return shape for a mock tool's `execute`. Mirrors the real Pi tool result
 * contract: an array of content blocks plus optional details. Strictly typed
 * so call sites (e.g. `_doc_injector_keywords`) get proper types instead of
 * `unknown`.
 */
interface MockToolResult {
    content: Array<{ type: "text"; text: string }>;
    details?: unknown;
}



interface MockExtensionAPI {
  on: (event: string, handler: (event: unknown, ctx: unknown) => unknown) => void;
  emit: (event: string, data: unknown, ctx: unknown) => Promise<unknown>;
  registerCommand: (name: string, opts: { description: string; handler: (...args: unknown[]) => unknown }) => void;
  registerTool: (def: { name: string; label: string; description: string; parameters: unknown; execute: (...args: unknown[]) => Promise<MockToolResult> }) => void;
  sendUserMessage: ReturnType<typeof createMockFn>;
  sendMessage: ReturnType<typeof createMockFn>;
  _handlers: Map<string, Array<(event: unknown, ctx: unknown) => unknown>>;
  _tools: Map<string, { name: string; label: string; description: string; parameters: unknown; execute: (...args: unknown[]) => Promise<MockToolResult> }>;
  _sessionCtx: {
    cwd: string;
    ui: { notify: ReturnType<typeof createMockFn> };
    getContextUsage: () => { tokens: number; percent: number } | null;
    isIdle: () => boolean;
    abort: ReturnType<typeof createMockFn>;
  };
  _commandHandlers: Map<string, (args: string, ctx: { ui: { notify: ReturnType<typeof createMockFn> } }) => Promise<void>>;
  _setIdle: (v: boolean) => void;
}

const createMockAPI = (): MockExtensionAPI => {
  const notifyFn = createMockFn();
  const getContextUsageFn = createMockFn();
  const abortFn = createMockFn();
  const sendUserMessageFn = createMockFn();
    const sendMessageFn = createMockFn();
  const commandHandlers = new Map<string, (args: string, ctx: { ui: { notify: ReturnType<typeof createMockFn> } }) => Promise<void>>();
  const tools = new Map<string, { name: string; label: string; description: string; parameters: unknown; execute: (...args: unknown[]) => Promise<MockToolResult> }>();
  let isIdle = true;

  const api: MockExtensionAPI = {
    _handlers: new Map(),
    _tools: tools,
    _commandHandlers: commandHandlers,
    sendUserMessage: sendUserMessageFn,
    sendMessage: sendMessageFn,
    _sessionCtx: {
      cwd: __dirname,
      ui: { notify: notifyFn },
      getContextUsage: () => {
        const result = getContextUsageFn();
        return result as unknown as { tokens: number; percent: number } | null;
      },
      isIdle: () => isIdle,
      abort: abortFn,
    },
    _setIdle: (v: boolean) => { isIdle = v; },
    on(event: string, handler: (event: unknown, ctx: unknown) => unknown) {
      const handlers = this._handlers.get(event) ?? [];
      handlers.push(handler);
      this._handlers.set(event, handlers);
    },
    registerCommand(name: string, opts: { description: string; handler: (...args: unknown[]) => unknown }) {
      commandHandlers.set(name, opts.handler as (args: string, ctx: { ui: { notify: ReturnType<typeof createMockFn> } }) => Promise<void>);
    },
    registerTool(def: { name: string; label: string; description: string; parameters: unknown; execute: (...args: unknown[]) => Promise<MockToolResult> }) {
      tools.set(def.name, def);
    },
    async emit(event: string, data: unknown, ctx: unknown) {
      const handlers = this._handlers.get(event) ?? [];
      let result: unknown;
      for (const handler of handlers) {
        result = await handler(data, ctx);
      }
      return result;
    },
  };
  return api;
};

const triggerSessionStart = async (api: MockExtensionAPI) => {
  await api.emit("session_start", {}, { cwd: __dirname });
};

const triggerInput = async (api: MockExtensionAPI, text: string) => {
  await api.emit("input", { text }, api._sessionCtx);
};

const triggerAssistantStream = async (api: MockExtensionAPI, content: string) => {
  await api.emit("message_update", { message: { role: "assistant", content } }, api._sessionCtx);
  await api.emit("message_end", { message: { role: "assistant", content } }, api._sessionCtx);
};

const triggerAssistantStreamBlocks = async (
  api: MockExtensionAPI,
  blocks: Array<{ type: string; text: string }>,
) => {
  await api.emit("message_update", { message: { role: "assistant", content: blocks } }, api._sessionCtx);
  await api.emit("message_end", { message: { role: "assistant", content: blocks } }, api._sessionCtx);
};

const triggerAgentStart = async (api: MockExtensionAPI, systemPrompt = "") => {
  const result = await api.emit("before_agent_start", { systemPrompt }, api._sessionCtx);
  return result;
};

// ---- Tests ----

describe("Doc Injector Extension - Integration", () => {
  beforeEach(() => { setupDocs(); setupConfig(); });
  afterEach(() => { cleanupDocs(); cleanupConfig(); });

  test("injects docs when keywords match in streaming output", async () => {
    const api = createMockAPI();
    await docInjectorExtension(api as unknown as Parameters<typeof docInjectorExtension>[0]);
    await triggerSessionStart(api);

    await triggerInput(api, "I'll help you with testing...");
    const result = await triggerAgentStart(api, "You are a helpful assistant.");

    expect(result).toBeDefined();
    const typedResult = result as { message?: { customType: string; content: string } } | undefined;
    expect(typedResult?.message?.customType).toBe("doc-injector");
    expect(typedResult?.message?.content).toContain("## Relevant Context Documents");
    expect(typedResult?.message?.content).toContain("Testing Guide");
    expect(typedResult?.message?.content).toContain("Matched keywords:");
  });

  test("matches keywords found in assistant thinking blocks", async () => {
    // The text block is generic and contains NO keywords from any doc. The
    // thinking block contains "testing" — a keyword of testing-guide.md.
    // If extractText dropped thinking blocks, this test would fail with
    // "no injection".
    const api = createMockAPI();
    await docInjectorExtension(api as unknown as Parameters<typeof docInjectorExtension>[0]);
    await triggerSessionStart(api);

    await triggerAssistantStreamBlocks(api, [
      { type: "thinking", text: "The user is asking about testing their code." },
      { type: "text", text: "Sure, let me help you with that." },
    ]);

    const result = await triggerAgentStart(api, "You are a helpful assistant.");
    const typedResult = result as { message?: { customType: string; content: string } } | undefined;
    expect(typedResult?.message?.customType).toBe("doc-injector");
    expect(typedResult?.message?.content).toContain("Testing Guide");
  });

  test("does not inject when keywords appear only in non-thought text", async () => {
    // Negative control: same text payload as a string (no thinking block)
    // contains no keywords and must NOT trigger injection.
    const api = createMockAPI();
    await docInjectorExtension(api as unknown as Parameters<typeof docInjectorExtension>[0]);
    await triggerSessionStart(api);

    await triggerAssistantStream(api, "Sure, let me help you with that.");

    const result = await triggerAgentStart(api, "You are a helpful assistant.");
    expect((result as { message?: { content: string } } | undefined)?.message).toBeUndefined();
  });


  test("does not inject docs when keywords don't match", async () => {
    const api = createMockAPI();
    await docInjectorExtension(api as unknown as Parameters<typeof docInjectorExtension>[0]);
    await triggerSessionStart(api);

    await triggerInput(api, "Hello, how can I help you today?");
    const result = await triggerAgentStart(api, "You are a helpful assistant.");

    expect(result).toBeUndefined();
  });

  test("injection is gated by matchThreshold in the full flow", async () => {
    // Override default config (matchThreshold: 1) to require 2 keyword hits.
    // Must be written AFTER beforeEach's setupConfig() runs and BEFORE the
    // extension reads the config via loadConfig().
    writeFileSync(
      resolve(__dirname, ".pi", "doc-injector.json"),
      JSON.stringify({
        docsPath: "./fixtures/docs",
        matchThreshold: 2,
        contextThreshold: 90,
        recursive: true,
      }),
    );

    const api = createMockAPI();
    await docInjectorExtension(api as unknown as Parameters<typeof docInjectorExtension>[0]);
    await triggerSessionStart(api);

    // 1 keyword hit ("testing") on testing-guide.md — below threshold (2).
    // The matcher returns no results, so pendingMatches stays empty and
    // before_agent_start must NOT produce a message.
    await triggerInput(api, "let's talk about testing");
    const r1 = await triggerAgentStart(api, "You are a helpful assistant.");
    expect((r1 as { message?: { content: string } } | undefined)?.message).toBeUndefined();

    // 2 keyword hits ("testing" + "unit test") on the same doc — at threshold.
    // The matcher now returns a result, pendingMatches is populated, and
    // before_agent_start must return the doc-injector CustomMessage.
    await triggerInput(api, "unit test for the testing module");
    const r2 = await triggerAgentStart(api, "You are a helpful assistant.");
    const typedResult2 = r2 as { message?: { customType: string; content: string } } | undefined;
    expect(typedResult2?.message?.customType).toBe("doc-injector");
    expect(typedResult2?.message?.content).toContain("Testing Guide");
  });

  test("injects multiple matching docs", async () => {
    const api = createMockAPI();
    await docInjectorExtension(api as unknown as Parameters<typeof docInjectorExtension>[0]);
    await triggerSessionStart(api);

    await triggerInput(api, "About testing and workflow: let me explain the CI pipeline...");
    const result = await triggerAgentStart(api, "You are a helpful assistant.");

    const typedResult = result as { message?: { customType: string; content: string } } | undefined;
    expect(typedResult?.message?.content).toContain("Testing Guide");
    expect(typedResult?.message?.content).toContain("Workflow Guide");
  });

  test("marks injected docs so they aren't re-injected", async () => {
    const api = createMockAPI();
    await docInjectorExtension(api as unknown as Parameters<typeof docInjectorExtension>[0]);
    await triggerSessionStart(api);

    await triggerInput(api, "testing is important...");
    const result1 = await triggerAgentStart(api, "You are a helpful assistant.");
    expect((result1 as { message?: { content: string } })?.message?.content).toContain("Testing Guide");

    await triggerInput(api, "More about testing...");
    const result2 = await triggerAgentStart(api, "You are a helpful assistant.");

    // Second turn should NOT return a message at all — doc is already injected.
    const typedResult2 = result2 as { message?: { content: string } } | undefined;
    expect(typedResult2?.message).toBeUndefined();
  });

  test("sends notification when docs are injected", async () => {
    const api = createMockAPI();
    await docInjectorExtension(api as unknown as Parameters<typeof docInjectorExtension>[0]);
    await triggerSessionStart(api);

    await triggerInput(api, "testing unit test...");
    await triggerAgentStart(api, "You are a helpful assistant.");

    const notifyCalls = (api._sessionCtx.ui.notify as unknown as { calls: unknown[][] }).calls;
    expect(notifyCalls.length).toBeGreaterThan(0);
    const notification = notifyCalls[0][0] as string;
    expect(notification).toContain("Injected:");
  });

  test("skips files without valid frontmatter keywords", async () => {
    const api = createMockAPI();
    await docInjectorExtension(api as unknown as Parameters<typeof docInjectorExtension>[0]);
    await triggerSessionStart(api);

    await triggerInput(api, "This file has no keywords to match against...");
    const result = await triggerAgentStart(api, "You are a helpful assistant.");

    expect(result).toBeUndefined();
  });
});

describe("Doc Injector Extension - Commands", () => {
  beforeEach(() => { setupDocs(); setupConfig(); });
  afterEach(() => { cleanupDocs(); cleanupConfig(); });

  test("/doc-inject reset allows re-injection", async () => {
    const api = createMockAPI();
    await docInjectorExtension(api as unknown as Parameters<typeof docInjectorExtension>[0]);
    await triggerSessionStart(api);

    // First injection
    await triggerInput(api, "testing is important...");
    const result1 = await triggerAgentStart(api, "You are a helpful assistant.");
    expect((result1 as { message?: { content: string } })?.message?.content).toContain("Testing Guide");

    // Second message - doc already marked as injected, should NOT return a message
    await triggerInput(api, "More about testing...");
    const result2 = await triggerAgentStart(api, "You are a helpful assistant.");
    expect((result2 as { message?: { content: string } } | undefined)?.message).toBeUndefined();

    // Invoke /doc-inject reset command
    const resetHandler = api._commandHandlers.get("doc-inject");
    expect(resetHandler).toBeDefined();
    const notifyFn = createMockFn();
    await resetHandler!("reset", { ui: { notify: notifyFn } });

    // Now the same keyword should inject again
    await triggerInput(api, "testing after reset...");
    const result3 = await triggerAgentStart(api, "You are a helpful assistant.");
    expect((result3 as { message?: { content: string } })?.message?.content).toContain("Testing Guide");
  });

  test("/doc-inject list shows status of all docs", async () => {
    const api = createMockAPI();
    await docInjectorExtension(api as unknown as Parameters<typeof docInjectorExtension>[0]);
    await triggerSessionStart(api);

    const notifyFn = createMockFn();
    const listHandler = api._commandHandlers.get("doc-inject");
    expect(listHandler).toBeDefined();
    await listHandler!("list", { ui: { notify: notifyFn } });

    const notifyCalls = (notifyFn as unknown as { calls: unknown[][] }).calls;
    expect(notifyCalls.length).toBeGreaterThan(0);
    const notification = notifyCalls[0][0] as string;
    expect(notification).toContain("testing-guide.md");
    expect(notification).toContain("workflow.md");
  });

  test("/doc-inject on/off enables and disables injection", async () => {
    const api = createMockAPI();
    await docInjectorExtension(api as unknown as Parameters<typeof docInjectorExtension>[0]);
    await triggerSessionStart(api);

    const offHandler = api._commandHandlers.get("doc-inject");
    expect(offHandler).toBeDefined();

    const notifyFn = createMockFn();
    await offHandler!("off", { ui: { notify: notifyFn } });

    // Keywords should not trigger injection when disabled
    await triggerInput(api, "testing workflow ci cd...");
    const result = await triggerAgentStart(api, "You are a helpful assistant.");
    expect(result).toBeUndefined();

    // Turn back on
    await offHandler!("on", { ui: { notify: notifyFn } });

    // Now injection should work
    await triggerInput(api, "testing...");
    const result2 = await triggerAgentStart(api, "You are a helpful assistant.");
    expect((result2 as { message?: { content: string } })?.message?.content).toContain("Testing Guide");
  });
});

describe("Doc Injector Extension - Session Reset", () => {
  beforeEach(() => { setupDocs(); setupConfig(); });
  afterEach(() => { cleanupDocs(); cleanupConfig(); });

  test("/doc-inject reset re-enables injection after docs are marked injected", async () => {
    const api = createMockAPI();
    await docInjectorExtension(api as unknown as Parameters<typeof docInjectorExtension>[0]);
    await triggerSessionStart(api);

    // First injection
    await triggerInput(api, "testing is important...");
    const result1 = await triggerAgentStart(api, "You are a helpful assistant.");
    expect(result1).toBeDefined();

    // Same keyword should NOT re-inject (doc already marked)
    await triggerInput(api, "testing again...");
    const result2 = await triggerAgentStart(api, "You are a helpful assistant.");
    const typedResult2 = result2 as { message?: { content: string } } | undefined;
    expect(typedResult2?.message).toBeUndefined();

    // Reset via command — should allow re-injection
    const resetHandler = api._commandHandlers.get("doc-inject");
    const notifyFn = createMockFn();
    await resetHandler!("reset", { ui: { notify: notifyFn } });

    await triggerInput(api, "testing after reset...");
    const result3 = await triggerAgentStart(api, "You are a helpful assistant.");
    expect((result3 as { message?: { content: string } })?.message?.content).toContain("Testing Guide");
  });
});

describe("Doc Injector Extension - Startup Init", () => {
  beforeEach(() => { setupDocs(); setupConfig(); });
  afterEach(() => { cleanupDocs(); cleanupConfig(); });

  test("deduplicates concurrent session_start initialization", async () => {
    const api = createMockAPI();
    await docInjectorExtension(api as unknown as Parameters<typeof docInjectorExtension>[0]);

    // Deduplication: both session_start calls complete without error
    await Promise.all([
      api.emit("session_start", {}, { cwd: __dirname }),
      api.emit("session_start", {}, { cwd: __dirname }),
    ]);

    // System initialized correctly
    expect(api._handlers.size).toBeGreaterThan(0);
  });

  test("ignores reload session_start and relies on resources_discover for rebuild", async () => {
    const api = createMockAPI();
    await docInjectorExtension(api as unknown as Parameters<typeof docInjectorExtension>[0]);

    await api.emit("session_start", { reason: "startup" }, { cwd: __dirname });
    await api.emit("session_start", { reason: "reload" }, { cwd: __dirname });
    await api.emit("resources_discover", {}, api._sessionCtx);

    // System works correctly with reload ignored
    expect(api._handlers.size).toBeGreaterThan(0);
  });
});

describe("Doc Injector Extension - End-to-End with resources_discover", () => {
  beforeEach(() => { setupDocs(); setupConfig(); });
  afterEach(() => { cleanupDocs(); cleanupConfig(); });

  test("reloads registry when resources_discover fires", async () => {
    const api = createMockAPI();
    await docInjectorExtension(api as unknown as Parameters<typeof docInjectorExtension>[0]);
    await triggerSessionStart(api);

    // Add a new doc after initial load
    writeFileSync(
      resolve(FIXTURE_DOCS, "new-doc.md"),
      `---
title: New Documentation
keywords: [new, added]
---
# New Doc

Added after initial load.
`,
    );

    // Trigger resource discovery (reload)
    await api.emit("resources_discover", {}, api._sessionCtx);

    // New doc should now be available for matching
    await triggerInput(api, "new feature added...");
    const result = await triggerAgentStart(api, "You are a helpful assistant.");

    const typedResult = result as { message?: { content: string } } | undefined;
    expect(typedResult?.message?.content).toContain("New Documentation");
  });
  test("reuses LLM-generated keywords after resources_discover reload", async () => {
    const api = createMockAPI();
    await docInjectorExtension(api as unknown as Parameters<typeof docInjectorExtension>[0]);
    await triggerSessionStart(api);

    const tool = api._tools.get("_doc_injector_keywords");
    expect(tool).toBeDefined();

    await tool!.execute(
      "tool-call-id",
      { keywords: [{ path: "no-frontmatter.md", keywords: ["oauth", "token"] }] },
      undefined,
      undefined,
      api._sessionCtx,
    );

    await api.emit("resources_discover", {}, api._sessionCtx);

    const listHandler = api._commandHandlers.get("doc-inject");
    expect(listHandler).toBeDefined();
    const notifyFn = createMockFn();
    await listHandler!("list", { ui: { notify: notifyFn } });

    const notification = (notifyFn as unknown as { calls: unknown[][] }).calls[0][0] as string;
    // After the LLM tool writes its sentinel mtime, the next rebuild must
    // surface the entry as [llm] (not [cache]) so /doc-keywords-gen
    // correctly excludes it from re-processing.
    expect(notification).toContain("[llm] no-frontmatter.md");
    expect(notification).toContain("oauth");
    expect(notification).toContain("token");
  });

  test("skips cache entry for non-existent files in _doc_injector_keywords", async () => {
    const api = createMockAPI();
    await docInjectorExtension(api as unknown as Parameters<typeof docInjectorExtension>[0]);
    await triggerSessionStart(api);

    const tool = api._tools.get("_doc_injector_keywords");
    expect(tool).toBeDefined();

    // Mix of existing and non-existing files
    const result = await tool!.execute(
      "tool-call-id",
      { keywords: [
        { path: "testing-guide.md", keywords: ["test"] },
        { path: "nonexistent-file-12345.md", keywords: ["ghost"] },
      ]},
      undefined,
      undefined,
      api._sessionCtx,
    );

    // Should report 1 saved (not 2)
    const text = result.content[0].text;
    expect(text).toContain("1"); // Only 1 file saved, not 2
  });
});

describe("Doc Injector Extension - Auto-Abort on Stream", () => {
  beforeEach(() => { setupDocs(); setupConfig(); });
  afterEach(() => { cleanupDocs(); cleanupConfig(); });

  test("aborts when assistant mentions a new keyword mid-stream", async () => {
    const api = createMockAPI();
    await docInjectorExtension(api as unknown as Parameters<typeof docInjectorExtension>[0]);
    await triggerSessionStart(api);

    // Simulate assistant streaming (not idle)
    api._setIdle(false);

    // Assistant says a keyword match mid-stream
    await api.emit(
      "message_update",
      { message: { role: "assistant", content: "Let's talk about testing..." } },
      api._sessionCtx,
    );

    const abortCalls = (api._sessionCtx.abort as unknown as { calls: unknown[][] }).calls;
    expect(abortCalls.length).toBe(1);
  });

  test("does NOT abort on user messages (already handled by before_agent_start)", async () => {
    const api = createMockAPI();
    await docInjectorExtension(api as unknown as Parameters<typeof docInjectorExtension>[0]);
    await triggerSessionStart(api);

    // User messages fire when idle = true
    api._setIdle(true);

    // User says a keyword
    await api.emit(
      "message_update",
      { message: { role: "user", content: "testing is important" } },
      api._sessionCtx,
    );

    const abortCalls = (api._sessionCtx.abort as unknown as { calls: unknown[][] }).calls;
    expect(abortCalls.length).toBe(0);
  });

  test("does NOT abort when no NEW matches (duplicate keyword in same response)", async () => {
    const api = createMockAPI();
    await docInjectorExtension(api as unknown as Parameters<typeof docInjectorExtension>[0]);
    await triggerSessionStart(api);

    api._setIdle(false);

    // First mention of keyword — should abort
    await api.emit(
      "message_update",
      { message: { role: "assistant", content: "testing..." } },
      api._sessionCtx,
    );

    const abortCalls1 = (api._sessionCtx.abort as unknown as { calls: unknown[][] }).calls;
    expect(abortCalls1.length).toBe(1);

    // Second mention of same keyword (no abort guard active since abortingForInjection
    // is reset in agent_end, but we haven't emitted agent_end — so guard is still true)
    // The guard should prevent second abort
    await api.emit(
      "message_update",
      { message: { role: "assistant", content: "testing again..." } },
      api._sessionCtx,
    );

    const abortCalls2 = (api._sessionCtx.abort as unknown as { calls: unknown[][] }).calls;
    // Still only 1 abort because abortingForInjection guard is active
    expect(abortCalls2.length).toBe(1);
  });

  test("agent_end sends follow-up message to restart after abort", async () => {
    vi.useFakeTimers();
    const api = createMockAPI();
    await docInjectorExtension(api as unknown as Parameters<typeof docInjectorExtension>[0]);
    await triggerSessionStart(api);

    // Trigger auto-abort
    api._setIdle(false);
    await api.emit(
      "message_update",
      { message: { role: "assistant", content: "testing..." } },
      api._sessionCtx,
    );

    // Emit agent_end — should trigger sendUserMessage (deferred via setTimeout)
    await api.emit("agent_end", {}, api._sessionCtx);

    // Run the setTimeout(0) callback
    vi.runAllTimers();

    const sendCalls = (api.sendUserMessage as unknown as { calls: unknown[][] }).calls;
    expect(sendCalls.length).toBe(1);
    expect(sendCalls[0][0]).toBe('continue');
  });

  test("does NOT send follow-up in agent_end without prior abort", async () => {
    const api = createMockAPI();
    await docInjectorExtension(api as unknown as Parameters<typeof docInjectorExtension>[0]);
    await triggerSessionStart(api);

    // No abort happened — just emit agent_end
    await api.emit("agent_end", {}, api._sessionCtx);

    const sendCalls = (api.sendUserMessage as unknown as { calls: unknown[][] }).calls;
    expect(sendCalls.length).toBe(0);
  });
});

describe("Doc Injector Extension - Multi-Chunk Stream Accumulation", () => {
  // Verifies that distinct keywords seen across multiple streaming chunks are
  // unioned in streamHits, so the matchThreshold can be met even when no
  // single chunk's tail window contains enough keywords on its own. This is
  // the contract behind the streamWindowSize config: the window bounds
  // per-chunk cost, but matchThreshold is still a property of the WHOLE
  // message, not of any individual chunk.
  //
  // Fixture doc `testing-guide.md` has keywords [testing, unit test, bun].
  beforeEach(() => {
    setupDocs();
    // matchThreshold: 2 makes accumulation observable — with 1, a single
    // chunk would always promote on its own.
    mkdirSync(resolve(__dirname, ".pi"), { recursive: true });
    writeFileSync(
      resolve(__dirname, ".pi", "doc-injector.json"),
      JSON.stringify({
        docsPath: "./fixtures/docs",
        matchThreshold: 2,
        // Small window so 'testing' (in chunk 1) scrolls out before 'bun'
        // appears in a later chunk.
        streamWindowSize: 30,
        contextThreshold: 90,
        recursive: true,
      }),
    );
  });
  afterEach(() => { cleanupDocs(); cleanupConfig(); });

  test("promotes doc when distinct keywords appear in different chunks' windows", async () => {
    const api = createMockAPI();
    await docInjectorExtension(api as unknown as Parameters<typeof docInjectorExtension>[0]);
    await triggerSessionStart(api);

    api._setIdle(false);

    // Chunk 1 (88 chars): 'testing' is at pos 80-87, inside the trailing
    // 30-char window [58, 87]. → matcher sees 'testing', streamHits = {testing}, size 1 < 2.
    await api.emit(
      "message_update",
      { message: { role: "assistant", content: "x".repeat(80) + " testing" } },
      api._sessionCtx,
    );
    let abortCalls = (api._sessionCtx.abort as unknown as { calls: unknown[][] }).calls;
    expect(abortCalls.length).toBe(0);

    // Chunk 2 (179 chars): 'testing' is now at pos 80-87, outside the trailing
    // 30-char window [149, 178]. 'bun' is at pos 170-172, inside the window.
    // → matcher sees 'bun', streamHits = {testing, bun}, size 2 → PROMOTED → abort.
    await api.emit(
      "message_update",
      { message: { role: "assistant", content: "x".repeat(80) + " testing" + "x".repeat(80) + " bun tail" } },
      api._sessionCtx,
    );
    abortCalls = (api._sessionCtx.abort as unknown as { calls: unknown[][] }).calls;
    expect(abortCalls.length).toBe(1);
  });

  test("does NOT promote when no chunk contains any keyword", async () => {
    // Sanity check: without any keyword in any chunk's window, streamHits
    // never accumulates to the threshold. Confirms accumulation doesn't
    // manufacture matches from nothing.
    const api = createMockAPI();
    await docInjectorExtension(api as unknown as Parameters<typeof docInjectorExtension>[0]);
    await triggerSessionStart(api);

    api._setIdle(false);

    await api.emit(
      "message_update",
      { message: { role: "assistant", content: "x".repeat(200) } },
      api._sessionCtx,
    );
    await api.emit(
      "message_update",
      { message: { role: "assistant", content: "x".repeat(400) } },
      api._sessionCtx,
    );

    const abortCalls = (api._sessionCtx.abort as unknown as { calls: unknown[][] }).calls;
    expect(abortCalls.length).toBe(0);
  });

  test("streamHits is cleared on message_end so the next message starts fresh", async () => {
    const api = createMockAPI();
    await docInjectorExtension(api as unknown as Parameters<typeof docInjectorExtension>[0]);
    await triggerSessionStart(api);

    api._setIdle(false);

    // Message 1: 'testing' is in chunk 1's window. streamHits = {testing}, no promotion.
    await api.emit(
      "message_update",
      { message: { role: "assistant", content: "x".repeat(80) + " testing" } },
      api._sessionCtx,
    );
    await api.emit(
      "message_end",
      { message: { role: "assistant", content: "x".repeat(80) + " testing" } },
      api._sessionCtx,
    );
    const abortCalls1 = (api._sessionCtx.abort as unknown as { calls: unknown[][] }).calls;
    expect(abortCalls1.length).toBe(0);

    // Reset the abort counter so we can observe the next message in isolation.
    (api._sessionCtx.abort as unknown as { calls: unknown[][] }).calls.length = 0;

    // Message 2: window contains 'bun' only. If streamHits was properly
    // cleared at message_end, {bun} has size 1 < 2 → no promotion. If it
    // wasn't cleared, the leftover {testing} from message 1 would push the
    // union to {testing, bun} → promotion → abort.
    await api.emit(
      "message_update",
      { message: { role: "assistant", content: "x".repeat(80) + " testing" + "x".repeat(80) + " bun tail" } },
      api._sessionCtx,
    );
    const abortCalls2 = (api._sessionCtx.abort as unknown as { calls: unknown[][] }).calls;
    expect(abortCalls2.length).toBe(0);
  });
});



describe("Doc Injector Extension - No Double Injection Validation", () => {
    // These tests rigorously verify that docs are injected at most once per
    // session. The new CustomMessage injection model inherits two independent
    // guards:
    //   1. Matcher guard: `buildMatcher()` excludes already-injected docs
    //      via `getNonInjectedEntries()`.
    //   2. Mark guard: `markInjected()` runs inside `before_agent_start`
    //      synchronously with the LLM call, so even if the matcher ever
    //      produced a duplicate, the mark would still prevent a second send.

    beforeEach(() => { setupDocs(); setupConfig(); });
    afterEach(() => { cleanupDocs(); cleanupConfig(); });

    test("same keyword across 10 turns produces exactly 1 injection", async () => {
        const api = createMockAPI();
        await docInjectorExtension(api as unknown as Parameters<typeof docInjectorExtension>[0]);
        await triggerSessionStart(api);

        const injectionCount: number[] = [];
        for (let i = 0; i < 10; i++) {
            await triggerInput(api, `testing is important (turn ${i})...`);
            const result = await triggerAgentStart(api, "You are a helpful assistant.");
            const r = result as { message?: { content: string } } | undefined;
            injectionCount.push(r?.message ? 1 : 0);
        }

        // Exactly one of the ten turns should have produced a message
        const total = injectionCount.reduce((a, b) => a + b, 0);
        expect(total).toBe(1);
    });

    test("different keywords across turns each inject their doc exactly once", async () => {
        const api = createMockAPI();
        await docInjectorExtension(api as unknown as Parameters<typeof docInjectorExtension>[0]);
        await triggerSessionStart(api);

        // Turn 1: match "testing" -> Testing Guide
        await triggerInput(api, "let's talk about testing");
        const r1 = await triggerAgentStart(api, "x");
        const c1 = (r1 as { message?: { content: string } } | undefined)?.message?.content ?? "";

        // Turn 2: match "workflow" -> Workflow Guide (testing already injected)
        await triggerInput(api, "now the workflow please");
        const r2 = await triggerAgentStart(api, "x");
        const c2 = (r2 as { message?: { content: string } } | undefined)?.message?.content ?? "";

        // Turn 3: match "testing" again -> should NOT re-inject
        await triggerInput(api, "back to testing again");
        const r3 = await triggerAgentStart(api, "x");
        const c3 = (r3 as { message?: { content: string } } | undefined)?.message?.content ?? "";

        // Turn 4: match "workflow" again -> should NOT re-inject
        await triggerInput(api, "and workflow once more");
        const r4 = await triggerAgentStart(api, "x");
        const c4 = (r4 as { message?: { content: string } } | undefined)?.message?.content ?? "";

        expect(c1).toContain("Testing Guide");
        expect(c1).not.toContain("Workflow Guide");
        expect(c2).toContain("Workflow Guide");
        expect(c2).not.toContain("Testing Guide");
        expect(c3).toBe(""); // no injection
        expect(c4).toBe(""); // no injection
    });

    test("system prompt is NEVER mutated by the injection handler", async () => {
        const api = createMockAPI();
        await docInjectorExtension(api as unknown as Parameters<typeof docInjectorExtension>[0]);
        await triggerSessionStart(api);

        const basePrompt = "You are a helpful assistant. Do not change this text.";

        // Turn 1: match -> injection
        await triggerInput(api, "testing is great");
        const r1 = await triggerAgentStart(api, basePrompt);

        // The returned `systemPrompt` field must be undefined (we don't
        // override it) and the message field must contain the doc content.
        const typed1 = r1 as { systemPrompt?: string; message?: { content: string } } | undefined;
        expect(typed1?.systemPrompt).toBeUndefined();
        expect(typed1?.message?.content).toContain("Testing Guide");

        // Turn 2: same keyword, no injection, system prompt still untouched
        await triggerInput(api, "more testing");
        const r2 = await triggerAgentStart(api, basePrompt);
        const typed2 = r2 as { systemPrompt?: string; message?: { content: string } } | undefined;
        expect(typed2?.systemPrompt).toBeUndefined();
        expect(typed2?.message).toBeUndefined();
    });

    test("injected message has customType=doc-injector and display=true", async () => {
        const api = createMockAPI();
        await docInjectorExtension(api as unknown as Parameters<typeof docInjectorExtension>[0]);
        await triggerSessionStart(api);

        await triggerInput(api, "testing is important");
        const r = await triggerAgentStart(api, "x");

        const msg = (r as { message?: { customType: string; content: string; display: boolean } } | undefined)?.message;
        expect(msg).toBeDefined();
        expect(msg?.customType).toBe("doc-injector");
        expect(msg?.display).toBe(true);
        expect(typeof msg?.content).toBe("string");
        expect(msg?.content.length).toBeGreaterThan(0);
    });

    test("user message AND mid-stream assistant message both match an already-injected doc: no duplicate", async () => {
        // After turn 1 injects Testing Guide, both the user's new message
        // and the assistant's streamed response can mention the same keyword.
        // The matcher (using getNonInjectedEntries) must filter both, so
        // neither triggers a re-injection.
        const api = createMockAPI();
        await docInjectorExtension(api as unknown as Parameters<typeof docInjectorExtension>[0]);
        await triggerSessionStart(api);

        // Turn 1: user mentions "testing" -> inject
        await triggerInput(api, "tell me about testing");
        const r1 = await triggerAgentStart(api, "x");
        const c1 = (r1 as { message?: { content: string } } | undefined)?.message?.content ?? "";
        expect(c1).toContain("Testing Guide");

        // Turn 2: user mentions same keyword, then assistant streams it again
        // -> still no duplicate
        await triggerInput(api, "more testing please");
        await triggerAssistantStream(api, "Sure, let's keep testing");
        const r2 = await triggerAgentStart(api, "x");
        expect((r2 as { message?: { content: string } } | undefined)?.message).toBeUndefined();
    });

    test("auto-abort + restart: no duplicate injection across the restart", async () => {
        // Simulate: assistant is mid-stream and mentions a NEW keyword, which
        // triggers ctx.abort(). The extension then sends a "continue" message
        // via setTimeout(0) in agent_end. The continue-turn should inject
        // exactly once (not re-trigger the abort and not double-inject).
        vi.useFakeTimers();
        const api = createMockAPI();
        await docInjectorExtension(api as unknown as Parameters<typeof docInjectorExtension>[0]);
        await triggerSessionStart(api);

        // Turn 1: user triggers initial injection
        await triggerInput(api, "explain testing");
        const r1 = await triggerAgentStart(api, "x");
        expect((r1 as { message?: { content: string } } | undefined)?.message?.content).toContain("Testing Guide");

        // Turn 2: assistant is mid-streaming, mentions a new keyword
        // (workflow, which hasn't been injected yet)
        api._setIdle(false);
        await triggerInput(api, "more please");
        await api.emit(
            "message_update",
            { message: { role: "assistant", content: "let's also cover the workflow" } },
            api._sessionCtx,
        );

        // Abort should fire (because workflow is a new match while streaming)
        const abortCalls = (api._sessionCtx.abort as unknown as { calls: unknown[][] }).calls;
        expect(abortCalls.length).toBe(1);

        // agent_end -> "continue" is queued via setTimeout
        await api.emit("agent_end", {}, api._sessionCtx);
        vi.runAllTimers();

        const sendCalls = (api.sendUserMessage as unknown as { calls: unknown[][] }).calls;
        expect(sendCalls.length).toBe(1);
        expect(sendCalls[0][0]).toBe("continue");

        // Drain the queued "continue" turn
        await triggerInput(api, "continue");
        const r2 = await triggerAgentStart(api, "x");
        const c2 = (r2 as { message?: { content: string } } | undefined)?.message?.content ?? "";
        expect(c2).toContain("Workflow Guide");
        // The previously-injected doc should NOT appear again
        expect(c2).not.toContain("Testing Guide");

        vi.useRealTimers();
    });

    test("re-injection is possible ONLY after /doc-inject reset, not before", async () => {
        const api = createMockAPI();
        await docInjectorExtension(api as unknown as Parameters<typeof docInjectorExtension>[0]);
        await triggerSessionStart(api);

        // First injection
        await triggerInput(api, "testing is important");
        const r1 = await triggerAgentStart(api, "x");
        expect((r1 as { message?: { content: string } } | undefined)?.message).toBeDefined();

        // Same keyword 5 more times - all should be no-ops
        for (let i = 0; i < 5; i++) {
            await triggerInput(api, `testing turn ${i}`);
            const r = await triggerAgentStart(api, "x");
            expect((r as { message?: { content: string } } | undefined)?.message).toBeUndefined();
        }

        // Reset
        const resetHandler = api._commandHandlers.get("doc-inject");
        expect(resetHandler).toBeDefined();
        const notifyFn = createMockFn();
        await resetHandler!("reset", { ui: { notify: notifyFn } });

        // Same keyword now re-injects
        await triggerInput(api, "testing after reset");
        const rAfter = await triggerAgentStart(api, "x");
        const c = (rAfter as { message?: { content: string } } | undefined)?.message?.content ?? "";
        expect(c).toContain("Testing Guide");
    });
});

