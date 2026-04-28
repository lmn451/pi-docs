## Open Questions — 2026-04-26

> **Important verification finding:** Bug report claim #5 ("the injected flag system is broken") is **incorrect**.
> `getEntries()` returns `[...this.entries]` — a new array with shared object references. Mutating
> `entry.injected = true` on a returned object **does** propagate to `this.entries`. The system works
> as designed, but relies on a fragile/intuitive JS semantics detail that should be made explicit.

- [ ] **Q1:** Does Pi's `message_update` event always contain full accumulated message content, or can it send incremental deltas (partial chunks)?
  **Why:** If full content → current `textBuffer = extractText(msg.content)` is correct (just needs a comment). If incremental → buffer replacement silently discards early content, causing missed keyword matches. This is a potential data-loss bug that cannot be assessed without knowing Pi's API contract.
  **Blocks:** FR-1 (streaming buffer strategy) — cannot choose between replace/accumulate/hybrid.

- [ ] **Q2:** When should injected flags auto-reset — per-turn, per-conversation, or per-session?
  **Why:** Current behavior: injected docs stay excluded for the entire Pi session. If a user discusses "testing" in turn 1 (injecting `test-md.md`), then discusses "workflows" in turn 3, then returns to "testing" in turn 5, the test doc will **never** be re-injected without manual `/doc-inject reset`. This may be desired (avoid repetition) or broken (user expects re-injection).
  **Blocks:** FR-2 (automatic reset strategy).

- [ ] **Q3:** Should nested subdirectories under `docsPath` be scanned recursively, and should this be configurable?
  **Why:** Currently only top-level `.md` files are discovered. Users organizing docs into subfolders (e.g., `docs/api/`, `docs/guides/`) will have those files silently ignored with no warning.
  **Blocks:** FR-3 (recursive scanning implementation).

- [ ] **Q4:** Should `/doc-reload` emit a `resources_discover` event or call `rebuild()` directly?
  **Why:** Two separate reload paths exist (event handler in `index.ts:47-51` and command in `commands.ts:82-90`). Both currently call `registry.rebuild()`, so no functional divergence yet. If `rebuild()` gains side effects, they must be maintained in two places. However, emitting `resources_discover` from a command may trigger other extensions' handlers unintentionally.
  **Blocks:** FR-4 (reload path consolidation).

- [ ] **Q5:** Should `DocRegistry` expose explicit mutation methods (`markInjected`, `markAllNotInjected`) instead of relying on shared-reference mutation?
  **Why:** Current pattern works (verified: shared references propagate mutations). However, it relies on an unintuitive JS semantics detail. A future maintainer could break it by switching `getEntries()` to return deep copies or frozen objects. Encapsulated mutation would be self-documenting and future-proof.
  **Blocks:** FR-5 (explicit mutation API).

- [ ] **Q6:** Is keyword matching on partial streaming content important, or is matching on final content sufficient?
  **Why:** If only final content matters, matching could be deferred to `message_end` for efficiency (avoiding O(n × m) work per `message_update`). If early keyword detection matters (trigger injection before response finishes), matching must run on each update.
  **Blocks:** FR-1 (buffer strategy) and NFR-2 (performance — whether to debounce matching).

- [ ] **Q7:** Should the 80% context-usage threshold for skipping injection be configurable via `.pi/doc-injector.json`?
  **Why:** Currently hardcoded at `index.ts:103`. Different users/projects may want a more conservative (70%) or lenient (90%) threshold.
  **Blocks:** NFR-3 (configurable budget guard).

- [ ] **Q8:** Should a `tsconfig.json` with `strict: true` be added?
  **Why:** No tsconfig exists. Adding strict mode would catch type errors (inline type in `injector.ts:42`, potential undefined issues) but may reveal existing violations that need fixing first.
  **Blocks:** FR-7 (type safety).