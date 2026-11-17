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
    return result as
      | {
          message?: { content: string; details?: unknown };
          entries?: Array<{
            type: string;
            customType: string;
            content: string;
            display: boolean;
            details?: unknown;
          }>;
          continue?: boolean;
        }
      | undefined;
  }
  return { root, pi, ctx, tools, emit, abort, sendUserMessage };
}

function turn(content: unknown, options: Record<string, unknown> = {}) {
  return {
    outcome: "completed",
    message: { role: "assistant", content },
    entries: [],
    toolResults: [],
    ...options,
  };
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
  expect(injected?.message?.details).toEqual({
    version: 1,
    mode: "simple",
    boundary: "before_agent_start",
    documents: [
      {
        relativePath: "auth.md",
        keywordSource: "filename",
        triggers: [{ source: "input", matchedKeywords: ["auth"] }],
      },
    ],
  });
  expect(injected?.message?.content).toContain("Important auth advice.");
  await emit("input", { source: "interactive", text: "auth again" });
  expect((await emit("before_agent_start", {}))?.message).toBeUndefined();
});

test("finished thinking and output inject at the same-run boundary without abort or a user message", async () => {
  const { pi, emit, abort, sendUserMessage } = setup();
  await docInjectorExtension(pi as any);
  await emit("session_start", { reason: "startup" });
  await emit("before_agent_start", { messageType: "user" });
  const event = turn([
    { type: "thinking", thinking: "Consider auth" },
    { type: "text", text: "Explain billing" },
  ]);
  await emit("message_update", { message: event.message });
  expect(await emit("before_agent_start", {})).toBeUndefined();
  await emit("message_end", { message: event.message });
  // Tool result message_end must not discard the finalized assistant match.
  await emit("message_end", { message: { role: "toolResult" } });
  const result = await emit("turn_end", event);
  expect(result?.continue).toBe(true);
  expect(result?.entries).toHaveLength(1);
  expect(result?.entries?.[0]).toMatchObject({
    type: "custom_message",
    customType: "doc-injector",
    display: true,
  });
  expect(result?.entries?.[0].details).toEqual({
    version: 1,
    mode: "simple",
    boundary: "turn_end",
    documents: [
      {
        relativePath: "auth.md",
        keywordSource: "filename",
        triggers: [{ source: "assistant", matchedKeywords: ["auth"] }],
      },
      {
        relativePath: "billing.md",
        keywordSource: "filename",
        triggers: [{ source: "assistant", matchedKeywords: ["billing"] }],
      },
    ],
  });
  expect(result?.entries?.[0].content).toContain("Important auth advice.");
  expect(result?.entries?.[0].content).toContain("Billing advice.");
  expect(result?.entries?.[0].content).toContain(
    "Continue the user's current task",
  );
  expect(result).not.toHaveProperty("systemPrompt");
  expect(event.entries).toEqual([]);
  expect(abort).not.toHaveBeenCalled();
  expect(sendUserMessage).not.toHaveBeenCalled();
  expect(await emit("turn_end", event)).toBeUndefined();
  expect(await emit("before_agent_start", {})).toBeUndefined();
});

test("the full user input is scanned even with a tiny keyword streaming window", async () => {
  const { root, pi, emit } = setup();
  writeFileSync(
    join(root, ".pi", "doc-injector.json"),
    JSON.stringify({ streamWindowSize: 1 }),
  );
  await docInjectorExtension(pi as any);
  await emit("session_start", {});
  await emit("input", { text: "auth " + "x".repeat(20000) });
  expect((await emit("before_agent_start", {}))?.message?.content).toContain(
    "Important auth advice.",
  );
});

test.each(["thinking", "text"])(
  "finished %s scans all content without truncation",
  async (type) => {
    const { root, pi, emit } = setup();
    writeFileSync(
      join(root, ".pi", "doc-injector.json"),
      JSON.stringify({ streamWindowSize: 1 }),
    );
    await docInjectorExtension(pi as any);
    await emit("session_start", {});
    const text = "auth " + "x".repeat(20000) + " billing " + "y".repeat(20000);
    // No streaming update is needed: only the finalized content is authoritative.
    const result = await emit("turn_end", turn([{ type, [type]: text }]));
    expect(result?.entries?.[0].content).toContain("Important auth advice.");
    expect(result?.entries?.[0].content).toContain("Billing advice.");
  },
);

test("streamed partial words cannot select a doc before the word finishes", async () => {
  const { pi, emit } = setup();
  await docInjectorExtension(pi as any);
  await emit("session_start", {});
  await emit("message_update", {
    message: { role: "assistant", content: "auth" },
  });
  expect(await emit("before_agent_start", {})).toBeUndefined();
  await emit("message_update", {
    message: { role: "assistant", content: "authentication" },
  });
  expect(await emit("turn_end", turn("authentication"))).toBeUndefined();
  expect(await emit("before_agent_start", {})).toBeUndefined();
});

test("a filename split across updates matches once the completed block contains it", async () => {
  const { pi, emit } = setup();
  await docInjectorExtension(pi as any);
  await emit("session_start", {});
  await emit("message_update", {
    message: { role: "assistant", content: "au" },
  });
  expect(await emit("turn_end", turn("auth"))).toHaveProperty("continue", true);
});

