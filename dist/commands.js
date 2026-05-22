/**
 * Register all doc-injector slash commands on the given ExtensionAPI.
 *
 * Commands:
 * - `/doc-inject [on|off|toggle|list|reset|status]` — manage injection state
 * - `/doc-reload` — re-scan docs folder
 * - `/doc-keywords-gen [path]` — generate LLM keywords for keyword-less files
 */
export function registerCommands(pi, deps) {
    const cmd = (name, desc, handler) => {
        pi.registerCommand(name, { description: desc, handler });
    };
    cmd("doc-inject", "Doc injector: on|off|toggle|list|reset|status", async (args, ctx) => {
        const a = args.trim().toLowerCase();
        if (a === "on") {
            deps.setEnabled(true);
            ctx.ui.notify("📄 Doc injection enabled", "info");
        }
        else if (a === "off") {
            deps.setEnabled(false);
            ctx.ui.notify("📄 Doc injection disabled", "warning");
        }
        else if (a === "toggle") {
            const next = !deps.getEnabled();
            deps.setEnabled(next);
            ctx.ui.notify(`📄 Doc injection ${next ? "enabled" : "disabled"}`, "info");
        }
        else if (a === "reset") {
            const reg = deps.getRegistry();
            if (reg) {
                reg.reset();
                ctx.ui.notify("📄 Injection state reset", "info");
            }
            else {
                ctx.ui.notify("📄 No registry loaded", "warning");
            }
        }
        else if (a === "list") {
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
                const sourceTag = `[${e.keywordSource}]`;
                return `${status} ${sourceTag} ${e.relativePath}: "${e.title}" — keywords: [${e.keywords.join(", ")}]`;
            });
            ctx.ui.notify(`📄 Registered docs:\n${lines.join("\n")}`, "info");
        }
        else {
            // status (default)
            const reg = deps.getRegistry();
            if (!reg) {
                ctx.ui.notify("📄 Status: No registry loaded", "warning");
                return;
            }
            const entries = reg.getEntries();
            const injected = entries.filter((e) => e.injected).length;
            const kwCount = entries.reduce((sum, e) => sum + e.keywords.length, 0);
            ctx.ui.notify(`📄 Doc Injector Status:\n` +
                `  Enabled: ${deps.getEnabled() ? "✅" : "❌"}\n` +
                `  Docs: ${entries.length}\n` +
                `  Keywords: ${kwCount}\n` +
                `  Injected: ${injected}`, "info");
        }
    });
    cmd("doc-reload", "Re-scan docs folder and rebuild registry", async (_args, ctx) => {
        try {
            const count = await deps.reloadRegistry();
            ctx.ui.notify(`📄 Reloaded: ${count} documents found`, "info");
        }
        catch (err) {
            ctx.ui.notify(`📄 Reload failed: ${err instanceof Error ? err.message : String(err)}`, "error");
        }
    });
    cmd("doc-keywords-gen", "Generate LLM keywords: /doc-keywords-gen [path] — no arg = all keyword-less files", async (args, ctx) => {
        const reg = deps.getRegistry();
        if (!reg) {
            ctx.ui.notify("📄 No registry loaded", "warning");
            return;
        }
        const config = deps.getConfig();
        if (!config.llmKeywords) {
            ctx.ui.notify("📄 LLM keyword generation is disabled (llmKeywords: false in config)", "warning");
            return;
        }
        const targetPath = args.trim();
        // Filter to keyword-less entries (keywordSource !== "frontmatter", "cache", or "llm")
        let candidates = reg.getEntries().filter((e) => {
            if (e.keywordSource === "frontmatter")
                return false;
            if (e.keywordSource === "cache")
                return false;
            if (e.keywordSource === "llm")
                return false; // already LLM-generated
            return true;
        });
        if (targetPath) {
            candidates = candidates.filter((e) => e.relativePath.includes(targetPath));
            if (candidates.length === 0) {
                ctx.ui.notify(`📄 No keyword-less files matching "${targetPath}"`, "info");
                return;
            }
        }
        if (candidates.length === 0) {
            ctx.ui.notify("📄 All files already have keywords", "info");
            return;
        }
        const batchSize = config.llmBatchSize;
        const batches = [];
        for (let i = 0; i < candidates.length; i += batchSize) {
            const batch = candidates.slice(i, i + batchSize).map((e) => ({
                path: e.relativePath,
                snippet: e.content.slice(0, 500),
                existingKeywords: e.keywords,
            }));
            batches.push(batch);
        }
        ctx.ui.notify(`📄 Sending ${batches.length} keyword-generation batch(es) for ${candidates.length} file(s)...`, "info");
        for (const batch of batches) {
            await deps.generateKeywordsLLM(batch);
        }
    });
}
//# sourceMappingURL=commands.js.map