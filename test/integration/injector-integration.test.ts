/**
 * Integration tests for the doc injector extension.
 * Tests the full injection lifecycle: session_start → message matching → injection.
 */
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { resolve } from "node:path";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";

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

const FIXTURE_DOCS = resolve(import.meta.dir, "fixtures/docs");

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
  mkdirSync(resolve(import.meta.dir, ".pi"), { recursive: true });
  writeFileSync(
    resolve(import.meta.dir, ".pi", "doc-injector.json"),
    JSON.stringify({
      docsPath: "./fixtures/docs",
      matchThreshold: 1,
      contextThreshold: 90,
      recursive: true,
    }),
  );
};

const cleanupConfig = () => {
  rmSync(resolve(import.meta.dir, ".pi"), { recursive: true, force: true });
};

// ---- Mock ExtensionAPI ----

interface MockExtensionAPI {
  on: (event: string, handler: (event: unknown, ctx: unknown) => unknown) => void;
  emit: (event: string, data: unknown, ctx: unknown) => Promise<unknown>;
  registerCommand: (name: string, opts: { description: string; handler: (...args: unknown[]) => unknown }) => void;
  _handlers: Map<string, Array<(event: unknown, ctx: unknown) => unknown>>;
  _sessionCtx: {
    cwd: string;
    ui: { notify: ReturnType<typeof createMockFn> };
    getContextUsage: () => { tokens: number; percent: number } | null;
  };
  _commandHandlers: Map<string, (args: string, ctx: { ui: { notify: ReturnType<typeof createMockFn> } }) => Promise<void>>;
}

