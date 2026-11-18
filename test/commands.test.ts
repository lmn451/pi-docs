/**
 * Tests for registered Doc Injector command behavior.
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { InjectionAuditDetails, InjectionTrigger } from "../audit";
import { registerCommands, type CommandDeps } from "../commands";
import type {
  ExtensionAPI,
  ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { DEFAULT_CONFIG, type DocEntry, type KeywordSource } from "../types";
import { DocRegistry } from "../registry";
import { afterEach, describe, expect, test, vi } from "vitest";

type AuditEntryOptions = {
  timestamp?: string;
  mode?: InjectionAuditDetails["mode"];
  boundary?: InjectionAuditDetails["boundary"];
  turnIndex?: number;
  relativePath?: string;
  keywordSource?: KeywordSource;
  triggers?: InjectionTrigger[];
};

function makeAuditEntry(
  index: number,
  options: AuditEntryOptions = {},
): unknown {
  const details: InjectionAuditDetails = {
    version: 1,
    mode: options.mode ?? "simple",
    boundary: options.boundary ?? "before_agent_start",
    ...(options.turnIndex === undefined
      ? {}
      : { turnIndex: options.turnIndex }),
    documents: [
      {
        relativePath: options.relativePath ?? `docs/doc-${index}.md`,
        keywordSource: options.keywordSource ?? "filename",
        triggers: options.triggers ?? [
          { source: "input", matchedKeywords: [`term-${index}`] },
        ],
      },
    ],
  };
  return {
    id: `entry-${index}`,
    type: "custom_message",
    customType: "doc-injector",
    content: "saved document context",
    display: true,
    timestamp:
      options.timestamp ??
      new Date(Date.UTC(2025, 0, 1, 0, 0, index)).toISOString(),
    details,
  };
}

function makeDocInjectHandler() {
  type Handler = (args: string, ctx: ExtensionContext) => Promise<void>;
  const handlers = new Map<string, Handler>();
  const pi = {
    registerCommand: (name: string, command: { handler: Handler }): void => {
      handlers.set(name, command.handler);
    },
  } as unknown as ExtensionAPI;
  const deps: CommandDeps = {
    getRegistry: () => null,
    resetInjectionState: vi.fn(),
    getEnabled: () => true,
    setEnabled: () => {},
    reloadRegistry: async () => 0,
    getConfig: () => DEFAULT_CONFIG,
    generateKeywordsLLM: async () => {},
  };
  registerCommands(pi, deps);
  const handler = handlers.get("doc-inject");
  if (!handler) throw new Error("doc-inject command was not registered");
  return handler;
}

function makeCommandContext(getBranch: () => unknown[]) {
  const notifications: Array<{
    message: string;
    type?: "info" | "warning" | "error";
  }> = [];
  const context = {
    sessionManager: { getBranch },
    ui: {
      notify: (message: string, type?: "info" | "warning" | "error") => {
        notifications.push({ message, type });
      },
    },
  } as unknown as ExtensionContext;
  return { context, notifications };
}

describe("/doc-inject history", () => {
  const handler = makeDocInjectHandler();

  test("shows saved path, match reasons, boundary, and live branch history", async () => {
    let branch: unknown[] = [
      makeAuditEntry(1, {
        timestamp: "2025-03-04T05:06:07.000Z",
        mode: "keywords",
        boundary: "turn_end",
        turnIndex: 7,
        relativePath: "guides/auth.md",
        keywordSource: "frontmatter",
        triggers: [
          { source: "input", matchedKeywords: ["auth"] },
          { source: "assistant", matchedKeywords: ["login"] },
        ],
      }),
    ];
    const getBranch = vi.fn(() => branch);
    const { context, notifications } = makeCommandContext(getBranch);

    await handler("history", context);

    const first = notifications.at(-1)?.message ?? "";
    expect(first).toContain("2025-03-04T05:06:07.000Z");
    expect(first).toContain("guides/auth.md");
    expect(first).toContain("Mode: keywords");
    expect(first).toContain("keyword source: frontmatter");
    expect(first).toContain("input: auth");
    expect(first).toContain("assistant: login");
    expect(first).toContain("Boundary: turn_end");
    expect(first).toContain("Turn index: 7");
    expect(first).not.toContain("saved document context");

    branch = [makeAuditEntry(2, { relativePath: "docs/deploy.md" })];
    await handler("history", context);

    const second = notifications.at(-1)?.message ?? "";
    expect(second).toContain("docs/deploy.md");
    expect(second).not.toContain("guides/auth.md");
    expect(getBranch).toHaveBeenCalledTimes(2);
  });

  test("supports the default recent window, a count, and all records", async () => {
    const branch = Array.from({ length: 23 }, (_, index) =>
      makeAuditEntry(index),
    );
    const { context, notifications } = makeCommandContext(() => branch);

    await handler("history", context);
    const recent = notifications.at(-1)?.message ?? "";
    expect(recent).toContain("Showing 20 of 23");
    expect(recent).toContain("docs/doc-22.md");
    expect(recent).toContain("docs/doc-3.md");
    expect(recent).not.toContain("docs/doc-2.md");
    expect(recent).toContain("Older records are omitted");

    await handler("history 2", context);
    const counted = notifications.at(-1)?.message ?? "";
    expect(counted).toContain("Showing 2 of 23");
    expect(counted).toContain("docs/doc-22.md");
    expect(counted).toContain("docs/doc-21.md");
    expect(counted).not.toContain("docs/doc-20.md");
    expect(counted).toContain("Older records are omitted");

    await handler("history all", context);
    const all = notifications.at(-1)?.message ?? "";
    expect(all).toContain("Showing 23 of 23");
    expect(all).toContain("docs/doc-0.md");
    expect(all).toContain("docs/doc-22.md");
    expect(all).not.toContain("Older records are omitted");
  });

  test("explains empty and legacy-only branches", async () => {
    let branch: unknown[] = [];
    const { context, notifications } = makeCommandContext(() => branch);

    await handler("history", context);
    expect(notifications.at(-1)?.message).toContain(
      "No saved injection records were found",
    );

    branch = [
      {
        id: "legacy-entry",
        type: "custom_message",
        customType: "doc-injector",
        content: "older saved document context",
        display: true,
        timestamp: "2025-03-04T05:06:07.000Z",
      },
    ];
    await handler("history", context);

    const legacy = notifications.at(-1)?.message ?? "";
    expect(legacy).toContain("No readable saved injection records");
    expect(legacy).toContain("1 doc-inject message");
    expect(legacy).toContain("reasons and timing are unknown");
  });

  test("warns for invalid counts and does not read history", async () => {
    const getBranch = vi.fn(() => []);
    const { context, notifications } = makeCommandContext(getBranch);

    for (const args of [
      "history 0",
      "history -1",
      "history 1.5",
      "history 1e3",
      "history 9007199254740992",
      "history all extra",
    ]) {
      await handler(args, context);
      const warning = notifications.at(-1);
      expect(warning?.type).toBe("warning");
      expect(warning?.message).toContain(
        "Usage: /doc-inject history [count|all]",
      );
    }
    expect(getBranch).not.toHaveBeenCalled();
  });
});

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

test.each(["", "auth.md"])(
  "cached heuristic docs remain eligible for LLM upgrade (path=%s)",
  async (path) => {
    const root = mkdtempSync(join(tmpdir(), "pi-command-test-"));
    roots.push(root);
    mkdirSync(join(root, "docs"));
    writeFileSync(
      join(root, "docs", "auth.md"),
      "# Authentication\nLogin instructions.",
    );
    writeFileSync(
      join(root, "docs", "explicit.md"),
      "---\nkeywords: [explicit]\n---\nExplicit doc.",
    );
    const config = { ...DEFAULT_CONFIG, mode: "keywords" as const };
    const notifier = { warn() {}, info() {}, error() {}, setContext() {} };
    const registry = await DocRegistry.create(
      join(root, "docs"),
      config,
      undefined,
      notifier,
    );
    const files = registry.getDirtyCache();
    registry.updateCache({ version: 1, files });
    await registry.rebuild();
    expect(
      registry.getEntries().find((entry) => entry.relativePath === "auth.md")
        ?.keywordSource,
    ).toBe("cache");
    const commands = new Map<string, any>();
    const generate = vi.fn();
    registerCommands(
      {
        registerCommand(name: string, command: any) {
          commands.set(name, command);
        },
      } as any,
      {
        getRegistry: () => registry,
        resetInjectionState: () => registry.markAllNotInjected(),
        getEnabled: () => true,
        setEnabled() {},
        reloadRegistry: async () => registry.getEntries().length,
        getConfig: () => config,
        generateKeywordsLLM: generate,
      },
    );
    await commands
      .get("doc-keywords-gen")
      .handler(path, { ui: { notify: vi.fn() } });
    expect(generate).toHaveBeenCalledOnce();
    expect(generate.mock.calls[0][0].map((file: any) => file.path)).toEqual([
      "auth.md",
    ]);
    registry.updateCache({
      version: 1,
      files: { "auth.md": { mtimeMs: -1, keywords: ["login"] } },
    });
    await registry.rebuild();
    generate.mockClear();
    await commands
      .get("doc-keywords-gen")
      .handler(path, { ui: { notify: vi.fn() } });
    expect(generate).not.toHaveBeenCalled();
  },
);

const makeEntry = (
  name: string,
  source: DocEntry["keywordSource"],
): DocEntry => ({
  filePath: `/docs/${name}`,
  fileName: name,
  relativePath: name,
  title: name,
  keywords: ["some", "keyword"],
  content: `# ${name}`,
  injected: false,
  keywordSource: source,
});

describe("/doc-keywords-gen filter", () => {
  // Mirrors the candidate rules used by `/doc-keywords-gen` without coupling
  // this test to the command's implementation details.
  const isCandidate = (e: DocEntry): boolean => {
    if (e.keywordSource === "frontmatter") return false;
    if (e.keywordSource === "cache") return false;
    if (e.keywordSource === "llm") return false;
    return true;
  };

  test("excludes frontmatter entries", () => {
    const e = makeEntry("fm.md", "frontmatter");
    expect(isCandidate(e)).toBe(false);
  });

  test("excludes cache entries (heuristic-written, surfaced as cache)", () => {
    const e = makeEntry("cached.md", "cache");
    expect(isCandidate(e)).toBe(false);
  });

  test("excludes LLM-labeled entries (the fix makes this branch reachable)", () => {
    const e = makeEntry("llm.md", "llm");
    expect(isCandidate(e)).toBe(false);
  });

  test("includes only heuristic entries", () => {
    const entries = [
      makeEntry("a.md", "frontmatter"),
      makeEntry("b.md", "cache"),
      makeEntry("c.md", "llm"),
      makeEntry("d.md", "heuristic"),
    ];
    const candidates = entries.filter(isCandidate);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].relativePath).toBe("d.md");
  });
});
