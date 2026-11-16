import { afterEach, expect, test, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerCommands } from "../commands";
import { DocRegistry } from "../registry";
import { DEFAULT_CONFIG } from "../types";

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
