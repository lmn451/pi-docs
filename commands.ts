/**
 * Slash commands for the Doc Injector extension.
 */
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import type { DocRegistry } from "./registry";

export function registerCommands(
  pi: ExtensionAPI,
  getRegistry: () => DocRegistry | null,
  getEnabled: () => boolean,
  setEnabled: (v: boolean) => void,
): void {
  const cmd = (name: string, desc: string, handler: (args: string, ctx: ExtensionContext) => void) => {
    pi.registerCommand(name, { description: desc, handler });
  };

  cmd("doc-inject", "Doc injector: on|off|toggle|list|reset|status", (args, ctx) => {
    const a = args.trim().toLowerCase();
    if (a === "on") {
      setEnabled(true);
      ctx.ui.notify("📄 Doc injection enabled", "success");
    } else if (a === "off") {
      setEnabled(false);
      ctx.ui.notify("📄 Doc injection disabled", "warning");
    } else if (a === "toggle") {
      const next = !getEnabled();
      setEnabled(next);
      ctx.ui.notify(`📄 Doc injection ${next ? "enabled" : "disabled"}`, "info");
    } else if (a === "reset") {
      const reg = getRegistry();
      if (reg) {
        reg.reset();
        ctx.ui.notify("📄 Injection state reset", "success");
      } else {
        ctx.ui.notify("📄 No registry loaded", "warning");
      }
    } else if (a === "list") {
      const reg = getRegistry();
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
        return `${status} ${e.fileName}: "${e.title}" — keywords: [${e.keywords.join(", ")}]`;
      });
      ctx.ui.notify(`📄 Registered docs:\n${lines.join("\n")}`, "info");
    } else {
      // status (default)
      const reg = getRegistry();
      if (!reg) {
        ctx.ui.notify("📄 Status: No registry loaded", "warning");
        return;
      }
      const entries = reg.getEntries();
      const injected = entries.filter((e) => e.injected).length;
      const kwCount = entries.reduce((sum, e) => sum + e.keywords.length, 0);
      ctx.ui.notify(
        `📄 Doc Injector Status:\n` +
        `  Enabled: ${getEnabled() ? "✅" : "❌"}\n` +
        `  Docs: ${entries.length}\n` +
        `  Keywords: ${kwCount}\n` +
        `  Injected: ${injected}`,
        "info",
      );
    }
  });

  cmd("doc-reload", "Re-scan docs folder and rebuild registry", (_args, ctx) => {
    const reg = getRegistry();
    if (!reg) {
      ctx.ui.notify("📄 No registry to reload", "warning");
      return;
    }
    // We can't call rebuild() async from a command handler easily,
    // so we notify and trigger via the event system
    ctx.ui.notify("📄 Triggering docs reload…", "info");
    // Trigger a resources_discover-like reload by rebuilding directly
    reg.rebuild().then(() => {
      const count = reg.getEntries().length;
      ctx.ui.notify(`📄 Reloaded: ${count} documents found`, "success");
    }).catch((err) => {
      ctx.ui.notify(`📄 Reload failed: ${err instanceof Error ? err.message : String(err)}`, "error");
    });
  });
}
