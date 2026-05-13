## Doc Injector Robustness - 2026-05-06

- [x] **LLM keyword gen mechanism** — Pi ExtensionAPI has no `pi.callModel()`. Decision: opt-in `/doc-keywords-gen` command with hidden tool.
- [x] **Glob library choice** — Decision: picomatch (~18KB, 0 deps). Only need `isMatch()`.
- [x] **Binary detection strategy** — Decision: extension blacklist (fast) + content sampling (safety net).
- [x] **LLM batching approach** — Decision: 20 files/batch, single structured tool call per batch.
- [x] **Cache strategy** — Decision: mtime-based in `.pi/doc-injector-cache.json`. Content hash defeats caching purpose.
- [x] **Config async refactor** — Decision: Yes, trivial (~5 lines). Factory is already async.
- [x] **Directories-as-docs** — Decision: No special handling. `relativePath` + `index.md` pattern is sufficient.