test("blocks are matched independently without invented phrases or joined words", async () => {
  const { root, pi, emit } = setup();
  // A newline is legal in a filename; joining blocks with '\n' must not create it.
  writeFileSync(join(root, "docs", "api\nauth.md"), "Cross-block phrase doc.");
  await docInjectorExtension(pi as any);
  await emit("session_start", {});
  expect(
    await emit(
      "turn_end",
      turn([
        { type: "thinking", thinking: "au" },
        { type: "text", text: "th" },
      ]),
    ),
  ).toBeUndefined();
  const result = await emit(
    "turn_end",
    turn([
      { type: "text", text: "api" },
      { type: "text", text: "auth" },
    ]),
  );
  expect(result?.entries?.[0].content).toContain("Important auth advice.");
  expect(result?.entries?.[0].content).not.toContain("Cross-block phrase doc.");
  await emit("input", { text: "api\nauth" });
  expect((await emit("before_agent_start", {}))?.message?.content).toContain(
    "Cross-block phrase doc.",
  );
});

test.each(["aborted", "error"])(
  "%s outcomes never inject or continue, and leave docs eligible",
  async (outcome) => {
    const { pi, emit, abort, sendUserMessage } = setup();
    await docInjectorExtension(pi as any);
    await emit("session_start", {});
    await emit("message_update", {
      message: { role: "assistant", content: "auth" },
    });
    await emit("message_end", {
      message: { role: "assistant", content: "auth" },
    });
    expect(await emit("turn_end", turn("auth", { outcome }))).toBeUndefined();
    expect(
      await emit("before_agent_start", { messageType: "user" }),
    ).toBeUndefined();
    expect(await emit("turn_end", turn("auth"))).toHaveProperty(
      "continue",
      true,
    );
    expect(abort).not.toHaveBeenCalled();
    expect(sendUserMessage).not.toHaveBeenCalled();
  },
);

test("no match or non-assistant boundary never proposes entries or continuation", async () => {
  const { pi, emit } = setup();
  await docInjectorExtension(pi as any);
  await emit("session_start", {});
  expect(await emit("turn_end", turn("generic response"))).toBeUndefined();
  expect(
    await emit(
      "turn_end",
      turn("", {
        message: { role: "toolResult", content: "auth" },
      }),
    ),
  ).toBeUndefined();
});

test("only one boundary batch per user run; deferred matches survive no-match turns and agent retries", async () => {
  const { pi, emit, ctx } = setup();
  await docInjectorExtension(pi as any);
  await emit("session_start", {});
  await emit("before_agent_start", { messageType: "user" });
  expect(await emit("turn_end", turn("auth"))).toHaveProperty("continue", true);
  await emit("agent_end", { messages: [] });
  await emit("agent_start", {});
  expect(await emit("turn_end", turn("billing"))).toBeUndefined();
  expect(await emit("turn_end", turn("generic response"))).toBeUndefined();
  expect(await emit("turn_end", turn("billing again"))).toBeUndefined();
  const notices = ctx.ui.notify.mock.calls.filter(([text]) =>
    text.includes("continuation limit"),
  );
  expect(notices).toHaveLength(1);
  await emit("input", { text: "more please" });
  const deferred = await emit("before_agent_start", { messageType: "user" });
  expect(deferred?.message?.content).toContain("Billing advice.");
  expect(deferred?.message?.details).toEqual({
    version: 1,
    mode: "simple",
    boundary: "before_agent_start",
    documents: [
      {
        relativePath: "billing.md",
        keywordSource: "filename",
        triggers: [{ source: "assistant", matchedKeywords: ["billing"] }],
      },
    ],
  });
  expect(await emit("turn_end", turn("auth billing"))).toBeUndefined();
});

test("the next user run replenishes the boundary allowance", async () => {
  const { pi, emit } = setup();
  await docInjectorExtension(pi as any);
  await emit("session_start", {});
  await emit("before_agent_start", { messageType: "user" });
  await emit("turn_end", turn("auth"));
  await emit("before_agent_start", { messageType: "user" });
  expect(await emit("turn_end", turn("billing"))).toHaveProperty(
    "continue",
    true,
  );
});

test("boundary draft preserves other extensions' entries and doesn't mutate the completed response", async () => {
  const { pi, emit } = setup();
  await docInjectorExtension(pi as any);
  await emit("session_start", {});
  const earlierDraft = { type: "custom", customType: "other", data: 1 };
  const event = turn([{ type: "text", text: "auth" }], {
    entries: [earlierDraft],
    continue: true,
    toolResults: [{ role: "toolResult", content: "done" }],
  });
  const original = structuredClone(event);
  const result = await emit("turn_end", event);
  expect(event).toEqual(original);
  expect(result?.entries?.[0]).toBe(earlierDraft);
  expect(result?.entries).toHaveLength(2);
  expect(result?.continue).toBe(true);
  // A repeated match leaves the shared boundary decision untouched.
  expect(await emit("turn_end", event)).toBeUndefined();
});

test("context guard applies at the boundary and skipped docs remain eligible", async () => {
  const { pi, emit, ctx } = setup();
  let usage: { tokens: number; percent: number } | null = {
    tokens: 9000,
    percent: 90,
  };
  ctx.getContextUsage = () => usage as any;
  await docInjectorExtension(pi as any);
  await emit("session_start", {});
  expect(await emit("turn_end", turn("auth"))).toBeUndefined();
  expect(ctx.ui.notify).toHaveBeenCalledWith(
    expect.stringContaining("context usage exceeds 80%"),
    "warning",
  );
  usage = null;
  expect(await emit("turn_end", turn("auth"))).toHaveProperty("continue", true);
});

test("failed notification preparation doesn't mark docs or consume the allowance", async () => {
  const { pi, emit, ctx } = setup();
  await docInjectorExtension(pi as any);
  await emit("session_start", {});
  ctx.ui.notify.mockImplementationOnce(() => {
    throw new Error("UI failed");
  });
  await expect(emit("turn_end", turn("auth"))).rejects.toThrow("UI failed");
  expect(await emit("turn_end", turn("auth"))).toHaveProperty("continue", true);
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
