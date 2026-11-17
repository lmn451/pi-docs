import { afterEach, expect, test, vi } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import docInjectorExtension from "../../index";

const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

// Exercise Pi's actual boundary commit and agent loop with a local fake stream.
// No provider, credentials, or external requests are used.
test.each([false, true])(
  "persisted docs enter the next request in the same run (natural tools: %s)",
  async (withTool) => {
    const root = mkdtempSync(join(tmpdir(), "pi-doc-boundary-"));
    roots.push(root);
    mkdirSync(join(root, "docs"));
    mkdirSync(join(root, "agent"));
    writeFileSync(
      join(root, "docs", "auth.md"),
      "# Auth\nPrivate project auth instructions.",
    );
    const settingsManager = SettingsManager.inMemory({
      compaction: { enabled: false },
      retry: { enabled: false },
    });
    const modelRuntime = await ModelRuntime.create({
      authPath: join(root, "agent", "auth.json"),
      modelsPath: null,
      modelsStorePath: join(root, "agent", "models.json"),
      refreshOnCreate: false,
    });
    const model = modelRuntime.getModels()[0];
    expect(model).toBeDefined();
    vi.spyOn(modelRuntime, "hasConfiguredAuth").mockReturnValue(true);
    vi.spyOn(modelRuntime, "getAuth").mockResolvedValue({
      apiKey: "test-only",
    } as any);
    const loader = new DefaultResourceLoader({
      cwd: root,
      agentDir: join(root, "agent"),
      settingsManager,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      extensionFactories: [docInjectorExtension],
    });
    await loader.reload();
    const manager = SessionManager.inMemory(root);
    const { session } = await createAgentSession({
      cwd: root,
      agentDir: join(root, "agent"),
      model,
      modelRuntime,
      settingsManager,
      sessionManager: manager,
      resourceLoader: loader,
      tools: withTool ? ["read"] : [],
    });
    const extensionErrors: unknown[] = [];
    await session.bindExtensions({
      onError: (error) => {
        extensionErrors.push(error);
      },
    });
    const requests: unknown[] = [];
    session.agent.streamFunction = (_model, context) => {
      requests.push(structuredClone(context));
      if (requests.length > 2)
        throw new Error("Unexpected redundant provider request");
      const first = requests.length === 1;
      const message = {
        role: "assistant",
        api: model.api,
        provider: model.provider,
        model: model.id,
        content: first
          ? [
              {
                type: "thinking",
                thinking: "Consider auth before proceeding.",
              },
              ...(withTool
                ? [
                    {
                      type: "toolCall",
                      id: "read-doc",
                      name: "read",
                      arguments: { path: "docs/auth.md" },
                    },
                  ]
                : [{ type: "text", text: "I will explain the project." }]),
            ]
          : [{ type: "text", text: "Finished using the auth instructions." }],
        stopReason: first && withTool ? "toolUse" : "stop",
        usage: {
          input: 1,
          output: 1,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 2,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        timestamp: Date.now(),
      };
      return {
        async *[Symbol.asyncIterator]() {
          yield { type: "done", reason: message.stopReason, message };
        },
        result: async () => message,
      } as any;
    };
    try {
      await session.prompt("Explain the project.");
      expect(extensionErrors).toEqual([]);
      expect(requests).toHaveLength(2);
      expect(JSON.stringify(requests[0])).not.toContain(
        "Private project auth instructions.",
      );
      expect(JSON.stringify(requests[1])).toContain(
        "Private project auth instructions.",
      );
      const docs = manager
        .getBranch()
        .filter(
          (entry) =>
            entry.type === "custom_message" &&
            entry.customType === "doc-injector",
        );
      expect(docs).toHaveLength(1);
      expect(
        manager
          .getBranch()
          .filter(
            (entry) =>
              entry.type === "message" && entry.message.role === "user",
          ),
      ).toHaveLength(1);
      if (withTool) {
        const branch = manager.getBranch();
        const toolIndex = branch.findIndex(
          (entry) =>
            entry.type === "message" && entry.message.role === "toolResult",
        );
        expect(toolIndex).toBeGreaterThan(-1);
        expect(branch.indexOf(docs[0])).toBeGreaterThan(toolIndex);
      }
      // The captured first request remains unchanged after boundary persistence.
      expect(JSON.stringify(requests[0])).not.toContain(
        "Relevant Context Documents",
      );
    } finally {
      session.dispose();
    }
  },
  15000,
);
