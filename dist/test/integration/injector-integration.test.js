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
    const calls = [];
    const fn = (...args) => {
        calls.push(args);
        return undefined;
    };
    fn.calls = calls;
    return fn;
}
// ---- Test Fixtures ----
const FIXTURE_DOCS = resolve(__dirname, "fixtures/docs");
const setupDocs = () => {
    mkdirSync(FIXTURE_DOCS, { recursive: true });
    writeFileSync(resolve(FIXTURE_DOCS, "testing-guide.md"), `---
title: Testing Guide
keywords: [testing, unit test, bun]
---
# Testing Guide

How to write tests in this project.
`);
    writeFileSync(resolve(FIXTURE_DOCS, "workflow.md"), `---
title: Workflow Guide
keywords: [workflow, ci, cd]
---
# Workflow Guide

CI/CD and development workflow.
`);
    writeFileSync(resolve(FIXTURE_DOCS, "no-frontmatter.md"), `# No Frontmatter

This file has no keywords.
`);
};
const cleanupDocs = () => {
    rmSync(FIXTURE_DOCS, { recursive: true, force: true });
};
const setupConfig = () => {
    mkdirSync(resolve(__dirname, ".pi"), { recursive: true });
    writeFileSync(resolve(__dirname, ".pi", "doc-injector.json"), JSON.stringify({
        docsPath: "./fixtures/docs",
        matchThreshold: 1,
        contextThreshold: 90,
        recursive: true,
    }));
};
const cleanupConfig = () => {
    rmSync(resolve(__dirname, ".pi"), { recursive: true, force: true });
};
const createMockAPI = () => {
    const notifyFn = createMockFn();
    const getContextUsageFn = createMockFn();
    const abortFn = createMockFn();
    const sendUserMessageFn = createMockFn();
    const sendMessageFn = createMockFn();
    const commandHandlers = new Map();
    const tools = new Map();
    let isIdle = true;
    const api = {
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
                return result;
            },
            isIdle: () => isIdle,
            abort: abortFn,
        },
        _setIdle: (v) => { isIdle = v; },
        on(event, handler) {
            const handlers = this._handlers.get(event) ?? [];
            handlers.push(handler);
            this._handlers.set(event, handlers);
        },
        registerCommand(name, opts) {
            commandHandlers.set(name, opts.handler);
        },
        registerTool(def) {
            tools.set(def.name, def);
        },
        async emit(event, data, ctx) {
            const handlers = this._handlers.get(event) ?? [];
            let result;
            for (const handler of handlers) {
                result = await handler(data, ctx);
            }
            return result;
        },
    };
    return api;
};
const triggerSessionStart = async (api) => {
    await api.emit("session_start", {}, { cwd: __dirname });
};
const triggerInput = async (api, text) => {
    await api.emit("input", { text }, api._sessionCtx);
};
const triggerAssistantStream = async (api, content) => {
    await api.emit("message_update", { message: { role: "assistant", content } }, api._sessionCtx);
    await api.emit("message_end", { message: { role: "assistant", content } }, api._sessionCtx);
};
const triggerAgentStart = async (api, systemPrompt = "") => {
    const result = await api.emit("before_agent_start", { systemPrompt }, api._sessionCtx);
    return result;
};
// ---- Tests ----
describe("Doc Injector Extension - Integration", () => {
    beforeEach(() => { setupDocs(); setupConfig(); });
    afterEach(() => { cleanupDocs(); cleanupConfig(); });
    test("injects docs when keywords match in streaming output", async () => {
        const api = createMockAPI();
        await docInjectorExtension(api);
        await triggerSessionStart(api);
        await triggerInput(api, "I'll help you with testing...");
        const result = await triggerAgentStart(api, "You are a helpful assistant.");
        expect(result).toBeDefined();
        const typedResult = result;
        expect(typedResult?.systemPrompt).toContain("## Relevant Context Documents");
        expect(typedResult?.systemPrompt).toContain("Testing Guide");
        expect(typedResult?.systemPrompt).toContain("Matched keywords:");
    });
    test("does not inject docs when keywords don't match", async () => {
        const api = createMockAPI();
        await docInjectorExtension(api);
        await triggerSessionStart(api);
        await triggerInput(api, "Hello, how can I help you today?");
        const result = await triggerAgentStart(api, "You are a helpful assistant.");
        expect(result).toBeUndefined();
    });
    test("injects multiple matching docs", async () => {
        const api = createMockAPI();
        await docInjectorExtension(api);
        await triggerSessionStart(api);
        await triggerInput(api, "About testing and workflow: let me explain the CI pipeline...");
        const result = await triggerAgentStart(api, "You are a helpful assistant.");
        const typedResult = result;
        expect(typedResult?.systemPrompt).toContain("Testing Guide");
        expect(typedResult?.systemPrompt).toContain("Workflow Guide");
    });
    test("marks injected docs so they aren't re-injected", async () => {
        const api = createMockAPI();
        await docInjectorExtension(api);
        await triggerSessionStart(api);
        await triggerInput(api, "testing is important...");
        const result1 = await triggerAgentStart(api, "You are a helpful assistant.");
        expect(result1?.systemPrompt).toContain("Testing Guide");
        await triggerInput(api, "More about testing...");
        const result2 = await triggerAgentStart(api, "You are a helpful assistant.");
        const typedResult2 = result2;
        if (typedResult2?.systemPrompt) {
            const count = (typedResult2.systemPrompt.match(/Testing Guide/g) ?? []).length;
            expect(count).toBeLessThanOrEqual(1);
        }
    });
    test("sends notification when docs are injected", async () => {
        const api = createMockAPI();
        await docInjectorExtension(api);
        await triggerSessionStart(api);
        await triggerInput(api, "testing unit test...");
        await triggerAgentStart(api, "You are a helpful assistant.");
        const notifyCalls = api._sessionCtx.ui.notify.calls;
        expect(notifyCalls.length).toBeGreaterThan(0);
        const notification = notifyCalls[0][0];
        expect(notification).toContain("Injected:");
    });
    test("skips files without valid frontmatter keywords", async () => {
        const api = createMockAPI();
        await docInjectorExtension(api);
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
        await docInjectorExtension(api);
        await triggerSessionStart(api);
        // First injection
        await triggerInput(api, "testing is important...");
        const result1 = await triggerAgentStart(api, "You are a helpful assistant.");
        expect(result1?.systemPrompt).toContain("Testing Guide");
        // Second message - doc already marked as injected
        await triggerInput(api, "More about testing...");
        const result2 = await triggerAgentStart(api, "You are a helpful assistant.");
        const typedResult2 = result2;
        if (typedResult2?.systemPrompt) {
            const count = (typedResult2.systemPrompt.match(/Testing Guide/g) ?? []).length;
            expect(count).toBeLessThanOrEqual(1);
        }
        // Invoke /doc-inject reset command
        const resetHandler = api._commandHandlers.get("doc-inject");
        expect(resetHandler).toBeDefined();
        const notifyFn = createMockFn();
        await resetHandler("reset", { ui: { notify: notifyFn } });
        // Now the same keyword should inject again
        await triggerInput(api, "testing after reset...");
        const result3 = await triggerAgentStart(api, "You are a helpful assistant.");
        expect(result3?.systemPrompt).toContain("Testing Guide");
    });
    test("/doc-inject list shows status of all docs", async () => {
        const api = createMockAPI();
        await docInjectorExtension(api);
        await triggerSessionStart(api);
        const notifyFn = createMockFn();
        const listHandler = api._commandHandlers.get("doc-inject");
        expect(listHandler).toBeDefined();
        await listHandler("list", { ui: { notify: notifyFn } });
        const notifyCalls = notifyFn.calls;
        expect(notifyCalls.length).toBeGreaterThan(0);
        const notification = notifyCalls[0][0];
        expect(notification).toContain("testing-guide.md");
        expect(notification).toContain("workflow.md");
    });
    test("/doc-inject on/off enables and disables injection", async () => {
        const api = createMockAPI();
        await docInjectorExtension(api);
        await triggerSessionStart(api);
        const offHandler = api._commandHandlers.get("doc-inject");
        expect(offHandler).toBeDefined();
        const notifyFn = createMockFn();
        await offHandler("off", { ui: { notify: notifyFn } });
        // Keywords should not trigger injection when disabled
        await triggerInput(api, "testing workflow ci cd...");
        const result = await triggerAgentStart(api, "You are a helpful assistant.");
        expect(result).toBeUndefined();
        // Turn back on
        await offHandler("on", { ui: { notify: notifyFn } });
        // Now injection should work
        await triggerInput(api, "testing...");
        const result2 = await triggerAgentStart(api, "You are a helpful assistant.");
        expect(result2?.systemPrompt).toContain("Testing Guide");
    });
});
describe("Doc Injector Extension - Session Reset", () => {
    beforeEach(() => { setupDocs(); setupConfig(); });
    afterEach(() => { cleanupDocs(); cleanupConfig(); });
    test("/doc-inject reset re-enables injection after docs are marked injected", async () => {
        const api = createMockAPI();
        await docInjectorExtension(api);
        await triggerSessionStart(api);
        // First injection
        await triggerInput(api, "testing is important...");
        const result1 = await triggerAgentStart(api, "You are a helpful assistant.");
        expect(result1).toBeDefined();
        // Same keyword should NOT re-inject (doc already marked)
        await triggerInput(api, "testing again...");
        const result2 = await triggerAgentStart(api, "You are a helpful assistant.");
        const typedResult2 = result2;
        if (typedResult2?.systemPrompt) {
            const count = (typedResult2.systemPrompt.match(/Testing Guide/g) ?? []).length;
            expect(count).toBeLessThanOrEqual(1);
        }
        // Reset via command — should allow re-injection
        const resetHandler = api._commandHandlers.get("doc-inject");
        const notifyFn = createMockFn();
        await resetHandler("reset", { ui: { notify: notifyFn } });
        await triggerInput(api, "testing after reset...");
        const result3 = await triggerAgentStart(api, "You are a helpful assistant.");
        expect(result3?.systemPrompt).toContain("Testing Guide");
    });
});
describe("Doc Injector Extension - Startup Init", () => {
    beforeEach(() => { setupDocs(); setupConfig(); });
    afterEach(() => { cleanupDocs(); cleanupConfig(); });
    test("deduplicates concurrent session_start initialization", async () => {
        const api = createMockAPI();
        const logSpy = vi.spyOn(console, "log").mockImplementation(() => { });
        try {
            await docInjectorExtension(api);
            await Promise.all([
                api.emit("session_start", {}, { cwd: __dirname }),
                api.emit("session_start", {}, { cwd: __dirname }),
            ]);
            const loadLogs = logSpy.mock.calls.filter(([message]) => typeof message === "string" && message.includes("[doc-injector] Loaded"));
            expect(loadLogs).toHaveLength(1);
        }
        finally {
            logSpy.mockRestore();
        }
    });
    test("ignores reload session_start and relies on resources_discover for rebuild", async () => {
        const api = createMockAPI();
        const logSpy = vi.spyOn(console, "log").mockImplementation(() => { });
        try {
            await docInjectorExtension(api);
            await api.emit("session_start", { reason: "startup" }, { cwd: __dirname });
            await api.emit("session_start", { reason: "reload" }, { cwd: __dirname });
            await api.emit("resources_discover", {}, api._sessionCtx);
            const loadLogs = logSpy.mock.calls.filter(([message]) => typeof message === "string" && message.includes("[doc-injector] Loaded"));
            const reloadLogs = logSpy.mock.calls.filter(([message]) => typeof message === "string" && message.includes("[doc-injector] Reloaded"));
            expect(loadLogs).toHaveLength(1);
            expect(reloadLogs).toHaveLength(1);
        }
        finally {
            logSpy.mockRestore();
        }
    });
});
describe("Doc Injector Extension - End-to-End with resources_discover", () => {
    beforeEach(() => { setupDocs(); setupConfig(); });
    afterEach(() => { cleanupDocs(); cleanupConfig(); });
    test("reloads registry when resources_discover fires", async () => {
        const api = createMockAPI();
        await docInjectorExtension(api);
        await triggerSessionStart(api);
        // Add a new doc after initial load
        writeFileSync(resolve(FIXTURE_DOCS, "new-doc.md"), `---
title: New Documentation
keywords: [new, added]
---
# New Doc

Added after initial load.
`);
        // Trigger resource discovery (reload)
        await api.emit("resources_discover", {}, api._sessionCtx);
        // New doc should now be available for matching
        await triggerInput(api, "new feature added...");
        const result = await triggerAgentStart(api, "You are a helpful assistant.");
        const typedResult = result;
        expect(typedResult?.systemPrompt).toContain("New Documentation");
    });
    test("reuses LLM-generated keywords after resources_discover reload", async () => {
        const api = createMockAPI();
        await docInjectorExtension(api);
        await triggerSessionStart(api);
        const tool = api._tools.get("_doc_injector_keywords");
        expect(tool).toBeDefined();
        await tool.execute("tool-call-id", { keywords: [{ path: "no-frontmatter.md", keywords: ["oauth", "token"] }] }, undefined, undefined, api._sessionCtx);
        await api.emit("resources_discover", {}, api._sessionCtx);
        const listHandler = api._commandHandlers.get("doc-inject");
        expect(listHandler).toBeDefined();
        const notifyFn = createMockFn();
        await listHandler("list", { ui: { notify: notifyFn } });
        const notification = notifyFn.calls[0][0];
        expect(notification).toContain("[cache] no-frontmatter.md");
        expect(notification).toContain("oauth");
        expect(notification).toContain("token");
    });
    test("skips cache entry for non-existent files in _doc_injector_keywords", async () => {
        const api = createMockAPI();
        await docInjectorExtension(api);
        await triggerSessionStart(api);
        const tool = api._tools.get("_doc_injector_keywords");
        expect(tool).toBeDefined();
        // Mix of existing and non-existing files
        const result = await tool.execute("tool-call-id", { keywords: [
                { path: "testing-guide.md", keywords: ["test"] },
                { path: "nonexistent-file-12345.md", keywords: ["ghost"] },
            ] }, undefined, undefined, api._sessionCtx);
        // Should report 1 saved (not 2)
        const resultTyped = result;
        const text = resultTyped.content[0].text;
        expect(text).toContain("1"); // Only 1 file saved, not 2
    });
});
describe("Doc Injector Extension - Auto-Abort on Stream", () => {
    beforeEach(() => { setupDocs(); setupConfig(); });
    afterEach(() => { cleanupDocs(); cleanupConfig(); });
    test("aborts when assistant mentions a new keyword mid-stream", async () => {
        const api = createMockAPI();
        await docInjectorExtension(api);
        await triggerSessionStart(api);
        // Simulate assistant streaming (not idle)
        api._setIdle(false);
        // Assistant says a keyword match mid-stream
        await api.emit("message_update", { message: { role: "assistant", content: "Let's talk about testing..." } }, api._sessionCtx);
        const abortCalls = api._sessionCtx.abort.calls;
        expect(abortCalls.length).toBe(1);
    });
    test("does NOT abort on user messages (already handled by before_agent_start)", async () => {
        const api = createMockAPI();
        await docInjectorExtension(api);
        await triggerSessionStart(api);
        // User messages fire when idle = true
        api._setIdle(true);
        // User says a keyword
        await api.emit("message_update", { message: { role: "user", content: "testing is important" } }, api._sessionCtx);
        const abortCalls = api._sessionCtx.abort.calls;
        expect(abortCalls.length).toBe(0);
    });
    test("does NOT abort when no NEW matches (duplicate keyword in same response)", async () => {
        const api = createMockAPI();
        await docInjectorExtension(api);
        await triggerSessionStart(api);
        api._setIdle(false);
        // First mention of keyword — should abort
        await api.emit("message_update", { message: { role: "assistant", content: "testing..." } }, api._sessionCtx);
        const abortCalls1 = api._sessionCtx.abort.calls;
        expect(abortCalls1.length).toBe(1);
        // Second mention of same keyword (no abort guard active since abortingForInjection
        // is reset in agent_end, but we haven't emitted agent_end — so guard is still true)
        // The guard should prevent second abort
        await api.emit("message_update", { message: { role: "assistant", content: "testing again..." } }, api._sessionCtx);
        const abortCalls2 = api._sessionCtx.abort.calls;
        // Still only 1 abort because abortingForInjection guard is active
        expect(abortCalls2.length).toBe(1);
    });
    test("agent_end sends follow-up message to restart after abort", async () => {
        vi.useFakeTimers();
        const api = createMockAPI();
        await docInjectorExtension(api);
        await triggerSessionStart(api);
        // Trigger auto-abort
        api._setIdle(false);
        await api.emit("message_update", { message: { role: "assistant", content: "testing..." } }, api._sessionCtx);
        // Emit agent_end — should trigger sendUserMessage (deferred via setTimeout)
        await api.emit("agent_end", {}, api._sessionCtx);
        // Run the setTimeout(0) callback
        vi.runAllTimers();
        const sendCalls = api.sendUserMessage.calls;
        expect(sendCalls.length).toBe(1);
        expect(sendCalls[0][0]).toBe('continue');
    });
    test("does NOT send follow-up in agent_end without prior abort", async () => {
        const api = createMockAPI();
        await docInjectorExtension(api);
        await triggerSessionStart(api);
        // No abort happened — just emit agent_end
        await api.emit("agent_end", {}, api._sessionCtx);
        const sendCalls = api.sendUserMessage.calls;
        expect(sendCalls.length).toBe(0);
    });
});
//# sourceMappingURL=injector-integration.test.js.map