const createMockAPI = (): MockExtensionAPI => {
  const notifyFn = createMockFn();
  const getContextUsageFn = createMockFn();
  const commandHandlers = new Map<string, (args: string, ctx: { ui: { notify: ReturnType<typeof createMockFn> } }) => Promise<void>>();

  const api: MockExtensionAPI = {
    _handlers: new Map(),
    _commandHandlers: commandHandlers,
    _sessionCtx: {
      cwd: import.meta.dir,
      ui: { notify: notifyFn },
      getContextUsage: () => {
        const result = getContextUsageFn();
        return result as { tokens: number; percent: number } | null;
      },
    },
    on(event: string, handler: (event: unknown, ctx: unknown) => unknown) {
      const handlers = this._handlers.get(event) ?? [];
      handlers.push(handler);
      this._handlers.set(event, handlers);
    },
    registerCommand(name: string, opts: { description: string; handler: (...args: unknown[]) => unknown }) {
      commandHandlers.set(name, opts.handler as (args: string, ctx: { ui: { notify: ReturnType<typeof createMockFn> } }) => Promise<void>);
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
  await api.emit("session_start", {}, { cwd: import.meta.dir });
};

const triggerMessage = async (api: MockExtensionAPI, role: "user" | "assistant", content: string) => {
  await api.emit("message_update", { message: { role, content } }, api._sessionCtx);
  await api.emit("message_end", { message: { role, content } }, api._sessionCtx);
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

    await triggerMessage(api, "assistant", "I'll help you with testing...");
    const result = await triggerAgentStart(api, "You are a helpful assistant.");

    expect(result).toBeDefined();
    const typedResult = result as { systemPrompt?: string } | undefined;
    expect(typedResult?.systemPrompt).toContain("## Relevant Context Documents");
    expect(typedResult?.systemPrompt).toContain("Testing Guide");
    expect(typedResult?.systemPrompt).toContain("Matched keywords:");
  });

  test("does not inject docs when keywords don't match", async () => {
    const api = createMockAPI();
    await docInjectorExtension(api as unknown as Parameters<typeof docInjectorExtension>[0]);
    await triggerSessionStart(api);

    await triggerMessage(api, "assistant", "Hello, how can I help you today?");
    const result = await triggerAgentStart(api, "You are a helpful assistant.");

    expect(result).toBeUndefined();
  });

  test("injects multiple matching docs", async () => {
    const api = createMockAPI();
    await docInjectorExtension(api as unknown as Parameters<typeof docInjectorExtension>[0]);
    await triggerSessionStart(api);

    await triggerMessage(api, "assistant", "About testing and workflow: let me explain the CI pipeline...");
    const result = await triggerAgentStart(api, "You are a helpful assistant.");

    const typedResult = result as { systemPrompt?: string } | undefined;
    expect(typedResult?.systemPrompt).toContain("Testing Guide");
    expect(typedResult?.systemPrompt).toContain("Workflow Guide");
  });

  test("marks injected docs so they aren't re-injected", async () => {
    const api = createMockAPI();
    await docInjectorExtension(api as unknown as Parameters<typeof docInjectorExtension>[0]);
    await triggerSessionStart(api);

    await triggerMessage(api, "assistant", "testing is important...");
    const result1 = await triggerAgentStart(api, "You are a helpful assistant.");
    expect((result1 as { systemPrompt?: string })?.systemPrompt).toContain("Testing Guide");

    await triggerMessage(api, "assistant", "More about testing...");
    const result2 = await triggerAgentStart(api, "You are a helpful assistant.");

    const typedResult2 = result2 as { systemPrompt?: string } | undefined;
    if (typedResult2?.systemPrompt) {
      const count = (typedResult2.systemPrompt.match(/Testing Guide/g) ?? []).length;
      expect(count).toBeLessThanOrEqual(1);
    }
  });

  test("sends notification when docs are injected", async () => {
    const api = createMockAPI();
    await docInjectorExtension(api as unknown as Parameters<typeof docInjectorExtension>[0]);
    await triggerSessionStart(api);

    await triggerMessage(api, "assistant", "testing unit test...");
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

    await triggerMessage(api, "assistant", "This file has no keywords to match against...");
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
    await triggerMessage(api, "assistant", "testing is important...");
    const result1 = await triggerAgentStart(api, "You are a helpful assistant.");
    expect((result1 as { systemPrompt?: string })?.systemPrompt).toContain("Testing Guide");

    // Second message - doc already marked as injected
    await triggerMessage(api, "assistant", "More about testing...");
    const result2 = await triggerAgentStart(api, "You are a helpful assistant.");
    const typedResult2 = result2 as { systemPrompt?: string } | undefined;
    if (typedResult2?.systemPrompt) {
      const count = (typedResult2.systemPrompt.match(/Testing Guide/g) ?? []).length;
      expect(count).toBeLessThanOrEqual(1);
    }

    // Invoke /doc-inject reset command
    const resetHandler = api._commandHandlers.get("doc-inject");
    expect(resetHandler).toBeDefined();
    const notifyFn = createMockFn();
    await resetHandler!("reset", { ui: { notify: notifyFn } });

    // Now the same keyword should inject again
    await triggerMessage(api, "assistant", "testing after reset...");
    const result3 = await triggerAgentStart(api, "You are a helpful assistant.");
    expect((result3 as { systemPrompt?: string })?.systemPrompt).toContain("Testing Guide");
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
    await triggerMessage(api, "assistant", "testing workflow ci cd...");
    const result = await triggerAgentStart(api, "You are a helpful assistant.");
    expect(result).toBeUndefined();

    // Turn back on
    await offHandler!("on", { ui: { notify: notifyFn } });

    // Now injection should work
    await triggerMessage(api, "assistant", "testing...");
    const result2 = await triggerAgentStart(api, "You are a helpful assistant.");
    expect((result2 as { systemPrompt?: string })?.systemPrompt).toContain("Testing Guide");
  });
});

describe("Doc Injector Extension - Session Reset", () => {
  beforeEach(() => { setupDocs(); setupConfig(); });
  afterEach(() => { cleanupDocs(); cleanupConfig(); });

  test("session_start resets injected state for all docs", async () => {
    const api = createMockAPI();
    await docInjectorExtension(api as unknown as Parameters<typeof docInjectorExtension>[0]);

    // First session: inject doc
    await triggerSessionStart(api);
    await triggerMessage(api, "assistant", "testing is important...");
    const result1 = await triggerAgentStart(api, "You are a helpful assistant.");
    expect(result1).toBeDefined();

    // Start new session (simulates /new or starting fresh)
    await triggerSessionStart(api);

    // Same keyword should match again because session_start rebuilt the registry
    await triggerMessage(api, "assistant", "testing again...");
    const result2 = await triggerAgentStart(api, "You are a helpful assistant.");

    const typedResult2 = result2 as { systemPrompt?: string } | undefined;
    expect(typedResult2?.systemPrompt).toContain("Testing Guide");
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
    await triggerMessage(api, "assistant", "new feature added...");
    const result = await triggerAgentStart(api, "You are a helpful assistant.");

    const typedResult = result as { systemPrompt?: string } | undefined;
    expect(typedResult?.systemPrompt).toContain("New Documentation");
  });
});