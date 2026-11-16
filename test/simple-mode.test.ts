import { afterEach, expect, test, vi } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import docInjectorExtension from "../index";

const roots: string[] = [];
afterEach(() => {
  vi.useRealTimers();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function setup() {
  const root = mkdtempSync(join(tmpdir(), "pi-doc-simple-"));
  roots.push(root);
  mkdirSync(join(root, ".pi"));
  mkdirSync(join(root, "docs"));
  writeFileSync(
    join(root, "docs", "auth.md"),
    "# Authentication\nImportant auth advice.",
  );
  writeFileSync(join(root, "docs", "billing.md"), "# Billing\nBilling advice.");
  const handlers = new Map<string, Function[]>();
  const tools = new Map<string, any>();
  const sendUserMessage = vi.fn();
  const abort = vi.fn();
  const pi = {
    on(name: string, handler: Function) {
      handlers.set(name, [...(handlers.get(name) ?? []), handler]);
    },
    registerTool(def: any) {
      tools.set(def.name, def);
    },
    registerCommand() {},
    sendUserMessage,
  };
  const ctx = {
    cwd: root,
    ui: { notify: vi.fn() },
    getContextUsage: () => null,
    isIdle: () => false,
    abort,
  };
  async function emit(name: string, data: unknown) {
    let result: unknown;
    for (const handler of handlers.get(name) ?? [])
      result = await handler(data, ctx);
    return result as { message?: { content: string } } | undefined;
  }
  return { root, pi, ctx, tools, emit, abort, sendUserMessage };
}

test("default mode matches a whole filename stem in user input, without frontmatter", async () => {
  const { pi, emit } = setup();
  await docInjectorExtension(pi as any);
  await emit("session_start", { reason: "startup" });
  await emit("input", { source: "interactive", text: "authentication" });
  expect((await emit("before_agent_start", {}))?.message).toBeUndefined();
  await emit("input", { source: "interactive", text: "AUTH guidance please" });
  const injected = await emit("before_agent_start", {
    systemPrompt: "unchanged",
  });
  expect(injected).not.toHaveProperty("systemPrompt");
  expect(injected?.message?.content).toContain("Important auth advice.");
  await emit("input", { source: "interactive", text: "auth again" });
  expect((await emit("before_agent_start", {}))?.message).toBeUndefined();
});

test("thinking and output match filename; inject on next prompt without abort or continue", async () => {
  vi.useFakeTimers();
  const { pi, emit, abort, sendUserMessage } = setup();
  await docInjectorExtension(pi as any);
  await emit("session_start", { reason: "startup" });
  await emit("message_update", {
    message: {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "Consider auth" },
        { type: "text", text: "Explain billing" },
      ],
    },
  });
  await emit("message_end", { message: { role: "assistant" } });
  await emit("agent_end", { messages: [] });
  vi.runAllTimers();
  expect(abort).not.toHaveBeenCalled();
  expect(sendUserMessage).not.toHaveBeenCalled();
  const result = await emit("before_agent_start", {});
  expect(result?.message?.content).toContain("Important auth advice.");
  expect(result?.message?.content).toContain("Billing advice.");
});

test("accumulated streaming updates retain earlier filename matches", async () => {
  const { pi, emit } = setup();
  await docInjectorExtension(pi as any);
  await emit("session_start", { reason: "startup" });
  await emit("message_update", {
    message: { role: "assistant", content: "auth" },
  });
  await emit("message_update", {
    message: {
      role: "assistant",
      content: "auth " + "x".repeat(600) + " billing",
    },
  });
  await emit("message_end", { message: { role: "assistant" } });
  const result = await emit("before_agent_start", {});
  expect(result?.message?.content).toContain("Important auth advice.");
  expect(result?.message?.content).toContain("Billing advice.");
});

test("new session clears pending filename matches", async () => {
  const { pi, emit } = setup();
  await docInjectorExtension(pi as any);
  await emit("session_start", { reason: "startup" });
  await emit("input", { source: "interactive", text: "auth" });
  await emit("session_start", { reason: "new" });
  expect((await emit("before_agent_start", {}))?.message).toBeUndefined();
});

test("keywords mode stays available when selected", async () => {
  const { root, pi, emit } = setup();
  writeFileSync(
    join(root, ".pi", "doc-injector.json"),
    JSON.stringify({ mode: "keywords", matchThreshold: 1 }),
  );
  writeFileSync(
    join(root, "docs", "auth.md"),
    "---\ntitle: Auth\nkeywords: [login]\n---\nLogin doc.",
  );
  await docInjectorExtension(pi as any);
  await emit("session_start", { reason: "startup" });
  await emit("input", { source: "interactive", text: "login" });
  expect((await emit("before_agent_start", {}))?.message?.content).toContain(
    "Login doc.",
  );
});

test("simple mode only indexes top-level markdown and does not write keyword cache", async () => {
  const { root, pi, emit } = setup();
  mkdirSync(join(root, "docs", "nested"));
  writeFileSync(
    join(root, "docs", "nested", "nested.md"),
    "# Nested\nHidden doc.",
  );
  writeFileSync(join(root, "docs", "notes.txt"), "# Notes\nText doc.");
  await docInjectorExtension(pi as any);
  await emit("session_start", { reason: "startup" });
  await emit("input", { source: "interactive", text: "nested notes" });
  expect((await emit("before_agent_start", {}))?.message).toBeUndefined();
  expect(existsSync(join(root, ".pi", "doc-injector-cache.json"))).toBe(false);
});

test("keyword tool rejects paths that are not registered docs", async () => {
  const { root, pi, ctx, tools, emit } = setup();
  writeFileSync(join(root, "outside.md"), "# Outside");
  writeFileSync(
    join(root, ".pi", "doc-injector.json"),
    JSON.stringify({ mode: "keywords" }),
  );
  await docInjectorExtension(pi as any);
  await emit("session_start", { reason: "startup" });
  const tool = tools.get("_doc_injector_keywords");
  const result = await tool.execute(
    "id",
    { keywords: [{ path: "../outside.md", keywords: ["wrong"] }] },
    undefined,
    undefined,
    ctx,
  );
  expect(result.content[0].text).toBe("Keywords saved for 0 files.");
});

test("fresh extension initializes on Pi's reload lifecycle", async () => {
  const { pi, emit } = setup();
  await docInjectorExtension(pi as any);
  await emit("session_start", { reason: "reload" });
  await emit("resources_discover", { reason: "reload" });
  await emit("input", { source: "interactive", text: "auth" });
  expect((await emit("before_agent_start", {}))?.message?.content).toContain(
    "Important auth advice.",
  );
});
