/**
 * Slash commands for the Doc Injector extension.
 */
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { DocRegistry } from "./registry";

export interface CommandDeps {
  getRegistry: () => DocRegistry | null;
  getEnabled: () => boolean;
  setEnabled: (v: boolean) => void;
  reloadRegistry: () => Promise<number>;
}

export function registerCommands(pi: ExtensionAPI, deps: CommandDeps): void {
  const cmd = (name: string, desc: string, handler: (args: string, ctx: ExtensionContext) => Promise<void>) => {
    pi.registerCommand(name, { description: desc, handler });
  };

  cmd("doc-inject", "Doc injector: on|off|toggle|list|reset|status", async (args, ctx) => {
    const a = args.trim().toLowerCase();
    if (a === "on") {
      deps.setEnabled(true);
      ctx.ui.notify("📄 Doc injection enabled", "info");
    } else if (a === "off") {
      deps.setEnabled(false);
      ctx.ui.notify("📄 Doc injection disabled", "warning");
    } else if (a === "toggle") {
      const next = !deps.getEnabled();
      deps.setEnabled(next);
      ctx.ui.notify(`📄 Doc injection ${next ? "enabled" : "disabled"}`, "info");
    } else if (a === "reset") {
      const reg = deps.getRegistry();
      if (reg) {
        reg.reset();
        ctx.ui.notify("📄 Injection state reset", "info");
      } else {
        ctx.ui.notify("📄 No registry loaded", "warning");
      }
    } else if (a === "list") {
      const reg = deps.getRegistry();
      if (!reg) {
        ctx.ui.notify("📄 No docs loaded", "warning");
        return;
      }
      const entries = reg.getEntries();
      if (entries.length === 0) {
        ctx.ui.notify("📄 No documents found in docs folder", "info");
        return;
      }
      const lines = entries.map((e) => {
        const status = e.injected ? "✅" : "⬜";
        return `${status} ${e.relativePath}: "${e.title}" — keywords: [${e.keywords.join(", ")}]`;
      });
      ctx.ui.notify(`📄 Registered docs:\n${lines.join("\n")}`, "info");
    } else {
      // status (default)
      const reg = deps.getRegistry();
      if (!reg) {
        ctx.ui.notify("📄 Status: No registry loaded", "warning");
        return;
      }
      const entries = reg.getEntries();
      const injected = entries.filter((e) => e.injected).length;
      const kwCount = entries.reduce((sum, e) => sum + e.keywords.length, 0);
      ctx.ui.notify(
        `📄 Doc Injector Status:\n` +
        `  Enabled: ${deps.getEnabled() ? "✅" : "❌"}\n` +
        `  Docs: ${entries.length}\n` +
        `  Keywords: ${kwCount}\n` +
        `  Injected: ${injected}`,
        "info",
      );
    }
  });

  cmd("doc-reload", "Re-scan docs folder and rebuild registry", async (_args, ctx) => {
    try {
      const count = await deps.reloadRegistry();
      ctx.ui.notify(`📄 Reloaded: ${count} documents found`, "info");
    } catch (err) {
      ctx.ui.notify(`📄 Reload failed: ${err instanceof Error ? err.message : String(err)}`, "error");
    }
  });
}
